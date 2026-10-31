import { ForbiddenException } from '@nestjs/common';
import { InvitationsService } from '../auth/invitations.service';
import { UsersService } from './users.service';
import { assertMembers } from '../../common/assert-members';

/** Minimal in-memory Prisma double for the invite flow. */
function makePrisma(users: any[] = []) {
  const memberships: any[] = [];
  const tokens: any[] = [];
  const sessions = [{ id: 's1', userId: 'u-attacker', revokedAt: null as Date | null }];
  const prisma: any = {
    _memberships: memberships,
    _tokens: tokens,
    _sessions: sessions,
    role: { findFirst: jest.fn(async () => ({ id: 'role-emp', organizationId: 'org1' })) },
    department: { count: jest.fn(async () => 0) },
    site: { count: jest.fn(async () => 0) },
    user: {
      findUnique: jest.fn(async ({ where }: any) => users.find((u) => u.email === where.email) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const u = { id: `u${users.length + 1}`, deletedAt: null, emailVerifiedAt: null, ...data };
        users.push(u);
        return u;
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(users.find((u) => u.id === where.id), data)),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    session: {
      updateMany: jest.fn(async ({ where }: any) => {
        sessions.filter((s) => s.userId === where.userId).forEach((s) => (s.revokedAt = new Date()));
        return { count: 1 };
      }),
    },
    membership: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where.organizationId_userId;
        if (k) return memberships.find((m) => m.organizationId === k.organizationId && m.userId === k.userId) ?? null;
        return memberships.find((m) => m.id === where.id) ?? null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const m = memberships.find((x) => x.id === where.id);
        return { ...m, user: users.find((u) => u.id === m.userId), organization: { name: 'Org <b>' } };
      }),
      create: jest.fn(async ({ data }: any) => {
        const m = { id: `m${memberships.length + 1}`, deletedAt: null, ...data };
        memberships.push(m);
        return m;
      }),
      update: jest.fn(),
      count: jest.fn(async () => 0),
    },
    verificationToken: { create: jest.fn(async ({ data }: any) => tokens.push(data)) },
  };
  return prisma;
}

function setup(users: any[] = []) {
  const prisma = makePrisma(users);
  const mail = { send: jest.fn(async () => undefined) };
  const gateway = { disconnectUser: jest.fn(), disconnectSession: jest.fn() };
  const config = { get: () => 'http://localhost:3000' } as any;
  const invitations = new InvitationsService(prisma, config, mail as any, gateway as any);
  const subs = { assertSeatAvailable: jest.fn(async () => undefined) };
  const service = new UsersService(prisma, config, subs as any, invitations);
  return { prisma, mail, gateway, service };
}

const dto = { email: 'victim@company.com', firstName: 'Vic', lastName: 'Tim', roleId: 'role-emp' };

describe('UsersService.inviteMember (H-1)', () => {
  it('invites a new address as a pending membership and never mails a password', async () => {
    const { prisma, mail, service } = setup();
    const m = await service.inviteMember('org1', dto);
    expect(m.acceptedAt).toBeNull();
    expect(m.isDefault).toBe(false);
    expect(prisma._tokens[0]).toMatchObject({ type: 'PASSWORD_RESET', membershipId: m.id });
    const html = (mail.send.mock.calls[0] as any)[0].html as string;
    expect(html).toContain('/reset-password?token=');
    expect(html).not.toMatch(/password\s*:/i);
    expect(html).toContain('Org &lt;b&gt;'); // escaped org name
  });

  it('neutralises an unverified pre-registered account: hash reset + sessions revoked', async () => {
    const attacker = { id: 'u-attacker', email: dto.email, passwordHash: 'attacker-hash', emailVerifiedAt: null, deletedAt: null };
    const { prisma, gateway, service } = setup([attacker]);
    const m = await service.inviteMember('org1', dto);
    expect(attacker.passwordHash).not.toBe('attacker-hash');
    expect(prisma._sessions[0].revokedAt).not.toBeNull();
    expect(gateway.disconnectUser).toHaveBeenCalledWith('u-attacker');
    expect(m.acceptedAt).toBeNull();
    expect(prisma._tokens[0].type).toBe('PASSWORD_RESET');
  });

  it('asks a verified existing account to accept the invitation (no password change)', async () => {
    const user = { id: 'u-real', email: dto.email, passwordHash: 'h', emailVerifiedAt: new Date(), deletedAt: null };
    const { prisma, service } = setup([user]);
    await service.inviteMember('org1', dto);
    expect(user.passwordHash).toBe('h');
    expect(prisma._tokens[0].type).toBe('INVITATION');
  });
});

describe('pending memberships grant nothing', () => {
  it('assertMembers only counts accepted memberships', async () => {
    const count = jest.fn(async () => 0);
    await expect(assertMembers({ membership: { count } } as any, 'org1', ['u1'])).rejects.toThrow();
    expect((count.mock.calls[0] as any)[0].where.acceptedAt).toEqual({ not: null });
  });

  it('TenantGuard ignores pending memberships', async () => {
    const { TenantGuard } = await import('../../common/guards/tenant.guard');
    const findFirst = jest.fn(async () => null);
    const guard = new TenantGuard(
      { membership: { findFirst } } as any,
      { getAllAndOverride: () => false } as any,
      { getOrLoad: (_k: string, load: () => unknown) => load() } as any,
    );
    const ctx: any = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u1' }, headers: { 'x-organization-id': 'org1' } }) }),
    };
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect((findFirst.mock.calls[0] as any)[0].where.acceptedAt).toEqual({ not: null });
  });
});
