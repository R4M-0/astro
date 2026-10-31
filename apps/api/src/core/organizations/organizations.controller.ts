import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { OrganizationsService } from './organizations.service';

class CreateOrgDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;
}

class UpdateOrgDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

class SiteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}

class DepartmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;
}

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('current')
  current(@OrgId() orgId: string) {
    return this.orgs.getOrganization(orgId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrgDto) {
    return this.orgs.createOrganization(user.id, dto.name);
  }

  @Patch('current')
  @RequirePermissions('organization:admin')
  update(@OrgId() orgId: string, @Body() dto: UpdateOrgDto) {
    return this.orgs.updateOrganization(orgId, dto);
  }

  @Get('current/sites')
  sites(@OrgId() orgId: string) {
    return this.orgs.listSites(orgId);
  }

  @Post('current/sites')
  @RequirePermissions('organization:admin')
  createSite(@OrgId() orgId: string, @Body() dto: SiteDto) {
    return this.orgs.createSite(orgId, dto);
  }

  @Patch('current/sites/:siteId')
  @RequirePermissions('organization:admin')
  updateSite(@OrgId() orgId: string, @Param('siteId') siteId: string, @Body() dto: SiteDto) {
    return this.orgs.updateSite(orgId, siteId, dto);
  }

  @Delete('current/sites/:siteId')
  @RequirePermissions('organization:admin')
  deleteSite(@OrgId() orgId: string, @Param('siteId') siteId: string) {
    return this.orgs.deleteSite(orgId, siteId);
  }

  @Post('current/sites/:siteId/departments')
  @RequirePermissions('organization:admin')
  createDepartment(
    @OrgId() orgId: string,
    @Param('siteId') siteId: string,
    @Body() dto: DepartmentDto,
  ) {
    return this.orgs.createDepartment(orgId, siteId, dto.name);
  }

  @Delete('current/departments/:departmentId')
  @RequirePermissions('organization:admin')
  deleteDepartment(@OrgId() orgId: string, @Param('departmentId') departmentId: string) {
    return this.orgs.deleteDepartment(orgId, departmentId);
  }
}
