import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthCacheService } from '../auth-cache/auth-cache.service';
import { SELF_HOSTED } from '../license/deployment-mode';

interface JwtPayload {
  sub: string;
  email: string;
  sid: string;
  type?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authCache: AuthCacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type) throw new UnauthorizedException(); // reject challenge tokens
    // cached per session; any Session/User write invalidates it (AuthCacheService)
    const state = await this.authCache.getOrLoad(
      `jwt:${payload.sid}:${payload.sub}`,
      async () => {
        const [session, user] = await Promise.all([
          this.prisma.session.findUnique({
            where: { id: payload.sid },
            select: { revokedAt: true, expiresAt: true, impersonatedById: true },
          }),
          this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: { isSuperAdmin: true, deletedAt: true },
          }),
        ]);
        return session && user ? { session, user } : null;
      },
      () => [`s:${payload.sid}`, `u:${payload.sub}`],
    );
    const session = state?.session;
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session revoked');
    }
    const user = state.user;
    if (user.deletedAt) throw new UnauthorizedException('Account unavailable');
    return {
      id: payload.sub,
      email: payload.email,
      sessionId: payload.sid,
      // a self-hosted install has no platform staff: the flag is ignored even if set in its database
      isSuperAdmin: !SELF_HOSTED && user.isSuperAdmin,
      impersonatedById: session.impersonatedById ?? null,
    };
  }
}
