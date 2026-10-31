import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { OrgId } from '../../common/decorators/org.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { AuditCategory, AuditLogService } from './audit-log.service';

class AuditLogQuery extends PaginationQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({ enum: ['create', 'update', 'delete', 'workflow', 'export'] })
  @IsOptional()
  @IsIn(['create', 'update', 'delete', 'workflow', 'export'])
  category?: AuditCategory;

  @ApiPropertyOptional({ enum: ['fr', 'en'] })
  @IsOptional()
  @IsIn(['fr', 'en'])
  locale?: string;
}

@ApiTags('audit-log')
@ApiBearerAuth()
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  /** Audit trail in plain language: who did what, on which record, with every changed field. */
  @Get()
  @RequirePermissions('audit-log:read')
  list(@OrgId() orgId: string, @Query() q: AuditLogQuery) {
    return this.auditLog.list(orgId, q);
  }
}
