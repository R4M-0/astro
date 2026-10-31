/**
 * Tiny in-process bus: the Prisma extension reports every write to a model the
 * auth context is derived from, and AuthCacheService drops matching entries.
 * Hooking the data layer (rather than each service) means a new code path that
 * revokes a session or edits a role can never forget to invalidate.
 */
export const AUTH_MODELS = new Set(['Session', 'User', 'Membership', 'Role', 'RolePermission', 'Organization', 'Subscription']);

export const AUTH_WRITE_OPS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

export interface AuthWriteEvent {
  model: string;
  operation: string;
  args: any;
}

type Listener = (event: AuthWriteEvent) => void | Promise<void>;
const listeners = new Set<Listener>();

export function onAuthWrite(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Awaited by the Prisma extension so the write's caller (and its HTTP response)
 * only proceeds once every replica has been told — otherwise the client's very
 * next request could still hit a stale entry.
 */
export async function emitAuthWrite(event: AuthWriteEvent): Promise<void> {
  await Promise.allSettled([...listeners].map(async (listener) => listener(event)));
}
