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
    const rawEvents: any[] = job.data.events;
    if (!rawEvents || !rawEvents.length) return;

    // 1. Deduplicate by event_id in memory within this batch
    const seen = new Set<string>();
    const events: any[] = [];
    for (const e of rawEvents) {
      if (!e || !e.event_id || seen.has(e.event_id)) continue;
      seen.add(e.event_id);
      events.push(e);
    }
    if (!events.length) return;

    // 2. Classify in memory
    const lateEvents: any[] = [];
    const unknownEvents: any[] = [];
    const candidateAccepted: any[] = [];

    // Pre-check unknown campaigns
    const missingCampaigns = new Set<string>();
    for (const event of events) {
      const observedAt = event.observed_at_ms;
      const emittedAt = event.emitted_at_ms;
      if (emittedAt - observedAt > 21600000) {
        lateEvents.push(event);
      } else {
        if (!this.campaignCache.has(event.campaign_id)) {
          missingCampaigns.add(event.campaign_id);
        }
      }
    }

    if (missingCampaigns.size > 0) {
      const campIds = Array.from(missingCampaigns);
      const rows = await this.manager.query(
        `SELECT id FROM api.campaigns WHERE id = ANY($1)`,
        [campIds]
      );
      for (const r of rows) {
        this.campaignCache.add(r.id);
      }
    }

    for (const event of events) {
      const observedAt = event.observed_at_ms;
      const emittedAt = event.emitted_at_ms;
      if (emittedAt - observedAt > 21600000) {
        continue;
      }
      if (!this.campaignCache.has(event.campaign_id)) {
        unknownEvents.push(event);
      } else {
        candidateAccepted.push(event);
      }
    }

    // 3. One atomic database transaction per batch
    await this.manager.transaction(async (em) => {
      // Late events
      if (lateEvents.length > 0) {
        const chunkSize = 1000;
        for (let i = 0; i < lateEvents.length; i += chunkSize) {
          const chunk = lateEvents.slice(i, i + chunkSize);
          await em.createQueryBuilder()
            .insert()
            .into(LateEvent)
            .values(chunk.map(e => ({ event_id: e.event_id })))
            .orIgnore()
            .execute();
        }
      }

      // DLQ unknown campaigns
      if (unknownEvents.length > 0) {
        const chunkSize = 1000;
        for (let i = 0; i < unknownEvents.length; i += chunkSize) {
          const chunk = unknownEvents.slice(i, i + chunkSize);
          await em.createQueryBuilder()
            .insert()
            .into(DlqEvent)
            .values(chunk.map(e => ({ event_id: e.event_id, reason: 'unknown_campaign', payload: e })))
            .orIgnore()
            .execute();
        }
      }

      // Accepted events
      if (candidateAccepted.length > 0) {
        const newAccepted: any[] = [];
        const chunkSize = 1000;
        for (let i = 0; i < candidateAccepted.length; i += chunkSize) {
          const chunk = candidateAccepted.slice(i, i + chunkSize);
          const res = await em.createQueryBuilder()
            .insert()
            .into(ProcessedEvent)
            .values(chunk.map(e => ({ event_id: e.event_id })))
            .orIgnore()
            .returning('event_id')
            .execute();

          const insertedIds = new Set((res.raw || []).map((r: any) => r.event_id));
          for (const ev of chunk) {
            if (insertedIds.has(ev.event_id)) {
              newAccepted.push(ev);
            }
          }
        }

        if (newAccepted.length > 0) {
          // Batch insert clip metadata
          for (let i = 0; i < newAccepted.length; i += chunkSize) {
            const chunk = newAccepted.slice(i, i + chunkSize);
            await em.createQueryBuilder()
              .insert()
              .into(ClipMetadata)
              .values(chunk.map(e => ({ clip_id: e.clip_id, campaign_id: e.campaign_id, creator_id: e.creator_id })))
              .orIgnore()
              .execute();
          }

          // Batch insert clip view snapshots
          for (let i = 0; i < newAccepted.length; i += chunkSize) {
            const chunk = newAccepted.slice(i, i + chunkSize);
            await em.createQueryBuilder()
              .insert()
              .into(ClipViewSnapshot)
              .values(chunk.map(e => ({
                clip_id: e.clip_id,
                campaign_id: e.campaign_id,
                creator_id: e.creator_id,
                observed_at_ms: e.observed_at_ms.toString(),
                views: e.view_count
              })))
              .orIgnore()
              .execute();
          }

          // Emit Outbox events: 1 per touched campaign
          const touchedCampaigns = new Set<string>();
          for (const ev of newAccepted) {
            touchedCampaigns.add(ev.campaign_id);
          }

          const outboxEntries = Array.from(touchedCampaigns).map(campId => {
            const txId = uuidv4();
            return {
              id: txId,
              type: 'views_updated',
              processed: false,
              payload: {
                version: 1,
                campaign_id: campId,
                aggregator_tx_id: txId
              }
            };
          });

          for (let i = 0; i < outboxEntries.length; i += chunkSize) {
            const chunk = outboxEntries.slice(i, i + chunkSize);
            await em.insert(OutboxEvent, chunk as any);
          }
        }
      }
    });
  }
}

