import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Resolved by TenantGuard: the validated organization id for this request. */
export const OrgId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest();
  return req.orgId as string;
});
