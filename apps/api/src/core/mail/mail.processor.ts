import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_MAIL } from '../jobs/queues';
import { MailInput, MailService } from './mail.service';

@Processor(QUEUE_MAIL, { concurrency: 5 })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mail: MailService) {
    super();
  }

  async process(job: Job<MailInput>): Promise<void> {
    try {
      await this.mail.deliver(job.data);
    } catch (err) {
      this.logger.warn(`mail to ${job.data.to} failed (attempt ${job.attemptsMade + 1}): ${(err as Error).message}`);
      throw err;
    }
  }
}
