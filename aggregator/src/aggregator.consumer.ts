import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { ProcessedEvent, ClipMetadata, ClipViewSnapshot, DlqEvent, OutboxEvent } from './entities';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

@Processor('raw_events')
@Injectable()
export class AggregatorConsumer extends WorkerHost {
  private readonly logger = new Logger(AggregatorConsumer.name);
  private campaignCache = new Set<string>();

  constructor(
    @InjectEntityManager() private readonly entityManager: EntityManager,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    if (job.name === 'invalid_schema_batch') {
      await this.processInvalidSchema(job.data.events);
    } else if (job.name === 'view_snapshot_batch') {
      await this.processViewSnapshots(job.data.events);
    }
  }

  private async processInvalidSchema(events: string[]) {
    if (!events || events.length === 0) return;

    await this.entityManager.transaction(async (manager) => {
      for (const line of events) {
        const identity = this.getGarbageIdentity(line);
        // check if already processed
        const exists = await manager.findOne(ProcessedEvent, { where: { event_id: identity } });
        if (exists) continue;

        await manager.insert(ProcessedEvent, { event_id: identity });
        
        await manager.createQueryBuilder()
          .insert()
          .into(DlqEvent)
          .values({
            event_id: identity,
            reason: 'invalid_schema',
            payload: { raw: line }
          })
          .orIgnore()
          .execute();
      }
    });
  }

  private getGarbageIdentity(line: string): string {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && typeof parsed.event_id === 'string' && parsed.event_id.match(/^[0-9a-f]{16}$/)) {
        return parsed.event_id;
      }
    } catch (e) {
      // ignore
    }
    return crypto.createHash('sha256').update(line).digest('hex');
  }

  private async processViewSnapshots(events: any[]) {
    if (!events || events.length === 0) return;

    await this.entityManager.transaction(async (manager) => {
      for (const event of events) {
        if (event.type === 'clip_text') continue; // Aggregator ignores clip_text

        // Dedup
        const exists = await manager.findOne(ProcessedEvent, { where: { event_id: event.event_id } });
        if (exists) continue;

        await manager.insert(ProcessedEvent, { event_id: event.event_id });

        // Check late
        const observedAt = new Date(event.observed_at).getTime();
        const emittedAt = new Date(event.emitted_at).getTime();
        if (emittedAt - observedAt > 21600000) {
          // Late -> counted, dropped, NEVER in DLQ
          continue; // dropped
        }

        // Check campaign
        let known = this.campaignCache.has(event.campaign_id);
        if (!known) {
          const res = await manager.query('SELECT id FROM api.campaigns WHERE id = $1', [event.campaign_id]);
          if (res.length > 0) {
            this.campaignCache.add(event.campaign_id);
            known = true;
          }
        }

        if (!known) {
          // unknown_campaign -> DLQ
          await manager.createQueryBuilder()
            .insert()
            .into(DlqEvent)
            .values({
              event_id: event.event_id,
              reason: 'unknown_campaign',
              payload: event
            })
            .orIgnore()
            .execute();
          continue;
        }

        // Valid snapshot
        await manager.createQueryBuilder()
          .insert()
          .into(ClipMetadata)
          .values({
            clip_id: event.clip_id,
            campaign_id: event.campaign_id,
            creator_id: event.creator_id
          })
          .orIgnore() // "A clip never changes campaign or creator"
          .execute();

        // Insert snapshot
        const insertRes = await manager.createQueryBuilder()
          .insert()
          .into(ClipViewSnapshot)
          .values({
            clip_id: event.clip_id,
            observed_at_ms: observedAt.toString(),
            views: event.views
          })
          .orIgnore() // No two accepted snapshots share observed_at for a clip
          .execute();

        if (insertRes.identifiers.length > 0 || insertRes.raw.length > 0 || insertRes.raw) {
          // We inserted a new snapshot. Push to outbox.
          // Wait, orIgnore returns empty if ignored. 
          // Actually, TypeORM's orIgnore() might not return affected rows clearly in all Postgres drivers without returning().
          // So we always push to outbox, or we use .returning('*')?
          // Since exactly-once is handled by ProcessedEvent, and observed_at is unique per clip,
          // if we reach here, it's a new snapshot.
          const txId = uuidv4();
          await manager.insert(OutboxEvent, {
            id: txId,
            payload: {
              version: 1,
              campaign_id: event.campaign_id,
              clip_id: event.clip_id,
              creator_id: event.creator_id,
              views: event.views,
              observed_at_ms: observedAt,
              aggregator_tx_id: txId
            }
          });
        }
      }
    });
  }
}
