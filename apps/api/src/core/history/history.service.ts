import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const CUID_RE = /^c[a-z0-9]{20,}$/;

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Field-level history for one record, newest first, with actor + ref names. */
  list(organizationId: string, entityType: string, entityId: string) {
    return this.listMany(organizationId, [{ entityType, ids: [entityId] }]);
  }

  /** History of several records at once (a record and its child rows), merged newest first. */
  async listMany(organizationId: string, targets: { entityType: string; ids: string[] }[], take = 100) {
    const or = targets.filter((t) => t.ids.length).map((t) => ({ entityType: t.entityType, entityId: { in: t.ids } }));
    const entries = or.length
      ? await this.prisma.historyEntry.findMany({
          where: { organizationId, OR: or },
          orderBy: { createdAt: 'desc' },
          take,
        })
      : [];

    // actors
    const actorIds = [...new Set(entries.map((e) => e.actorId).filter(Boolean) as string[])];
    const users = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true, avatarUrl: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    // referenced ids inside the diffs/snapshots → display labels (users + employees)
    const refs = await this.resolveRefs(organizationId, entries);

    return {
      entries: entries.map((e) => ({
        ...e,
        actor: e.actorId ? (byId.get(e.actorId) ?? null) : null,
      })),
      refs,
    };
  }

  /** Collect cuid-looking values across changes/snapshots → { id: "Nom" }. */
  private async resolveRefs(
    organizationId: string,
    entries: { changes: unknown; snapshot: unknown }[],
  ): Promise<Record<string, string>> {
    const ids = new Set<string>();
    const scan = (v: unknown) => {
      if (typeof v === 'string') {
        if (CUID_RE.test(v)) ids.add(v);
      } else if (Array.isArray(v)) {
        v.forEach(scan);
      } else if (v && typeof v === 'object') {
        Object.values(v as Record<string, unknown>).forEach(scan);
      }
    };
    for (const e of entries) {
      scan(e.changes);
      scan(e.snapshot);
    }
    if (!ids.size) return {};
    const idList = [...ids];
    const [users, employees] = await Promise.all([
      this.prisma.user.findMany({
        // members of this organization only — a foreign cuid in a diff never resolves to a name
        where: { id: { in: idList }, memberships: { some: { organizationId } } },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.employee.findMany({
        where: { id: { in: idList }, organizationId },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);
    const refs: Record<string, string> = {};
    for (const u of [...users, ...employees]) {
      refs[u.id] = `${u.firstName} ${u.lastName}`.trim();
    }
    return refs;
  }
}
