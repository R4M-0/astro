import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { MailProcessor } from '../mail/mail.processor';

/** Queue consumers — imported only when this process runs jobs (see app-role.ts). */
@Module({
  imports: [MailModule],
  providers: [MailProcessor],
})
export class JobsModule {}
