import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity({ schema: 'aggregator', name: 'processed_events' })
export class ProcessedEvent {
  @PrimaryColumn('text')
  event_id: string;

  @CreateDateColumn()
  processed_at: Date;
}

@Entity({ schema: 'aggregator', name: 'clip_metadata' })
export class ClipMetadata {
  @PrimaryColumn('text')
  clip_id: string;

  @Column('text')
  campaign_id: string;

  @Column('text')
  creator_id: string;
}

@Entity({ schema: 'aggregator', name: 'clip_view_snapshots' })
export class ClipViewSnapshot {
  @PrimaryColumn('text')
  clip_id: string;

  @PrimaryColumn('bigint')
  observed_at_ms: string;

  @Column('int')
  views: number;
}

@Entity({ schema: 'aggregator', name: 'dlq' })
export class DlqEvent {
  @PrimaryColumn('text')
  event_id: string;

  @Column('text')
  reason: string;

  @Column('jsonb')
  payload: any;

  @CreateDateColumn()
  created_at: Date;
}

@Entity({ schema: 'aggregator', name: 'outbox' })
export class OutboxEvent {
  @PrimaryColumn('uuid')
  id: string;

  @Column('jsonb')
  payload: any;

  @CreateDateColumn()
  created_at: Date;

  @Column('boolean', { default: false })
  processed: boolean;
}
