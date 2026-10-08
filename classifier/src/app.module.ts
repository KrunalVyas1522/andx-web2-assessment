import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClassifierProcessor } from './classifier.processor';
import { ClassifierService } from './classifier.service';
import { ClipRelevance } from './clip-relevance.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL || 'postgres://user:pass@postgres:5432/andx',
      schema: 'classifier',
      autoLoadEntities: true,
      synchronize: true, // Auto-create table in assessment
    }),
    TypeOrmModule.forFeature([ClipRelevance]),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL || 'redis://broker:6379',
      },
    }),
    BullModule.registerQueue({
      name: 'raw_events',
    }),
  ],
  providers: [ClassifierProcessor, ClassifierService],
})
export class AppModule implements OnModuleInit {
  constructor(private dataSource: DataSource) {}
  
  async onModuleInit() {
    // Ensure schema exists before TypeORM synchronizes the tables
    await this.dataSource.query('CREATE SCHEMA IF NOT EXISTS classifier;');
    await this.dataSource.synchronize(false);
  }
}
