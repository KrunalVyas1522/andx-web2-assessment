import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { validateEvent } from './validator';
import * as dotenv from 'dotenv';
dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://broker:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const rawEventsQueue = new Queue('raw_events', { 
  connection, 
  defaultJobOptions: { removeOnComplete: true, removeOnFail: false } 
});

const app = Fastify({
  bodyLimit: 8 * 1024 * 1024 // 8 MB limit
});

app.addContentTypeParser('application/x-ndjson', { parseAs: 'string' }, (req: FastifyRequest, body: string, done: any) => {
  done(null, body);
});

// GET /healthz
app.get('/healthz', async (req: FastifyRequest, reply: FastifyReply) => {
  reply.code(200).send('OK');
});

// POST /v1/events
app.post('/v1/events', async (req: FastifyRequest, reply: FastifyReply) => {
  // Check backpressure
  const counts = await rawEventsQueue.getJobCounts('waiting', 'active');
  const lag = counts.waiting + counts.active;
  if (lag > 50000) {
    reply.header('Retry-After', '2');
    return reply.code(429).send({ error: 'Too Many Requests' });
  }

  const body = req.body as string | undefined;
  if (body === undefined) {
    return reply.code(202).send({ accepted: 0, rejected: 0 });
  }

  const lines = body.split('\n');
  let realLinesCount = 0;
  for (const line of lines) {
    if (line.trim() !== '') realLinesCount++;
  }

  if (realLinesCount > 10000) {
    return reply.code(413).send({ error: 'Payload Too Large' });
  }

  const accepted: any[] = [];
  const rejected: string[] = [];

  for (const line of lines) {
    const cleanLine = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (cleanLine === '') continue;

    const { valid, event, rawLine } = validateEvent(cleanLine);
    if (valid) {
      accepted.push(event);
    } else {
      rejected.push(rawLine);
    }
  }

  if (accepted.length > 0) {
    await rawEventsQueue.add('view_snapshot_batch', {
      version: 1,
      type: 'view_snapshot_batch',
      events: accepted
    });
  }

  if (rejected.length > 0) {
    await rawEventsQueue.add('invalid_schema_batch', {
      version: 1,
      type: 'invalid_schema_batch',
      events: rejected
    });
  }

  return reply.code(202).send({ accepted: accepted.length, rejected: rejected.length });
});

const start = async () => {
  try {
    await app.listen({ port: 8080, host: '0.0.0.0' });
    console.log('Gateway listening on port 8080');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
start();
