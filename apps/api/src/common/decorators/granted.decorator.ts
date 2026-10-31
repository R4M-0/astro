import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The caller's granted permission keys (`resource:action`) for the active org,
 * derived from the membership resolved by TenantGuard. Lets a handler apply
 * finer-grained rules than a single @RequirePermissions() (e.g. "the assignee
 * OR anyone with forms:approve").
 */
export const Granted = createParamDecorator((_data: unknown, ctx: ExecutionContext): Set<string> => {
  const req = ctx.switchToHttp().getRequest();
  if (req.grantedPermissions) return new Set<string>(req.grantedPermissions);
  const perms: { permission: { resource: string; action: string } }[] =
    req.membership?.role?.permissions ?? [];
  return new Set(perms.map((rp) => `${rp.permission.resource}:${rp.permission.action}`));
});
