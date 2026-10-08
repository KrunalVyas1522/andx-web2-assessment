import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

@Injectable()
export class AggregatorService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Processes an incoming event with exactly-once deduplication using the Outbox pattern.
   * This logic operates within a single Postgres transaction.
   */
  async processEvent(payload: any): Promise<void> {
    await this.dataSource.transaction(async (em: EntityManager) => {
      // 1. Exact-once Deduplication
      // We try to insert into processed_events. If the event_id already exists, it throws a unique constraint error.
      try {
        await em.query(
          `INSERT INTO aggregator.processed_events (event_id, processed_at) VALUES ($1, NOW())`,
          [payload.event_id]
        );
      } catch (error: any) {
        if (error.code === '23505') {
          // Unique constraint violation - Duplicate event, skip processing safely.
          return;
        }
        throw error;
      }

      // 2. Insert V(clip, t) Snapshot
      await em.query(
        `INSERT INTO aggregator.clip_view_snapshots (clip_id, campaign_id, creator_id, views, observed_at_ms) 
         VALUES ($1, $2, $3, $4, $5)`,
        [payload.clip_id, payload.campaign_id, payload.creator_id, payload.view_count, payload.observed_at_ms]
      );

      // 3. Outbox Pattern
      // We write to the outbox table in the SAME transaction. 
      // The cron job will pick this up and send it to BullMQ safely.
      await em.query(
        `INSERT INTO aggregator.outbox (type, payload) VALUES ($1, $2)`,
        ['views_updated', JSON.stringify({ campaign_id: payload.campaign_id })]
      );
    });
  }
}
