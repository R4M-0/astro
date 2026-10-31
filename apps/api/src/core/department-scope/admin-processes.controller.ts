import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { OrgId } from '../../common/decorators/org.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AdminProcessesService } from './admin-processes.service';

class AddMemberDto {
  @IsString() @IsNotEmpty() membershipId: string;
  @IsIn(['main', 'extra']) kind: 'main' | 'extra';
}

class RenameDepartmentDto {
  @IsString() @IsNotEmpty() @MaxLength(200) name: string;
}

class MergeDepartmentDto {
  @IsString() @IsNotEmpty() targetDepartmentId: string;
}

/** Admin → « Départements & membres » (department membership + department clean-up). */
@ApiTags('admin-processes')
@ApiBearerAuth()
@Controller('admin')
export class AdminProcessesController {
  constructor(private readonly service: AdminProcessesService) {}

  @Get('departments')
  @RequirePermissions('users:read')
  overview(@OrgId() orgId: string) {
    return this.service.overview(orgId);
  }

  @Post('departments/:departmentId/members')
  @RequirePermissions('users:admin')
  addMember(@OrgId() orgId: string, @Param('departmentId') departmentId: string, @Body() dto: AddMemberDto) {
    return this.service.addMember(orgId, departmentId, dto.membershipId, dto.kind);
  }

  @Delete('departments/:departmentId/members/:membershipId')
  @RequirePermissions('users:admin')
  removeMember(
    @OrgId() orgId: string,
    @Param('departmentId') departmentId: string,
    @Param('membershipId') membershipId: string,
  ) {
    return this.service.removeMember(orgId, departmentId, membershipId);
  }

  @Patch('departments/:id')
  @RequirePermissions('users:admin')
  rename(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: RenameDepartmentDto) {
    return this.service.rename(orgId, id, dto.name);
  }

  @Post('departments/:id/merge')
  @RequirePermissions('users:admin')
  merge(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: MergeDepartmentDto) {
    return this.service.merge(orgId, id, dto.targetDepartmentId);
  }

  @Delete('departments/:id')
  @RequirePermissions('users:admin')
  remove(@OrgId() orgId: string, @Param('id') id: string) {
    return this.service.remove(orgId, id);
  }
}
