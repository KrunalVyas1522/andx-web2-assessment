import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EarningsConsumer } from './earnings.consumer';
import { EarningsCron } from './earnings.cron';
import {
  ProcessedUpdate,
  CampaignSpend,
  CreatorEarnings,
  DirtyCampaign,
} from './entities';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/andx',
      schema: 'earnings',
      entities: [
        ProcessedUpdate,
        CampaignSpend,
        CreatorEarnings,
        DirtyCampaign,
      ],
      synchronize: false,
    }),
    TypeOrmModule.forFeature([
      ProcessedUpdate,
      CampaignSpend,
      CreatorEarnings,
      DirtyCampaign,
    ]),
    BullModule.forRoot({
      connection: new Redis(process.env.REDIS_URL || 'redis://broker:6379', {
        maxRetriesPerRequest: null,
      }),
    }),
    BullModule.registerQueue({
      name: 'views_updated',
    }),
  ],
  providers: [EarningsConsumer, EarningsCron],
})
export class AppModule {}
