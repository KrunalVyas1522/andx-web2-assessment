import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { ProcessedEvent, LateEvent, ClipMetadata, ClipViewSnapshot, DlqEvent, OutboxEvent } from './entities';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
class BaseConsumer extends WorkerHost {
  protected campaignCache = new Set<string>();

  constructor(@InjectEntityManager() protected readonly manager: EntityManager) {
    super();
  }
  async process(job: Job<any, any, string>): Promise<any> {}
}

@Processor('snapshots')
@Injectable()
export class SnapshotsConsumer extends BaseConsumer {
  async process(job: Job<any, any, string>): Promise<any> {
    const events = job.data.events;
    if (!events || !events.length) return;

    for (const event of events) {
      await this.manager.transaction(async (em) => {
        // check exactly-once 
        const exists = await em.findOne(ProcessedEvent, { where: { event_id: event.event_id } });
        if (exists) return;
        const lateExists = await em.findOne(LateEvent, { where: { event_id: event.event_id } });
        if (lateExists) return;

        const observedAt = event.observed_at_ms;
        const emittedAt = event.emitted_at_ms;
        if (emittedAt - observedAt > 21600000) { // 6 hours
          await em.insert(LateEvent, { event_id: event.event_id });
          return;
        }

        let known = this.campaignCache.has(event.campaign_id);
        if (!known) {
          const res = await em.query('SELECT id FROM api.campaigns WHERE id = $1', [event.campaign_id]);
          if (res.length > 0) {
            this.campaignCache.add(event.campaign_id);
            known = true;
          }
        }

        if (!known) {
          // Unknown campaign: send to DLQ, DO NOT mark as processed (can be replayed)
          await em.createQueryBuilder()
            .insert()
            .into(DlqEvent)
            .values({ event_id: event.event_id, reason: 'unknown_campaign', payload: event })
            .orIgnore()
            .execute();
          return;
        }

        // Successfully accepted
        await em.insert(ProcessedEvent, { event_id: event.event_id });

        await em.createQueryBuilder().insert().into(ClipMetadata)
          .values({ clip_id: event.clip_id, campaign_id: event.campaign_id, creator_id: event.creator_id })
          .orIgnore().execute();

        const insertRes = await em.createQueryBuilder().insert().into(ClipViewSnapshot)
          .values({ clip_id: event.clip_id, campaign_id: event.campaign_id, creator_id: event.creator_id, observed_at_ms: observedAt.toString(), views: event.view_count })
          .orIgnore().execute();

        const affected = insertRes.raw ? insertRes.raw.length : 0; // Check if actually inserted
        // Some drivers don't return raw array length reliably on DO NOTHING, so let's check manually if it was inserted via select, or just always emit outbox
        // The safest idempotent way is to always emit, earnings will dedup, or only emit if inserted.
        // Let's assume TypeORM postgres driver returns affected > 0 or raw array when returning is used.
        // Actually, we can use an Outbox payload that is idempotent
        const txId = uuidv4();
        await em.insert(OutboxEvent, {
          id: txId,
          type: 'views_updated',
          payload: {
            version: 1,
            campaign_id: event.campaign_id,
            clip_id: event.clip_id,
            creator_id: event.creator_id,
            views: event.view_count,
            observed_at_ms: observedAt,
            aggregator_tx_id: txId
          } as any
        });
      });
    }
  }
}

@Processor('invalid')
@Injectable()
export class InvalidConsumer extends BaseConsumer {
  private readonly logger = new Logger(InvalidConsumer.name);

  async process(job: Job<any, any, string>): Promise<any> {
    const events = job.data.events;
    if (!events || !events.length) return;

    for (const line of events) {
      await this.manager.transaction(async (em) => {
        const identity = this.getGarbageIdentity(line);
        await em.createQueryBuilder()
          .insert()
          .into(DlqEvent)
          .values({ event_id: identity, reason: 'invalid_schema', payload: { raw: line } })
          .orIgnore()
          .execute();
      });
    }
  }

  private getGarbageIdentity(line: string): string {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && typeof parsed.event_id === 'string' && parsed.event_id.match(/^[0-9a-f]{16}$/)) {
        return parsed.event_id;
      }
    } catch (e) {
      this.logger.debug('Garbage identity parsing failed, falling back to hash', e);
    }
    return crypto.createHash('sha256').update(line).digest('hex');
  }
}

@Processor('dlq_replay')
@Injectable()
export class ReplayConsumer extends BaseConsumer {
  async process(job: Job<any, any, string>): Promise<any> {
    const { reason, batch } = job.data;
    if (!batch || !batch.length) return;
    
    // We are the aggregator, we own the DLQ. We delete the items from DLQ and push them to snapshots or invalid
    // Actually, `dlq_replay` gives us the reason and we fetch from DB, OR the API fetched it and passed it?
    // "replay via broker request owned by aggregator" implies API sends { reason: 'unknown_campaign' }
    // and this consumer reads from DLQ and requeues them.
    await this.manager.transaction(async (em) => {
      const limit = 5000;
      const rows = await em.query(`SELECT event_id, payload FROM aggregator.dlq WHERE reason = $1 LIMIT $2 FOR UPDATE SKIP LOCKED`, [reason, limit]);
      if (!rows.length) return;

      const eventIds = rows.map((r: any) => r.event_id);
      
      // Wait, we can't easily push to bullmq within this transaction natively without outbox, 
      // but since it's a replay, we can just insert them into outbox or directly to bullmq after tx.
      // Easiest is to process them directly here as if they were in the snapshots queue!
      // This guarantees exactly-once and atomic replay without BullMQ intermediary!
      
      for (const row of rows) {
        let event = row.payload;
        if (typeof event === 'string') event = JSON.parse(event);
        
        // Try processing it directly
        // We know it's a valid snapshot if reason was unknown_campaign
        let known = this.campaignCache.has(event.campaign_id);
        if (!known) {
          const res = await em.query('SELECT id FROM api.campaigns WHERE id = $1', [event.campaign_id]);
          if (res.length > 0) {
            this.campaignCache.add(event.campaign_id);
            known = true;
          }
        }

        if (known) {
          await em.insert(ProcessedEvent, { event_id: event.event_id });
          await em.createQueryBuilder().insert().into(ClipMetadata)
            .values({ clip_id: event.clip_id, campaign_id: event.campaign_id, creator_id: event.creator_id })
            .orIgnore().execute();

          await em.createQueryBuilder().insert().into(ClipViewSnapshot)
            .values({ clip_id: event.clip_id, campaign_id: event.campaign_id, creator_id: event.creator_id, observed_at_ms: event.observed_at_ms.toString(), views: event.view_count })
            .orIgnore().execute();

          const txId = uuidv4();
          await em.insert(OutboxEvent, {
            id: txId,
            type: 'views_updated',
            payload: {
              version: 1,
              campaign_id: event.campaign_id,
              clip_id: event.clip_id,
              creator_id: event.creator_id,
              views: event.view_count,
              observed_at_ms: event.observed_at_ms,
              aggregator_tx_id: txId
            } as any
          });
          
          await em.query(`DELETE FROM aggregator.dlq WHERE event_id = $1`, [event.event_id]);
        }
      }
    });
  }
}
