import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { DirtyCampaign, CampaignSpend, CreatorEarnings } from './entities';

@Injectable()
export class EarningsCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EarningsCron.name);
  private timer: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    @InjectEntityManager() private readonly entityManager: EntityManager,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.poll(), 2000); // Debounce / poll every 2s
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async poll() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const campaigns = await this.entityManager.find(DirtyCampaign, { take: 50 });
      for (const dirty of campaigns) {
        await this.computeCampaign(dirty.campaign_id);
      }
    } catch (e) {
      this.logger.error('Earnings computation error', e);
    } finally {
      this.isRunning = false;
    }
  }

  async computeCampaign(campaignId: string) {
    await this.entityManager.transaction(async (manager) => {
      const dirty = await manager.findOne(DirtyCampaign, { where: { campaign_id: campaignId } });
      if (!dirty) return;
      const currentVersion = dirty.version;

      // Fetch campaign from api.campaigns
      const apiCamps = await manager.query('SELECT * FROM api.campaigns WHERE id = $1', [campaignId]);
      if (apiCamps.length === 0) {
        // Unknown campaign, delete from dirty
        await manager.delete(DirtyCampaign, { campaign_id: campaignId, version: currentVersion });
        return;
      }
      const campaign = apiCamps[0];
      const endAtMs = new Date(campaign.end_at).getTime();
      const cap = BigInt(campaign.per_clip_cap_cents);
      const cpm = BigInt(campaign.cpm_cents);
      const budget = BigInt(campaign.budget_cents);

      // Query views from aggregator
      // "V(clip,t) = views of the accepted snapshot with greatest observed_at STRICTLY BEFORE t"
      const clipsResult = await manager.query(`
        SELECT
          cm.clip_id,
          cm.creator_id,
          COALESCE(
            (
              SELECT cvs.views
              FROM aggregator.clip_view_snapshots cvs
              WHERE cvs.clip_id = cm.clip_id
                AND CAST(cvs.observed_at_ms AS BIGINT) < $2
              ORDER BY CAST(cvs.observed_at_ms AS BIGINT) DESC
              LIMIT 1
            ),
            0
          ) as views
        FROM aggregator.clip_metadata cm
        WHERE cm.campaign_id = $1
      `, [campaignId, endAtMs]);

      const clips = clipsResult.map((c: any) => ({
        clip_id: c.clip_id,
        creator_id: c.creator_id,
        views: BigInt(c.views)
      }));

      // Compute exact earnings
      // earned_i = min(cap, floor(V(i,end_at) * cpm / 1000))
      let rawSum = 0n;
      clips.forEach((c: any) => {
        let earned = (c.views * cpm) / 1000n;
        if (earned > cap) earned = cap;
        c.earned_i = earned;
        rawSum += earned;
      });

      let spendCents = 0n;
      let paidClipsCount = 0;

      if (rawSum <= budget) {
        // Budget not exhausted
        clips.forEach((c: any) => {
          c.paid_i = c.earned_i;
          if (c.paid_i > 0n) {
            spendCents += c.paid_i;
            paidClipsCount++;
          }
        });
      } else {
        // Budget exhausted -> remainder rule
        // paid_i = floor(earned_i * budget / raw)
        // remainder_i = (earned_i * budget) % raw
        let sumPaid = 0n;
        clips.forEach((c: any) => {
          c.paid_i = (c.earned_i * budget) / rawSum;
          c.remainder_i = (c.earned_i * budget) % rawSum;
          if (c.paid_i > 0n) paidClipsCount++;
          sumPaid += c.paid_i;
        });

        let left = Number(budget - sumPaid);
        if (left > 0) {
          // Give +1 cent to the left clips with largest remainder, ties by clip_id ascending
          clips.sort((a: any, b: any) => {
            if (a.remainder_i > b.remainder_i) return -1;
            if (a.remainder_i < b.remainder_i) return 1;
            return a.clip_id < b.clip_id ? -1 : (a.clip_id > b.clip_id ? 1 : 0);
          });
          
          for (let i = 0; i < left && i < clips.length; i++) {
            clips[i].paid_i += 1n;
            if (clips[i].paid_i === 1n) paidClipsCount++; // It wasn't counted before
          }
        }
        spendCents = budget;
      }

      // Group earnings by creator
      const creatorEarningsMap = new Map<string, { earned: bigint, clips: number }>();
      clips.forEach((c: any) => {
        if (c.paid_i > 0n) {
          const current = creatorEarningsMap.get(c.creator_id) || { earned: 0n, clips: 0 };
          creatorEarningsMap.set(c.creator_id, {
            earned: current.earned + c.paid_i,
            clips: current.clips + 1
          });
        }
      });

      // Clear existing creator_earnings for this campaign
      await manager.delete(CreatorEarnings, { campaign_id: campaignId });

      // Insert new creator_earnings
      const creatorEarningsInserts = Array.from(creatorEarningsMap.entries()).map(([creator_id, data]) => ({
        creator_id,
        campaign_id: campaignId,
        clips: data.clips,
        earned_cents: data.earned.toString()
      }));

      // We only insert if > 0
      if (creatorEarningsInserts.length > 0) {
        // chunk the inserts to avoid postgres limitations
        const chunkSize = 1000;
        for (let i = 0; i < creatorEarningsInserts.length; i += chunkSize) {
          await manager.insert(CreatorEarnings, creatorEarningsInserts.slice(i, i + chunkSize));
        }
      }

      // Upsert CampaignSpend
      await manager.createQueryBuilder()
        .insert()
        .into(CampaignSpend)
        .values({
          campaign_id: campaignId,
          spend_cents: spendCents.toString(),
          raw_earnings_cents: rawSum.toString(),
          paid_clips: paidClipsCount
        })
        .orUpdate(['spend_cents', 'raw_earnings_cents', 'paid_clips'], ['campaign_id'])
        .execute();

      // Finally remove from dirty
      const delRes = await manager.delete(DirtyCampaign, { campaign_id: campaignId, version: currentVersion });
      if (delRes.affected === 0) {
        throw new Error(`Optimistic lock failed on DirtyCampaign ${campaignId} v${currentVersion}`);
      }
    });
  }
}
