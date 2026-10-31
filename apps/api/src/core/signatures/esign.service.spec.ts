import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { canonicalJson, EsignService, verifySignature } from './esign.service';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';

describe('EsignService — electronic signatures (audit 2026-10 M-3)', () => {
  const prisma = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ firstName: 'Ana', lastName: 'Lopez', email: 'ana@x.io' }) },
    employee: { findFirst: jest.fn().mockResolvedValue({ jobTitle: 'Responsable qualité' }) },
    organization: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) },
  };
  const auth = {
    reauthenticate: jest.fn().mockImplementation(async (_u: string, creds: { password?: string }) => {
      if (creds.password !== 'right') throw new ForbiddenException({ error: 'ESIGN_REAUTH_FAILED' });
    }),
  };
  const service = new EsignService(prisma as never, auth as never);
  const base = { orgId: 'o1', userId: 'u1', entityType: 'complaint', entityId: 'c1', scope: 'closure' };
  const content = { reference: 'CMP-000001', decision: 'FOUNDED', customerSatisfied: true };

  it('signs after re-authentication and verifies the round trip', async () => {
    const { record, serialized } = await service.sign({ ...base, content, credentials: { password: 'right' } });
    expect(auth.reauthenticate).toHaveBeenCalledWith('u1', { password: 'right' });
    expect(record.signer).toEqual({ userId: 'u1', name: 'Ana Lopez', email: 'ana@x.io', function: 'Responsable qualité' });
    expect(verifySignature(serialized, content)).toMatchObject({ verified: true, legacy: false, contentMatches: true });
    expect(verifySignature(record)).toMatchObject({ verified: true });
  });

  it('detects content edited after signing', async () => {
    const { serialized } = await service.sign({ ...base, content, credentials: { password: 'right' } });
    expect(verifySignature(serialized, { ...content, decision: 'UNFOUNDED' })).toMatchObject({ verified: false, contentMatches: false });
  });

  it('detects a tampered signature record (signer, date or hash)', async () => {
    const { record } = await service.sign({ ...base, content, credentials: { password: 'right' } });
    expect(verifySignature({ ...record, signer: { ...record.signer, name: 'Someone else' } })?.verified).toBe(false);
    expect(verifySignature({ ...record, signedAt: new Date(0).toISOString() })?.verified).toBe(false);
    expect(verifySignature({ ...record, entityId: 'c2' })?.verified).toBe(false);
  });

  it('refuses to sign without credentials', async () => {
    await expect(service.sign({ ...base, content, credentials: undefined })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.sign({ ...base, content, credentials: {} })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to sign with a wrong password', async () => {
    await expect(service.sign({ ...base, content, credentials: { password: 'wrong' } })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a typed function override replaces the HR job title', async () => {
    const { record } = await service.sign({ ...base, content, credentials: { password: 'right' }, functionOverride: 'Directeur' });
    expect(record.signer.function).toBe('Directeur');
  });

  it('reads old opaque signatures as legacy, never as verified', () => {
    expect(verifySignature('a1b2c3d4e5f6')).toEqual({ signer: null, signedAt: null, scope: null, verified: false, legacy: true });
    expect(verifySignature(null)).toBeNull();
  });

  it('canonical JSON ignores key order and undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: new Date(0) } })).toBe(canonicalJson({ a: { c: new Date(0) }, b: 1 }));
  });

  describe('separation of duties', () => {
    it('refuses the author / requester as approver', async () => {
      await expect(service.assertSeparation('o1', ['u2', 'u1'], ['u1'], 'un document')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('accepts independent approvers', async () => {
      await expect(service.assertSeparation('o1', ['u2'], ['u1', null], 'un document')).resolves.toBeUndefined();
    });

    it('allows self-approval only when the organization enabled it', async () => {
      prisma.organization.findUnique.mockResolvedValueOnce({ settings: { allowSelfApproval: true } });
      await expect(service.assertSeparation('o1', ['u1'], ['u1'], 'un document')).resolves.toBeUndefined();
    });
  });
});
