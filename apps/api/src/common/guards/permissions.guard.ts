import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { addonOfResource, type PermissionKey } from '@astro/shared';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest();
    const membership = req.membership;
    // A permission-gated route always needs a resolved tenant membership.
    if (!membership) throw new ForbiddenException('No membership in this organization');

    // precomputed by TenantGuard (cached with the membership)
    const granted: Set<string> =
      req.grantedPermissions ??
      new Set<string>(
        membership.role.permissions.map(
          (rp: { permission: { resource: string; action: string } }) =>
            `${rp.permission.resource}:${rp.permission.action}`,
        ),
      );
    const missing = required.filter((p) => !granted.has(p));
    // a paid add-on the org has not purchased: distinct, machine-readable error for the web upsell
    const locked: Set<string> | undefined = req.lockedResources;
    const addon = missing.map((p) => p.split(':')[0]).find((r) => locked?.has(r));
    if (addon) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'ADDON_REQUIRED',
        addon: addonOfResource(addon),
        message: 'This module is a paid add-on that is not included in your subscription.',
      });
    }
    if (missing.length) {
      throw new ForbiddenException(`Missing permissions: ${missing.join(', ')}`);
    }
    return true;
  }
}
