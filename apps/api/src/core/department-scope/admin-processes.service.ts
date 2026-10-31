import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { unscoped } from './department-scope';

type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number];

/** Models with a scalar `departmentId` column (discovered from the DMMF, so new tables are covered). */
function departmentModels(): { name: string; delegate: string; hasDeletedAt: boolean }[] {
  return Prisma.dmmf.datamodel.models
    .filter((m: DmmfModel) => m.fields.some((f) => f.name === 'departmentId' && f.kind === 'scalar'))
    .map((m: DmmfModel) => ({
      name: m.name,
      delegate: m.name.charAt(0).toLowerCase() + m.name.slice(1),
      hasDeletedAt: m.fields.some((f) => f.name === 'deletedAt' && f.kind === 'scalar'),
    }));
}

/** Models counted as "records" of a department (memberships are reported separately). */
const NOT_RECORDS = new Set(['Membership']);

export interface AdminMember {
  membershipId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  roleName: string;
  kind: 'main' | 'extra';
}

/**
 * Admin → « Départements & membres »: who belongs to which department, the records filed under each,
 * and department rename / merge / delete.
 */
@Injectable()
export class AdminProcessesService {
  constructor(private readonly prisma: PrismaService) {}

  private db() {
    return this.prisma as unknown as Record<string, any>;
  }

  private async orgDepartments(orgId: string) {
    return this.prisma.department.findMany({
      where: { deletedAt: null, site: { organizationId: orgId, deletedAt: null } },
      select: { id: true, name: true, site: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  private async assertDepartment(orgId: string, id: string) {
    const dept = await this.prisma.department.findFirst({
      where: { id, deletedAt: null, site: { organizationId: orgId } },
      select: { id: true, name: true, siteId: true },
    });
    if (!dept) throw new NotFoundException('Département introuvable');
    return dept;
  }

  /** { departmentId: { model: n } } for every department-carrying model (non-deleted rows), unscoped. */
  private async recordCounts(departmentIds: string[]): Promise<Map<string, Record<string, number>>> {
    const out = new Map<string, Record<string, number>>();
    if (!departmentIds.length) return out;
    const models = departmentModels().filter(
      (m) => !NOT_RECORDS.has(m.name),
    );
    await unscoped(() =>
      Promise.all(
        models.map(async (m) => {
          const where: Record<string, unknown> = { departmentId: { in: departmentIds } };
          if (m.hasDeletedAt) where.deletedAt = null;
          const rows: { departmentId: string; _count: { _all: number } }[] = await this.db()[m.delegate].groupBy({
            by: ['departmentId'],
            where,
            _count: { _all: true },
          });
          for (const r of rows) {
            if (!r.departmentId || !r._count._all) continue;
            const counts = out.get(r.departmentId) ?? {};
            counts[m.name] = r._count._all;
            out.set(r.departmentId, counts);
          }
        }),
      ),
    );
    return out;
  }

  async overview(orgId: string) {
    const [departments, memberships, groups] = await unscoped(() =>
      Promise.all([
        this.orgDepartments(orgId),
        this.prisma.membership.findMany({
          where: { organizationId: orgId, deletedAt: null },
          select: {
            id: true,
            departmentId: true,
            extraDepartmentIds: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
            role: { select: { name: true } },
          },
        }),
        this.prisma.userGroup.findMany({
          where: { organizationId: orgId, deletedAt: null },
          select: { id: true, name: true, departmentIds: true },
          orderBy: { name: 'asc' },
        }),
      ]),
    );

    const membersOf = (departmentId: string): AdminMember[] =>
      memberships
        .filter((m) => m.departmentId === departmentId || m.extraDepartmentIds.includes(departmentId))
        .map((m) => ({
          membershipId: m.id,
          userId: m.user.id,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          email: m.user.email,
          roleName: m.role.name,
          kind: (m.departmentId === departmentId ? 'main' : 'extra') as 'main' | 'extra',
        }))
        .sort((a, b) => (a.kind === b.kind ? `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`) : a.kind === 'main' ? -1 : 1));

    const counts = await this.recordCounts(departments.map((d) => d.id));
    return {
      departments: departments.map((d) => {
        const c = counts.get(d.id) ?? {};
        const members = membersOf(d.id);
        const deptGroups = groups.filter((g) => g.departmentIds.includes(d.id)).map((g) => ({ id: g.id, name: g.name }));
        return {
          id: d.id,
          name: d.name,
          siteName: d.site.name,
          members,
          groups: deptGroups,
          counts: c,
          usedBy: Object.values(c).reduce((a, b) => a + b, 0) + members.length + deptGroups.length,
        };
      }),
    };
  }

  // ── Members ────────────────────────────────────────────────────────────────

  private async membership(orgId: string, membershipId: string) {
    const m = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId: orgId, deletedAt: null },
      select: { id: true, departmentId: true, extraDepartmentIds: true },
    });
    if (!m) throw new NotFoundException('Membre introuvable');
    return m;
  }

