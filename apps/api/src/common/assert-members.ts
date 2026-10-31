import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Every id must be an active member of the org (invitation accepted); ignores null/undefined/empty.
 * Throws 400 otherwise. Use it on create/update paths before persisting any
 * user id taken from a request body (owner, responsible, approvers, ...).
 */
export async function assertMembers(
  prisma: PrismaService,
  orgId: string,
  ids: (string | null | undefined)[] | undefined,
  label = 'user',
): Promise<void> {
  const unique = [...new Set((ids ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (!unique.length) return;
  const count = await prisma.membership.count({
    where: { organizationId: orgId, deletedAt: null, isActive: true, acceptedAt: { not: null }, userId: { in: unique } },
  });
  if (count !== unique.length) {
    throw new BadRequestException(`Unknown ${label} for this organization`);
  }
}
