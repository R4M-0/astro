import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, PaginationQuery } from '../../common/dto/pagination.dto';

export interface PlatformAuditInput {
  actorId?: string;
  actorEmail?: string;
  action: string;
  organizationId?: string;
  targetUserId?: string;
  ip?: string;
  userAgent?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

/** Append-only platform audit trail. No update/delete is ever exposed. */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: PlatformAuditInput) {
    return this.prisma.platformAuditLog
      .create({
        data: {
          actorId: input.actorId,
          actorEmail: input.actorEmail,
          action: input.action,
          organizationId: input.organizationId,
          targetUserId: input.targetUserId,
          ip: input.ip,
          userAgent: input.userAgent,
          before: (input.before ?? undefined) as object | undefined,
          after: (input.after ?? undefined) as object | undefined,
          metadata: (input.metadata ?? undefined) as object | undefined,
        },
      })
      .catch(() => undefined); // never let audit failures break the operation
  }

  async list(q: PaginationQuery, filters: { organizationId?: string; action?: string } = {}) {
    const where = {
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters.action ? { action: { contains: filters.action, mode: 'insensitive' as const } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.platformAuditLog.count({ where }),
    ]);
    // decorate with organization names for readable, linkable rows
    const orgIds = [...new Set(items.map((i) => i.organizationId).filter(Boolean) as string[])];
    const orgs = orgIds.length
      ? await this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(orgs.map((o) => [o.id, o.name]));
    const decorated = items.map((i) => ({ ...i, organizationName: i.organizationId ? nameById.get(i.organizationId) ?? null : null }));
    return paginate(decorated, total, q);
  }
}