  async addMember(orgId: string, departmentId: string, membershipId: string, kind: 'main' | 'extra') {
    await this.assertDepartment(orgId, departmentId);
    const m = await this.membership(orgId, membershipId);
    if (kind === 'main') {
      await this.prisma.membership.update({
        where: { id: m.id },
        data: { departmentId, extraDepartmentIds: m.extraDepartmentIds.filter((d) => d !== departmentId) },
      });
    } else {
      if (m.departmentId === departmentId) throw new BadRequestException('Ce département est déjà le département principal de ce membre');
      if (!m.extraDepartmentIds.includes(departmentId)) {
        await this.prisma.membership.update({
          where: { id: m.id },
          data: { extraDepartmentIds: [...m.extraDepartmentIds, departmentId] },
        });
      }
    }
    return { ok: true };
  }

  async removeMember(orgId: string, departmentId: string, membershipId: string) {
    await this.assertDepartment(orgId, departmentId);
    const m = await this.membership(orgId, membershipId);
    if (m.departmentId === departmentId) {
      await this.prisma.membership.update({ where: { id: m.id }, data: { departmentId: null } });
    } else if (m.extraDepartmentIds.includes(departmentId)) {
      await this.prisma.membership.update({
        where: { id: m.id },
        data: { extraDepartmentIds: m.extraDepartmentIds.filter((d) => d !== departmentId) },
      });
    } else {
      throw new NotFoundException('Ce membre ne fait pas partie de ce département');
    }
    return { ok: true };
  }

  // ── Departments ─────────────────────────────────────────────────────

  async rename(orgId: string, id: string, name: string) {
    const dept = await this.assertDepartment(orgId, id);
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Nom requis');
    return this.prisma.department.update({ where: { id: dept.id }, data: { name: trimmed }, select: { id: true, name: true } });
  }

  /** Every reference to a department (non-deleted rows), keyed by model / pseudo-key. */
  private async references(orgId: string, departmentId: string): Promise<Record<string, number>> {
    const refs: Record<string, number> = {};
    await unscoped(() =>
      Promise.all(
        departmentModels().map(async (m) => {
          const where: Record<string, unknown> = { departmentId };
          if (m.hasDeletedAt) where.deletedAt = null;
          const n: number = await this.db()[m.delegate].count({ where });
          if (n) refs[m.name] = n;
        }),
      ),
    );
    const [extras, groups] = await Promise.all([
      this.prisma.membership.count({ where: { organizationId: orgId, deletedAt: null, extraDepartmentIds: { has: departmentId } } }),
      this.prisma.userGroup.count({ where: { organizationId: orgId, deletedAt: null, departmentIds: { has: departmentId } } }),
    ]);
    if (extras) refs.MembershipExtra = extras;
    if (groups) refs.UserGroup = groups;
    return refs;
  }

  async merge(orgId: string, id: string, targetDepartmentId: string) {
    if (id === targetDepartmentId) throw new BadRequestException('Le département cible doit être différent');
    const source = await this.assertDepartment(orgId, id);
    const target = await this.assertDepartment(orgId, targetDepartmentId);

    const ops: Prisma.PrismaPromise<unknown>[] = departmentModels().map((m) =>
      this.db()[m.delegate].updateMany({ where: { departmentId: source.id }, data: { departmentId: target.id } }),
    );
    ops.push(
      this.prisma.$executeRaw`
        UPDATE "Membership"
           SET "extraDepartmentIds" = ARRAY(
                 SELECT DISTINCT x FROM unnest(array_replace("extraDepartmentIds", ${source.id}::text, ${target.id}::text)) AS x
                  WHERE x IS DISTINCT FROM "departmentId")
         WHERE "organizationId" = ${orgId} AND ${source.id}::text = ANY("extraDepartmentIds")`,
      this.prisma.$executeRaw`
        UPDATE "UserGroup"
           SET "departmentIds" = ARRAY(
                 SELECT DISTINCT x FROM unnest(array_replace("departmentIds", ${source.id}::text, ${target.id}::text)) AS x)
         WHERE "organizationId" = ${orgId} AND ${source.id}::text = ANY("departmentIds")`,
      this.prisma.department.update({ where: { id: source.id }, data: { deletedAt: new Date() } }),
    );
    await unscoped(() => this.prisma.$transaction(ops));
    return { merged: true, sourceId: source.id, targetId: target.id, targetName: target.name };
  }

  async remove(orgId: string, id: string) {
    const dept = await this.assertDepartment(orgId, id);
    const refs = await this.references(orgId, dept.id);
    if (Object.keys(refs).length) {
      throw new BadRequestException({ message: 'Département encore utilisé', references: refs });
    }
    await this.prisma.department.update({ where: { id: dept.id }, data: { deletedAt: new Date() } });
    return { removed: true };
  }
}
