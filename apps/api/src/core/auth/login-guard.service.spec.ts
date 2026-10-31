import { HttpException } from '@nestjs/common';
import { LoginGuardService, MAX_FAILURES } from './login-guard.service';

describe('LoginGuardService (in-memory fallback, fake clock)', () => {
  let now: number;
  let guard: LoginGuardService;
  beforeEach(() => {
    now = 1_000_000;
    guard = new LoginGuardService(); // no Redis → memory
    guard.now = () => now;
  });

  const fail = async (n: number, key = 'login:a@b.c') => {
    let last = { failures: 0, lockedNow: false, lockMs: 0 };
    for (let i = 0; i < n; i++) last = await guard.recordFailure(key);
    return last;
  };

  it('locks the account after MAX_FAILURES failures, whatever the IP', async () => {
    const r = await fail(MAX_FAILURES);
    expect(r.lockedNow).toBe(true);
    expect(r.lockMs).toBe(60_000);
    await expect(guard.assertNotLocked('login:a@b.c')).rejects.toBeInstanceOf(HttpException);
    await expect(guard.assertNotLocked('login:other@b.c')).resolves.toBeUndefined();
  });

  it('answers 429 with a retry delay, then unlocks when it expires', async () => {
    await fail(MAX_FAILURES);
    try {
      await guard.assertNotLocked('login:a@b.c');
      throw new Error('expected the account to be locked');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(429);
      expect((e as HttpException).getResponse()).toMatchObject({ error: 'ACCOUNT_LOCKED', retryAfterSeconds: 60 });
    }
    now += 61_000;
    await expect(guard.assertNotLocked('login:a@b.c')).resolves.toBeUndefined();
  });

  it('doubles the lock on each successive lockout (capped at 1 h)', async () => {
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      delays.push((await fail(MAX_FAILURES)).lockMs);
      now += 3_600_001;
    }
    expect(delays.slice(0, 4)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(Math.max(...delays)).toBe(3_600_000);
  });

  it('forgets failures outside the 15-minute window', async () => {
    await fail(MAX_FAILURES - 1);
    now += 15 * 60_000 + 1;
    const r = await fail(1);
    expect(r.lockedNow).toBe(false);
    expect(r.failures).toBe(1);
  });

  it('reset clears failures and the lock', async () => {
    await fail(MAX_FAILURES);
    await guard.reset('login:a@b.c');
    await expect(guard.assertNotLocked('login:a@b.c')).resolves.toBeUndefined();
    expect(await guard.failures('login:a@b.c')).toBe(0);
  });
});
