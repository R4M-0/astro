import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JourneyItemKind, JourneyKind, Prisma, TrialDecision } from '@prisma/client';
import { assertMembers } from '../../common/assert-members';
import { assertInOrg } from '../../common/assert-in-org';
import { paginate, PaginationQuery } from '../../common/dto/pagination.dto';
import { ActivityService } from '../../core/activity/activity.service';
import { unscoped } from '../../core/department-scope/department-scope';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { EsignService, type ESignCredentials } from '../../core/signatures/esign.service';
import { MemberAdminService } from '../../core/users/member-admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { JourneyQuery } from './dto/journeys.dto';

const DAY = 86_400_000;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

/** Offboarding steps added to every new departure plan (editable afterwards). */
const OFFBOARDING_DEFAULT_TASKS = [
  'Entretien de sortie',
  'Transfert des connaissances et des dossiers en cours',
  'Restitution du matériel (badge, clés, ordinateur, EPI)',
  'Solde de tout compte et documents de fin de contrat',
];

/**
 * Records a departing person may own, reassigned by the offboarding handover. Each entry is one
 * user-id column; `open` excludes finished records (only live work is handed over).
 */
interface HandoverCategory {
  key: string;
  delegate: string;
  field: string;
  softDelete: boolean;
  open?: Record<string, unknown>;
}
export const HANDOVER_CATEGORIES: HandoverCategory[] = [
  { key: 'journeys', delegate: 'employeeJourney', field: 'ownerId', softDelete: true, open: { status: 'IN_PROGRESS' } },
];

type Delegate = {
  count: (args: unknown) => Promise<number>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
};

