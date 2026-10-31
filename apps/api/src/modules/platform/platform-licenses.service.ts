import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { isAddonKey, normalizeAddons } from '@astro/shared';
import { loadPrivateKey, loadPublicKey, type LicensePayload, signLicense } from '../../core/license/license-token';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditService } from './platform-audit.service';

const DAY = 86_400_000;

export interface IssueLicenseInput {
  customer: string;
  organizationId?: string | null;
  plan: string;
  seatLimit: number;
  orgLimit?: number;
  addons?: string[];
  storageLimitMb?: number | null;
  startsAt: string;
  expiresAt: string;
  graceDays?: number;
  instanceId?: string | null;
  updatesUntil?: string | null;
  notes?: string | null;
  supersedesId?: string | null;
}

interface Actor {
  actorId: string;
  actorEmail: string;
  ip?: string;
  userAgent?: string;
}

/**
 * SaaS side of self-hosted licensing: signs QLIC1 tokens with
 * LICENSE_SIGNING_KEY (Ed25519 private key, never shipped in an image) and
 * keeps the register of every license issued.
 */
@Injectable()
export class PlatformLicensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  private signingKey() {
    const raw = process.env.LICENSE_SIGNING_KEY;
    if (!raw) throw new ServiceUnavailableException('LICENSE_SIGNING_KEY is not configured on this server');
    try {
      return loadPrivateKey(raw);
    } catch {
      throw new ServiceUnavailableException('LICENSE_SIGNING_KEY is not a valid Ed25519 private key');
    }
  }

  /** Public half of the signing key — the value to bake into self-hosted builds. */
  publicKey(): { configured: boolean; publicKeyPem: string | null } {
    if (!process.env.LICENSE_SIGNING_KEY) return { configured: false, publicKeyPem: null };
    const pem = loadPublicKey(
      this.signingKey().export({ format: 'pem', type: 'pkcs8' }).toString(),
    ).export({ format: 'pem', type: 'spki' }).toString();
    return { configured: true, publicKeyPem: pem };
  }

  list(q: { search?: string } = {}) {
    const search = q.search?.trim();
    return this.prisma.issuedLicense.findMany({
      where: search
        ? { OR: [{ customer: { contains: search, mode: 'insensitive' } }, { reference: { contains: search, mode: 'insensitive' } }] }
        : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      omit: { token: true },
    });
  }

  async get(id: string) {
    const row = await this.prisma.issuedLicense.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('License not found');
    const [supersedes, renewals] = await Promise.all([
      row.supersedesId
        ? this.prisma.issuedLicense.findUnique({ where: { id: row.supersedesId }, select: { id: true, reference: true, expiresAt: true } })
        : null,
      this.prisma.issuedLicense.findMany({
        where: { supersedesId: id },
        select: { id: true, reference: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { ...row, supersedes, renewals };
  }

  private async nextReference(year: number) {
    const prefix = `LIC-${year}-`;
    const last = await this.prisma.issuedLicense.findFirst({
      where: { reference: { startsWith: prefix } },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    });
    const n = last ? Number(last.reference.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(n).padStart(4, '0')}`;
  }

  async issue(actor: Actor, dto: IssueLicenseInput) {
    const key = this.signingKey();
    const startsAt = new Date(dto.startsAt);
    const expiresAt = new Date(dto.expiresAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(expiresAt.getTime())) throw new BadRequestException('Invalid dates');
    if (expiresAt.getTime() <= startsAt.getTime() + DAY) throw new BadRequestException('The license must end after it starts');
    const unknown = (dto.addons ?? []).filter((a) => !isAddonKey(a));
    if (unknown.length) throw new BadRequestException(`Unknown add-on(s): ${unknown.join(', ')}`);
    if (!(await this.prisma.plan.findUnique({ where: { key: dto.plan } }))) throw new BadRequestException('Unknown plan');
    if (dto.supersedesId && !(await this.prisma.issuedLicense.findUnique({ where: { id: dto.supersedesId } }))) {
      throw new BadRequestException('The license to renew does not exist');
    }
    const updatesUntil = dto.updatesUntil ? new Date(dto.updatesUntil) : null;
    if (updatesUntil && Number.isNaN(updatesUntil.getTime())) throw new BadRequestException('Invalid update entitlement date');

    const now = new Date();
    const reference = await this.nextReference(now.getUTCFullYear());
    const payload: LicensePayload = {
      v: 1,
      lid: reference,
      customer: dto.customer.trim(),
      plan: dto.plan,
      seatLimit: dto.seatLimit,
      orgLimit: dto.orgLimit ?? 1,
      addons: [...normalizeAddons(dto.addons ?? [])],
      storageLimitMb: dto.storageLimitMb ?? null,
      issuedAt: now.toISOString(),
      startsAt: startsAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      graceDays: dto.graceDays ?? 14,
      instanceId: dto.instanceId?.trim() || null,
      updatesUntil: updatesUntil?.toISOString() ?? null,
    };
    const token = signLicense(payload, key);
    const row = await this.prisma.issuedLicense.create({
      data: {
        reference,
        customer: payload.customer,
        organizationId: dto.organizationId || null,
        plan: payload.plan,
        seatLimit: payload.seatLimit,
        orgLimit: payload.orgLimit,
        addons: payload.addons,
        storageLimitMb: payload.storageLimitMb,
        startsAt,
        expiresAt,
        graceDays: payload.graceDays,
        instanceId: payload.instanceId,
        updatesUntil,
        token,
        notes: dto.notes?.trim() || null,
        supersedesId: dto.supersedesId || null,
        issuedById: actor.actorId,
        issuedByEmail: actor.actorEmail,
      },
    });
    await this.audit.record({
      ...actor,
      action: 'license.issued',
      organizationId: dto.organizationId || undefined,
      after: { ...payload },
      metadata: { licenseId: row.id, supersedesId: dto.supersedesId ?? null },
    });
    return row;
  }
}
