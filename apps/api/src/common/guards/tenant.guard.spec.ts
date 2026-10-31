import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TENANT_OPTIONAL_KEY } from '../decorators/tenant-optional.decorator';
import { TenantGuard } from './tenant.guard';

/** A signed-in user with no membership at all (platform super admin). */
function setup(meta: Record<string, unknown>) {
  const prisma = { membership: { findFirst: jest.fn().mockResolvedValue(null) } };
  const authCache = { getOrLoad: (_k: string, load: () => Promise<unknown>) => load() };
  const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
  const guard = new TenantGuard(prisma as never, reflector, authCache as never);
  const req: Record<string, unknown> = { user: { id: 'u-super', isSuperAdmin: true }, headers: {} };
  const ctx = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { guard, ctx, req };
}

describe('TenantGuard without a membership', () => {
  it('refuses tenant routes (never an undefined orgId)', async () => {
    const { guard, ctx } = setup({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets @TenantOptional() user-level routes through without an orgId', async () => {
    const { guard, ctx, req } = setup({ [TENANT_OPTIONAL_KEY]: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.orgId).toBeUndefined();
    expect(req.membership).toBeUndefined();
  });
});
