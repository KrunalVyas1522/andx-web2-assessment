import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ClassifierService } from './classifier.service';
import { Logger } from '@nestjs/common';

@Processor('raw_events', { concurrency: 5 })
export class ClassifierProcessor extends WorkerHost {
  private readonly logger = new Logger(ClassifierProcessor.name);

  constructor(private readonly classifierService: ClassifierService) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    if (job.name === 'view_snapshot_batch') {
      const events = job.data.events || [];
      const clipTextEvents = events.filter((e: any) => e.type === 'clip_text');
      
      if (clipTextEvents.length > 0) {
        this.logger.log(`Processing batch of ${clipTextEvents.length} clip_text events from job ${job.id}`);
        await this.classifierService.classifyBatch(clipTextEvents);
      }
    }
    return {};
  }
}
