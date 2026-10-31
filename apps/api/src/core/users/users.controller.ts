import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NormalizeEmail } from '../../common/decorators/normalize-email.decorator';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { MemberAdminService } from './member-admin.service';
import { UsersService } from './users.service';
import { TenantOptional } from '../../common/decorators/tenant-optional.decorator';

class UpdateMeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  lastName?: string;

  @IsOptional()
  @IsIn(['fr', 'en'])
  locale?: string;
}

class InviteUserDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  lastName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  roleId: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  siteId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  departmentId?: string;
}

class UpdateMembershipDto {
  @IsOptional()
  @IsString()
  roleId?: string;

  @IsOptional()
  @IsString()
  siteId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  /** main department ('' or null clears it) */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  departmentId?: string | null;

  /** extra departments whose records this member also sees */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  extraDepartmentIds?: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName?: string;
}

class MembershipStatusDto {
  @IsBoolean()
  isActive: boolean;
}

class BulkMembersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  membershipIds: string[];

  @IsOptional()
  @IsString()
  roleId?: string;

  /** main department (null or '' clears it) */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  departmentId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  addExtraDepartmentIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  removeExtraDepartmentIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  addGroupIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  removeGroupIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly admin: MemberAdminService,
  ) {}

  // also a membership-less platform super admin (orgId is then undefined)
  @TenantOptional()
  @Get('me')
  me(@CurrentUser() user: AuthUser, @OrgId() orgId: string | undefined) {
    return this.users.getMe(user.id, orgId);
  }

  @TenantOptional()
  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user.id, dto);
  }

  @Get('me/permissions')
  myPermissions(@CurrentUser() user: AuthUser, @OrgId() orgId: string) {
    return this.users.getMyPermissions(user.id, orgId);
  }

  /** Active members (id + name) for person pickers — any member; the admin list stays on users:read. */
  @Get('users/directory')
  directory(@OrgId() orgId: string) {
    return this.users.directory(orgId);
  }

  @Get('users')
  @RequirePermissions('users:read')
  list(@OrgId() orgId: string, @Query() q: PaginationQuery) {
    return this.users.listMembers(orgId, q);
  }

  @Post('users')
  @RequirePermissions('users:admin')
  invite(@OrgId() orgId: string, @Body() dto: InviteUserDto) {
    return this.users.inviteMember(orgId, dto);
  }

  /** declared before `users/:membershipId` routes */
  @Post('users/bulk')
  @RequirePermissions('users:admin')
  bulk(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: BulkMembersDto) {
    return this.admin.bulk(orgId, user.id, dto);
  }

  @Patch('users/:membershipId/status')
  @RequirePermissions('users:admin')
  setStatus(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('membershipId') membershipId: string,
    @Body() dto: MembershipStatusDto,
  ) {
    return this.admin.setStatus(orgId, user.id, membershipId, dto.isActive);
  }

  @Post('users/:membershipId/reset-2fa')
  @HttpCode(200)
  @RequirePermissions('users:admin')
  reset2fa(@OrgId() orgId: string, @Param('membershipId') membershipId: string) {
    return this.admin.reset2fa(orgId, membershipId);
  }

  @Post('users/:membershipId/resend-invite')
  @HttpCode(200)
  @RequirePermissions('users:admin')
  resendInvite(@OrgId() orgId: string, @Param('membershipId') membershipId: string) {
    return this.admin.resendInvite(orgId, membershipId);
  }

  @Get('users/:membershipId/effective-access')
  @RequirePermissions('users:admin')
  effectiveAccess(@OrgId() orgId: string, @Param('membershipId') membershipId: string) {
    return this.admin.effectiveAccess(orgId, membershipId);
  }

  @Patch('users/:membershipId')
  @RequirePermissions('users:admin')
  updateMembership(
    @OrgId() orgId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateMembershipDto,
  ) {
    return this.users.updateMembership(orgId, membershipId, dto);
  }

  @Delete('users/:membershipId')
  @RequirePermissions('users:admin')
  removeMembership(@OrgId() orgId: string, @Param('membershipId') membershipId: string) {
    return this.users.removeMembership(orgId, membershipId);
  }
}
