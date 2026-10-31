import { authenticator } from 'otplib';
import { AuthService } from './auth.service';
import { encryptSecret } from './secret-cipher';

describe('TOTP replay guard (M-2)', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET ??= 'test-secret-test-secret-test-secret!!';
  });

  it('accepts a code once, then rejects the same time step', async () => {
    const user = { id: 'u1', lastTotpStep: null as number | null };
    const prisma: any = {
      user: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const ok = user.lastTotpStep === null || user.lastTotpStep < where.OR[1].lastTotpStep.lt;
          if (ok) user.lastTotpStep = data.lastTotpStep;
          return { count: ok ? 1 : 0 };
        }),
      },
    };
    const service = new AuthService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const secret = authenticator.generateSecret();
    const enc = encryptSecret(secret);
    const code = authenticator.generate(secret);
    const check = (last: number | null) => (service as any).checkTotp('u1', enc, code, last);
    expect(await check(null)).toBe(true);
    expect(await check(user.lastTotpStep)).toBe(false);
    expect(await (service as any).checkTotp('u1', enc, '000000', null)).toBe(code === '000000');
  });
});
