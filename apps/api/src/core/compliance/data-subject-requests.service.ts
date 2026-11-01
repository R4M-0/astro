import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSubjectType, DsrStatus, DsrType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { unscoped } from '../department-scope/department-scope';
import { AnonymizerService } from './anonymizer.service';

const DAY = 86_400_000;
/** GDPR Art. 12(3): one month from receipt. */
export const DSR_DUE_DAYS = 30;

export interface CreateDsr {
  type: DsrType;
  subjectType: DataSubjectType;
  subjectId: string;
  requesterEmail?: string;
  channel?: string;
  notes?: string;
  receivedAt?: string;
}

/** Internal columns that are never part of a subject export (secrets, bearer tokens). */
const NEVER_EXPORT = new Set(['inviteToken', 'trialSignature', 'respondentKey', 'passwordHash', 'twoFactorSecret', 'recoveryCodes']);
const clean = <T extends object>(row: T | null | undefined) =>
  row ? Object.fromEntries(Object.entries(row).filter(([k]) => !NEVER_EXPORT.has(k))) : null;

@Injectable()
export class DataSubjectRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anonymizer: AnonymizerService,
  ) {}

  async list(orgId: string, status?: DsrStatus) {
    return this.prisma.dataSubjectRequest.findMany({
      where: { organizationId: orgId, deletedAt: null, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    });
  }

  async get(orgId: string, id: string) {
    const dsr = await this.prisma.dataSubjectRequest.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!dsr) throw new NotFoundException('Demande introuvable');
    const hold = await this.anonymizer.activeHold(orgId, dsr.subjectType, dsr.subjectId);
    return { ...dsr, overdue: dsr.status === 'OPEN' && dsr.dueAt < new Date(), legalHold: hold };
  }

  /** « EMP-0007 Lucas Martin » / « Candidat Jane Doe — Technicien » (display only). */
  async subjectLabel(orgId: string, type: DataSubjectType, id: string): Promise<string> {
    return unscoped(async () => {
      if (type === 'EMPLOYEE') {
        const e = await this.prisma.employee.findFirst({ where: { id, organizationId: orgId }, select: { reference: true, firstName: true, lastName: true } });
        if (!e) throw new NotFoundException('Collaborateur introuvable');
        return `${e.reference} ${e.firstName} ${e.lastName}`.trim();
      }
      const c = await this.prisma.candidate.findFirst({
        where: { id, organizationId: orgId },
        select: { fullName: true, email: true, jobOpening: { select: { title: true } } },
      });
      if (!c) throw new NotFoundException('Candidat introuvable');
      return `${c.fullName ?? c.email ?? `CAND-${id.slice(0, 8)}`} — ${c.jobOpening.title}`;
    });
  }

  private async nextReference(orgId: string) {
    const last = await this.prisma.dataSubjectRequest.findFirst({
      where: { organizationId: orgId },
      orderBy: { reference: 'desc' },
      select: { reference: true },
    });
    const n = last ? Number(last.reference.replace(/\D/g, '')) + 1 : 1;
    return `DSR-${String(n).padStart(4, '0')}`;
  }

  async create(orgId: string, actorId: string, dto: CreateDsr) {
    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime()) || receivedAt > new Date(Date.now() + 60_000)) {
      throw new BadRequestException('Date de réception invalide');
    }
    const subjectLabel = await this.subjectLabel(orgId, dto.subjectType, dto.subjectId);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.dataSubjectRequest.create({
          data: {
            organizationId: orgId,
            reference: await this.nextReference(orgId),
            type: dto.type,
            subjectType: dto.subjectType,
            subjectId: dto.subjectId,
            subjectLabel,
            requesterEmail: dto.requesterEmail?.trim() || null,
            channel: dto.channel?.trim() || null,
            notes: dto.notes?.trim() || null,
            receivedAt,
            dueAt: new Date(receivedAt.getTime() + DSR_DUE_DAYS * DAY),
            createdById: actorId,
          },
        });
      } catch (err) {
        // two requests created at once: the reference is taken, try the next one
        if (attempt < 3 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
  }

  private async open(orgId: string, id: string) {
    const dsr = await this.get(orgId, id);
    if (dsr.status !== 'OPEN') throw new ConflictException('Cette demande est déjà clôturée');
    return dsr;
  }

  async complete(orgId: string, actorId: string, id: string, resolution?: string) {
    const dsr = await this.open(orgId, id);
    if (dsr.type === 'ERASURE') throw new BadRequestException('Une demande d’effacement se clôture en exécutant l’effacement');
    return this.prisma.dataSubjectRequest.update({
      where: { id },
      data: { status: 'COMPLETED', resolution: resolution?.trim() || null, completedAt: new Date(), completedById: actorId, updatedById: actorId },
    });
  }

  async reject(orgId: string, actorId: string, id: string, resolution: string) {
    if (!resolution?.trim()) throw new BadRequestException('Le motif du refus est obligatoire');
    await this.open(orgId, id);
    return this.prisma.dataSubjectRequest.update({
      where: { id },
      data: { status: 'REJECTED', resolution: resolution.trim(), completedAt: new Date(), completedById: actorId, updatedById: actorId },
    });
  }

  /**
   * Executes an erasure request. Refused while a legal hold is active, or while the employment
   * contract still runs (the contract is a legal basis that overrides erasure, Art. 17(1)(b)).
   */
  async execute(orgId: string, actorId: string, id: string) {
    const dsr = await this.open(orgId, id);
    if (dsr.type !== 'ERASURE') throw new BadRequestException('Seule une demande d’effacement s’exécute');
    if (dsr.legalHold) throw new ConflictException('Gel juridique actif : effacement impossible tant qu’il n’est pas levé');
    if (dsr.subjectType === 'EMPLOYEE') {
      const emp = await unscoped(() =>
        this.prisma.employee.findFirst({ where: { id: dsr.subjectId, organizationId: orgId }, select: { active: true, exitDate: true, deletedAt: true } }),
      );
      if (!emp) throw new NotFoundException('Collaborateur introuvable');
      const contractRunning = !emp.deletedAt && (emp.active || (emp.exitDate && emp.exitDate > new Date()));
      if (contractRunning) {
        throw new ConflictException('Contrat de travail en cours : les données restent nécessaires (base légale). Clôturez le départ avant l’effacement.');
      }
    }
    const result = await this.anonymizer.anonymize(orgId, dsr.subjectType, dsr.subjectId, { actorId, reason: `request:${dsr.reference}` });
    return this.prisma.dataSubjectRequest.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        // the request record is the proof the right was honoured: it keeps the reference, never the name
        subjectLabel: result.subjectLabel,
        result: result as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
        completedById: actorId,
        updatedById: actorId,
      },
    });
  }

  /** Art. 15 / 20: everything Astro holds about the subject, machine-readable. */
  async export(orgId: string, id: string) {
    const dsr = await this.get(orgId, id);
    const data = await unscoped<Record<string, unknown>>(() =>
      dsr.subjectType === 'EMPLOYEE' ? this.employeeData(orgId, dsr.subjectId) : this.candidateData(orgId, dsr.subjectId),
    );
    const sections = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : v ? 1 : 0]));
    await this.prisma.dataSubjectRequest.update({
      where: { id },
      data: { result: { exportedAt: new Date().toISOString(), sections } as Prisma.InputJsonValue },
    });
    return {
      request: { reference: dsr.reference, type: dsr.type, receivedAt: dsr.receivedAt, dueAt: dsr.dueAt },
      generatedAt: new Date().toISOString(),
      controller: await this.prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
      subjectType: dsr.subjectType,
      data,
    };
  }

  private async accessLog(orgId: string, ids: string[]) {
    // who looked at / changed the file: the person has a right to know (bodies excluded)
    const rows = await this.prisma.auditLogEntry.findMany({
      where: { organizationId: orgId, entityId: { in: ids } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, action: true, actorId: true, entityType: true },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter(Boolean) as string[])] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const names = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    return rows.map((r) => ({ at: r.createdAt, action: r.action, record: r.entityType, by: r.actorId ? (names.get(r.actorId) ?? null) : 'system' }));
  }

  private async employeeData(orgId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id, organizationId: orgId } });
    if (!employee) throw new NotFoundException('Collaborateur introuvable');
    const [account, department, manager, assignment, evaluations, trainings, journeys, surveyResponses, attachments, history] = await Promise.all([
      employee.userId
        ? this.prisma.user.findUnique({ where: { id: employee.userId }, select: { email: true, firstName: true, lastName: true, locale: true, lastLoginAt: true, createdAt: true } })
        : null,
      employee.departmentId ? this.prisma.department.findUnique({ where: { id: employee.departmentId }, select: { name: true } }) : null,
      employee.managerId ? this.prisma.employee.findUnique({ where: { id: employee.managerId }, select: { reference: true, firstName: true, lastName: true } }) : null,
      this.prisma.jobAssignment.findFirst({ where: { employeeId: id }, include: { jobDescription: { select: { reference: true, jobTitle: true } } } }),
      this.prisma.competencyEvaluation.findMany({ where: { employeeId: id }, include: { skill: { select: { name: true } } } }),
      this.prisma.trainingParticipant.findMany({ where: { employeeId: id }, include: { training: { select: { code: true, theme: true, startDate: true, endDate: true, status: true } } } }),
      this.prisma.employeeJourney.findMany({ where: { employeeId: id, organizationId: orgId }, include: { items: true } }),
      this.prisma.hrSurveyResponse.findMany({ where: { employeeId: id, organizationId: orgId }, include: { answers: true, survey: { select: { reference: true, title: true } } } }),
      this.prisma.attachment.findMany({ where: { organizationId: orgId, entityId: id, deletedAt: null }, select: { fileName: true, mimeType: true, size: true, createdAt: true } }),
      this.prisma.historyEntry.findMany({ where: { organizationId: orgId, entityType: 'Employee', entityId: id }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, operation: true, changes: true } }),
    ]);
    return {
      employee: clean(employee),
      account,
      department,
      manager,
      jobAssignment: assignment,
      competencyEvaluations: evaluations,
      trainings,
      journeys: journeys.map(clean),
      surveyResponses: surveyResponses.map(clean),
      attachments,
      history,
      accessLog: await this.accessLog(orgId, [id, ...journeys.map((j) => j.id)]),
    };
  }

  private async candidateData(orgId: string, id: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id, organizationId: orgId },
      include: { jobOpening: { select: { title: true } }, slot: { select: { startsAt: true, durationMinutes: true, location: true } } },
    });
    if (!candidate) throw new NotFoundException('Candidat introuvable');
    const messages = await this.prisma.candidateMessage.findMany({
      where: { candidateId: id, organizationId: orgId, status: { in: ['SENT', 'RECEIVED'] } },
      orderBy: { createdAt: 'asc' },
      select: { direction: true, kind: true, subject: true, body: true, sentAt: true, createdAt: true },
    });
    return {
      candidate: clean(candidate),
      // ranking explanation: the criteria, scores and the CV quote behind each (AI Act transparency)
      messages,
      accessLog: await this.accessLog(orgId, [id]),
    };
  }
}
