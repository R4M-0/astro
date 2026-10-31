import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Granted } from '../../common/decorators/granted.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { EntityResolverService } from '../entities/entity-resolver.service';
import { ActivityService } from './activity.service';

@ApiTags('activity')
@ApiBearerAuth()
@Controller('activity')
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly entities: EntityResolverService,
  ) {}

  /** Activity feed of a record: `<resource>:read` + the record must be visible to the caller. */
  @Get(':entityType/:entityId')
  async list(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Granted() granted: Set<string>,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    await this.entities.resolve({ orgId, userId: user.id, granted }, entityType, entityId, 'read', { includeDeleted: true });
    return this.activity.list(orgId, entityType, entityId);
  }
}
