import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrgId } from '../../common/decorators/org.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RbacService } from './rbac.service';

class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  permissions: string[];
}

class UpdateRoleDto {
  /** members with this role only see their department(s)' records */
  @IsOptional()
  @IsBoolean()
  departmentScoped?: boolean;

  /** custom roles only */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

class DuplicateRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}

class SetPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}

@ApiTags('rbac')
@ApiBearerAuth()
@Controller('roles')
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get()
  @RequirePermissions('roles:read')
  list(@OrgId() orgId: string) {
    return this.rbac.listRoles(orgId);
  }

  @Post()
  @RequirePermissions('roles:admin')
  create(@OrgId() orgId: string, @Body() dto: CreateRoleDto) {
    return this.rbac.createCustomRole(orgId, dto.name, dto.permissions);
  }

  @Patch(':id')
  @RequirePermissions('roles:admin')
  update(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rbac.updateRole(orgId, id, dto);
  }

  @Put(':id/permissions')
  @RequirePermissions('roles:admin')
  setPermissions(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: SetPermissionsDto) {
    return this.rbac.setRolePermissions(orgId, id, dto.permissions);
  }

  @Post(':id/reset')
  @RequirePermissions('roles:admin')
  reset(@OrgId() orgId: string, @Param('id') id: string) {
    return this.rbac.resetRole(orgId, id);
  }

  @Post(':id/duplicate')
  @RequirePermissions('roles:admin')
  duplicate(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: DuplicateRoleDto) {
    return this.rbac.duplicateRole(orgId, id, dto.name);
  }

  /** Custom roles only; when members hold it pass `?reassignToRoleId=` to move them first. */
  @Delete(':id')
  @RequirePermissions('roles:admin')
  remove(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Query('reassignToRoleId') reassignToRoleId?: string,
  ) {
    return this.rbac.deleteRole(orgId, id, reassignToRoleId || undefined);
  }
}
