import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeletionNotifierService } from './deletion-notifier.service';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [HistoryController],
  providers: [HistoryService, DeletionNotifierService],
  exports: [HistoryService, DeletionNotifierService],
})
export class HistoryModule {}
