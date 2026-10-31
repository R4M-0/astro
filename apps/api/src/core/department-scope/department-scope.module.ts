import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminProcessesController } from './admin-processes.controller';
import { AdminProcessesService } from './admin-processes.service';
import { SharesController } from './shares.controller';
import { SharesService } from './shares.service';
import { VisibilityController } from './visibility.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [SharesController, VisibilityController, AdminProcessesController],
  providers: [SharesService, AdminProcessesService],
})
export class DepartmentScopeModule {}
