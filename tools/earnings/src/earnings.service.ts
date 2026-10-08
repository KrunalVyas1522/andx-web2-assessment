import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

@Injectable()
export class EarningsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Computes the exact budget allocation using BigInt.
   * Distributes the remainder (+1 cent) to clips based on the remainder score, 
   * falling back to ascending clip ID for tie-breakers.
   */
  async allocateBudget(campaignId: string): Promise<void> {
    await this.dataSource.transaction(async (em: EntityManager) => {
      // Fetch budget
      const campaignRows = await em.query(`SELECT budget_cents FROM api.campaigns WHERE id = $1`, [campaignId]);
      if (!campaignRows.length) return;
      const budgetCents = BigInt(campaignRows[0].budget_cents);

      // Fetch all exact clips and their views
      const clips = await em.query(`
        SELECT clip_id, views 
        FROM aggregator.clip_view_snapshots 
        WHERE campaign_id = $1
      `, [campaignId]);

      if (!clips.length) return;

      const totalViews = clips.reduce((sum, c) => sum + BigInt(c.views), 0n);
      if (totalViews === 0n) return;

      // Calculate allocations
      const allocations = clips.map((c: any) => {
        const views = BigInt(c.views);
        const base = (views * budgetCents) / totalViews;
        const remainderScore = (views * budgetCents) % totalViews;
        return { clip_id: c.clip_id, base, remainderScore, final: base };
      });

      // Strict remainder distribution (descending remainder score, ascending clip_id)
      allocations.sort((a, b) => {
        if (b.remainderScore !== a.remainderScore) {
          return b.remainderScore > a.remainderScore ? 1 : -1;
        }
        return a.clip_id.localeCompare(b.clip_id);
      });

      let remainder = budgetCents % totalViews;
      let idx = 0;
      while (remainder > 0n && idx < allocations.length) {
        allocations[idx].final += 1n;
        remainder -= 1n;
        idx++;
      }

      // Persist exact allocations to DB in ONE transaction
      for (const alloc of allocations) {
        await em.query(
          `INSERT INTO earnings.creator_earnings (clip_id, earnings_cents) VALUES ($1, $2)
           ON CONFLICT (clip_id) DO UPDATE SET earnings_cents = EXCLUDED.earnings_cents`,
          [alloc.clip_id, Number(alloc.final)]
        );
      }
    });
  }
}
