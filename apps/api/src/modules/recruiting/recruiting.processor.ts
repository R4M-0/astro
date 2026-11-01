import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_RECRUITING } from '../../core/jobs/queues';
import { OutreachService } from './outreach.service';
import type { MessageKind } from './outreach';
import { RecruitingPipelineService } from './recruiting-pipeline.service';

type RecruitingJob =
  | Job<{ candidateId: string }, void, 'ingest'>
  | Job<{ openingId: string }, void, 'rank'>
  | Job<{ candidateId: string; kind: MessageKind; inReplyToId?: string }, void, 'draft'>
  | Job<{ messageId: string }, void, 'send' | 'triage'>;

/**
 * Pipeline 1: `ingest` = stage 1 for one CV, `rank` = stages 2-4 for one opening.
 * Pipeline 2: `draft` = agent writes one e-mail draft, `send` = deliver one approved message, `triage` = classify a candidate reply.
 */
@Processor(QUEUE_RECRUITING, { concurrency: 2 })
export class RecruitingProcessor extends WorkerHost {
  private readonly logger = new Logger(RecruitingProcessor.name);

  constructor(
    private readonly pipeline: RecruitingPipelineService,
    private readonly outreach: OutreachService,
  ) {
    super();
  }

  async process(job: RecruitingJob): Promise<void> {
    switch (job.name) {
      case 'rank':
        return this.pipeline.rank(job.data.openingId);
      case 'draft':
        return this.outreach.draft(job.data.candidateId, job.data.kind, job.data.inReplyToId);
      case 'send':
        return this.outreach.send(job.data.messageId, job.attemptsMade + 1 >= (job.opts.attempts ?? 1));
      case 'triage':
        return this.outreach.triage(job.data.messageId).catch(async (err: Error) => {
          // a candidate message must reach a human even when the agent is down
          if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await this.outreach.triageFailed(job.data.messageId);
          throw err;
        });
    }
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
