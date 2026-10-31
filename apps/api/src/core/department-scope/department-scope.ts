import type { PrismaClient } from '@prisma/client';
import { getHistoryContext, runWithHistoryContext } from '../history/history-context';

/**
 * Department-scoped visibility (rules per register: see ./registers.ts — configurable per org).
 *
 * Members whose role has `departmentScoped` only see records of the operational registers that
 * belong to one of their departments (main + admin-granted extras), plus records they are involved
 * in (author, owner, responsible, assignee…) and records explicitly shared with them (RecordShare).
 * Everyone else — and every request without a user (crons, queue workers, public links) — is
 * unrestricted.
 *
 * Enforcement is central: the Prisma extension (PrismaService) narrows every read, count,
 * aggregate, update and delete on a scoped model through {@link scopeArgs}, so lists, detail pages,
 * dashboards, reports, search and exports all follow the same rule without per-service filters.
 * Code that must see the whole organization during a restricted user's request (reference-number
 * generators, duplicate checks) wraps the call in {@link unscoped}.
 *
 * Not covered: rows reached only through a nested `include`/`select` of another record.
 */

import {
  CHILD_REGISTERS,
  DEPARTMENT_OWNING_MODELS,
  REGISTER_BY_MODEL,
  REGISTERS,
  SHAREABLE_MODELS,
  type PeopleRule,
  type VisibilityPolicy,
} from './registers';

export { DEPARTMENT_OWNING_MODELS, SHAREABLE_MODELS };

/** Owning register model → its people rule (used by the department backfill). */
export const DEPARTMENT_SCOPED: Record<string, PeopleRule> = Object.fromEntries(
  REGISTERS.filter((r) => DEPARTMENT_OWNING_MODELS.has(r.model)).map((r) => [r.model, r]),
);

/** Resolved visibility of the current request's user (set by TenantGuard for every member). */
export interface DepartmentAccess {
  userId: string;
  organizationId: string;
  /** the role is limited to its process(es) — `process`-mode registers are filtered */
  departmentScoped: boolean;
  /** main + extra departments (groups' granted departments are added when loaded) */
  departmentIds: string[];
  /** the organization's visibility mode per register */
  policy: VisibilityPolicy;
  /** groups of the user + the departments they grant; loaded lazily once per request */
  groups?: Promise<{ groupIds: string[]; departmentIds: string[] }>;
  /** entityType → ids shared with the user or one of their groups; loaded lazily once per request */
  shares?: Promise<Map<string, string[]>>;
}

const READ_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);
const WRITE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany']);

/**
 * Runs `fn` with department scoping lifted (whole-organization reads during a scoped request).
 * Awaited *inside* the lifted context on purpose: Prisma queries are lazy and only execute when
 * awaited, so returning the bare query would run it back in the caller's (scoped) context.
 */
export async function unscoped<T>(fn: () => PromiseLike<T> | T): Promise<T> {
  const ctx = getHistoryContext();
  if (!ctx?.access) return fn();
  return runWithHistoryContext({ ...ctx, access: null }, async () => await fn());
}

/** The where-filter the user must satisfy on `model` (null = everything visible). */
export function visibilityFilter(
  model: string,
  access: DepartmentAccess,
  shares: Map<string, string[]>,
  groupDepartmentIds: string[] = [],
): Record<string, unknown> | null {
  const or: Record<string, unknown>[] = [];
  let people: PeopleRule;
  const child = CHILD_REGISTERS.get(model);
  if (child) {
    // a child record follows its parent; its own people see it as well
    const parent = visibilityFilter(child.parent.model, access, shares, groupDepartmentIds);
    if (!parent) return null;
    or.push({ [child.child.relation]: { is: parent } });
    people = { people: child.child.people ?? [], peopleLists: child.child.peopleLists };
  } else {
    const register = REGISTER_BY_MODEL.get(model);
    if (!register) return null;
    const mode = access.policy[model] ?? register.default;
    if (mode === 'organization' || (mode === 'process' && !access.departmentScoped)) return null;
    if (mode === 'process') {
      const departments = [...new Set([...access.departmentIds, ...groupDepartmentIds])];
      if (departments.length) or.push({ departmentId: { in: departments } });
    }
    people = register;
  }
  for (const field of people.people) or.push({ [field]: access.userId });
  for (const field of people.peopleLists ?? []) or.push({ [field]: { has: access.userId } });
  const shared = shares.get(model);
  if (shared?.length) or.push({ id: { in: shared } });
  return { OR: or };
}

function loadGroups(base: PrismaClient, access: DepartmentAccess) {
  access.groups ??= base.userGroupMember
    .findMany({
      where: { userId: access.userId, group: { organizationId: access.organizationId, deletedAt: null } },
      select: { groupId: true, group: { select: { departmentIds: true } } },
    })
    .then((rows) => ({
      groupIds: rows.map((r) => r.groupId),
      departmentIds: [...new Set(rows.flatMap((r) => r.group.departmentIds))],
    }));
  return access.groups;
}

function loadShares(base: PrismaClient, access: DepartmentAccess): Promise<Map<string, string[]>> {
  access.shares ??= loadGroups(base, access).then(({ groupIds }) =>
    base.recordShare
      .findMany({
        where: {
          organizationId: access.organizationId,
          OR: [{ userId: access.userId }, ...(groupIds.length ? [{ groupId: { in: groupIds } }] : [])],
        },
        select: { entityType: true, entityId: true },
      })
      .then((rows) => {
        const map = new Map<string, string[]>();
        for (const r of rows) map.set(r.entityType, [...(map.get(r.entityType) ?? []), r.entityId]);
        return map;
      }),
  );
  return access.shares;
}

/**
 * Narrows `args` of a Prisma operation to what the current user may see. Called by the Prisma
 * extension for every operation; a no-op for unscoped users, unscoped models and other operations.
 */
export async function scopeArgs(
  base: PrismaClient,
  model: string | undefined,
  operation: string,
  args: any,
): Promise<any> {
  if (!model || !SHAREABLE_MODELS.has(model)) return args;
  const ctx = getHistoryContext();

  if ((operation === 'create' || operation === 'update') && DEPARTMENT_OWNING_MODELS.has(model)) {
    const data = args?.data;
    if (data && typeof data === 'object') {
      if (operation === 'create' && data.departmentId == null && !data.department && ctx?.defaultDepartmentId) {
        // New records default to the author's main department ("every record has a department").
        args = { ...args, data: { ...data, departmentId: ctx.defaultDepartmentId } };
      }
    }
    if (operation === 'create') return args;
  }

  const access = ctx?.access;
  if (!access || (!READ_OPS.has(operation) && !WRITE_OPS.has(operation))) return args;
  const [shares, groups] = await Promise.all([loadShares(base, access), loadGroups(base, access)]);
  const filter = visibilityFilter(model, access, shares, groups.departmentIds);
  if (!filter) return args;
  const where = args?.where;
  return { ...(args ?? {}), where: where ? { ...where, AND: [...toArray(where.AND), filter] } : { AND: [filter] } };
}

function toArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
