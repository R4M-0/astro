import { ForbiddenException, HttpException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { LoginGuardService } from './login-guard.service';

describe('AuthService.reauthenticate — e-signature step-up (M-3)', () => {
  let hash: string;
  beforeAll(async () => {
    hash = await argon2.hash('Correct-Horse-1');
  });

  const build = (user: Record<string, unknown>) => {
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue(user), updateMany: jest.fn() } };
    const guard = new LoginGuardService();
    const mail = { send: jest.fn() };
    const service = new AuthService(prisma, {} as any, { get: () => '' } as any, mail as any, {} as any, {} as any, {} as any, guard);
    return { service, guard, mail };
  };

  it('accepts the right password', async () => {
    const { service } = build({ id: 'u1', email: 'a@x.io', passwordHash: hash, twoFactorEnabled: false, deletedAt: null });
    await expect(service.reauthenticate('u1', { password: 'Correct-Horse-1' })).resolves.toBeUndefined();
  });

  it('answers 403 ESIGN_REAUTH_FAILED (not 401) on a wrong password', async () => {
    const { service } = build({ id: 'u1', email: 'a@x.io', passwordHash: hash, twoFactorEnabled: false, deletedAt: null });
    const err = await service.reauthenticate('u1', { password: 'nope' }).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ error: 'ESIGN_REAUTH_FAILED', method: 'password' });
  });

  it('requires the TOTP code (not the password) when 2FA is on', async () => {
    const { service } = build({ id: 'u1', email: 'a@x.io', passwordHash: hash, twoFactorEnabled: true, twoFactorSecret: null, deletedAt: null });
    const err = await service.reauthenticate('u1', { password: 'Correct-Horse-1' }).catch((e) => e);
    expect(err.getResponse()).toMatchObject({ error: 'ESIGN_REAUTH_FAILED', method: 'totp' });
  });

  it('locks the account after repeated failures, even with the right password afterwards', async () => {
    const { service, mail } = build({ id: 'u1', email: 'a@x.io', passwordHash: hash, twoFactorEnabled: false, deletedAt: null });
    for (let i = 0; i < 5; i++) await service.reauthenticate('u1', { password: 'nope' }).catch(() => undefined);
    expect(mail.send).toHaveBeenCalled();
    const err = await service.reauthenticate('u1', { password: 'Correct-Horse-1' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
  });
});
