import { Controller, ForbiddenException, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Granted } from '../../common/decorators/granted.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { RoleKey } from '../../common/decorators/role-key.decorator';
import { entityTypeDef } from '../entities/entity-registry';
import { EntityResolverService } from '../entities/entity-resolver.service';
import { MODEL_RESOURCE } from './history-map';
import { HistoryService } from './history.service';

/** Roles allowed to read history for models with no RBAC resource mapping. */
const ADMIN_ROLE_KEYS = new Set(['org_admin', 'hr_manager']);

@ApiTags('history')
@ApiBearerAuth()
@Controller('history')
export class HistoryController {
  constructor(
    private readonly history: HistoryService,
    private readonly entities: EntityResolverService,
  ) {}

  /**
   * History follows the record: for registered entity types the caller needs `<resource>:read` AND
   * must be able to see the record (visibility policy; soft-deleted rows included so deletions stay
   * traceable). Other models (settings, child rows) are gated on the MODEL_RESOURCE read permission;
   * unmapped models are restricted to admin roles. `@Granted()` already excludes locked add-ons.
   */
  @Get(':entityType/:entityId')
  async list(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Granted() granted: Set<string>,
    @RoleKey() roleKey: string | undefined,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    const def = entityTypeDef(entityType);
    if (def) {
      await this.entities.resolve({ orgId, userId: user.id, granted }, entityType, entityId, 'read', { includeDeleted: true });
    } else {
      const resource = Object.hasOwn(MODEL_RESOURCE, entityType) ? MODEL_RESOURCE[entityType] : null;
      const allowed = resource ? granted.has(`${resource}:read`) : !!roleKey && ADMIN_ROLE_KEYS.has(roleKey);
      if (!allowed) throw new ForbiddenException(`Missing permissions: ${resource ?? entityType}:read`);
    }
    return this.history.list(orgId, def?.model ?? entityType, entityId);
  }
}
