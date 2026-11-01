import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_RECRUITING } from '../../core/jobs/queues';
import { RecruitingAiService } from './recruiting-ai.service';
import { RecruitingPipelineService } from './recruiting-pipeline.service';
import { CandidatesController, OpeningsController } from './recruiting.controller';
import { RecruitingService } from './recruiting.service';

/** Recruiting pipeline 1: resume screening & ranking (docs/recruiting). */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_RECRUITING })],
  controllers: [OpeningsController, CandidatesController],
  providers: [RecruitingAiService, RecruitingPipelineService, RecruitingService],
  exports: [RecruitingPipelineService],
})
export class RecruitingModule {}
