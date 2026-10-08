import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres',
      autoLoadEntities: true,
      synchronize: false,
    }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
      },
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