@Processor('invalid')
@Injectable()
export class InvalidConsumer extends BaseConsumer {
  private readonly logger = new Logger(InvalidConsumer.name);

  async process(job: Job<any, any, string>): Promise<any> {
    const rawEvents: string[] = job.data.events;
    if (!rawEvents || !rawEvents.length) return;

    // Deduplicate in memory
    const seen = new Set<string>();
    const entries: { event_id: string; reason: string; payload: any }[] = [];
    for (const line of rawEvents) {
      if (!line) continue;
      const identity = this.getGarbageIdentity(line);
      if (seen.has(identity)) continue;
      seen.add(identity);
      entries.push({ event_id: identity, reason: 'invalid_schema', payload: { raw: line } });
    }

    if (entries.length > 0) {
      await this.manager.transaction(async (em) => {
        const chunkSize = 1000;
        for (let i = 0; i < entries.length; i += chunkSize) {
          const chunk = entries.slice(i, i + chunkSize);
          await em.createQueryBuilder()
            .insert()
            .into(DlqEvent)
            .values(chunk)
            .orIgnore()
            .execute();
        }
      });
    }
  }

  private getGarbageIdentity(line: string): string {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && typeof parsed.event_id === 'string' && parsed.event_id.length > 0) {
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
    const { reason } = job.data;
    if (!reason || reason === 'invalid_schema') return;

    while (true) {
      const processedCount = await this.manager.transaction(async (em) => {
        const rows = await em.query(`SELECT event_id, payload FROM aggregator.dlq WHERE reason = $1 LIMIT 5000 FOR UPDATE SKIP LOCKED`, [reason]);
        if (!rows || rows.length === 0) return 0;

        for (const row of rows) {
          let event = row.payload;
          if (typeof event === 'string') {
            try { event = JSON.parse(event); } catch (e) {}
          }
          if (!event || !event.campaign_id) continue;

          let known = this.campaignCache.has(event.campaign_id);
          if (!known) {
            const res = await em.query('SELECT id FROM api.campaigns WHERE id = $1', [event.campaign_id]);
            if (res.length > 0) {
              this.campaignCache.add(event.campaign_id);
              known = true;
            }
          }

          if (known) {
            await em.createQueryBuilder().insert().into(ProcessedEvent)
              .values({ event_id: event.event_id })
              .orIgnore().execute();

            await em.createQueryBuilder().insert().into(ClipMetadata)
              .values({ clip_id: event.clip_id, campaign_id: event.campaign_id, creator_id: event.creator_id })
              .orIgnore().execute();

            await em.createQueryBuilder().insert().into(ClipViewSnapshot)
              .values({
                clip_id: event.clip_id,
                campaign_id: event.campaign_id,
                creator_id: event.creator_id,
                observed_at_ms: event.observed_at_ms.toString(),
                views: event.view_count
              })
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
        return rows.length;
      });

      if (processedCount === 0) break;
    }
  }
}
