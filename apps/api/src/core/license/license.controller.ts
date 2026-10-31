import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SELF_HOSTED } from './deployment-mode';
import { LicenseExempt } from './license-exempt.decorator';
import { LicenseService, renewalCovers, type LicenseState } from './license.service';

class InstallLicenseDto {
  @IsString() @MinLength(20) @MaxLength(8000) license: string;
}

/** What every member may see (banner): no customer details, no instance id. */
function publicView(s: LicenseState) {
  return {
    mode: s.mode,
    status: s.status,
    readOnly: s.readOnly,
    expiresAt: s.payload?.expiresAt ?? null,
    daysLeft: s.daysLeft,
    graceEndsAt: s.graceEndsAt,
    /** expiry warnings are moot: an installed renewal takes over in time */
    renewalInstalled: renewalCovers(s),
  };
}

@ApiTags('license')
@ApiBearerAuth()
@Controller('license')
export class LicenseController {
  constructor(private readonly license: LicenseService) {}

  /** Banner state for any signed-in member (`mode: 'saas'` on the SaaS). */
  @Get('status')
  status() {
    return publicView(this.license.state());
  }

  /** Admin → Licence: full details, install-wide usage, instance id. */
  @Get()
  @RequirePermissions('organization:admin')
  async details() {
    if (!SELF_HOSTED) throw new NotFoundException();
    return this.view(await this.license.refresh());
  }

  @Post()
  @LicenseExempt()
  @RequirePermissions('organization:admin')
  async install(@Body() dto: InstallLicenseDto, @CurrentUser() user: AuthUser) {
    if (!SELF_HOSTED) throw new NotFoundException();
    return this.view(await this.license.install(dto.license, user.id));
  }

  private async view(s: LicenseState) {
    const [seatsUsed, organizations] = await Promise.all([this.license.installSeatsUsed(), this.license.organizationCount()]);
    const p = s.payload;
    return {
      ...publicView(s),
      source: s.source,
      error: s.error,
      instanceId: s.instanceId,
      upcoming: s.upcoming,
      checkedAt: s.checkedAt,
      license: p
        ? {
            reference: p.lid,
            customer: p.customer,
            plan: p.plan,
            seatLimit: p.seatLimit,
            orgLimit: p.orgLimit,
            addons: p.addons,
            storageLimitMb: p.storageLimitMb,
            issuedAt: p.issuedAt,
            startsAt: p.startsAt,
            expiresAt: p.expiresAt,
            graceDays: p.graceDays,
            boundToInstance: !!p.instanceId,
            updatesUntil: p.updatesUntil,
          }
        : null,
      usage: { seatsUsed, organizations },
    };
  }
}
