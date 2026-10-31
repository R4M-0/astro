import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CRON_CLAIM_MS, RedisService } from '../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FilesService } from './files.service';

const DAY = 86_400_000;
/** Rows are checked once they are a day old (the presigned PUT has long expired) and up to a week back. */
const MIN_AGE_MS = DAY;
const MAX_AGE_MS = 8 * DAY;
const BATCH = 500;

/**
 * Daily cleanup of attachment rows whose upload never happened: the row is
 * created when the PUT URL is presigned, so an abandoned upload leaves a row
 * pointing at nothing (and counting against the storage quota). Runs only in
 * the worker/all role (ScheduleModule is registered there).
 */
@Injectable()
export class AttachmentsCleanupCronService {
  private readonly logger = new Logger(AttachmentsCleanupCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly redis: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    if (!(await this.redis.claimRun('cron:attachments-cleanup', CRON_CLAIM_MS))) return;
    try {
      const removed = await this.cleanup();
      if (removed) this.logger.log(`Removed ${removed} orphan attachment row(s)`);
    } catch (err) {
      this.logger.error('Attachment cleanup failed', err as Error);
    }
  }

  async cleanup(now = new Date()): Promise<number> {
    const rows = await this.prisma.attachment.findMany({
      where: {
        createdAt: { lt: new Date(now.getTime() - MIN_AGE_MS), gte: new Date(now.getTime() - MAX_AGE_MS) },
      },
      select: { id: true, storageKey: true },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    const orphans: string[] = [];
    for (const row of rows) {
      try {
        if (!(await this.files.objectExists(row.storageKey))) orphans.push(row.id);
      } catch {
        // storage unreachable: keep the row, try again tomorrow
      }
    }
    if (!orphans.length) return 0;
    const { count } = await this.prisma.attachment.deleteMany({ where: { id: { in: orphans } } });
    return count;
  }
}
