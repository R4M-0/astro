import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_RECRUITING } from '../../core/jobs/queues';
import { MailModule } from '../../core/mail/mail.module';
import { BookingController, OutreachController } from './outreach.controller';
import { OutreachService } from './outreach.service';
import { RecruitingAiService } from './recruiting-ai.service';
import { RecruitingPipelineService } from './recruiting-pipeline.service';
import { CandidatesController, OpeningsController } from './recruiting.controller';
import { RecruitingService } from './recruiting.service';

/** Recruiting pipeline 1 (resume screening & ranking) and 2 (scheduling, replies, follow-ups), see docs/recruiting. */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_RECRUITING }), MailModule],
  controllers: [OpeningsController, CandidatesController, OutreachController, BookingController],
  providers: [RecruitingAiService, RecruitingPipelineService, RecruitingService, OutreachService],
  exports: [RecruitingPipelineService, OutreachService],
})
export class RecruitingModule {}
