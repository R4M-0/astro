import { Module } from '@nestjs/common';
import { RecruitingModule } from '../../modules/recruiting/recruiting.module';
import { FilesModule } from '../files/files.module';
import { AnonymizerService } from './anonymizer.service';
import { ComplianceCronService } from './compliance-cron.service';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { DataSubjectRequestsService } from './data-subject-requests.service';
import { RetentionService } from './retention.service';

/** Retention, data subject requests, legal holds, record of processing (docs/compliance). */
@Module({
  imports: [FilesModule, RecruitingModule],
  controllers: [ComplianceController],
  providers: [AnonymizerService, RetentionService, DataSubjectRequestsService, ComplianceService, ComplianceCronService],
  exports: [AnonymizerService],
})
export class ComplianceModule {}
