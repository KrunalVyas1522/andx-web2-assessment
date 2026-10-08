import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { ProcessedUpdate, DirtyCampaign } from './entities';

@Processor('views_updated')
@Injectable()
export class EarningsConsumer extends WorkerHost {
  private readonly logger = new Logger(EarningsConsumer.name);

  constructor(
    @InjectEntityManager() private readonly entityManager: EntityManager,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const payload = job.data;
    if (!payload.aggregator_tx_id) return;

    await this.entityManager.transaction(async (manager) => {
      const exists = await manager.findOne(ProcessedUpdate, { where: { aggregator_tx_id: payload.aggregator_tx_id } });
      if (exists) return;

      await manager.insert(ProcessedUpdate, { aggregator_tx_id: payload.aggregator_tx_id });

      await manager.createQueryBuilder()
        .insert()
        .into(DirtyCampaign)
        .values({ campaign_id: payload.campaign_id })
        .orUpdate(['updated_at'], ['campaign_id'])
        .execute();
    });
  }
}
