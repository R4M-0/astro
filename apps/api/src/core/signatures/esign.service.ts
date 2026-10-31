import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { deriveKey } from '../auth/secret-cipher';

/** Credentials re-entered at signing time (M-3): the password, or the TOTP code when 2FA is on. */
export interface ESignCredentials {
  password?: string;
  totp?: string;
}

export interface ESignSigner {
  userId: string;
  name: string;
  email: string;
  function: string | null;
}

/** What is stored (serialised) in a signature column / slot. */
export interface ESignRecord {
  v: 1;
  signer: ESignSigner;
  entityType: string;
  entityId: string;
  scope: string;
  contentHash: string;
  signedAt: string;
  mac: string;
}

/** What is handed to clients next to a signed record. */
export interface ESignView {
  signer: ESignSigner | null;
  signedAt: string | null;
  scope: string | null;
  /** MAC valid AND (when the current content is known) the content is unchanged since signing. */
  verified: boolean;
  /** Pre-2026-10 signature (opaque hash string): cannot be verified. */
  legacy: boolean;
  /** false when the MAC is valid but the signed content changed afterwards. */
  contentMatches?: boolean;
}

/** Stable JSON: sorted keys, Dates as ISO strings, undefined dropped. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v instanceof Date) return v.toISOString();
    if (v && typeof v === 'object' && typeof (v as { toJSON?: unknown }).toJSON === 'function' && !Array.isArray(v)) {
      return norm((v as { toJSON: () => unknown }).toJSON());
    }
    if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : norm(x)));
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value) ?? null);
}

export const contentHash = (content: unknown) => createHash('sha256').update(canonicalJson(content)).digest('hex');

let macKey: Buffer | undefined;
const key = () => (macKey ??= deriveKey('esign:v1'));

function macOf(r: Omit<ESignRecord, 'mac'>): string {
  const payload = [
    `v${r.v}`,
    r.signer.userId,
    r.entityType,
    r.entityId,
    r.scope,
    r.contentHash,
    r.signedAt,
    canonicalJson(r.signer),
  ].join('|');
  return createHmac('sha256', key()).update(payload).digest('hex');
}

/** Parses a stored signature: a record, `'legacy'` for an old opaque string, or null. */
export function parseSignature(stored: unknown): ESignRecord | 'legacy' | null {
  if (stored === null || stored === undefined || stored === '') return null;
  let obj: unknown = stored;
  if (typeof stored === 'string') {
    if (!stored.startsWith('{')) return 'legacy';
    try {
      obj = JSON.parse(stored);
    } catch {
      return 'legacy';
    }
  }
  const r = obj as Partial<ESignRecord>;
  if (r && r.v === 1 && typeof r.mac === 'string' && r.signer && typeof r.contentHash === 'string') return r as ESignRecord;
  return 'legacy';
}

/** Recomputes the MAC (and, when given, the content hash) of a stored signature. */
export function verifySignature(stored: unknown, currentContent?: unknown): ESignView | null {
  const parsed = parseSignature(stored);
  if (parsed === null) return null;
  if (parsed === 'legacy') return { signer: null, signedAt: null, scope: null, verified: false, legacy: true };
  const { mac, ...rest } = parsed;
  const expected = macOf(rest);
  const macOk = mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  const contentMatches = currentContent === undefined ? undefined : contentHash(currentContent) === parsed.contentHash;
  return {
    signer: parsed.signer,
    signedAt: parsed.signedAt,
    scope: parsed.scope,
    verified: macOk && contentMatches !== false,
    legacy: false,
    ...(contentMatches === undefined ? {} : { contentMatches }),
  };
}

/**
 * Electronic signatures (M-3): every approve / sign / close / decide re-authenticates the
 * signer in the same request, snapshots who they are, binds the signature to a hash of the
 * signed content and seals it with an HMAC keyed from APP_ENCRYPTION_KEY — so it can be
 * verified later and any edit of the signed content or of the signature itself shows.
 */
@Injectable()
export class EsignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Re-authenticates `userId` and returns the signature record + its serialised form
   * (for String columns). `functionOverride` replaces the job title (forms, approver only).
   */
  async sign(input: {
    orgId: string;
    userId: string;
    entityType: string;
    entityId: string;
    scope: string;
    content: unknown;
    credentials: ESignCredentials | undefined;
    functionOverride?: string | null;
    signedAt?: Date;
  }): Promise<{ record: ESignRecord; serialized: string }> {
    if (!input.credentials || (!input.credentials.password && !input.credentials.totp)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'ESIGN_REQUIRED',
        message: 'Signature électronique requise : confirmez votre mot de passe ou votre code d’authentification',
      });
    }
    await this.auth.reauthenticate(input.userId, input.credentials);
    const signer = await this.signer(input.orgId, input.userId, input.functionOverride);
    const rest: Omit<ESignRecord, 'mac'> = {
      v: 1,
      signer,
      entityType: input.entityType,
      entityId: input.entityId,
      scope: input.scope,
      contentHash: contentHash(input.content),
      signedAt: (input.signedAt ?? new Date()).toISOString(),
    };
    const record: ESignRecord = { ...rest, mac: macOf(rest) };
    return { record, serialized: JSON.stringify(record) };
  }

  /** `Organization.settings.allowSelfApproval` — off unless an admin explicitly allows it. */
  async selfApprovalAllowed(orgId: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    const settings = org?.settings as Record<string, unknown> | null;
    return settings?.allowSelfApproval === true;
  }

  /**
   * Separation of duties: none of `approverIds` may be one of `excluded` (requester,
   * author…) unless the organization allows self-approval.
   */
  async assertSeparation(orgId: string, approverIds: (string | null | undefined)[], excluded: (string | null | undefined)[], what: string) {
    const banned = new Set(excluded.filter((u): u is string => !!u));
    if (!approverIds.some((u) => !!u && banned.has(u))) return;
    if (await this.selfApprovalAllowed(orgId)) return;
    throw new ForbiddenException({
      statusCode: 403,
      error: 'SELF_APPROVAL_FORBIDDEN',
      message: `Séparation des tâches : ${what} ne peut pas être approuvé(e) par son auteur ou son demandeur`,
    });
  }

  verify(stored: unknown, currentContent?: unknown): ESignView | null {
    return verifySignature(stored, currentContent);
  }

  /** Snapshot of the signer: name + e-mail from the account, function from the linked employee record. */
  async signer(orgId: string, userId: string, functionOverride?: string | null): Promise<ESignSigner> {
    const [user, employee] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } }),
      this.prisma.employee.findFirst({
        where: { organizationId: orgId, userId, deletedAt: null },
        select: { jobTitle: true },
      }),
    ]);
    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email;
    const fn = functionOverride?.trim() || employee?.jobTitle?.trim() || null;
    return { userId, name, email: user.email, function: fn };
  }
}
