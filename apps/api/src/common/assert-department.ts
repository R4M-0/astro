import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * A department id taken from a request body must belong to one of the org's sites.
 * Ignores null/undefined/empty (clearing or "default to the author's department").
 */
export async function assertDepartment(
  prisma: PrismaService,
  orgId: string,
  departmentId: string | null | undefined,
): Promise<void> {
  if (!departmentId) return;
  const count = await prisma.department.count({
    where: { id: departmentId, deletedAt: null, site: { organizationId: orgId } },
  });
  if (!count) throw new BadRequestException('Département inconnu');
}
