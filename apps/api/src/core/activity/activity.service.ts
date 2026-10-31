import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget activity feed entry. */
  record(input: {
    organizationId: string;
    entityType: string;
    entityId: string;
    actorId?: string | null;
    verb: string;
    data?: Record<string, unknown>;
  }) {
    void this.prisma.activityEntry
      .create({
        data: {
          organizationId: input.organizationId,
          entityType: input.entityType,
          entityId: input.entityId,
          actorId: input.actorId ?? null,
          verb: input.verb,
          data: (input.data ?? {}) as object,
        },
      })
      .catch(() => undefined);
  }

  list(organizationId: string, entityType: string, entityId: string) {
    return this.prisma.activityEntry.findMany({
      where: { organizationId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
