import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { unscoped } from '../core/department-scope/department-scope';

/** Tenant-owned models whose ids may be taken from a request body (all carry `organizationId`). */
const MODELS = {
  site: { delegate: 'site', softDelete: true },
  employee: { delegate: 'employee', softDelete: true },
} as const;

export type InOrgModel = keyof typeof MODELS;

/**
 * Every id must be a record of this organization; ignores null/undefined/empty (clearing).
 * Throws 400 otherwise. Existence is checked org-wide (department visibility does not apply:
 * linking to a record of another process is legitimate, linking to another tenant's is not).
 * Departments keep `assertDepartment` (they hang off `site.organizationId`).
 */
export async function assertInOrg(
  prisma: PrismaService,
  orgId: string,
  model: InOrgModel,
  ids: string | null | undefined | (string | null | undefined)[],
): Promise<void> {
  const list = Array.isArray(ids) ? ids : [ids];
  const unique = [...new Set(list.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (!unique.length) return;
  const def = MODELS[model];
  const where: Record<string, unknown> = { id: { in: unique }, organizationId: orgId };
  if (def.softDelete) where.deletedAt = null;
  const count = await unscoped(() => (prisma as any)[def.delegate].count({ where }) as Promise<number>);
  if (count !== unique.length) throw new BadRequestException(`Unknown ${model} for this organization`);
}