const JOURNEY_INCLUDE = {
  employee: {
    select: {
      id: true, reference: true, firstName: true, lastName: true, jobTitle: true, departmentId: true,
      userId: true, hireDate: true, contractType: true, trialEndDate: true, exitDate: true, active: true,
    },
  },
  buddy: { select: { id: true, firstName: true, lastName: true, jobTitle: true } },
  items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.EmployeeJourneyInclude;

type JourneyWithItems = Prisma.EmployeeJourneyGetPayload<{ include: typeof JOURNEY_INCLUDE }>;

export interface ItemState {
  done: boolean;
  /** satisfied by the linked record (training attendance) */
  auto: boolean;
  completedAt: Date | null;
  overdue: boolean;
}

@Injectable()
export class JourneysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
    private readonly esign: EsignService,
    private readonly members: MemberAdminService,
  ) {}

  private async nextReference(orgId: string, kind: JourneyKind) {
    const prefix = kind === 'ONBOARDING' ? 'ONB' : 'OFF';
    const count = await unscoped(() => this.prisma.employeeJourney.count({ where: { organizationId: orgId, kind } }));
    return `${prefix}-${String(count + 1).padStart(4, '0')}`;
  }

  // ── computed checklist state ────────────────────────────────────────────
  /**
   * Item states from the real records: a training is done once the employee attended a completed
   * session. A manual tick (`doneAt`) always counts (TASK, or an override).
   */
  async itemStates(orgId: string, journeys: JourneyWithItems[]): Promise<Map<string, ItemState>> {
    const items = journeys.flatMap((j) => j.items.map((i) => ({ ...i, employeeId: j.employeeId })));
    const trainingIds = [...new Set(items.map((i) => i.trainingId).filter((d): d is string => !!d))];

    // whole-org read: the plan's trainings may sit in another department
    const trainings = trainingIds.length
      ? await unscoped(() =>
          this.prisma.hrTraining.findMany({
            where: { id: { in: trainingIds }, organizationId: orgId },
            select: { id: true, status: true, endDate: true, participants: { select: { employeeId: true, present: true } } },
          }),
        )
      : [];

    const now = Date.now();
    const states = new Map<string, ItemState>();
    for (const item of items) {
      let autoAt: Date | null = null;
      if (item.kind === 'TRAINING' && item.trainingId) {
        const t = trainings.find((x) => x.id === item.trainingId);
        const attended = t?.participants.some((p) => p.employeeId === item.employeeId && p.present);
        if (t && t.status === 'COMPLETED' && attended) autoAt = t.endDate ?? new Date(now);
      }
      const completedAt = item.doneAt ?? autoAt;
      states.set(item.id, {
        done: !!completedAt,
        auto: !item.doneAt && !!autoAt,
        completedAt,
        overdue: !completedAt && !!item.dueDate && item.dueDate.getTime() < now,
      });
    }
    return states;
  }

  private decorate(j: JourneyWithItems, states: Map<string, ItemState>) {
    const items = j.items.map((i) => ({ ...i, state: states.get(i.id)! }));
    const done = items.filter((i) => i.state.done).length;
    return {
      ...j,
      items,
      progress: { done, total: items.length, pct: items.length ? Math.round((done / items.length) * 100) : 0, overdue: items.filter((i) => i.state.overdue).length },
    };
  }

  // ── reads ───────────────────────────────────────────────────────────────
  async list(orgId: string, q: JourneyQuery) {
    const where: Prisma.EmployeeJourneyWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      ...(q.kind ? { kind: q.kind as JourneyKind } : {}),
      ...(q.status ? { status: q.status as Prisma.EmployeeJourneyWhereInput['status'] } : {}),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      employee: {
        deletedAt: null,
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(q.search
          ? {
              OR: [
                { firstName: { contains: q.search, mode: 'insensitive' } },
                { lastName: { contains: q.search, mode: 'insensitive' } },
                { reference: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    };
    const [rows, total] = await Promise.all([
      this.prisma.employeeJourney.findMany({
        where,
        orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
        skip: q.skip,
        take: q.pageSize,
        include: JOURNEY_INCLUDE,
      }),
      this.prisma.employeeJourney.count({ where }),
    ]);
    const states = await this.itemStates(orgId, rows);
    const decorated = rows.map((r) => {
      const { items: _items, ...rest } = this.decorate(r, states);
      return rest;
    });
    return paginate(decorated, total, q as unknown as PaginationQuery);
  }

  private async load(orgId: string, id: string) {
    const j = await this.prisma.employeeJourney.findFirst({ where: { id, organizationId: orgId, deletedAt: null }, include: JOURNEY_INCLUDE });
    if (!j) throw new NotFoundException('Parcours introuvable');
    return j;
  }

  async get(orgId: string, id: string) {
    const j = await this.load(orgId, id);
    const states = await this.itemStates(orgId, [j]);
    const decorated = this.decorate(j, states);
    // labels of the linked trainings for display (whole org: links may cross departments)
    const trainings = await unscoped(() =>
      this.prisma.hrTraining.findMany({
        where: { id: { in: j.items.map((i) => i.trainingId).filter((x): x is string => !!x) }, organizationId: orgId },
        select: { id: true, code: true, theme: true, status: true, startDate: true },
      }),
    );
    const trialSignature = j.trialSignature ? this.esignView(j) : null;
    return {
      ...decorated,
      trialSignature: undefined,
      trialSignatureView: trialSignature,
      linked: { trainings },
    };
  }

  private esignView(j: JourneyWithItems) {
    try {
      const rec = JSON.parse(j.trialSignature!);
      return { signer: rec.signer ?? null, signedAt: rec.signedAt ?? null };
    } catch {
      return null;
    }
  }

  // ── create / update ─────────────────────────────────────────────────────
  async create(orgId: string, userId: string, dto: Record<string, unknown>) {
    const kind = dto.kind as JourneyKind;
    const employeeId = dto.employeeId as string;
    await assertInOrg(this.prisma, orgId, 'employee', [employeeId, dto.buddyId as string | undefined]);
    await assertMembers(this.prisma, orgId, [dto.ownerId as string | undefined]);
    if (dto.buddyId && dto.buddyId === employeeId) throw new BadRequestException('Le parrain doit être une autre personne');
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, organizationId: orgId, deletedAt: null },
      include: {
        assignments: { include: { jobDescription: { include: { onboardingItems: { orderBy: { sortOrder: 'asc' } } } } } },
      },
    });
    if (!employee) throw new NotFoundException('Collaborateur introuvable');
    const open = await this.prisma.employeeJourney.count({
      where: { organizationId: orgId, employeeId, kind, status: 'IN_PROGRESS', deletedAt: null },
    });
    if (open) throw new BadRequestException(kind === 'ONBOARDING' ? 'Un parcours d’intégration est déjà en cours pour ce collaborateur' : 'Un parcours de départ est déjà en cours pour ce collaborateur');

    const startDate = dto.startDate ? new Date(dto.startDate as string) : kind === 'ONBOARDING' ? (employee.hireDate ?? new Date()) : new Date();
    const jd = employee.assignments[0]?.jobDescription ?? null;
    let targetDate = dto.targetDate ? new Date(dto.targetDate as string) : null;
    if (!targetDate && kind === 'ONBOARDING') {
      targetDate = employee.trialEndDate ?? (jd?.trialPeriodDays ? addDays(startDate, jd.trialPeriodDays) : null);
    }
    if (!targetDate && kind === 'OFFBOARDING') targetDate = employee.exitDate;
    if (targetDate && targetDate < startDate) throw new BadRequestException('La date cible doit suivre la date de début');

    const items: Prisma.EmployeeJourneyItemCreateWithoutJourneyInput[] =
      kind === 'ONBOARDING'
        ? (jd?.onboardingItems ?? []).map((t, idx) => ({
            kind: t.kind,
            label: t.label,
            dueDate: addDays(startDate, t.dueDays),
            sortOrder: idx,
          }))
        : OFFBOARDING_DEFAULT_TASKS.map((label, idx) => ({ kind: 'TASK' as JourneyItemKind, label, dueDate: targetDate, sortOrder: idx }));

    const reference = await this.nextReference(orgId, kind);
    const journey = await this.prisma.employeeJourney.create({
      data: {
        organizationId: orgId,
        reference,
        kind,
        employeeId,
        startDate,
        targetDate,
        ownerId: (dto.ownerId as string) || userId,
        buddyId: kind === 'ONBOARDING' ? (dto.buddyId as string) || null : null,
        notes: (dto.notes as string) || null,
        exitReason: kind === 'OFFBOARDING' ? (dto.exitReason as string) || null : null,
        createdById: userId,
        items: { create: items },
      },
    });
    // keep the employee record in step with the plan
    if (kind === 'ONBOARDING' && targetDate && !employee.trialEndDate) {
      await this.prisma.employee.update({ where: { id: employeeId }, data: { trialEndDate: targetDate } });
    }
    if (kind === 'OFFBOARDING') {
      await this.prisma.employee.update({
        where: { id: employeeId },
        data: { exitDate: targetDate ?? employee.exitDate, exitReason: (dto.exitReason as string) || employee.exitReason },
      });
    }

    this.activity.record({ organizationId: orgId, entityType: 'employee-journey', entityId: journey.id, actorId: userId, verb: 'created', data: { reference } });
    this.activity.record({ organizationId: orgId, entityType: 'employee', entityId: employeeId, actorId: userId, verb: kind === 'ONBOARDING' ? 'onboarding_started' : 'offboarding_started', data: { reference } });
    if (kind === 'ONBOARDING') {
      const buddy = journey.buddyId ? await unscoped(() => this.prisma.employee.findFirst({ where: { id: journey.buddyId!, organizationId: orgId }, select: { userId: true } })) : null;
      await this.notifications.notify({
        organizationId: orgId,
        userIds: [employee.userId, buddy?.userId, journey.ownerId !== userId ? journey.ownerId : null].filter((u): u is string => !!u),
        type: 'onboarding_assigned',
        title: `Parcours d’intégration ${reference}`,
        body: `${employee.firstName} ${employee.lastName} — ${items.length} étape(s) à suivre`,
        entityType: 'employee-journey',
        entityId: journey.id,
        link: `/hr/journeys/${journey.id}`,
      });
    }
    return this.get(orgId, journey.id);
  }

  private assertOpen(j: { status: string }) {
    if (j.status !== 'IN_PROGRESS') throw new BadRequestException('Ce parcours est clôturé');
  }

  async update(orgId: string, userId: string, id: string, dto: Record<string, unknown>) {
    const j = await this.load(orgId, id);
    await assertInOrg(this.prisma, orgId, 'employee', [dto.buddyId as string | undefined]);
    await assertMembers(this.prisma, orgId, [dto.ownerId as string | undefined]);
    if (dto.buddyId && dto.buddyId === j.employeeId) throw new BadRequestException('Le parrain doit être une autre personne');
    if (dto.status !== undefined) {
      // cancel, or reopen a cancelled/completed plan; completion goes through its guarded endpoint
      if (dto.status === 'COMPLETED') throw new BadRequestException('Utilisez la clôture du parcours');
    }
    const startDate = dto.startDate ? new Date(dto.startDate as string) : j.startDate;
    const targetDate = dto.targetDate !== undefined ? (dto.targetDate ? new Date(dto.targetDate as string) : null) : j.targetDate;
    if (targetDate && targetDate < startDate) throw new BadRequestException('La date cible doit suivre la date de début');
    await this.prisma.employeeJourney.update({
      where: { id },
      data: {
        ...(dto.startDate ? { startDate } : {}),
        ...(dto.targetDate !== undefined ? { targetDate } : {}),
        ...(dto.ownerId !== undefined ? { ownerId: (dto.ownerId as string) || null } : {}),
        ...(dto.buddyId !== undefined ? { buddyId: (dto.buddyId as string) || null } : {}),
        ...(dto.notes !== undefined ? { notes: (dto.notes as string) || null } : {}),
        ...(dto.exitReason !== undefined ? { exitReason: (dto.exitReason as string) || null } : {}),
        ...(dto.status !== undefined
          ? { status: dto.status as 'IN_PROGRESS' | 'CANCELLED', completedAt: null }
          : {}),
        updatedById: userId,
      },
    });
    if (j.kind === 'OFFBOARDING' && (dto.targetDate !== undefined || dto.exitReason !== undefined)) {
      await this.prisma.employee.update({
        where: { id: j.employeeId },
        data: {
          ...(dto.targetDate !== undefined ? { exitDate: targetDate } : {}),
          ...(dto.exitReason !== undefined ? { exitReason: (dto.exitReason as string) || null } : {}),
        },
      });
    }
    return this.get(orgId, id);
  }

  async remove(orgId: string, userId: string, id: string) {
    await this.load(orgId, id);
    await this.prisma.employeeJourney.update({ where: { id }, data: { deletedAt: new Date(), updatedById: userId } });
    return { deleted: true };
  }

  // ── items ───────────────────────────────────────────────────────────────
  private async assertLinks(orgId: string, dto: Record<string, unknown>) {
    if (!dto.trainingId) return;
    const training = await unscoped(() =>
      this.prisma.hrTraining.count({ where: { id: dto.trainingId as string, organizationId: orgId, deletedAt: null } }),
    );
    if (!training) throw new BadRequestException('Formation inconnue');
  }

  /** A training item puts the employee on the session's attendance list. */
  private async enrollTraining(orgId: string, employeeId: string, trainingId: string | null | undefined) {
    if (!trainingId) return;
    await unscoped(() =>
      this.prisma.trainingParticipant.upsert({
        where: { trainingId_employeeId: { trainingId, employeeId } },
        create: { trainingId, employeeId, present: false },
        update: {},
      }),
    );
  }

  async addItem(orgId: string, userId: string, id: string, dto: Record<string, unknown>) {
    const j = await this.load(orgId, id);
    this.assertOpen(j);
    await this.assertLinks(orgId, dto);
    const item = await this.prisma.employeeJourneyItem.create({
      data: {
        journeyId: id,
        kind: dto.kind as JourneyItemKind,
        label: dto.label as string,
        trainingId: (dto.trainingId as string) || null,
        dueDate: dto.dueDate ? new Date(dto.dueDate as string) : null,
        sortOrder: j.items.length,
      },
    });
    await this.enrollTraining(orgId, j.employeeId, item.trainingId);
    await this.prisma.employeeJourney.update({ where: { id }, data: { updatedById: userId } });
    return this.get(orgId, id);
  }

  private async loadItem(orgId: string, id: string, itemId: string) {
    const j = await this.load(orgId, id);
    const item = j.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Étape introuvable');
    return { j, item };
  }

  async updateItem(orgId: string, userId: string, id: string, itemId: string, dto: Record<string, unknown>) {
    const { j } = await this.loadItem(orgId, id, itemId);
    this.assertOpen(j);
    await this.assertLinks(orgId, dto);
    const item = await this.prisma.employeeJourneyItem.update({
      where: { id: itemId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label as string } : {}),
        ...(dto.trainingId !== undefined ? { trainingId: (dto.trainingId as string) || null } : {}),
        ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? new Date(dto.dueDate as string) : null } : {}),
      },
    });
    if (dto.trainingId) await this.enrollTraining(orgId, j.employeeId, item.trainingId);
    await this.prisma.employeeJourney.update({ where: { id }, data: { updatedById: userId } });
    return this.get(orgId, id);
  }

  async toggleItem(orgId: string, userId: string, id: string, itemId: string, done: boolean) {
    const { j } = await this.loadItem(orgId, id, itemId);
    this.assertOpen(j);
    await this.prisma.employeeJourneyItem.update({
      where: { id: itemId },
      data: done ? { doneAt: new Date(), doneById: userId } : { doneAt: null, doneById: null },
    });
    return this.get(orgId, id);
  }

  async removeItem(orgId: string, id: string, itemId: string) {
    const { j } = await this.loadItem(orgId, id, itemId);
    this.assertOpen(j);
    await this.prisma.employeeJourneyItem.delete({ where: { id: itemId } });
    return this.get(orgId, id);
  }

  // ── end of trial period (onboarding) ───────────────────────────────────
  async trialSignOff(
    orgId: string,
    userId: string,
    id: string,
    dto: { decision: TrialDecision; comment?: string; extendedUntil?: string; esign?: ESignCredentials },
  ) {
    const j = await this.load(orgId, id);
    if (j.kind !== 'ONBOARDING') throw new BadRequestException('Réservé aux parcours d’intégration');
    this.assertOpen(j);
    // separation of duties: the employee never confirms their own trial period
    if (j.employee.userId && j.employee.userId === userId) throw new ForbiddenException('Vous ne pouvez pas valider votre propre période d’essai');
    if (dto.decision !== 'CONFIRMED' && !dto.comment?.trim()) throw new BadRequestException('Un commentaire est requis pour une prolongation ou une fin de période d’essai');
    const extendedUntil = dto.decision === 'EXTENDED' ? (dto.extendedUntil ? new Date(dto.extendedUntil) : null) : null;
    if (dto.decision === 'EXTENDED' && (!extendedUntil || (j.targetDate && extendedUntil <= j.targetDate))) {
      throw new BadRequestException('Indiquez la nouvelle fin de période d’essai (postérieure à l’actuelle)');
    }
    const signedAt = new Date();
    const { serialized } = await this.esign.sign({
      orgId,
      userId,
      entityType: 'employee-journey',
      entityId: id,
      scope: `trial:${dto.decision}`,
      content: { employeeId: j.employeeId, decision: dto.decision, comment: dto.comment ?? null, extendedUntil: extendedUntil?.toISOString() ?? null },
      credentials: dto.esign,
      signedAt,
    });
    const closes = dto.decision !== 'EXTENDED';
    await this.prisma.employeeJourney.update({
      where: { id },
      data: {
        trialDecision: dto.decision,
        trialComment: dto.comment?.trim() || null,
        trialSignedAt: signedAt,
        trialSignedById: userId,
        trialSignature: serialized,
        ...(extendedUntil ? { targetDate: extendedUntil } : {}),
        ...(closes ? { status: 'COMPLETED', completedAt: signedAt } : {}),
        updatedById: userId,
      },
    });
    if (extendedUntil) await this.prisma.employee.update({ where: { id: j.employeeId }, data: { trialEndDate: extendedUntil } });
    this.activity.record({ organizationId: orgId, entityType: 'employee-journey', entityId: id, actorId: userId, verb: 'trial_signed_off', data: { decision: dto.decision } });
    return this.get(orgId, id);
  }

  // ── onboarding template (per job description) ──────────────────────────
  async templateItems(orgId: string, jobDescriptionId: string) {
    const jd = await this.prisma.jobDescription.findFirst({
      where: { id: jobDescriptionId, organizationId: orgId, deletedAt: null },
      select: { id: true, trialPeriodDays: true, onboardingItems: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!jd) throw new NotFoundException('Fiche de poste introuvable');
    return { trialPeriodDays: jd.trialPeriodDays, items: jd.onboardingItems };
  }

  /** Replaces the job description's onboarding checklist (existing plans keep their copy). */
  async setTemplateItems(
    orgId: string,
    jobDescriptionId: string,
    dto: { trialPeriodDays?: number | null; items: Record<string, unknown>[] },
  ) {
    const jd = await this.prisma.jobDescription.findFirst({ where: { id: jobDescriptionId, organizationId: orgId, deletedAt: null }, select: { id: true } });
    if (!jd) throw new NotFoundException('Fiche de poste introuvable');
    for (const item of dto.items) await this.assertLinks(orgId, item);
    await this.prisma.$transaction([
      this.prisma.onboardingTemplateItem.deleteMany({ where: { jobDescriptionId } }),
      this.prisma.onboardingTemplateItem.createMany({
        data: dto.items.map((i, idx) => ({
          organizationId: orgId,
          jobDescriptionId,
          kind: i.kind as JourneyItemKind,
          label: i.label as string,
          dueDays: (i.dueDays as number) ?? 30,
          sortOrder: idx,
        })),
      }),
      ...(dto.trialPeriodDays !== undefined
        ? [this.prisma.jobDescription.update({ where: { id: jobDescriptionId }, data: { trialPeriodDays: dto.trialPeriodDays } })]
        : []),
    ]);
    return this.templateItems(orgId, jobDescriptionId);
  }

  // ── offboarding ─────────────────────────────────────────────────────────
  private async offboarding(orgId: string, id: string) {
    const j = await this.load(orgId, id);
    if (j.kind !== 'OFFBOARDING') throw new BadRequestException('Réservé aux parcours de départ');
    return j;
  }

  private categoryWhere(orgId: string, c: HandoverCategory, userId: string) {
    return {
      [c.field]: userId,
      organizationId: orgId,
      ...(c.softDelete ? { deletedAt: null } : {}),
      ...(c.open ?? {}),
    };
  }

  /** Open records the departing person owns, per category (whole organization). */
  async handoverPreview(orgId: string, id: string) {
    const j = await this.offboarding(orgId, id);
    const userId = j.employee.userId;
    if (!userId) return { userId: null, membership: null, categories: [] };
    const counts = await unscoped(() =>
      Promise.all(
        HANDOVER_CATEGORIES.map((c) =>
          ((this.prisma as unknown as Record<string, Delegate>)[c.delegate]).count({ where: this.categoryWhere(orgId, c, userId) }),
        ),
      ),
    );
    const membership = await this.prisma.membership.findFirst({
      where: { organizationId: orgId, userId, deletedAt: null },
      select: { id: true, isActive: true, deactivatedAt: true },
    });
    return {
      userId,
      membership,
      categories: HANDOVER_CATEGORIES.map((c, i) => ({ key: c.key, count: counts[i] })),
    };
  }

  async handover(orgId: string, actorId: string, id: string, dto: { toUserId: string; categories: string[] }) {
    const j = await this.offboarding(orgId, id);
    this.assertOpen(j);
    const fromUserId = j.employee.userId;
    if (!fromUserId) throw new BadRequestException('Ce collaborateur n’a pas de compte Astro : rien à transférer');
    if (dto.toUserId === fromUserId) throw new BadRequestException('Choisissez une autre personne');
    await assertMembers(this.prisma, orgId, [dto.toUserId]);
    const selected = HANDOVER_CATEGORIES.filter((c) => dto.categories.includes(c.key));
    if (!selected.length) throw new BadRequestException('Sélectionnez au moins une catégorie');

    const summary: Record<string, number> = { ...((j.handoverSummary as Record<string, number> | null) ?? {}) };
    await unscoped(async () => {
      for (const c of selected) {
        const delegate = (this.prisma as unknown as Record<string, Delegate>)[c.delegate];
        const where = this.categoryWhere(orgId, c, fromUserId);
        const res = await delegate.updateMany({ where, data: { [c.field]: dto.toUserId } });
        summary[c.key] = (summary[c.key] ?? 0) + res.count;
      }
    });
    const total = selected.reduce((n, c) => n + (summary[c.key] ?? 0), 0);
    await this.prisma.employeeJourney.update({
      where: { id },
      data: { handoverToUserId: dto.toUserId, handoverAt: new Date(), handoverSummary: summary, updatedById: actorId },
    });
    this.activity.record({ organizationId: orgId, entityType: 'employee-journey', entityId: id, actorId, verb: 'handover', data: { toUserId: dto.toUserId, summary } });
    await this.notifications.notify({
      organizationId: orgId,
      userIds: [dto.toUserId],
      type: 'handover_received',
      title: `Reprise des dossiers de ${j.employee.firstName} ${j.employee.lastName}`,
      body: `${total} élément(s) vous ont été transférés`,
      entityType: 'employee-journey',
      entityId: id,
      link: `/hr/journeys/${id}`,
    });
    return this.get(orgId, id);
  }

  /** Deactivates the departing person's membership (sessions revoked) — `users:admin` only. */
  async deactivateAccount(orgId: string, actorId: string, id: string) {
    const j = await this.offboarding(orgId, id);
    if (!j.employee.userId) throw new BadRequestException('Ce collaborateur n’a pas de compte Astro');
    const membership = await this.prisma.membership.findFirst({
      where: { organizationId: orgId, userId: j.employee.userId, deletedAt: null },
      select: { id: true },
    });
    if (!membership) throw new BadRequestException('Aucun accès à cette organisation');
    await this.members.setStatus(orgId, actorId, membership.id, false);
    await this.prisma.employeeJourney.update({ where: { id }, data: { accountDeactivatedAt: new Date(), updatedById: actorId } });
    this.activity.record({ organizationId: orgId, entityType: 'employee-journey', entityId: id, actorId, verb: 'account_deactivated' });
    return this.get(orgId, id);
  }

  /** Closes a departure: the employee becomes inactive (kept for records). */
  async completeOffboarding(orgId: string, actorId: string, id: string) {
    const j = await this.offboarding(orgId, id);
    this.assertOpen(j);
    const now = new Date();
    await this.prisma.employeeJourney.update({ where: { id }, data: { status: 'COMPLETED', completedAt: now, updatedById: actorId } });
    await this.prisma.employee.update({
      where: { id: j.employeeId },
      data: { active: false, exitDate: j.targetDate ?? j.employee.exitDate ?? now, updatedById: actorId },
    });
    this.activity.record({ organizationId: orgId, entityType: 'employee-journey', entityId: id, actorId, verb: 'completed' });
    return this.get(orgId, id);
  }
}
