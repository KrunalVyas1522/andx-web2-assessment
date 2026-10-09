import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres',
      autoLoadEntities: true,
      synchronize: false,
    }),
    BullModule.forRoot({
      connection: new Redis(process.env.REDIS_URL || 'redis://broker:6379', {
        maxRetriesPerRequest: null,
      }),
    }),
    BullModule.registerQueue({
      name: 'raw_events',
    }),
    TypeOrmModule.forFeature([]),
  ],
  controllers: [AppController, ApiController],
  providers: [ApiService],
})
export class AppModule {}
