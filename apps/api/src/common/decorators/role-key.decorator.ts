import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Resolves the caller's role key for the active org (set by TenantGuard on req.membership). */
export const RoleKey = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | null => {
  const req = ctx.switchToHttp().getRequest();
  return req.membership?.role?.key ?? null;
});
