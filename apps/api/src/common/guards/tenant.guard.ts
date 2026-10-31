import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lockedAddonResources } from '@astro/shared';
import { AuthCacheService } from '../../core/auth-cache/auth-cache.service';
import { resolvePolicy } from '../../core/department-scope/registers';
import { licensedAddons } from '../../core/license/license.service';
import { getHistoryContext } from '../../core/history/history-context';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_PLATFORM_KEY } from '../decorators/platform.decorator';
import { TENANT_OPTIONAL_KEY } from '../decorators/tenant-optional.decorator';

/**
 * Resolves and validates the tenant for every authenticated request.
 * The client sends X-Organization-Id; membership is checked and the
 * request is annotated with orgId + membership (role included).
 * Routes without the header fall back to the user's default membership.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly authCache: AuthCacheService,
  ) {}

  private async loadMembership(userId: string, requestedOrgId?: string) {
    const withRelations = {
      role: { include: { permissions: { include: { permission: true } } } },
      organization: {
        select: { status: true, deletedAt: true, name: true, settings: true, subscription: { select: { addons: true } } },
      },
    } as const;
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        deletedAt: null,
        // a pending invitation (not accepted yet) grants no access
        acceptedAt: { not: null },
        ...(requestedOrgId ? { organizationId: requestedOrgId } : { isDefault: true }),
      },
      include: withRelations,
    });
    if (membership || requestedOrgId) return membership;
    // fall back to any membership when no default is flagged
    return this.prisma.membership.findFirst({
      where: { userId, deletedAt: null, acceptedAt: { not: null } },
      include: withRelations,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ||
      this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest();
    if (!req.user) return true; // auth guard already rejected if required

    const requestedOrgId = req.headers['x-organization-id'] as string | undefined;
    // cached per user+org; membership/role/permission/org writes invalidate it (AuthCacheService)
    const resolved = await this.authCache.getOrLoad(
      `tenant:${req.user.id}:${requestedOrgId ?? '*'}`,
      async () => {
        const membership = await this.loadMembership(req.user.id, requestedOrgId);
        if (!membership) return null;
        // resources of add-ons the org has not purchased are never granted, whatever the role says
        const locked = lockedAddonResources(licensedAddons(membership.organization.subscription?.addons));
        const granted = new Set<string>(
          membership.role.permissions
            .filter((rp) => !locked.has(rp.permission.resource))
            .map((rp) => `${rp.permission.resource}:${rp.permission.action}`),
        );
        return { membership, granted, locked };
      },
      ({ membership }) => [
        `u:${membership.userId}`,
        `o:${membership.organizationId}`,
        `r:${membership.roleId}`,
        `m:${membership.id}`,
      ],
    );
    if (!resolved) {
      // User-level routes (own profile, sign-out…) stay usable without an organization;
      // no orgId is set, so they can never reach tenant data.
      if (this.reflector.getAllAndOverride<boolean>(TENANT_OPTIONAL_KEY, [context.getHandler(), context.getClass()])) {
        return true;
      }
      // Platform staff operate on @Platform() routes (skipped above) or via
      // impersonation. Never let a request reach a tenant handler without a
      // resolved organization: Prisma treats `organizationId: undefined` as "no
      // filter" and would return every tenant's rows.
      throw new ForbiddenException('No membership in this organization');
    }
    const { membership, granted, locked } = resolved;

    // ── server-side SaaS gates (never trust the client) ──
    if (membership.organization.deletedAt || membership.organization.status === 'SUSPENDED') {
      throw new ForbiddenException('This organization is suspended. Please contact Astro support.');
    }
    if (!membership.isActive) {
      throw new ForbiddenException('Your account in this organization is deactivated.');
    }

    req.orgId = membership.organizationId;
    req.membership = membership;
    req.grantedPermissions = granted;
    req.lockedResources = locked;

    // Department-scoped visibility, enforced by the Prisma extension for the rest of the request.
    const ctx = getHistoryContext();
    if (ctx) {
      ctx.defaultDepartmentId = membership.departmentId ?? null;
      ctx.access = {
        userId: membership.userId,
        organizationId: membership.organizationId,
        departmentScoped: membership.role.departmentScoped,
        policy: resolvePolicy(membership.organization.settings),
        departmentIds: [...new Set([membership.departmentId, ...(membership.extraDepartmentIds ?? [])].filter(Boolean) as string[])],
      };
    }
    return true;
  }
}
