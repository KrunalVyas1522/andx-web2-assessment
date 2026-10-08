import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
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
      synchronize: true, // Auto-create schema for Phase 1
    }),
    TypeOrmModule.forFeature([
      ProcessedUpdate,
      CampaignSpend,
      CreatorEarnings,
      DirtyCampaign,
    ]),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      } as any,
    }),
    BullModule.registerQueue({
      name: 'views_updated',
    }),
  ],
  providers: [EarningsConsumer, EarningsCron],
})
export class AppModule {}
