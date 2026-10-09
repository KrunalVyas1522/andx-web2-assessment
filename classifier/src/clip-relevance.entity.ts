import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('clip_relevance', { schema: 'classifier' })
export class ClipRelevance {
  @PrimaryColumn('varchar', { length: 50 })
  clip_id: string;

  @Column('varchar', { length: 50 })
  campaign_id: string;

  @Column('boolean')
  on_brief: boolean;

  @Column('numeric')
  score: number;

  @Column('varchar', { length: 100 })
  model: string;
}
