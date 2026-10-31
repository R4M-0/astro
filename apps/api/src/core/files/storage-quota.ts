import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const MB = 1024 * 1024;

/** Effective cap in bytes: the subscription override wins over the plan; null = unlimited. */
export function effectiveStorageLimit(
  sub: { storageLimitMb: number | null; plan?: { storageLimitMb: number | null } | null } | null,
): number | null {
  const mb = sub ? (sub.storageLimitMb ?? sub.plan?.storageLimitMb ?? null) : null;
  return mb === null ? null : mb * MB;
}

/** Throws 413 `STORAGE_QUOTA` when adding `size` bytes to `used` would exceed `limit` (bytes). */
export function assertWithinQuota(used: number, size: number, limit: number | null) {
  if (limit === null) return;
  if (used + size > limit) {
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        error: 'STORAGE_QUOTA',
        message: 'Storage quota reached for this organization',
        usedBytes: used,
        limitBytes: limit,
      },
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
}

/** Per-organization attachment storage quota (Plan.storageLimitMb, Subscription override). */
@Injectable()
export class StorageQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async usage(orgId: string): Promise<{ used: number; limit: number | null }> {
    const [sub, agg] = await Promise.all([
      this.prisma.subscription.findUnique({
        where: { organizationId: orgId },
        select: { storageLimitMb: true, plan: { select: { storageLimitMb: true } } },
      }),
      this.prisma.attachment.aggregate({
        where: { organizationId: orgId, deletedAt: null },
        _sum: { size: true },
      }),
    ]);
    return { used: agg._sum.size ?? 0, limit: effectiveStorageLimit(sub) };
  }

  async assertCanStore(orgId: string, size: number) {
    const { used, limit } = await this.usage(orgId);
    assertWithinQuota(used, size, limit);
  }
}
