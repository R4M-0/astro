import { generateKeyPairSync } from 'crypto';
import { decodeLicense, evaluateLicense, LicenseError, type LicensePayload, loadPrivateKey, loadPublicKey, signLicense } from './license-token';

const DAY = 86_400_000;
const keys = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');

const payload = (over: Partial<LicensePayload> = {}): LicensePayload => ({
  v: 1,
  lid: 'LIC-2026-0001',
  customer: 'Acme SA',
  plan: 'enterprise',
  seatLimit: 50,
  orgLimit: 1,
  addons: ['environment'],
  storageLimitMb: null,
  issuedAt: '2026-11-01T00:00:00.000Z',
  startsAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2027-11-01T00:00:00.000Z',
  graceDays: 14,
  instanceId: null,
  updatesUntil: null,
  ...over,
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as LicenseError).code;
  }
  return null;
};

describe('license token', () => {
  it('round-trips a signed license', () => {
    const token = signLicense(payload(), keys.privateKey);
    expect(token.startsWith('QLIC1.')).toBe(true);
    expect(decodeLicense(token, keys.publicKey)).toEqual(payload());
  });

  it('accepts PEM, base64 PEM and escaped-newline keys', () => {
    const pem = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const token = signLicense(payload(), loadPrivateKey(Buffer.from(keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()).toString('base64')));
    for (const text of [pem, Buffer.from(pem).toString('base64'), pem.replace(/\n/g, '\\n')]) {
      expect(decodeLicense(token, loadPublicKey(text)).lid).toBe('LIC-2026-0001');
    }
  });

  it('rejects another key, an edited payload and garbage', () => {
    const token = signLicense(payload(), keys.privateKey);
    expect(code(() => decodeLicense(token, other.publicKey))).toBe('BAD_SIGNATURE');
    const [p, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify(payload({ seatLimit: 5000 }))).toString('base64url');
    expect(code(() => decodeLicense(`${p}.${forged}.${s}`, keys.publicKey))).toBe('BAD_SIGNATURE');
    expect(code(() => decodeLicense('hello', keys.publicKey))).toBe('MALFORMED');
    expect(code(() => decodeLicense(signLicense({ ...payload(), seatLimit: -1 }, keys.privateKey), keys.publicKey))).toBe('MALFORMED');
  });

  it('walks active → expiring → grace → expired (read-only)', () => {
    const p = payload();
    const at = (iso: string) => evaluateLicense(p, { now: new Date(iso), instanceId: 'x' });
    expect(at('2027-01-01T00:00:00Z')).toMatchObject({ phase: 'active', readOnly: false });
    expect(at('2027-10-20T00:00:00Z')).toMatchObject({ phase: 'expiring', daysLeft: 12, readOnly: false });
    expect(at('2027-11-05T00:00:00Z')).toMatchObject({ phase: 'grace', readOnly: false });
    expect(at('2027-11-15T00:00:01Z')).toMatchObject({ phase: 'expired', readOnly: true });
  });

  it('enforces instance binding, start date and update entitlement', () => {
    const now = new Date('2027-01-01T00:00:00Z');
    expect(code(() => evaluateLicense(payload({ instanceId: 'QI-a' }), { now, instanceId: 'QI-b' }))).toBe('WRONG_INSTANCE');
    expect(evaluateLicense(payload({ instanceId: 'QI-a' }), { now, instanceId: 'QI-a' }).phase).toBe('active');
    expect(code(() => evaluateLicense(payload({ startsAt: '2027-03-01T00:00:00Z' }), { now, instanceId: 'x' }))).toBe('NOT_YET_VALID');
    const updates = payload({ updatesUntil: '2026-12-01T00:00:00Z' });
    expect(code(() => evaluateLicense(updates, { now, instanceId: 'x', buildDate: new Date('2026-12-20') }))).toBe('UPDATES_EXPIRED');
    expect(evaluateLicense(updates, { now, instanceId: 'x', buildDate: new Date(Date.parse('2026-12-01') - DAY) }).phase).toBe('active');
  });
});
