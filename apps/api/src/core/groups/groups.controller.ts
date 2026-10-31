import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrgId } from '../../common/decorators/org.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { GroupsService } from './groups.service';

class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  departmentIds?: string[];
}

class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  departmentIds?: string[];
}

class SetMembersDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  userIds: string[];
}

@ApiTags('groups')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @RequirePermissions('users:read')
  list(@OrgId() orgId: string) {
    return this.groups.list(orgId);
  }

  /** Lightweight list for the share picker — any member of the org. */
  @Get('directory')
  directory(@OrgId() orgId: string) {
    return this.groups.directory(orgId);
  }

  @Post()
  @RequirePermissions('users:admin')
  create(@OrgId() orgId: string, @Body() dto: CreateGroupDto) {
    return this.groups.create(orgId, dto);
  }

  @Patch(':id')
  @RequirePermissions('users:admin')
  update(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.groups.update(orgId, id, dto);
  }

  @Put(':id/members')
  @RequirePermissions('users:admin')
  setMembers(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: SetMembersDto) {
    return this.groups.setMembers(orgId, id, dto.userIds);
  }

  @Delete(':id')
  @RequirePermissions('users:admin')
  remove(@OrgId() orgId: string, @Param('id') id: string) {
    return this.groups.remove(orgId, id);
  }
}
