import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class ApiService {
  private readonly logger = new Logger(ApiService.name);

  constructor(
    @InjectEntityManager()
    private readonly em: EntityManager,
    @InjectQueue('dlq_replay')
    private readonly replayQueue: Queue,
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
    const list = Array.isArray(campaigns) ? campaigns : ((campaigns as any)?.campaigns || []);
    const values = list.map((c: any) => [
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
    const res1 = await this.em.query(`SELECT COUNT(*) as cnt FROM aggregator.processed_events;`);
    const distinct_valid_events = parseInt(res1[0]?.cnt || '0', 10);

    const res2 = await this.em.query(`SELECT COUNT(*) as cnt FROM aggregator.late_events;`);
    const late_dropped = parseInt(res2[0]?.cnt || '0', 10);

    let dlq_invalid = 0;
    let dlq_unknown = 0;
    const res3 = await this.em.query(`SELECT reason, COUNT(*) as cnt FROM aggregator.dlq GROUP BY reason;`);
    for (const row of res3) {
      if (row.reason === 'invalid_schema') dlq_invalid = parseInt(row.cnt, 10);
      if (row.reason === 'unknown_campaign') dlq_unknown = parseInt(row.cnt, 10);
    }

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
    const res = await this.em.query(`SELECT COUNT(*) as cnt FROM aggregator.dlq WHERE reason = $1`, [reason]);
    if (res.length > 0) {
      replayed = parseInt(res[0].cnt, 10);
    }
    await this.replayQueue.add('replay_batch', { reason });
    
    return { replayed };
  }

  async getCampaignSpend(id: string) {
    const res = await this.em.query(`SELECT * FROM api.campaigns WHERE id = $1`, [id]);
    if (!res || res.length === 0) {
      throw new NotFoundException();
    }
    const campaign = res[0];

    let spend = { raw_earnings_cents: '0', spend_cents: '0', paid_clips: 0 };
    const spendRes = await this.em.query(`SELECT * FROM earnings.campaign_spend WHERE campaign_id = $1`, [id]);
    if (spendRes.length > 0) {
      spend = spendRes[0];
    }

    const budget_cents = Number(campaign.budget_cents);
    const raw_earnings_cents = Number(spend.raw_earnings_cents);
    const spend_cents = Number(spend.spend_cents);
    
    return {
      campaign_id: id,
      budget_cents,
      cpm_cents: Number(campaign.cpm_cents),
      per_clip_cap_cents: Number(campaign.per_clip_cap_cents),
      end_at: new Date(campaign.end_at).toISOString(),
      raw_earnings_cents,
      spend_cents,
      budget_exhausted: raw_earnings_cents > budget_cents,
      paid_clips: Number(spend.paid_clips)
    };
  }

  async getCreatorEarnings(id: string) {
    const entries = await this.em.query(`
      SELECT campaign_id, earned_cents, clips
      FROM earnings.creator_earnings 
      WHERE creator_id = $1 AND earned_cents > 0
      ORDER BY campaign_id ASC
    `, [id]);

    let total_cents = 0;
    const campaigns = entries.map((e: any) => {
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
    const res = await this.em.query(`SELECT id FROM api.campaigns WHERE id = $1`, [campaignId]);
    if (!res || res.length === 0) {
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

    if (fromDate.getUTCMinutes() !== 0 || fromDate.getUTCSeconds() !== 0 || fromDate.getUTCMilliseconds() !== 0 ||
        toDate.getUTCMinutes() !== 0 || toDate.getUTCSeconds() !== 0 || toDate.getUTCMilliseconds() !== 0) {
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

    let cursorG: number | null = null;
    let cursorC: string | null = null;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
        cursorG = Number(decoded.g);
        cursorC = decoded.c;
      } catch (e) {
        throw new BadRequestException("Invalid cursor");
      }
    }

    const fromMs = fromDate.getTime();
    const toMs = toDate.getTime();

    const query = `
      WITH v_from AS (
        SELECT DISTINCT ON (clip_id) clip_id, views as v_from
        FROM aggregator.clip_view_snapshots
        WHERE campaign_id = $1 AND observed_at_ms < $2
        ORDER BY clip_id, observed_at_ms DESC
      ),
      v_to AS (
        SELECT DISTINCT ON (clip_id) clip_id, creator_id, views as v_to
        FROM aggregator.clip_view_snapshots
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
      ORDER BY views_gained DESC, clip_id COLLATE "C" ASC
      LIMIT $6
    `;

    // Request limit + 1 to check if there is a next page
    const rows = await this.em.query(query, [campaignId, fromMs, toMs, cursorG, cursorC, limit + 1]);
    
    let hasNext = false;
    let resultRows = rows;
    if (rows.length > limit) {
      hasNext = true;
      resultRows = rows.slice(0, limit);
    }

    const items = resultRows.map((r: any) => ({
      clip_id: r.clip_id,
      creator_id: r.creator_id,
      views_gained: Number(r.views_gained)
    }));

    let next_cursor = null;
    if (hasNext && items.length > 0) {
      const last = items[items.length - 1];
      next_cursor = Buffer.from(JSON.stringify({ g: last.views_gained, c: last.clip_id })).toString('base64');
    }

    return {
      campaign_id: campaignId,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      items,
      next_cursor
    };
  }

  async getClipRelevance(clipId: string) {
    const res = await this.em.query(`SELECT * FROM classifier.clip_relevance WHERE clip_id = $1`, [clipId]);
    if (res && res.length > 0) {
      const row = res[0];
      return {
        clip_id: row.clip_id,
        campaign_id: row.campaign_id,
        on_brief: row.on_brief,
        score: Number(row.score),
        model: row.model
      };
    }
    throw new NotFoundException();
  }
}
