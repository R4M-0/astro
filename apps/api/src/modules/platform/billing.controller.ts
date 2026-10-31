import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ADDON_KEYS } from '@astro/shared';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PlatformAuditService } from './platform-audit.service';
import { SubscriptionsService } from './subscriptions.service';

class RequestSeatsDto {
  @IsInt() @Min(1) additionalSeats: number;
  @IsOptional() @IsString() note?: string;
}
class RequestPlanDto {
  @IsString() planKey: string;
  @IsOptional() @IsString() note?: string;
}
class RequestAddonDto {
  @IsIn(ADDON_KEYS) addon: string;
  @IsOptional() @IsString() note?: string;
}

/**
 * Organization-facing billing view: an admin sees their own plan, seats and
 * invoices, and can *request* an upgrade or more seats (which surfaces to the
 * Super Admin as a platform event). Strictly tenant-scoped — never touches
 * another org and cannot self-grant seats.
 */
@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(
    private readonly subs: SubscriptionsService,
    private readonly audit: PlatformAuditService,
  ) {}

  @Get('overview')
  @RequirePermissions('organization:read')
  overview(@OrgId() orgId: string) {
    return this.subs.billingOverview(orgId);
  }

  @Get('plans')
  @RequirePermissions('organization:read')
  plans() {
    return this.subs.listPlans({ publicOnly: true });
  }

  @Post('request-seats')
  @RequirePermissions('organization:admin')
  async requestSeats(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: RequestSeatsDto) {
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'seat.requested',
      organizationId: orgId,
      metadata: { additionalSeats: dto.additionalSeats, note: dto.note },
    });
    return { requested: true };
  }

  @Post('request-plan')
  @RequirePermissions('organization:admin')
  async requestPlan(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: RequestPlanDto) {
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'plan.requested',
      organizationId: orgId,
      metadata: { planKey: dto.planKey, note: dto.note },
    });
    return { requested: true };
  }

  @Post('request-addon')
  @RequirePermissions('organization:admin')
  async requestAddon(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: RequestAddonDto) {
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'addon.requested',
      organizationId: orgId,
      metadata: { addon: dto.addon, note: dto.note },
    });
    return { requested: true };
  }
}
