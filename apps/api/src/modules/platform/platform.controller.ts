import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NormalizeEmail } from '../../common/decorators/normalize-email.decorator';
import { ADDON_KEYS } from '@astro/shared';
import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Platform } from '../../common/decorators/platform.decorator';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { AuthService } from '../../core/auth/auth.service';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformService } from './platform.service';
import { SubscriptionsService } from './subscriptions.service';

class CreateOrgDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsString() @MinLength(2) @MaxLength(60) slug: string;
  @IsOptional() @IsString() planKey?: string;
  @NormalizeEmail() @IsEmail() @MaxLength(254) adminEmail: string;
  @IsString() @IsNotEmpty() @MaxLength(120) adminFirstName: string;
  @IsString() @IsNotEmpty() @MaxLength(120) adminLastName: string;
}
class OrgStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED']) status: 'ACTIVE' | 'SUSPENDED';
  @IsOptional() @IsString() reason?: string;
}
class SeatLimitDto {
  @IsInt() @Min(0) seatLimit: number;
}
class StorageLimitDto {
  /** MB; null = back to the plan's cap */
  @IsOptional() @IsInt() @Min(0) storageLimitMb: number | null;
}
class ChangePlanDto {
  @IsString() planId: string;
  @IsOptional() @IsInt() @Min(0) seatLimit?: number;
  @IsOptional() @IsIn(['MONTHLY', 'YEARLY']) billingCycle?: 'MONTHLY' | 'YEARLY';
}
class SubStatusDto {
  @IsIn(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'SUSPENDED']) status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'SUSPENDED';
}
class AddonsDto {
  @IsArray() @ArrayUnique() @IsIn(ADDON_KEYS, { each: true }) addons: string[];
}
class AccountActiveDto {
  @IsBoolean() active: boolean;
}
class ImpersonateDto {
  @IsOptional() @IsString() userId?: string;
}
class AuditQuery extends PaginationQuery {
  @IsOptional() @IsString() organizationId?: string;
  @IsOptional() @IsString() action?: string;
}
class OrgListQuery extends PaginationQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() planId?: string;
}

