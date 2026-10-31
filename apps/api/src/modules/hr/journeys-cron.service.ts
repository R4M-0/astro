import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { CRON_CLAIM_MS, RedisService } from '../../core/redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Daily end-of-trial reminders (`trial_period_due`): onboarding plans still in progress whose
 * trial period ends in 14 or 7 days, today, or is past (weekly) notify the plan owner and the
 * employee's manager (when they have a login), so the sign-off is not forgotten.
 */
@Injectable()
export class JourneysCronService {
  private readonly logger = new Logger(JourneysCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly redis: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async run(): Promise<void> {
    if (!(await this.redis.claimRun('cron:hr-trial-periods', CRON_CLAIM_MS))) return;
    try {
      await this.remind();
    } catch (err) {
      this.logger.error('Trial period reminders failed', err as Error);
    }
  }

  async remind(now = new Date()): Promise<number> {
    const horizon = new Date(now.getTime() + 14 * 86400000);
    const journeys = await this.prisma.employeeJourney.findMany({
      where: { kind: 'ONBOARDING', status: 'IN_PROGRESS', deletedAt: null, targetDate: { not: null, lte: horizon } },
      select: {
        id: true,
        organizationId: true,
        reference: true,
        targetDate: true,
        ownerId: true,
        employee: { select: { firstName: true, lastName: true, manager: { select: { userId: true } } } },
      },
    });
    let sent = 0;
    for (const j of journeys) {
      const days = Math.floor((j.targetDate!.getTime() - now.getTime()) / 86400000);
      const due = days === 14 || days === 7 || days === 0 || (days < 0 && -days % 7 === 0);
      if (!due) continue;
      const userIds = [j.ownerId, j.employee.manager?.userId].filter((u): u is string => !!u);
      if (!userIds.length) continue;
      await this.notifications.notify({
        organizationId: j.organizationId,
        userIds,
        type: 'trial_period_due',
        title: `Fin de période d’essai — ${j.employee.firstName} ${j.employee.lastName}`,
        body:
          days >= 0
            ? `La période d’essai se termine le ${j.targetDate!.toLocaleDateString('fr-FR')} : validation à signer (${j.reference})`
            : `Période d’essai échue depuis ${-days} jour(s) : validation à signer (${j.reference})`,
        entityType: 'employee-journey',
        entityId: j.id,
        link: `/hr/journeys/${j.id}`,
      });
      sent++;
    }
    return sent;
  }
}
