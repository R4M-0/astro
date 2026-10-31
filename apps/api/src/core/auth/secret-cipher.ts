import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';

/**
 * AES-256-GCM envelope for secrets stored in the database (TOTP seeds).
 * Key: APP_ENCRYPTION_KEY (32 bytes as hex or base64), otherwise derived from
 * JWT_ACCESS_SECRET so existing deployments keep working. Values are prefixed
 * `enc:v1:` — anything else is treated as a legacy plaintext value.
 */
const PREFIX = 'enc:v1:';

function loadKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (raw) {
    const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
    throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)');
  }
  const seed = process.env.JWT_ACCESS_SECRET;
  if (!seed) throw new Error('APP_ENCRYPTION_KEY or JWT_ACCESS_SECRET is required');
  return createHash('sha256').update(`astro-secret-cipher:${seed}`).digest();
}

let key: Buffer | undefined;
const getKey = () => (key ??= loadKey());

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, ct].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const [iv, tag, ct] = stored.slice(PREFIX.length).split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** A sub-key for another purpose (e.g. e-signature MACs), derived from the same master key. */
export function deriveKey(purpose: string): Buffer {
  return createHmac('sha256', getKey()).update(`astro:${purpose}`).digest();
}

export const isEncryptedSecret = (v: string | null | undefined) => !!v && v.startsWith(PREFIX);
