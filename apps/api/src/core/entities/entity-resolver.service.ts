import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EntityTypeDef, entityLabel, entityTypeDef, restrictedWhere } from './entity-registry';

export interface ResolveContext {
  orgId: string;
  /** caller */
  userId?: string;
  /** the caller's permission keys — add-on resources are already stripped by TenantGuard */
  granted: Set<string>;
}

export interface ResolvedEntity {
  type: string;
  def: EntityTypeDef;
  id: string;
  label: string;
  row: Record<string, unknown>;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Resolves a polymorphic (entityType, entityId) pair for the current caller: the type must be known
 * (400), the caller must hold `<resource>:<action>` (403) and the record must exist in the caller's
 * organization AND be visible to them (404). Reads go through the extended Prisma client, so the
 * department/members visibility filter applies exactly as on the record's own endpoints.
 */
@Injectable()
export class EntityResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /** Registry entry for `type`, or 400. */
  definition(type: string): EntityTypeDef {
    const d = entityTypeDef(type);
    if (!d) throw new BadRequestException('Unsupported entity type');
    return d;
  }

  /** Type known + permission held (no record lookup). */
  authorizeType(granted: Set<string>, type: string, action: 'read' | 'update'): EntityTypeDef {
    const d = this.definition(type);
    const key = `${d.resource}:${action}`;
    if (!granted.has(key)) throw new ForbiddenException(`Missing permissions: ${key}`);
    return d;
  }

  async resolve(
    ctx: ResolveContext,
    type: string,
    id: string,
    action: 'read' | 'update',
    opts: { includeDeleted?: boolean } = {},
  ): Promise<ResolvedEntity> {
    const d = this.authorizeType(ctx.granted, type, action);
    const row = await this.find(ctx, d, id, opts.includeDeleted ?? false);
    if (!row) throw new NotFoundException('Record not found');
    return { type, def: d, id, label: entityLabel(d, row), row };
  }

  /** Same as resolve() but returns null instead of throwing on a missing/invisible record. */
  async tryResolve(ctx: ResolveContext, type: string, id: string, action: 'read' | 'update' = 'read') {
    const d = entityTypeDef(type);
    if (!d || !ctx.granted.has(`${d.resource}:${action}`)) return null;
    const row = await this.find(ctx, d, id, false);
    return row ? { type, def: d, id, label: entityLabel(d, row), row } : null;
  }

  private async find(ctx: ResolveContext, d: EntityTypeDef, id: string, includeDeleted: boolean) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    const where: Record<string, unknown> = { ...d.where, ...restrictedWhere(d, ctx.granted), id };
    if (d.parent) {
      where[d.parent.relation] = {
        organizationId: ctx.orgId,
        ...(d.parent.softDelete && !includeDeleted ? { deletedAt: null } : {}),
      };
    } else {
      where.organizationId = ctx.orgId;
    }
    if (d.softDelete && !includeDeleted) where.deletedAt = null;
    const delegate = (this.prisma as unknown as Record<string, { findFirst: (a: unknown) => Promise<Record<string, unknown> | null> }>)[
      d.model.charAt(0).toLowerCase() + d.model.slice(1)
    ];
    if (!delegate) return null;
    return delegate.findFirst({ where });
  }
}
