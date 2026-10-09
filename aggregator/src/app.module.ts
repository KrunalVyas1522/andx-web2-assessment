import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnapshotsConsumer, InvalidConsumer, ReplayConsumer } from './consumers';
import { OutboxCron } from './outbox.cron';
import {
  ProcessedEvent,
  LateEvent,
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
        LateEvent,
        ClipMetadata,
        ClipViewSnapshot,
        DlqEvent,
        OutboxEvent,
      ],
      synchronize: false,
    }),
    TypeOrmModule.forFeature([
      ProcessedEvent,
      LateEvent,
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
      connection: new Redis(process.env.REDIS_URL || 'redis://broker:6379', {
        maxRetriesPerRequest: null,
      }),
    }),
    BullModule.registerQueue({ name: 'snapshots' }),
    BullModule.registerQueue({ name: 'invalid' }),
    BullModule.registerQueue({ name: 'dlq_replay' }),
    BullModule.registerQueue({ name: 'views_updated' }),
  ],
  providers: [SnapshotsConsumer, InvalidConsumer, ReplayConsumer, OutboxCron],
})
export class AppModule {}
