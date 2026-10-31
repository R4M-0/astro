import { randomBytes } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActivityService } from '../../core/activity/activity.service';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { paginate, PaginationQuery } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { TrainingQuery } from './dto/hr.dto';

@Injectable()
export class TrainingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
  ) {}

  private assertDates(startDate?: unknown, endDate?: unknown) {
    if (startDate && endDate && new Date(endDate as string) < new Date(startDate as string)) {
      throw new BadRequestException('La date de fin ne peut précéder la date de début');
    }
  }

  /**
   * hotToken/coldToken are bearer credentials for the public feedback forms:
   * only hr-trainings:update holders receive them (and the ready-made URLs).
   */
  private shareLinks<T extends { hotToken: string; coldToken: string }>(t: T, canManage: boolean) {
    const { hotToken, coldToken, ...rest } = t;
    if (!canManage) return { ...rest, hotToken: null, coldToken: null, hotUrl: null, coldUrl: null };
    const base = (process.env.APP_URL ?? '').replace(/\/+$/, '');
    return {
      ...rest,
      hotToken,
      coldToken,
      hotUrl: base ? `${base}/f/${hotToken}` : null,
      coldUrl: base ? `${base}/f/${coldToken}` : null,
    };
  }

  async list(orgId: string, q: TrainingQuery, canManage = false) {
    const where: Prisma.HrTrainingWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      ...(q.status ? { status: q.status as Prisma.HrTrainingWhereInput['status'] } : {}),
      ...(q.type ? { type: q.type as Prisma.HrTrainingWhereInput['type'] } : {}),
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: 'insensitive' } },
              { theme: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.hrTraining.findMany({
        where,
        orderBy: { startDate: 'desc' },
        skip: q.skip,
        take: q.pageSize,
        include: { _count: { select: { participants: true, feedback: true } } },
      }),
      this.prisma.hrTraining.count({ where }),
    ]);
    const decorated = rows.map((r) => {
      const { _count, ...rest } = r;
      return { ...this.shareLinks(rest, canManage), participantCount: _count.participants, feedbackCount: _count.feedback };
    });
    return paginate(decorated, total, q as unknown as PaginationQuery);
  }

  async assert(orgId: string, id: string) {
    const training = await this.prisma.hrTraining.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
    if (!training) throw new NotFoundException('Training not found');
    return training;
  }

  async get(orgId: string, id: string, canManage = false) {
    const training = await this.prisma.hrTraining.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: {
        participants: {
          include: {
            employee: {
              select: { id: true, firstName: true, lastName: true, reference: true, jobTitle: true },
            },
          },
        },
        feedback: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!training) throw new NotFoundException('Training not found');
    return { ...this.shareLinks(training, canManage), satisfaction: this.summariseFeedback(training.feedback) };
  }

  private summariseFeedback(feedback: { evaluationType: string; satisfactionScore: number }[]) {
    const of = (type: string) => {
      const items = feedback.filter((f) => f.evaluationType === type);
      const avg = items.length
        ? Math.round((items.reduce((s, f) => s + f.satisfactionScore, 0) / items.length) * 10) / 10
        : null;
      return { count: items.length, avgScore: avg, rate: avg != null ? Math.round((avg / 5) * 100) : null };
    };
    return { hot: of('HOT'), cold: of('COLD') };
  }


  /** The department must belong to the org (ids come from the client). */
  private async assertDepartment(orgId: string, departmentId: unknown) {
    if (!departmentId) return;
    const found = await this.prisma.department.count({
      where: { id: departmentId as string, deletedAt: null, site: { organizationId: orgId } },
    });
    if (!found) throw new BadRequestException('Département inconnu');
  }

  async create(orgId: string, userId: string, dto: Record<string, unknown>) {
    this.assertDates(dto.startDate, dto.endDate);
    const participantIds = (dto.participantIds as string[]) ?? [];
    await this.assertEmployees(orgId, participantIds);
    await this.assertDepartment(orgId, dto.departmentId);
    const training = await this.prisma.hrTraining.create({
      data: {
        organizationId: orgId,
        code: dto.code as string,
        theme: dto.theme as string,
        type: (dto.type ?? 'INTERNE') as 'INTERNE',
        startDate: dto.startDate ? new Date(dto.startDate as string) : null,
        endDate: dto.endDate ? new Date(dto.endDate as string) : null,
        status: (dto.status ?? 'PLANNED') as 'PLANNED',
        observation: (dto.observation as string) || null,
        departmentId: (dto.departmentId as string) || null,
        hotToken: randomBytes(16).toString('base64url'),
        coldToken: randomBytes(16).toString('base64url'),
        createdById: userId,
        participants: {
          create: participantIds.map((employeeId) => ({ employeeId })),
        },
      },
    });
    this.activity.record({
      organizationId: orgId,
      entityType: 'hr-training',
      entityId: training.id,
      actorId: userId,
      verb: 'created',
      data: { code: training.code, theme: training.theme },
    });
    if (participantIds.length) await this.notifyAssigned(orgId, training.id, participantIds);
    return this.get(orgId, training.id, true);
  }

  async update(orgId: string, userId: string, id: string, dto: Record<string, unknown>) {
    const current = await this.assert(orgId, id);
    const nextStart = dto.startDate !== undefined ? dto.startDate : current.startDate?.toISOString();
    const nextEnd = dto.endDate !== undefined ? dto.endDate : current.endDate?.toISOString();
    this.assertDates(nextStart, nextEnd);
    await this.assertDepartment(orgId, dto.departmentId);

    await this.prisma.hrTraining.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code as string } : {}),
        ...(dto.theme !== undefined ? { theme: dto.theme as string } : {}),
        ...(dto.type !== undefined ? { type: dto.type as 'INTERNE' } : {}),
        ...(dto.startDate !== undefined
          ? { startDate: dto.startDate ? new Date(dto.startDate as string) : null }
          : {}),
        ...(dto.endDate !== undefined
          ? { endDate: dto.endDate ? new Date(dto.endDate as string) : null }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status as 'PLANNED' } : {}),
        ...(dto.observation !== undefined ? { observation: (dto.observation as string) || null } : {}),
        ...(dto.departmentId !== undefined ? { departmentId: (dto.departmentId as string) || null } : {}),
        updatedById: userId,
      },
    });

    if (dto.participantIds !== undefined) {
      await this.setParticipants(orgId, id, dto.participantIds as string[]);
    }
    this.activity.record({
      organizationId: orgId,
      entityType: 'hr-training',
      entityId: id,
      actorId: userId,
      verb: dto.status !== undefined && dto.status !== current.status ? 'status_changed' : 'updated',
      data:
        dto.status !== undefined && dto.status !== current.status
          ? { from: current.status, to: dto.status }
          : undefined,
    });
    return this.get(orgId, id, true);
  }

  /** Every referenced employee must belong to the org (ids come from the client). */
  private async assertEmployees(orgId: string, employeeIds: string[]) {
    const ids = [...new Set(employeeIds)];
    if (!ids.length) return;
    const count = await this.prisma.employee.count({
      where: { id: { in: ids }, organizationId: orgId, deletedAt: null },
    });
    if (count !== ids.length) throw new BadRequestException('Unknown employee in participants');
  }

  /** Reconcile the attendance list with the given employee ids. */
  async setParticipants(orgId: string, trainingId: string, employeeIds: string[]) {
    await this.assert(orgId, trainingId);
    await this.assertEmployees(orgId, employeeIds);
    const existing = await this.prisma.trainingParticipant.findMany({ where: { trainingId } });
    const existingIds = new Set(existing.map((p) => p.employeeId));
    const target = new Set(employeeIds);
    const toAdd = employeeIds.filter((id) => !existingIds.has(id));
    const toRemove = existing.filter((p) => !target.has(p.employeeId)).map((p) => p.id);
    await this.prisma.$transaction([
      ...(toRemove.length
        ? [this.prisma.trainingParticipant.deleteMany({ where: { id: { in: toRemove } } })]
        : []),
      ...(toAdd.length
        ? [
            this.prisma.trainingParticipant.createMany({
              data: toAdd.map((employeeId) => ({ trainingId, employeeId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
    if (toAdd.length) await this.notifyAssigned(orgId, trainingId, toAdd);
    return { participants: employeeIds.length };
  }

  /** Notify newly-added participants who are also login users. */
  private async notifyAssigned(orgId: string, trainingId: string, employeeIds: string[]) {
    const [training, employees] = await Promise.all([
      this.prisma.hrTraining.findUnique({ where: { id: trainingId }, select: { code: true, theme: true, startDate: true } }),
      this.prisma.employee.findMany({
        where: { id: { in: employeeIds }, userId: { not: null } },
        select: { userId: true },
      }),
    ]);
    const userIds = employees.map((e) => e.userId!).filter(Boolean);
    if (!training || !userIds.length) return;
    await this.notifications.notify({
      organizationId: orgId,
      userIds,
      type: 'hr_training_assigned',
      title: `${training.code} — ${training.theme}`,
      body: training.startDate
        ? `Vous êtes inscrit(e) à cette formation (${training.startDate.toLocaleDateString()}).`
        : 'Vous êtes inscrit(e) à cette formation.',
      entityType: 'hr-training', entityId: trainingId, link: `/hr/trainings/${trainingId}`,
    });
  }

  async setPresence(orgId: string, trainingId: string, participantId: string, present: boolean) {
    await this.assert(orgId, trainingId);
    await this.prisma.trainingParticipant.updateMany({
      where: { id: participantId, trainingId },
      data: { present },
    });
    return { updated: true };
  }

  async remove(orgId: string, userId: string, id: string) {
    await this.assert(orgId, id);
    await this.prisma.hrTraining.update({ where: { id }, data: { deletedAt: new Date() } });
    this.activity.record({
      organizationId: orgId,
      entityType: 'hr-training',
      entityId: id,
      actorId: userId,
      verb: 'deleted',
    });
    return { deleted: true };
  }

  // ── public feedback (à chaud / à froid) ──────────────────────────────────
  /**
   * Share links are not eternal: a feedback form closes PUBLIC_FEEDBACK_TTL_DAYS
   * (default 365) after the training ended (or was created) and when the
   * training is cancelled.
   */
  private assertPublicLinkOpen(t: { status: string; endDate: Date | null; startDate: Date | null; createdAt: Date }) {
    if (t.status === 'CANCELLED') throw new NotFoundException('Formulaire indisponible');
    const ttlDays = Number(process.env.PUBLIC_FEEDBACK_TTL_DAYS ?? 365);
    const anchor = t.endDate ?? t.startDate ?? t.createdAt;
    if (Date.now() - anchor.getTime() > ttlDays * 86400000) {
      throw new NotFoundException('Formulaire expiré');
    }
  }

  async publicTraining(token: string) {
    const training = await this.prisma.hrTraining.findFirst({
      where: { OR: [{ hotToken: token }, { coldToken: token }], deletedAt: null },
      select: { id: true, code: true, theme: true, hotToken: true, startDate: true, endDate: true, status: true, createdAt: true },
    });
    if (!training) throw new NotFoundException('Formulaire indisponible');
    this.assertPublicLinkOpen(training);
    const evaluationType = training.hotToken === token ? 'HOT' : 'COLD';
    return {
      code: training.code,
      theme: training.theme,
      startDate: training.startDate,
      endDate: training.endDate,
      evaluationType,
    };
  }

  async publicRespond(token: string, dto: Record<string, unknown>) {
    const training = await this.prisma.hrTraining.findFirst({
      where: { OR: [{ hotToken: token }, { coldToken: token }], deletedAt: null },
    });
    if (!training) throw new NotFoundException('Formulaire indisponible');
    this.assertPublicLinkOpen(training);
    const evaluationType = training.hotToken === token ? 'HOT' : 'COLD';
    await this.prisma.trainingFeedback.create({
      data: {
        organizationId: training.organizationId,
        trainingId: training.id,
        evaluationType,
        satisfactionScore: dto.satisfactionScore as number,
        answers: (dto.answers as Prisma.InputJsonValue) ?? {},
        respondentName: ((dto.respondentName as string) ?? '').trim().slice(0, 200) || null,
      },
    });
    return { ok: true };
  }

  // ── training evaluation dashboard ─────────────────────────────────────────
  async dashboard(orgId: string, departmentId?: string) {
    const trainings = await this.prisma.hrTraining.findMany({
      where: { organizationId: orgId, deletedAt: null, ...(departmentId ? { departmentId } : {}) },
      include: {
        feedback: { select: { evaluationType: true, satisfactionScore: true } },
        _count: { select: { participants: true } },
      },
      orderBy: { startDate: 'desc' },
    });
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let totalResponses = 0;
    let totalParticipants = 0;
    const perTraining = trainings.map((t) => {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      byType[t.type] = (byType[t.type] ?? 0) + 1;
      totalResponses += t.feedback.length;
      totalParticipants += t._count.participants;
      const summary = this.summariseFeedback(t.feedback);
      const all = t.feedback.length
        ? Math.round((t.feedback.reduce((s, f) => s + f.satisfactionScore, 0) / t.feedback.length) * 10) / 10
        : null;
      return {
        id: t.id,
        code: t.code,
        theme: t.theme,
        type: t.type,
        status: t.status,
        participantCount: t._count.participants,
        responseCount: t.feedback.length,
        avgScore: all,
        satisfactionRate: all != null ? Math.round((all / 5) * 100) : null,
        hot: summary.hot,
        cold: summary.cold,
      };
    });
    const rated = perTraining.filter((t) => t.satisfactionRate != null);
    const overallRate = rated.length
      ? Math.round(rated.reduce((s, t) => s + (t.satisfactionRate ?? 0), 0) / rated.length)
      : null;
    return {
      trainingCount: trainings.length,
      completed: byStatus.COMPLETED ?? 0,
      planned: byStatus.PLANNED ?? 0,
      totalParticipants,
      totalResponses,
      overallRate,
      byStatus,
      byType,
      perTraining,
    };
  }
}