@ApiTags('platform')
@ApiBearerAuth()
@Platform()
@UseGuards(SuperAdminGuard)
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly subs: SubscriptionsService,
    private readonly audit: PlatformAuditService,
    private readonly auth: AuthService,
  ) {}

  private actor(user: AuthUser, ip?: string, ua?: string) {
    return { actorId: user.id, actorEmail: user.email, ip, userAgent: ua };
  }

  @Get('stats')
  stats() {
    return this.platform.stats();
  }

  @Get('plans')
  plans() {
    return this.subs.listPlans();
  }

  @Get('organizations')
  listOrgs(@Query() q: OrgListQuery) {
    return this.platform.listOrganizations(q, { status: q.status, planId: q.planId });
  }

  @Post('organizations')
  createOrg(@CurrentUser() user: AuthUser, @Ip() ip: string, @Req() req: { headers: Record<string, string> }, @Body() dto: CreateOrgDto) {
    return this.platform.createOrganization(this.actor(user, ip, req.headers['user-agent']), dto);
  }

  @Get('organizations/:id')
  orgDetail(@Param('id') id: string) {
    return this.platform.organizationDetail(id);
  }

  @Patch('organizations/:id/status')
  setStatus(@CurrentUser() user: AuthUser, @Ip() ip: string, @Req() req: { headers: Record<string, string> }, @Param('id') id: string, @Body() dto: OrgStatusDto) {
    return this.platform.setOrganizationStatus(this.actor(user, ip, req.headers['user-agent']), id, dto.status, dto.reason);
  }

  @Delete('organizations/:id')
  remove(@CurrentUser() user: AuthUser, @Ip() ip: string, @Req() req: { headers: Record<string, string> }, @Param('id') id: string) {
    return this.platform.deleteOrganization(this.actor(user, ip, req.headers['user-agent']), id);
  }

  @Patch('organizations/:id/seat-limit')
  async seatLimit(@CurrentUser() user: AuthUser, @Ip() ip: string, @Req() req: { headers: Record<string, string> }, @Param('id') id: string, @Body() dto: SeatLimitDto) {
    const before = await this.subs.seatInfo(id);
    const sub = await this.subs.setSeatLimit(id, dto.seatLimit);
    await this.audit.record({ ...this.actor(user, ip, req.headers['user-agent']), action: 'seat.limit_changed', organizationId: id, before: { seatLimit: before.limit }, after: { seatLimit: dto.seatLimit } });
    return sub;
  }

  @Patch('organizations/:id/storage-limit')
  async storageLimit(@CurrentUser() user: AuthUser, @Ip() ip: string, @Req() req: { headers: Record<string, string> }, @Param('id') id: string, @Body() dto: StorageLimitDto) {
    const sub = await this.subs.setStorageLimit(id, dto.storageLimitMb ?? null);
    await this.audit.record({ ...this.actor(user, ip, req.headers['user-agent']), action: 'storage.limit_changed', organizationId: id, after: { storageLimitMb: dto.storageLimitMb ?? null } });
    return sub;
  }

  @Patch('organizations/:id/plan')
  async changePlan(@CurrentUser() user: AuthUser, @Ip() ip: string, @Req() req: { headers: Record<string, string> }, @Param('id') id: string, @Body() dto: ChangePlanDto) {
    const sub = await this.subs.changePlan(id, dto.planId, { seatLimit: dto.seatLimit, billingCycle: dto.billingCycle });
    await this.audit.record({ ...this.actor(user, ip, req.headers['user-agent']), action: 'subscription.plan_changed', organizationId: id, after: { planId: dto.planId, seatLimit: sub.seatLimit } });
    return sub;
  }

  @Patch('organizations/:id/subscription-status')
  async subStatus(@CurrentUser() user: AuthUser, @Ip() ip: string, @Req() req: { headers: Record<string, string> }, @Param('id') id: string, @Body() dto: SubStatusDto) {
    const sub = await this.subs.setStatus(id, dto.status);
    await this.audit.record({ ...this.actor(user, ip, req.headers['user-agent']), action: 'subscription.status_changed', organizationId: id, after: { status: dto.status } });
    return sub;
  }

  @Patch('organizations/:id/addons')
  async setAddons(@CurrentUser() user: AuthUser, @Ip() ip: string, @Req() req: { headers: Record<string, string> }, @Param('id') id: string, @Body() dto: AddonsDto) {
    const before = await this.subs.getSubscription(id);
    const sub = await this.subs.setAddons(id, dto.addons);
    await this.audit.record({ ...this.actor(user, ip, req.headers['user-agent']), action: 'subscription.addons_changed', organizationId: id, before: { addons: before?.addons ?? [] }, after: { addons: sub.addons } });
    return sub;
  }

  @Get('organizations/:id/accounts')
  accounts(@Param('id') id: string, @Query() q: PaginationQuery) {
    return this.platform.listOrgAccounts(id, q);
  }

  @Patch('organizations/:id/accounts/:membershipId/active')
  setAccountActive(@CurrentUser() user: AuthUser, @Ip() ip: string, @Req() req: { headers: Record<string, string> }, @Param('id') id: string, @Param('membershipId') membershipId: string, @Body() dto: AccountActiveDto) {
    return this.platform.setAccountActive(this.actor(user, ip, req.headers['user-agent']), id, membershipId, dto.active);
  }

  @Post('organizations/:id/impersonate')
  async impersonate(@CurrentUser() user: AuthUser, @Ip() ip: string, @Req() req: { headers: Record<string, string> }, @Param('id') id: string, @Body() dto: ImpersonateDto) {
    const result = await this.auth.impersonate(user, id, dto.userId, { ip, userAgent: req.headers['user-agent'] });
    await this.audit.record({
      ...this.actor(user, ip, req.headers['user-agent']),
      action: 'impersonation.start',
      organizationId: id,
      targetUserId: result.user.id,
      metadata: { role: result.role.key },
    });
    return result;
  }

  @Post('users/:id/reset-2fa')
  resetUserTwoFactor(@CurrentUser() user: AuthUser, @Ip() ip: string, @Req() req: { headers: Record<string, string> }, @Param('id') id: string) {
    return this.platform.resetUserTwoFactor(this.actor(user, ip, req.headers['user-agent']), id);
  }

  @Get('audit-logs')
  auditLogs(@Query() q: AuditQuery) {
    return this.audit.list(q, { organizationId: q.organizationId, action: q.action });
  }
}
