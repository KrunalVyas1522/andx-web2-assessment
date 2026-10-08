import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AggregatorConsumer } from './aggregator.consumer';
import { OutboxCron } from './outbox.cron';
import {
  ProcessedEvent,
  ClipMetadata,
  ClipViewSnapshot,
  DlqEvent,
  OutboxEvent,
} from './entities';
import * as crypto from 'crypto';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/andx',
      schema: 'aggregator',
      entities: [
        ProcessedEvent,
        ClipMetadata,
        ClipViewSnapshot,
        DlqEvent,
        OutboxEvent,
      ],
      synchronize: true, // For phase 1, auto-create tables
    }),
    TypeOrmModule.forFeature([
      ProcessedEvent,
      ClipMetadata,
      ClipViewSnapshot,
      DlqEvent,
      OutboxEvent,
    ]),
    TypeOrmModule.forRoot({
      name: 'api_connection',
      type: 'postgres',
      url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/andx',
      schema: 'api',
      synchronize: false,
    }),
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
  providers: [AggregatorConsumer, OutboxCron],
})
export class AppModule {}
