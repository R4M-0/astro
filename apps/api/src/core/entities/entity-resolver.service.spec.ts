import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityResolverService } from './entity-resolver.service';
import { entityTypeDef } from './entity-registry';
import { orgWhere } from './org-where';

function makePrisma(rows: Record<string, Record<string, unknown> | null>) {
  const calls: { model: string; where: Record<string, unknown> }[] = [];
  const delegate = (model: string) => ({
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      calls.push({ model, where });
      return rows[model] ?? null;
    }),
  });
  const prisma = new Proxy({} as Record<string, unknown>, { get: (_t, key: string) => delegate(key) });
  return { prisma, calls };
}

const ctx = (granted: string[]) => ({ orgId: 'org-a', userId: 'user-1', granted: new Set(granted) });

describe('EntityResolverService', () => {
  it('rejects unknown types (incl. prototype keys) with 400', async () => {
    const { prisma } = makePrisma({});
    const svc = new EntityResolverService(prisma as never);
    for (const type of ['nope', 'constructor', '__proto__', 'toString']) {
      await expect(svc.resolve(ctx(['employees:read']), type, 'cabc', 'read')).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('requires the resource permission (403)', async () => {
    const { prisma } = makePrisma({ employee: { id: 'e1' } });
    const svc = new EntityResolverService(prisma as never);
    await expect(svc.resolve(ctx(['employees:read']), 'employee', 'e1', 'update')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s on a missing / invisible / foreign record and filters by organization + deletedAt', async () => {
    const { prisma, calls } = makePrisma({ employee: null });
    const svc = new EntityResolverService(prisma as never);
    await expect(svc.resolve(ctx(['employees:read']), 'employee', 'e1', 'read')).rejects.toBeInstanceOf(NotFoundException);
    expect(calls[0].where).toEqual({ id: 'e1', organizationId: 'org-a', deletedAt: null });
  });

  it('accepts PascalCase model names and labels the row', async () => {
    const { prisma } = makePrisma({ hrTraining: { id: 't1', code: 'FOR-01', theme: 'Sécurité' } });
    const svc = new EntityResolverService(prisma as never);
    const r = await svc.resolve(ctx(['hr-trainings:read']), 'HrTraining', 't1', 'read');
    expect(r.label).toBe('FOR-01 · Sécurité');
    expect(entityTypeDef('HrTraining')?.resource).toBe('hr-trainings');
  });

  it('hides survey drafts from callers who cannot edit them', async () => {
    const { prisma, calls } = makePrisma({ hrSurvey: { id: 's1', reference: 'ENQ-0001', title: 'x' } });
    const svc = new EntityResolverService(prisma as never);
    await svc.resolve(ctx(['hr-surveys:read']), 'hr-survey', 's1', 'read');
    expect(calls[0].where).toMatchObject({ scope: 'HR', NOT: { status: 'DRAFT' } });
    await svc.resolve(ctx(['hr-surveys:read', 'hr-surveys:update']), 'hr-survey', 's1', 'read');
    expect(calls[1].where.NOT).toBeUndefined();
  });

  it('rejects malformed ids without querying', async () => {
    const { prisma, calls } = makePrisma({ employee: { id: 'x' } });
    const svc = new EntityResolverService(prisma as never);
    await expect(svc.resolve(ctx(['employees:read']), 'employee', '../x', 'read')).rejects.toBeInstanceOf(NotFoundException);
    expect(calls).toHaveLength(0);
  });
});

describe('orgWhere (label resolvers)', () => {
  it('ties every lookup to the organization', () => {
    expect(orgWhere('Employee', 'o')).toEqual({ organizationId: 'o' });
    expect(orgWhere('User', 'o')).toEqual({ memberships: { some: { organizationId: 'o' } } });
    expect(orgWhere('Department', 'o')).toEqual({ site: { organizationId: 'o' } });
    expect(orgWhere('JobActivity', 'o')).toEqual({ jobDescription: { organizationId: 'o' } });
    expect(orgWhere('NoSuchModel', 'o')).toBeNull();
  });
});
