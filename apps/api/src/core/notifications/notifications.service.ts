import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@astro/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationCategory, notificationCategory } from './notification-categories';

export interface NotificationPageQuery {
  page: number;
  pageSize: number;
  status?: 'all' | 'unread' | 'read';
  category?: NotificationCategory;
  search?: string;
}

export interface NotifyInput {
  organizationId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  link?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async notify(input: NotifyInput) {
    const { userIds, ...rest } = input;
    const requested = [...new Set(userIds)].filter(Boolean);
    if (!requested.length) return [];
    // Safety net: only active members of the target org may receive its notifications.
    const members = await this.prisma.membership.findMany({
      where: {
        organizationId: rest.organizationId,
        deletedAt: null,
        isActive: true,
        userId: { in: requested },
      },
      select: { userId: true },
    });
    const allowed = new Set(members.map((m) => m.userId));
    const unique = requested.filter((id) => allowed.has(id));
    if (!unique.length) return [];
    const notifications = await this.prisma.$transaction(
      unique.map((userId) => this.prisma.notification.create({ data: { userId, ...rest } })),
    );
    for (const n of notifications) {
      this.gateway.emitToUser(n.userId, 'notification', n);
    }
    return notifications;
  }

  async list(userId: string, orgId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        organizationId: orgId,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Full history for the notifications page: paginated, filterable, with per-category counts. */
  async page(userId: string, orgId: string, q: NotificationPageQuery) {
    const base = { userId, organizationId: orgId };
    const byType = await this.prisma.notification.groupBy({
      by: ['type'],
      where: base,
      _count: { _all: true },
    });
    const unreadByType = await this.prisma.notification.groupBy({
      by: ['type'],
      where: { ...base, readAt: null },
      _count: { _all: true },
    });
    const categories: Record<string, { total: number; unread: number }> = {};
    for (const row of byType) {
      const c = (categories[notificationCategory(row.type)] ??= { total: 0, unread: 0 });
      c.total += row._count._all;
    }
    for (const row of unreadByType) {
      categories[notificationCategory(row.type)].unread += row._count._all;
    }

    const search = q.search?.trim().slice(0, 200);
    const where = {
      ...base,
      ...(q.status === 'unread' ? { readAt: null } : q.status === 'read' ? { readAt: { not: null } } : {}),
      ...(q.category
        ? { type: { in: byType.map((r) => r.type).filter((t) => notificationCategory(t) === q.category) } }
        : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' as const } },
              { body: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return {
      data: data.map((n) => ({ ...n, category: notificationCategory(n.type) })),
      meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) },
      counts: {
        total: byType.reduce((s, r) => s + r._count._all, 0),
        unread: unreadByType.reduce((s, r) => s + r._count._all, 0),
        categories,
      },
    };
  }

  async unreadCount(userId: string, orgId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, organizationId: orgId, readAt: null },
    });
    return { count };
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    return { read: true };
  }

  async markUnread(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: null },
    });
    return { read: false };
  }

  async remove(userId: string, id: string) {
    await this.prisma.notification.deleteMany({ where: { id, userId } });
    return { deleted: true };
  }

  /** Clears the read notifications of the current organization. */
  async removeRead(userId: string, orgId: string) {
    const { count } = await this.prisma.notification.deleteMany({
      where: { userId, organizationId: orgId, readAt: { not: null } },
    });
    return { deleted: count };
  }

  async markAllRead(userId: string, orgId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, organizationId: orgId, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: true };
  }
}
