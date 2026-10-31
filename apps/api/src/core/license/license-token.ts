import { createPrivateKey, createPublicKey, KeyObject, sign, verify } from 'crypto';

/**
 * Self-hosted license token — pure helpers (no Nest, no DB) shared by the API,
 * the platform issuer and the `license` CLI.
 *
 *   QLIC1.<base64url(JSON payload)>.<base64url(Ed25519 signature)>
 *
 * The signature covers `QLIC1.<payload>`. Only Astro holds the private key
 * (LICENSE_SIGNING_KEY on the SaaS); an install embeds the public key, so it can
 * verify a license offline but never mint one.
 */
export const LICENSE_PREFIX = 'QLIC1';

export interface LicensePayload {
  v: 1;
  /** LIC-2026-0001 */
  lid: string;
  customer: string;
  /** plan key (starter | professional | enterprise) */
  plan: string;
  /** active accounts allowed across the whole installation */
  seatLimit: number;
  /** organizations allowed on the installation */
  orgLimit: number;
  /** paid add-on keys (shared ADDON_KEYS) */
  addons: string[];
  /** per-organization storage cap (null = plan value) */
  storageLimitMb: number | null;
  issuedAt: string;
  startsAt: string;
  expiresAt: string;
  /** days the app keeps working after expiresAt before going read-only */
  graceDays: number;
  /** bind to one installation (InstallState.instanceId); null = any */
  instanceId: string | null;
  /** images built after this date refuse the license (update entitlement); null = no limit */
  updatesUntil: string | null;
}

export type LicenseErrorCode =
  | 'MALFORMED'
  | 'BAD_SIGNATURE'
  | 'UNSUPPORTED_VERSION'
  | 'WRONG_INSTANCE'
  | 'NOT_YET_VALID'
  | 'UPDATES_EXPIRED'
  | 'NO_PUBLIC_KEY';

export class LicenseError extends Error {
  constructor(
    readonly code: LicenseErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const DAY = 86_400_000;
/** expiry warnings start this many days before expiresAt */
export const EXPIRING_SOON_DAYS = 30;

/** Accepts a PEM, a base64-encoded PEM (single-line env vars) or a raw base64 DER (SPKI/PKCS8). */
function keyText(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('-----BEGIN')) return trimmed.replace(/\\n/g, '\n');
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  return decoded.includes('-----BEGIN') ? decoded : trimmed;
}

export function loadPublicKey(input: string): KeyObject {
  const text = keyText(input);
  return text.includes('-----BEGIN')
    ? createPublicKey(text)
    : createPublicKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'spki' });
}

export function loadPrivateKey(input: string): KeyObject {
  const text = keyText(input);
  return text.includes('-----BEGIN')
    ? createPrivateKey(text)
    : createPrivateKey({ key: Buffer.from(text, 'base64'), format: 'der', type: 'pkcs8' });
}

export function signLicense(payload: LicensePayload, privateKey: KeyObject): string {
  const body = `${LICENSE_PREFIX}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const signature = sign(null, Buffer.from(body), privateKey).toString('base64url');
  return `${body}.${signature}`;
}

const isDate = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isNonNegInt = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;

function assertPayload(p: Record<string, unknown>): asserts p is Record<string, unknown> & LicensePayload {
  const ok =
    typeof p.lid === 'string' &&
    typeof p.customer === 'string' &&
    typeof p.plan === 'string' &&
    isNonNegInt(p.seatLimit) &&
    Number.isInteger(p.orgLimit) &&
    (p.orgLimit as number) >= 1 &&
    Array.isArray(p.addons) &&
    p.addons.every((a) => typeof a === 'string') &&
    (p.storageLimitMb === null || isNonNegInt(p.storageLimitMb)) &&
    isDate(p.issuedAt) &&
    isDate(p.startsAt) &&
    isDate(p.expiresAt) &&
    isNonNegInt(p.graceDays) &&
    (p.instanceId === null || typeof p.instanceId === 'string') &&
    (p.updatesUntil === null || isDate(p.updatesUntil));
  if (!ok) throw new LicenseError('MALFORMED', 'License payload is incomplete');
}

/** Checks format + signature only (not dates / binding). Throws LicenseError. */
export function decodeLicense(token: string, publicKey: KeyObject): LicensePayload {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) {
    throw new LicenseError('MALFORMED', 'Not a Astro license key');
  }
  const [prefix, body, signature] = parts;
  let valid = false;
  try {
    valid = verify(null, Buffer.from(`${prefix}.${body}`), publicKey, Buffer.from(signature, 'base64url'));
  } catch {
    valid = false;
  }
  if (!valid) throw new LicenseError('BAD_SIGNATURE', 'The license signature is invalid');
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new LicenseError('MALFORMED', 'License payload is unreadable');
  }
  if (payload?.v !== 1) throw new LicenseError('UNSUPPORTED_VERSION', 'License format not supported by this version');
  assertPayload(payload);
  return payload;
}

export type LicensePhase = 'active' | 'expiring' | 'grace' | 'expired';

export interface LicenseEvaluation {
  phase: LicensePhase;
  /** whole days until expiresAt (negative once expired) */
  daysLeft: number;
  graceEndsAt: Date;
  readOnly: boolean;
}

/**
 * Applies the rules that depend on where/when the license runs. Throws for a
 * license that is not usable at all (other install, starts later, older
 * update entitlement than this build).
 */
export function evaluateLicense(
  payload: LicensePayload,
  ctx: { now: Date; instanceId: string; buildDate?: Date | null },
): LicenseEvaluation {
  if (payload.instanceId && payload.instanceId !== ctx.instanceId) {
    throw new LicenseError('WRONG_INSTANCE', 'This license is bound to another installation');
  }
  const now = ctx.now.getTime();
  if (Date.parse(payload.startsAt) > now + DAY) {
    throw new LicenseError('NOT_YET_VALID', `This license starts on ${payload.startsAt.slice(0, 10)}`);
  }
  if (payload.updatesUntil && ctx.buildDate && ctx.buildDate.getTime() > Date.parse(payload.updatesUntil) + DAY) {
    throw new LicenseError('UPDATES_EXPIRED', 'This version was released after the license update period');
  }
  const expiresAt = Date.parse(payload.expiresAt);
  const graceEndsAt = new Date(expiresAt + payload.graceDays * DAY);
  const daysLeft = Math.ceil((expiresAt - now) / DAY);
  const phase: LicensePhase =
    now >= graceEndsAt.getTime() ? 'expired' : now >= expiresAt ? 'grace' : daysLeft <= EXPIRING_SOON_DAYS ? 'expiring' : 'active';
  return { phase, daysLeft, graceEndsAt, readOnly: phase === 'expired' };
}
