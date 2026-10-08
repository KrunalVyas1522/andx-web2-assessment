import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { OutboxEvent } from './entities';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class OutboxCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxCron.name);
  private timer: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    @InjectEntityManager() private readonly entityManager: EntityManager,
    @InjectQueue('views_updated') private readonly viewsQueue: Queue,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.poll(), 1000); // 1s polling
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async poll() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      await this.entityManager.transaction(async (manager) => {
        const events = await manager.find(OutboxEvent, {
          where: { processed: false },
          take: 1000,
          lock: { mode: 'pessimistic_write' },
        });

        if (events.length > 0) {
          const jobs = events.map(e => ({
            name: 'views_updated',
            data: e.payload,
          }));
          
          await this.viewsQueue.addBulk(jobs);

          await manager.delete(OutboxEvent, events.map(e => e.id));
        }
      });
    } catch (e) {
      this.logger.error('Outbox poll error', e);
    } finally {
      this.isRunning = false;
    }
  }
}
