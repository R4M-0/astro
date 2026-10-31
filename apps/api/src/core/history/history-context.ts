import { AsyncLocalStorage } from 'node:async_hooks';
import type { DepartmentAccess } from '../department-scope/department-scope';

/** A deletion detected during a request — flushed to notifications afterwards. */
export interface DeleteEvent {
  organizationId: string | null;
  entityType: string;
  entityId: string;
  /** kind of removal — a hard delete or a soft-delete (deletedAt set). */
  soft: boolean;
}

/**
 * Per-request store carried through AsyncLocalStorage. The store object is
 * created (empty) by HistoryContextMiddleware *before* the auth/tenant guards
 * run, then filled with actor/org by HistoryInterceptor once the guards have
 * populated the request. Because it is a single mutable object, the Prisma
 * write middleware (which runs later, during the handler) sees the filled-in
 * values.
 */
export interface HistoryContext {
  actorId: string | null;
  /** super admin acting through impersonation (null otherwise). */
  impersonatedById?: string | null;
  organizationId: string | null;
  ip: string | null;
  userAgent: string | null;
  /** deletions collected during the request, flushed to notifications after. */
  deleteEvents: DeleteEvent[];
  /** every record written during the request — lets the audit log name its target. */
  touched: TouchedRecord[];
  /** department-scoped visibility of the user (null = sees the whole organization). Set by TenantGuard. */
  access?: DepartmentAccess | null;
  /** the user's main department — default `departmentId` of records they create. */
  defaultDepartmentId?: string | null;
}

/** A record written during the request (model + id + history operation). */
export interface TouchedRecord {
  entityType: string;
  entityId: string;
  operation: string;
}

const storage = new AsyncLocalStorage<HistoryContext>();

export function runWithHistoryContext<T>(ctx: HistoryContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getHistoryContext(): HistoryContext | undefined {
  return storage.getStore();
}
