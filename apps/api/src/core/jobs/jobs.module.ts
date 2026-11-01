import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { MailProcessor } from '../mail/mail.processor';
import { RecruitingModule } from '../../modules/recruiting/recruiting.module';
import { RecruitingProcessor } from '../../modules/recruiting/recruiting.processor';

/** Queue consumers — imported only when this process runs jobs (see app-role.ts). */
@Module({
  imports: [MailModule, RecruitingModule],
  providers: [MailProcessor, RecruitingProcessor],
})
export class JobsModule {}
