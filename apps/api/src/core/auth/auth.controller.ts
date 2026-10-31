import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService, TokenPair } from './auth.service';
import { InvitationsService } from './invitations.service';
import {
  AcceptInvitationDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  TwoFactorCodeDto,
  TwoFactorLoginDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { LicenseExempt } from '../license/license-exempt.decorator';
import { TenantOptional } from '../../common/decorators/tenant-optional.decorator';

const REFRESH_COOKIE = 'astro_rt';

@ApiTags('auth')
@LicenseExempt()
// sign-out, sessions, password, 2FA are user-level — also for a membership-less super admin
@TenantOptional()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly invitations: InvitationsService,
  ) {}

  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure:
        process.env.NODE_ENV === 'production' || (process.env.APP_URL ?? '').startsWith('https://'),
      path: '/api/v1/auth',
      maxAge: Number(process.env.JWT_REFRESH_TTL ?? 2592000) * 1000,
    });
  }

  private meta(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  private respondWithTokens(res: Response, tokens: TokenPair) {
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('register')
  @ApiOperation({ summary: 'Create an account (optionally with a new organization)' })
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(dto, this.meta(req));
    if ('verificationRequired' in result) return result;
    return this.respondWithTokens(res, result);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login; returns tokens or a 2FA challenge' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, this.meta(req));
    if ('twoFactorRequired' in result) return result;
    return this.respondWithTokens(res, result);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login/2fa')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete a 2FA login challenge' })
  async login2fa(@Body() dto: TwoFactorLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.loginWith2fa(dto.challengeToken, dto.code, this.meta(req));
    return this.respondWithTokens(res, tokens);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token and get a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], this.meta(req));
    return this.respondWithTokens(res, tokens);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    return this.auth.logout(user.sessionId);
  }

  // ── 2FA management ──────────────────────────────────────────────────────────

  @ApiBearerAuth()
  @Post('2fa/setup')
  @ApiOperation({ summary: 'Generate a TOTP secret + QR code' })
  setup2fa(@CurrentUser() user: AuthUser) {
    return this.auth.setup2fa(user.id);
  }

  @ApiBearerAuth()
  @Post('2fa/verify')
  @ApiOperation({ summary: 'Confirm the TOTP code and enable 2FA; returns recovery codes' })
  enable2fa(@CurrentUser() user: AuthUser, @Body() dto: TwoFactorCodeDto) {
    return this.auth.enable2fa(user.id, dto.code);
  }

  @ApiBearerAuth()
  @Post('2fa/disable')
  disable2fa(@CurrentUser() user: AuthUser, @Body() dto: TwoFactorCodeDto) {
    return this.auth.disable2fa(user.id, dto.code);
  }

  // ── email verification / password reset ─────────────────────────────────────

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('email/verify')
  @HttpCode(200)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('invitations/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept an organization invitation (link from the invitation e-mail)' })
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.invitations.accept(dto.token);
  }

  @ApiBearerAuth()
  @Post('email/resend')
  resendVerification(@CurrentUser() user: AuthUser) {
    return this.auth.resendVerification(user.id);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('password/forgot')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('password/reset')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('password/change')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change the password of the logged-in user (revokes other sessions)' })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, user.sessionId, dto.currentPassword, dto.newPassword);
  }

  // ── session management ──────────────────────────────────────────────────────

  @ApiBearerAuth()
  @Get('sessions')
  listSessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user.id);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  revokeSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.auth.revokeSession(user.id, id);
  }
}
