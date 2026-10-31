import { decryptSecret, encryptSecret, isEncryptedSecret } from './secret-cipher';

describe('secret-cipher', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'unit-test-secret';
  });

  it('round-trips a TOTP seed and never stores it in clear', () => {
    const seed = 'JBSWY3DPEHPK3PXP';
    const stored = encryptSecret(seed);
    expect(stored).not.toContain(seed);
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(decryptSecret(stored)).toBe(seed);
  });

  it('uses a fresh IV per encryption', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('passes legacy plaintext values through unchanged', () => {
    expect(isEncryptedSecret('LEGACYSEED')).toBe(false);
    expect(decryptSecret('LEGACYSEED')).toBe('LEGACYSEED');
  });

  it('rejects tampered ciphertext', () => {
    const stored = encryptSecret('seed');
    const tampered = stored.slice(0, -2) + (stored.endsWith('A') ? 'BB' : 'AA');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
