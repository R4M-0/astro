import { Body, Controller, Get, Ip, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ADDON_KEYS } from '@astro/shared';
import { ArrayUnique, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Platform } from '../../common/decorators/platform.decorator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { PlatformLicensesService } from './platform-licenses.service';

class IssueLicenseDto {
  @IsString() @IsNotEmpty() @MaxLength(200) customer: string;
  @IsOptional() @IsString() organizationId?: string | null;
  @IsString() @IsNotEmpty() plan: string;
  @IsInt() @Min(1) @Max(100000) seatLimit: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000) orgLimit?: number;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(ADDON_KEYS, { each: true }) addons?: string[];
  @IsOptional() @IsInt() @Min(0) storageLimitMb?: number | null;
  @IsDateString() startsAt: string;
  @IsDateString() expiresAt: string;
  @IsOptional() @IsInt() @Min(0) @Max(90) graceDays?: number;
  @IsOptional() @IsString() @MaxLength(100) instanceId?: string | null;
  @IsOptional() @IsDateString() updatesUntil?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsString() supersedesId?: string | null;
}

class LicenseListQuery {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}

/** Super Admin: sign and keep track of self-hosted licenses. */
@ApiTags('platform')
@ApiBearerAuth()
@Platform()
@UseGuards(SuperAdminGuard)
@Controller('platform/licenses')
export class PlatformLicensesController {
  constructor(private readonly licenses: PlatformLicensesService) {}

  @Get()
  list(@Query() q: LicenseListQuery) {
    return this.licenses.list(q);
  }

  /** Whether signing is configured + the public key to embed in self-hosted builds. */
  @Get('signing-key')
  signingKey() {
    return this.licenses.publicKey();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.licenses.get(id);
  }

  @Post()
  issue(@CurrentUser() user: AuthUser, @Ip() ip: string, @Req() req: { headers: Record<string, string> }, @Body() dto: IssueLicenseDto) {
    return this.licenses.issue({ actorId: user.id, actorEmail: user.email, ip, userAgent: req.headers['user-agent'] }, dto);
  }
}
