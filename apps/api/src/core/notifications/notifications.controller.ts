import { Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { NotificationsService } from './notifications.service';
import { LicenseExempt } from '../license/license-exempt.decorator';
import { NOTIFICATION_CATEGORIES, NotificationCategory } from './notification-categories';

class NotificationPageQueryDto extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['all', 'unread', 'read'] })
  @IsOptional()
  @IsIn(['all', 'unread', 'read'])
  status?: 'all' | 'unread' | 'read';

  @ApiPropertyOptional({ enum: NOTIFICATION_CATEGORIES })
  @IsOptional()
  @IsIn(NOTIFICATION_CATEGORIES)
  category?: NotificationCategory;
}

@ApiTags('notifications')
@ApiBearerAuth()
@LicenseExempt()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @OrgId() orgId: string,
    @Query('unread') unread?: string,
  ) {
    return this.notifications.list(user.id, orgId, unread === 'true');
  }

  @Get('page')
  page(@CurrentUser() user: AuthUser, @OrgId() orgId: string, @Query() q: NotificationPageQueryDto) {
    return this.notifications.page(user.id, orgId, q);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser, @OrgId() orgId: string) {
    return this.notifications.unreadCount(user.id, orgId);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: AuthUser, @OrgId() orgId: string) {
    return this.notifications.markAllRead(user.id, orgId);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Patch(':id/unread')
  markUnread(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markUnread(user.id, id);
  }

  @Delete('read')
  removeRead(@CurrentUser() user: AuthUser, @OrgId() orgId: string) {
    return this.notifications.removeRead(user.id, orgId);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.remove(user.id, id);
  }
}
