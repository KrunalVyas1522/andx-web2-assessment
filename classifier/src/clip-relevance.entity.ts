import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('clip_relevance', { schema: 'classifier' })
export class ClipRelevance {
  @PrimaryColumn('varchar', { length: 20 })
  clip_id: string;

  @Column('boolean')
  on_brief: boolean;

  @Column('float')
  score: number;
}
