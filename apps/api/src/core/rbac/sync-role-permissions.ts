import type { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, isSupportedPermission } from '@astro/shared';

/**
 * Aligns the global Permission table with the supported catalogue (`ALL_PERMISSIONS`): creates the
 * missing keys and deletes keys no code enforces any more, together with their role grants
 * (RolePermission has no cascade). Returns the counts so callers can log them.
 */
export async function syncPermissionCatalog(
  prisma: Pick<PrismaClient, 'permission' | 'rolePermission'>,
): Promise<{ created: number; removed: number; total: number }> {
  const data = ALL_PERMISSIONS.map((key) => {
    const [resource, action] = key.split(':');
    return { resource, action };
  });
  const created = (await prisma.permission.createMany({ data, skipDuplicates: true })).count;
  const stale = (await prisma.permission.findMany()).filter((p) => !isSupportedPermission(`${p.resource}:${p.action}`));
  if (stale.length) {
    const ids = stale.map((p) => p.id);
    await prisma.rolePermission.deleteMany({ where: { permissionId: { in: ids } } });
    await prisma.permission.deleteMany({ where: { id: { in: ids } } });
  }
  return { created, removed: stale.length, total: ALL_PERMISSIONS.length };
}

/**
 * Default grants still to add to a system role (M-16). A default permission is offered
 * once: the keys already offered are remembered on the role (`permissionsSyncedKeys`), so
 * a grant an administrator removed is never re-added — only permissions the role has never
 * been offered (new resources / actions) are. A role never synced before (`syncedAt` null)
 * gets the full default set once.
 */
export function plannedGrants(
  roleKey: string,
  synced: { keys: string[]; syncedAt: Date | null },
  defaults: Record<string, string[]> = DEFAULT_ROLE_PERMISSIONS,
): { grant: string[]; syncedKeys: string[] } {
  const wanted = defaults[roleKey] ?? [];
  // keys that no longer exist are forgotten, so a key re-introduced later is offered again
  const offered = new Set<string>((synced.syncedAt ? synced.keys : []).filter(isSupportedPermission));
  return {
    grant: wanted.filter((k) => !offered.has(k)),
    syncedKeys: [...new Set([...offered, ...wanted])],
  };
}

/** Backfills newly-introduced default grants to every system role of every org (idempotent, never removes). */
export async function syncSystemRolePermissions(
  prisma: PrismaClient,
  log: (msg: string) => void = () => undefined,
): Promise<number> {
  const permissions = await prisma.permission.findMany();
  const byKey = new Map(permissions.map((p) => [`${p.resource}:${p.action}`, p.id]));
  const roles = await prisma.role.findMany({ where: { isSystem: true, deletedAt: null } });
  let added = 0;
  for (const role of roles) {
    const { grant, syncedKeys } = plannedGrants(role.key, {
      keys: role.permissionsSyncedKeys ?? [],
      syncedAt: role.permissionsSyncedAt,
    });
    const data = grant
      .map((k) => byKey.get(k))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId: role.id, permissionId }));
    if (data.length) {
      const res = await prisma.rolePermission.createMany({ data, skipDuplicates: true });
      if (res.count) log(`  org ${role.organizationId ?? '-'} · ${role.key}: +${res.count} (${grant.join(', ')})`);
      added += res.count;
    }
    await prisma.role.update({
      where: { id: role.id },
      data: { permissionsSyncedKeys: syncedKeys, permissionsSyncedAt: new Date() },
    });
  }
  return added;
}

/** Marks a system role's current defaults as offered (after provisioning / reset). */
export async function stampRoleSynced(prisma: Pick<PrismaClient, 'role'>, roleId: string, roleKey: string) {
  await prisma.role.update({
    where: { id: roleId },
    data: { permissionsSyncedKeys: DEFAULT_ROLE_PERMISSIONS[roleKey] ?? [], permissionsSyncedAt: new Date() },
  });
}
