import { Entity, Column, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'earnings', name: 'processed_updates' })
export class ProcessedUpdate {
  @Column({ primary: true, type: 'uuid' })
  aggregator_tx_id: string;

  @CreateDateColumn()
  processed_at: Date;
}

@Entity({ schema: 'earnings', name: 'campaign_spend' })
export class CampaignSpend {
  @Column({ primary: true, type: 'text' })
  campaign_id: string;

  @Column('bigint')
  spend_cents: string;

  @Column('bigint')
  raw_earnings_cents: string;

  @Column('int')
  paid_clips: number;
}

@Entity({ schema: 'earnings', name: 'creator_earnings' })
export class CreatorEarnings {
  @Column({ primary: true, type: 'text' })
  creator_id: string;

  @Column({ primary: true, type: 'text' })
  campaign_id: string;

  @Column('bigint')
  earned_cents: string;
}

@Entity({ schema: 'earnings', name: 'dirty_campaigns' })
export class DirtyCampaign {
  @Column({ primary: true, type: 'text' })
  campaign_id: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updated_at: Date;
}
