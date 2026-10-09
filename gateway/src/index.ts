import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { validateEvent } from './validator';
import * as dotenv from 'dotenv';
dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://broker:6379';
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

const snapshotsQueue = new Queue('snapshots', { connection, defaultJobOptions: { removeOnComplete: true, removeOnFail: false } });
const clipTextQueue = new Queue('clip_text', { connection, defaultJobOptions: { removeOnComplete: true, removeOnFail: false } });
const invalidQueue = new Queue('invalid', { connection, defaultJobOptions: { removeOnComplete: true, removeOnFail: false } });

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
  // Check backpressure by checking Redis memory directly 
  const info = await connection.info('memory');
  const match = info.match(/used_memory:(\d+)/);
  const usedMemory = match ? parseInt(match[1], 10) : 0;
  
  if (usedMemory > 1_000_000_000) { // 1 GB (below 1.5GB limit)
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

  const snapshots: any[] = [];
  const clipText: any[] = [];
  const invalid: string[] = [];

  for (const line of lines) {
    const cleanLine = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (cleanLine === '') continue;

    const { valid, event, rawLine } = validateEvent(cleanLine);
    if (valid) {
      if (event.type === 'view_snapshot' || event.type === undefined) {
        snapshots.push(event);
      } else if (event.type === 'clip_text') {
        clipText.push(event);
      }
    } else {
      invalid.push(rawLine);
    }
  }

  if (snapshots.length > 0) {
    await snapshotsQueue.add('batch', {
      version: 1,
      type: 'view_snapshot_batch',
      events: snapshots
    });
  }
  if (clipText.length > 0) {
    await clipTextQueue.add('batch', {
      version: 1,
      type: 'clip_text_batch',
      events: clipText
    });
  }
  if (invalid.length > 0) {
    await invalidQueue.add('batch', {
      version: 1,
      type: 'invalid_schema_batch',
      events: invalid
    });
  }

  return reply.code(202).send({ accepted: snapshots.length + clipText.length, rejected: invalid.length });
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
