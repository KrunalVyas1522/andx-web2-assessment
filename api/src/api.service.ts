import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class ApiService {
  constructor(
    @InjectEntityManager()
    private readonly em: EntityManager,
    @InjectQueue('raw_events')
    private readonly rawEventsQueue: Queue,
  ) {}

  async getHealth() {
    return { status: 'ok' };
  }

  async upsertCampaigns(campaigns: any[]) {
    if (!campaigns || !Array.isArray(campaigns) || campaigns.length === 0) {
      return { upserted: 0 };
    }

    // Ensure api schema exists
    await this.em.query(`CREATE SCHEMA IF NOT EXISTS api;`);
    await this.em.query(`
      CREATE TABLE IF NOT EXISTS api.campaigns (
        id VARCHAR(50) PRIMARY KEY,
        budget_cents BIGINT NOT NULL,
        cpm_cents BIGINT NOT NULL,
        per_clip_cap_cents BIGINT NOT NULL,
        end_at TIMESTAMP WITH TIME ZONE NOT NULL
      );
    `);

    // Upsert
    const values = campaigns.map(c => [
      c.campaign_id,
      c.budget_cents,
      c.cpm_cents,
      c.per_clip_cap_cents,
      new Date(c.end_at)
    ]);

    let upserted = 0;
    // Batch upsert for efficiency
    await this.em.transaction(async manager => {
      for (const val of values) {
        await manager.query(`
          INSERT INTO api.campaigns (id, budget_cents, cpm_cents, per_clip_cap_cents, end_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO UPDATE SET
            budget_cents = EXCLUDED.budget_cents,
            cpm_cents = EXCLUDED.cpm_cents,
            per_clip_cap_cents = EXCLUDED.per_clip_cap_cents,
            end_at = EXCLUDED.end_at;
        `, val);
        upserted++;
      }
    });

    return { upserted };
  }

  async getStats() {
    // We expect these tables to be created by the aggregator service.
    // distinct_valid_events from aggregator.processed_events
    let distinct_valid_events = 0;
    try {
      const res1 = await this.em.query(`SELECT COUNT(*) as cnt FROM aggregator.processed_events;`);
      distinct_valid_events = parseInt(res1[0].cnt, 10);
    } catch (e) {
      // Ignore if table doesn't exist yet
    }

    // late_dropped from aggregator.late_events
    let late_dropped = 0;
    try {
      const res2 = await this.em.query(`SELECT COUNT(*) as cnt FROM aggregator.late_events;`);
      late_dropped = parseInt(res2[0].cnt, 10);
    } catch (e) { }

    // dlq_pending
    let dlq_invalid = 0;
    let dlq_unknown = 0;
    try {
      const res3 = await this.em.query(`SELECT reason, COUNT(*) as cnt FROM aggregator.dlq GROUP BY reason;`);
      for (const row of res3) {
        if (row.reason === 'invalid_schema') dlq_invalid = parseInt(row.cnt, 10);
        if (row.reason === 'unknown_campaign') dlq_unknown = parseInt(row.cnt, 10);
      }
    } catch (e) { }

    return {
      distinct_valid_events,
      late_dropped,
      dlq_pending: {
        invalid_schema: dlq_invalid,
        unknown_campaign: dlq_unknown,
      }
    };
  }

  async replayDlq(reason: string) {
    if (!reason) {
      return { replayed: 0 };
    }
    
    let replayed = 0;
    try {
      const limit = 5000;
      while (true) {
        const rows = await this.em.query(`
          SELECT event_id, payload FROM aggregator.dlq WHERE reason = $1 LIMIT $2
        `, [reason, limit]);

        if (rows.length === 0) break;

        const events = rows.map(r => typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload);
        const eventIds = rows.map(r => r.event_id);

        // Push to BullMQ. We chunk them into one batch job to match gateway behavior,
        // or just add them as a view_snapshot_batch.
        await this.rawEventsQueue.add('view_snapshot_batch', {
          version: 1, // Contract says internal events are versioned
          type: 'view_snapshot_batch',
          events: events,
        });

        // Delete from DLQ
        await this.em.query(`
          DELETE FROM aggregator.dlq WHERE event_id = ANY($1)
        `, [eventIds]);

        replayed += rows.length;
      }
    } catch (e) {
      console.error(e);
    }
    
    return { replayed };
  }

  async getCampaignSpend(id: string) {
    let campaign;
    try {
      const res = await this.em.query(`SELECT * FROM api.campaigns WHERE id = $1`, [id]);
      if (res.length > 0) campaign = res[0];
    } catch (e) {}

    if (!campaign) {
      throw new NotFoundException();
    }

    let spend = { raw_earnings_cents: 0, spend_cents: 0, paid_clips: 0 };
    try {
      const spendRes = await this.em.query(`SELECT * FROM earnings.campaign_spend WHERE campaign_id = $1`, [id]);
      if (spendRes.length > 0) {
        spend = spendRes[0];
      }
    } catch (e) {}

    const budget_cents = Number(campaign.budget_cents);
    const raw_earnings_cents = Number(spend.raw_earnings_cents);
    const spend_cents = Number(spend.spend_cents);
    
    return {
      campaign_id: id,
      budget_cents,
      cpm_cents: Number(campaign.cpm_cents),
      per_clip_cap_cents: Number(campaign.per_clip_cap_cents),
      end_at: campaign.end_at,
      raw_earnings_cents,
      spend_cents,
      budget_exhausted: raw_earnings_cents > budget_cents,
      paid_clips: Number(spend.paid_clips)
    };
  }

  async getCreatorEarnings(id: string) {
    let entries = [];
    try {
      entries = await this.em.query(`
        SELECT campaign_id, earned_cents as earned_cents, clips
        FROM earnings.creator_earnings 
        WHERE creator_id = $1 AND earned_cents > 0
        ORDER BY campaign_id ASC
      `, [id]);
    } catch (e) {}

    let total_cents = 0;
    const campaigns = entries.map(e => {
      const earned_cents = Number(e.earned_cents);
      total_cents += earned_cents;
      return {
        campaign_id: e.campaign_id,
        clips: Number(e.clips),
        earned_cents
      };
    });

    return {
      creator_id: id,
      total_cents,
      campaigns
    };
  }

  async getTopClips(campaignId: string, fromStr: string, toStr: string, limitStr: string, cursor: string) {
    // Validate campaign exists
    let campaign;
    try {
      const res = await this.em.query(`SELECT id FROM api.campaigns WHERE id = $1`, [campaignId]);
      if (res.length > 0) campaign = res[0];
    } catch (e) {}
    
    if (!campaign) {
      throw new NotFoundException();
    }

    if (!fromStr || !toStr) {
      throw new BadRequestException("from and to are required");
    }

    const fromDate = new Date(fromStr);
    const toDate = new Date(toStr);
    
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new BadRequestException("Invalid dates");
    }

    if (fromDate.getMinutes() !== 0 || fromDate.getSeconds() !== 0 || fromDate.getMilliseconds() !== 0 ||
        toDate.getMinutes() !== 0 || toDate.getSeconds() !== 0 || toDate.getMilliseconds() !== 0) {
      throw new BadRequestException("Timestamps must be on whole hours");
    }

    if (toDate.getTime() <= fromDate.getTime()) {
      throw new BadRequestException("to must be > from");
    }

    const diffHours = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60);
    if (diffHours > 168) {
      throw new BadRequestException("span <= 168 hours");
    }

    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    if (isNaN(limit) || limit < 1 || limit > 200) {
      throw new BadRequestException("limit must be between 1 and 200");
    }

    // Parse cursor (base64 encoded JSON { g: views_gained, c: clip_id })
    let cursorG = null;
    let cursorC = null;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
        cursorG = Number(decoded.g);
        cursorC = decoded.c;
      } catch (e) {
        throw new BadRequestException("Invalid cursor");
      }
    }

    // aggregator.clip_snapshots (clip_id, campaign_id, creator_id, observed_at_ms, views)
    // For V(clip, t), we need the snapshot with the greatest observed_at_ms strictly BEFORE t (epoch ms)
    const fromMs = fromDate.getTime();
    const toMs = toDate.getTime();

    let items = [];
    try {
      // Explanation for EXPLAIN requirements:
      // A query that computes V(clip, to) - V(clip, from) efficiently.
      // Assuming a table `aggregator.clip_snapshots`:
      const query = `
        WITH v_from AS (
          SELECT DISTINCT ON (clip_id) clip_id, views as v_from
          FROM aggregator.clip_snapshots
          WHERE campaign_id = $1 AND observed_at_ms < $2
          ORDER BY clip_id, observed_at_ms DESC
        ),
        v_to AS (
          SELECT DISTINCT ON (clip_id) clip_id, creator_id, views as v_to
          FROM aggregator.clip_snapshots
          WHERE campaign_id = $1 AND observed_at_ms < $3
          ORDER BY clip_id, observed_at_ms DESC
        ),
        gained AS (
          SELECT 
            t.clip_id, 
            t.creator_id, 
            t.v_to - COALESCE(f.v_from, 0) AS views_gained
          FROM v_to t
          LEFT JOIN v_from f ON t.clip_id = f.clip_id
          WHERE t.v_to - COALESCE(f.v_from, 0) > 0
        )
        SELECT clip_id, creator_id, views_gained
        FROM gained
        WHERE ($4::bigint IS NULL OR views_gained < $4 OR (views_gained = $4 AND clip_id > $5))
        ORDER BY views_gained DESC, clip_id ASC
        LIMIT $6
      `;

      const rows = await this.em.query(query, [campaignId, fromMs, toMs, cursorG, cursorC, limit]);
      
      items = rows.map(r => ({
        clip_id: r.clip_id,
        creator_id: r.creator_id,
        views_gained: Number(r.views_gained)
      }));
    } catch (e) {
      console.error(e);
    }

    let next_cursor = null;
    if (items.length === limit) {
      const last = items[items.length - 1];
      next_cursor = Buffer.from(JSON.stringify({ g: last.views_gained, c: last.clip_id })).toString('base64');
    }

    return {
      campaign_id: campaignId,
      from: fromStr,
      to: toStr,
      items,
      next_cursor
    };
  }

  async getClipRelevance(clipId: string) {
    try {
      const res = await this.em.query(`SELECT * FROM classifier.clip_relevance WHERE clip_id = $1`, [clipId]);
      if (res.length > 0) {
        const row = res[0];
        return {
          clip_id: row.clip_id,
          campaign_id: row.campaign_id,
          on_brief: row.on_brief,
          score: Number(row.score),
          model: row.model
        };
      }
    } catch (e) {}

    throw new NotFoundException();
  }
}
