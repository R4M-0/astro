import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_MAIL } from '../jobs/queues';
import { MailService } from './mail.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_MAIL })],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
