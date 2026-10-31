import { plannedGrants, syncPermissionCatalog } from './sync-role-permissions';

const defaults = { employee: ['employees:read', 'employees:update', 'skills:read'] };

describe('plannedGrants (seed permission sync)', () => {
  it('grants the full default set to a role never synced', () => {
    const r = plannedGrants('employee', { keys: [], syncedAt: null }, defaults);
    expect(r.grant).toEqual(['employees:read', 'employees:update', 'skills:read']);
    expect(r.syncedKeys).toEqual(defaults.employee);
  });

  it('never re-grants a default an admin removed', () => {
    // second run: employees:update was offered before, then removed by the admin
    const r = plannedGrants('employee', { keys: defaults.employee, syncedAt: new Date() }, defaults);
    expect(r.grant).toEqual([]);
  });

  it('grants a permission introduced after the last sync', () => {
    const later = { employee: [...defaults.employee, 'hr-surveys:read'] };
    const r = plannedGrants('employee', { keys: defaults.employee, syncedAt: new Date() }, later);
    expect(r.grant).toEqual(['hr-surveys:read']);
    expect(r.syncedKeys).toContain('hr-surveys:read');
  });

  it('keeps previously offered keys even if dropped from the defaults', () => {
    const r = plannedGrants('employee', { keys: ['job-descriptions:read'], syncedAt: new Date() }, defaults);
    expect(r.syncedKeys).toContain('job-descriptions:read');
  });

  it('forgets offered keys that no longer exist, so a re-introduced key is offered again', () => {
    const r = plannedGrants('employee', { keys: ['skills:approve', 'old:read'], syncedAt: new Date() }, defaults);
    expect(r.syncedKeys).not.toContain('skills:approve');
    expect(r.syncedKeys).not.toContain('old:read');
    const back = plannedGrants('employee', { keys: ['skills:approve'], syncedAt: new Date() }, { employee: ['job-descriptions:read'] });
    expect(back.grant).toEqual(['job-descriptions:read']);
  });
});

describe('syncPermissionCatalog', () => {
  it('creates supported keys and deletes unsupported ones with their grants first', async () => {
    const calls: string[] = [];
    const prisma = {
      permission: {
        createMany: jest.fn().mockImplementation(() => { calls.push('create'); return { count: 2 }; }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'p1', resource: 'skills', action: 'read' },
          { id: 'p2', resource: 'skills', action: 'approve' },
        ]),
        deleteMany: jest.fn().mockImplementation(() => { calls.push('deletePermissions'); return { count: 1 }; }),
      },
      rolePermission: {
        deleteMany: jest.fn().mockImplementation(() => { calls.push('deleteGrants'); return { count: 3 }; }),
      },
    };
    const res = await syncPermissionCatalog(prisma as never);
    expect(res.removed).toBe(1);
    expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { permissionId: { in: ['p2'] } } });
    expect(calls).toEqual(['create', 'deleteGrants', 'deletePermissions']);
  });
});
