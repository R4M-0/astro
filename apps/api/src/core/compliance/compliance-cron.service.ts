import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditChainService } from '../audit-log/audit-chain.service';
import { CRON_CLAIM_MS, RedisService } from '../redis/redis.service';
import { RetentionService } from './retention.service';

/**
 * Worker-only schedules (ScheduleModule is registered in worker / all processes):
 *  - 02:30 verify every organization's audit chain, then seal its head (log line = copy outside the DB)
 *  - 03:30 apply the retention policies an admin enabled
 */
@Injectable()
export class ComplianceCronService {
  private readonly logger = new Logger('ComplianceCron');

  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: AuditChainService,
    private readonly retention: RetentionService,
    private readonly redis: RedisService,
  ) {}

  @Cron('30 2 * * *')
  async sealAll(): Promise<void> {
    if (!(await this.redis.claimRun('cron:audit-seal', CRON_CLAIM_MS))) return;
    const orgs = await this.prisma.organization.findMany({ where: { deletedAt: null }, select: { id: true } });
    for (const { id } of orgs) {
      try {
        await this.chain.verify(id);
        await this.chain.seal(id, 'DAILY');
      } catch (err) {
        this.logger.error(`audit seal for ${id} failed`, err as Error);
      }
    }
  }

  @Cron('30 3 * * *')
  async retentionAll(): Promise<void> {
    if (!(await this.redis.claimRun('cron:retention', CRON_CLAIM_MS))) return;
    const orgs = await this.prisma.retentionPolicy.findMany({ where: { enabled: true }, distinct: ['organizationId'], select: { organizationId: true } });
    for (const { organizationId } of orgs) {
      try {
        await this.retention.run(organizationId, { dryRun: false, actorId: null });
      } catch (err) {
        this.logger.error(`retention for ${organizationId} failed`, err as Error);
      }
    }
  }
}
