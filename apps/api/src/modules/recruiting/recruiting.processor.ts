import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_RECRUITING } from '../../core/jobs/queues';
import { RecruitingPipelineService } from './recruiting-pipeline.service';

type RecruitingJob = Job<{ candidateId: string }, void, 'ingest'> | Job<{ openingId: string }, void, 'rank'>;

/** Pipeline 1 consumer: `ingest` = stage 1 for one CV, `rank` = stages 2-4 for one opening. */
@Processor(QUEUE_RECRUITING, { concurrency: 2 })
export class RecruitingProcessor extends WorkerHost {
  private readonly logger = new Logger(RecruitingProcessor.name);

  constructor(private readonly pipeline: RecruitingPipelineService) {
    super();
  }

  async process(job: RecruitingJob): Promise<void> {
    if (job.name === 'rank') return this.pipeline.rank(job.data.openingId);
    try {
      await this.pipeline.ingest(job.data.candidateId);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`ingest ${job.data.candidateId} failed (attempt ${job.attemptsMade + 1}): ${message}`);
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await this.pipeline.markFailed(job.data.candidateId, message);
      throw err;
    }
  }
}
