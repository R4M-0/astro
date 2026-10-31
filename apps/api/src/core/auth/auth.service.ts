import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';
import { MailService } from '../mail/mail.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { decryptSecret, encryptSecret } from './secret-cipher';
import { InvitationsService } from './invitations.service';
import { LoginGuardService, MAX_FAILURES } from './login-guard.service';
import { escapeHtml } from '../../common/html';
import { SELF_HOSTED } from '../license/deployment-mode';
import { currentLicense } from '../license/license.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const TOTP_STEP_SECONDS = 30;
const currentTotpStep = () => Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly rbac: RbacService,
    private readonly gateway: NotificationsGateway,
    private readonly invitations: InvitationsService,
    private readonly loginGuard: LoginGuardService,
  ) {}

  // ── registration ────────────────────────────────────────────────────────────

  async register(dto: RegisterDto, meta: { ip?: string; userAgent?: string }) {
    if (SELF_HOSTED) {
      // a customer's installation has no public sign-up: admins invite members
      throw new ForbiddenException('Self-registration is disabled on this installation; ask an administrator for an invitation');
    }
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new BadRequestException('An account with this email already exists');

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await argon2.hash(dto.password),
        firstName: dto.firstName,
        lastName: dto.lastName,
        termsAcceptedAt: new Date(),
        termsVersion: dto.termsVersion,
      },
    });

    await this.sendVerificationEmail(user.id, user.email);
    if (!dto.organizationName) {
      // an account without an organization must prove its e-mail before it can sign in
      return { verificationRequired: true as const };
    }
    await this.assertCanCreateOrganization(user.id);
    await this.createOrganizationForUser(user.id, dto.organizationName);
    return this.issueTokens(user.id, user.email, meta);
  }

  /**
   * Self-serve org creation is a feature flag (ALLOW_ORG_CREATION, default on)
   * and capped per user (MAX_ORGS_PER_USER, default 3) so an account cannot
   * mint unlimited tenants / subscriptions.
   */
  async assertCanCreateOrganization(userId: string) {
    if (SELF_HOSTED) {
      // the first organization can always be created (before the license is installed)
      const limit = Math.max(1, currentLicense().payload?.orgLimit ?? 1);
      const count = await this.prisma.organization.count({ where: { deletedAt: null } });
      if (count >= limit) {
        throw new ForbiddenException(`The license allows ${limit} organization${limit > 1 ? 's' : ''} on this installation`);
      }
    }
    if (process.env.ALLOW_ORG_CREATION === 'false') {
      throw new ForbiddenException('Organization creation is disabled; contact Astro support');
    }
    const max = Number(process.env.MAX_ORGS_PER_USER ?? 3);
    const owned = await this.prisma.membership.count({
      where: { userId, deletedAt: null, role: { key: 'org_admin' }, organization: { deletedAt: null } },
    });
    if (owned >= max) {
      throw new ForbiddenException(`You already administer ${owned} organizations (limit ${max})`);
    }
  }

  async createOrganizationForUser(userId: string, name: string) {
    const slugBase = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const slug = `${slugBase}-${randomBytes(3).toString('hex')}`;

    const org = await this.prisma.organization.create({ data: { name, slug } });
    const roles = await this.rbac.provisionSystemRoles(org.id);
    const adminRole = roles.find((r) => r.key === 'org_admin')!;
    await this.prisma.membership.create({
      data: { organizationId: org.id, userId, roleId: adminRole.id, isDefault: true },
    });
    return org;
  }

  // ── login / 2FA ─────────────────────────────────────────────────────────────

  async login(dto: LoginDto, meta: { ip?: string; userAgent?: string }) {
    const email = dto.email.trim().toLowerCase();
    const guardKey = `login:${email}`;
    // per-account lockout, whatever the caller's IP (the per-IP throttle stays on the route)
    await this.loginGuard.assertNotLocked(guardKey);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = !!user && !user.deletedAt && (await argon2.verify(user.passwordHash, dto.password));
    if (!user || !valid) {
      const { lockedNow, lockMs } = await this.loginGuard.recordFailure(guardKey);
      if (lockedNow && user && !user.deletedAt) await this.notifyLockout(user.email, lockMs);
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.loginGuard.reset(guardKey);

    // An account that never verified its e-mail and has no organization yet must verify first
    // (existing tenants keep signing in; invitations verify the address when accepted).
    if (!user.emailVerifiedAt && !(user.isSuperAdmin && !SELF_HOSTED)) {
      const accepted = await this.prisma.membership.count({
        where: { userId: user.id, deletedAt: null, acceptedAt: { not: null } },
      });
      if (!accepted) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'EMAIL_NOT_VERIFIED',
          message: 'Please verify your e-mail address before signing in.',
        });
      }
    }

    if (user.twoFactorEnabled) {
      const challengeToken = await this.jwt.signAsync(
        { sub: user.id, type: '2fa-challenge', jti: randomBytes(12).toString('base64url') },
        { secret: this.config.getOrThrow('JWT_ACCESS_SECRET'), expiresIn: '5m' },
      );
      return { twoFactorRequired: true as const, challengeToken };
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(user.id, user.email, meta);
  }

  async loginWith2fa(challengeToken: string, code: string, meta: { ip?: string; userAgent?: string }) {
    let payload: { sub: string; type: string; jti?: string };
    try {
      payload = await this.jwt.verifyAsync(challengeToken, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Challenge expired, log in again');
    }
    if (payload.type !== '2fa-challenge' || !payload.jti) throw new UnauthorizedException('Invalid challenge');

    // at most MAX_FAILURES codes per challenge, and a per-account lockout across challenges
    const challengeKey = `2fa:${payload.jti}`;
    const accountKey = `2fa-user:${payload.sub}`;
    if ((await this.loginGuard.failures(challengeKey)) >= MAX_FAILURES) {
      throw new UnauthorizedException('Too many attempts, log in again');
    }
    await this.loginGuard.assertNotLocked(accountKey);

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
    if (user.deletedAt) throw new UnauthorizedException('Invalid challenge');
    const ok = await this.verifyTotpOrRecovery(user.id, user.twoFactorSecret, user.recoveryCodes, code, user.lastTotpStep);
    if (!ok) {
      await this.loginGuard.recordFailure(challengeKey);
      const { lockedNow, lockMs } = await this.loginGuard.recordFailure(accountKey);
      if (lockedNow) await this.notifyLockout(user.email, lockMs);
      throw new UnauthorizedException('Invalid authentication code');
    }
    await this.loginGuard.reset(accountKey);

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(user.id, user.email, meta);
  }

  /**
   * Step-up re-authentication for an electronic signature (M-3): the TOTP code when 2FA is
   * on, otherwise the password. It shares the per-account lockout (and honours a sign-in
   * lockout) so it cannot be used as a password / OTP oracle. Answers 403
   * `ESIGN_REAUTH_FAILED` — not 401, the session itself is still valid.
   */
  async reauthenticate(userId: string, creds: { password?: string; totp?: string }): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new UnauthorizedException();
    const key = `esign:${userId}`;
    await this.loginGuard.assertNotLocked(`login:${user.email.toLowerCase()}`);
    await this.loginGuard.assertNotLocked(key);

    const method = user.twoFactorEnabled ? 'totp' : 'password';
    const ok =
      method === 'totp'
        ? !!creds.totp && !!user.twoFactorSecret && (await this.checkTotp(user.id, user.twoFactorSecret, creds.totp, user.lastTotpStep))
        : !!creds.password && (await argon2.verify(user.passwordHash, creds.password));
    if (!ok) {
      const { lockedNow, lockMs } = await this.loginGuard.recordFailure(key);
      if (lockedNow) await this.notifyLockout(user.email, lockMs);
      throw new ForbiddenException({
        statusCode: 403,
        error: 'ESIGN_REAUTH_FAILED',
        method,
        message: method === 'totp' ? 'Code d’authentification invalide' : 'Mot de passe incorrect',
      });
    }
    await this.loginGuard.reset(key);
  }

  /**
   * TOTP (never the same time step twice — replay guard) or a one-time recovery code.
   */
  private async verifyTotpOrRecovery(
    userId: string,
    secret: string | null,
    recoveryCodes: string[],
    code: string,
    lastTotpStep: number | null = null,
  ): Promise<boolean> {
    if (secret && (await this.checkTotp(userId, secret, code, lastTotpStep))) return true;
    const hashed = sha256(code.replace(/\s/g, '').toUpperCase());
    if (recoveryCodes.includes(hashed)) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { recoveryCodes: recoveryCodes.filter((c) => c !== hashed) },
      });
      return true;
    }
    return false;
  }

  /** Accepts a TOTP code once: its time step must be newer than the last accepted one. */
  private async checkTotp(userId: string, secret: string, code: string, lastTotpStep: number | null) {
    const delta = authenticator.checkDelta(code.replace(/\s/g, ''), decryptSecret(secret));
    if (delta === null) return false;
    const step = currentTotpStep() + delta;
    if (lastTotpStep !== null && step <= lastTotpStep) return false;
    // conditional write: a concurrent request with the same code loses the race
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: step } }] },
      data: { lastTotpStep: step },
    });
    return count === 1;
  }

  private async notifyLockout(email: string, lockMs: number) {
    const minutes = Math.ceil(lockMs / 60_000);
    const appUrl = escapeHtml(this.config.get('APP_URL') ?? '');
    await this.mail.send({
      to: email,
      subject: 'Astro — sign-in temporarily locked / connexion temporairement bloquée',
      html: `<p>Several failed sign-in attempts were made on your Astro account. Sign-in is locked for ${minutes} minute(s).
             If this was not you, <a href="${appUrl}/forgot-password">reset your password</a>.</p>
             <p>Plusieurs tentatives de connexion ont échoué sur votre compte Astro. La connexion est bloquée pendant ${minutes} minute(s).
             Si vous n'êtes pas à l'origine de ces tentatives, <a href="${appUrl}/forgot-password">réinitialisez votre mot de passe</a>.</p>`,
    });
  }

  async setup2fa(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.twoFactorEnabled) throw new BadRequestException('2FA is already enabled');
    const secret = authenticator.generateSecret();
    // stored encrypted at rest; the plaintext only ever leaves via this QR
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: encryptSecret(secret) },
    });
    const otpauth = authenticator.keyuri(user.email, 'Astro', secret);
    const qrDataUrl = await qrcode.toDataURL(otpauth);
    return { secret, otpauth, qrDataUrl };
  }

  async enable2fa(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorSecret) throw new BadRequestException('Run 2FA setup first');
    if (!(await this.checkTotp(user.id, user.twoFactorSecret, code, user.lastTotpStep))) {
      throw new BadRequestException('Invalid code');
    }
    const plainCodes = Array.from({ length: 8 }, () =>
      randomBytes(4).toString('hex').toUpperCase(),
    );
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true, recoveryCodes: plainCodes.map(sha256) },
    });
    return { recoveryCodes: plainCodes };
  }

  async disable2fa(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorEnabled) throw new BadRequestException('2FA is not enabled');
    const ok = await this.verifyTotpOrRecovery(user.id, user.twoFactorSecret, user.recoveryCodes, code, user.lastTotpStep);
    if (!ok) throw new BadRequestException('Invalid code');
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, recoveryCodes: [] },
    });
    return { disabled: true };
  }

  // ── tokens & sessions ───────────────────────────────────────────────────────

  private async issueTokens(
    userId: string,
    email: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<TokenPair> {
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshTtl = Number(this.config.get('JWT_REFRESH_TTL') ?? 2592000);
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: sha256(refreshToken),
        userAgent: meta.userAgent?.slice(0, 500),
        ip: meta.ip,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });
    const accessToken = await this.signAccessToken(userId, email, session.id);
    return { accessToken, refreshToken: `${session.id}.${refreshToken}`, sessionId: session.id };
  }

  private signAccessToken(userId: string, email: string, sessionId: string) {
    return this.jwt.signAsync(
      { sub: userId, email, sid: sessionId },
      {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        expiresIn: Number(this.config.get('JWT_ACCESS_TTL') ?? 900),
      },
    );
  }

  /**
   * Super Admin support access. Issues a short-lived, access-token-only session for
   * a target user in an organization, marked with impersonatedById. No refresh token
   * is issued (so the Super Admin's own session/refresh cookie is untouched), and the
   * session carries the impersonation marker surfaced to the UI as a banner.
   * The caller (PlatformController) writes the audit entry.
   */
  async impersonate(
    admin: { id: string; email: string; isSuperAdmin: boolean },
    orgId: string,
    targetUserId: string | undefined,
    meta: { ip?: string; userAgent?: string },
  ) {
    if (SELF_HOSTED || !admin.isSuperAdmin) throw new UnauthorizedException('Super administrator access required');
    const org = await this.prisma.organization.findFirst({ where: { id: orgId, deletedAt: null } });
    if (!org) throw new BadRequestException('Organization not found');
    const membership = await this.prisma.membership.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
        isActive: true,
        acceptedAt: { not: null },
        user: { deletedAt: null },
        ...(targetUserId ? { userId: targetUserId } : { role: { key: 'org_admin' } }),
      },
      include: { user: true, role: { select: { key: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) throw new BadRequestException('No target user to impersonate in this organization');
    const target = membership.user;
    const ttl = Number(this.config.get('IMPERSONATION_TTL') ?? 1800);
    const session = await this.prisma.session.create({
      data: {
        userId: target.id,
        refreshTokenHash: sha256(randomBytes(48).toString('base64url')), // unusable — impersonation cannot be refreshed
        impersonatedById: admin.id,
        userAgent: meta.userAgent?.slice(0, 500),
        ip: meta.ip,
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: target.id, email: target.email, sid: session.id },
      { secret: this.config.getOrThrow('JWT_ACCESS_SECRET'), expiresIn: ttl },
    );
    return {
      accessToken,
      expiresIn: ttl,
      organization: { id: org.id, name: org.name },
      user: { id: target.id, email: target.email, firstName: target.firstName, lastName: target.lastName },
      role: membership.role,
    };
  }

  /** Rotating refresh: verifies, revokes the old token value, issues a new one. */
  async refresh(compound: string | undefined, meta: { ip?: string; userAgent?: string }) {
    if (!compound) throw new UnauthorizedException('Missing refresh token');
    const [sessionId, token] = compound.split('.');
    if (!sessionId || !token) throw new UnauthorizedException('Malformed refresh token');

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.deletedAt) {
      throw new UnauthorizedException('Session expired');
    }
    if (session.refreshTokenHash !== sha256(token)) {
      // token reuse — likely theft: kill the session (and its live sockets)
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      });
      this.gateway.disconnectSession(sessionId);
      throw new ForbiddenException('Refresh token reuse detected; session revoked');
    }

    const newToken = randomBytes(48).toString('base64url');
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { refreshTokenHash: sha256(newToken), lastUsedAt: new Date(), ip: meta.ip },
    });
    const accessToken = await this.signAccessToken(session.userId, session.user.email, sessionId);
    return { accessToken, refreshToken: `${sessionId}.${newToken}`, sessionId };
  }

  async logout(sessionId: string) {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.gateway.disconnectSession(sessionId);
    return { loggedOut: true };
  }

  async listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId },
      data: { revokedAt: new Date() },
    });
    this.gateway.disconnectSession(sessionId);
    return { revoked: true };
  }

  // ── email verification & password reset ─────────────────────────────────────

  async sendVerificationEmail(userId: string, email: string) {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.verificationToken.create({
      data: {
        userId,
        type: 'EMAIL_VERIFICATION',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    const url = `${this.config.get('APP_URL')}/verify-email?token=${token}`;
    await this.mail.send({
      to: email,
      subject: 'Verify your Astro account',
      html: `<p>Welcome to Astro! Confirm your email address:</p><p><a href="${url}">Verify my email</a></p><p>This link expires in 24 hours.</p>`,
    });
  }

  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) throw new BadRequestException('Email already verified');
    await this.sendVerificationEmail(user.id, user.email);
    return { sent: true };
  }

  async verifyEmail(token: string) {
    const record = await this.prisma.verificationToken.findFirst({
      where: {
        tokenHash: sha256(token),
        type: 'EMAIL_VERIFICATION',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!record) throw new BadRequestException('Invalid or expired verification link');
    await this.prisma.$transaction([
      this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
    return { verified: true };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always claim success to avoid account enumeration.
    if (!user || user.deletedAt) return { sent: true };

    const token = randomBytes(32).toString('base64url');
    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });
    const url = `${this.config.get('APP_URL')}/reset-password?token=${token}`;
    await this.mail.send({
      to: email,
      subject: 'Reset your Astro password',
      html: `<p>Reset your password:</p><p><a href="${url}">Choose a new password</a></p><p>This link expires in 1 hour. Ignore this email if you didn't request it.</p>`,
    });
    return { sent: true };
  }

  /** Logged-in password change: re-authenticates, then revokes every *other* session. */
  async changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must differ from the current one');
    }
    const others = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, id: { not: sessionId } },
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await argon2.hash(newPassword) },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null, id: { not: sessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
    for (const s of others) this.gateway.disconnectSession(s.id);
    return { changed: true, revokedSessions: others.length };
  }

  async resetPassword(token: string, password: string) {
    const record = await this.prisma.verificationToken.findFirst({
      where: {
        tokenHash: sha256(token),
        type: 'PASSWORD_RESET',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!record) throw new BadRequestException('Invalid or expired reset link');
    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user || user.deletedAt) throw new BadRequestException('Invalid or expired reset link');
    await this.prisma.$transaction([
      this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await argon2.hash(password) },
      }),
      // the link proved control of the mailbox
      this.prisma.user.updateMany({
        where: { id: record.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      }),
      // all sessions are revoked after a password reset
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    this.gateway.disconnectUser(record.userId);
    // set-password link of an invitation: the pending membership becomes active
    if (record.membershipId) {
      await this.invitations.activateMembership(record.membershipId, record.userId).catch((err) => {
        this.logger.warn(`invitation ${record.membershipId} not activated: ${(err as Error).message}`);
      });
    }
    await this.loginGuard.reset(`login:${user.email.toLowerCase()}`);
    return { reset: true };
  }
}
