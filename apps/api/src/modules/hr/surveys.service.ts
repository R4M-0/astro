import { createHash, createHmac, randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HrSurveyQuestionType, Prisma, SurveyScope } from '@prisma/client';
import { ActivityService } from '../../core/activity/activity.service';
import { paginate, PaginationQuery } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  HrSurveyOptionDto,
  HrSurveyQuery,
  MemberSurveyResponseDto,
  PublicSurveyResponseDto,
  UpdateHrSurveyQuestionDto,
  UpsertHrSurveyQuestionDto,
} from './dto/surveys.dto';

const CHOICE_TYPES: HrSurveyQuestionType[] = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'];
const TEXT_TYPES: HrSurveyQuestionType[] = ['SHORT_TEXT', 'LONG_TEXT'];
const TEXT_MAX = { SHORT_TEXT: 500, LONG_TEXT: 5000 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const questionInclude = {
  orderBy: { sortOrder: 'asc' as const },
  include: { options: { orderBy: { sortOrder: 'asc' as const } } },
};

type AnswerableQuestion = {
  id: string;
  type: HrSurveyQuestionType;
  label: string;
  required: boolean;
  scaleMin: number;
  scaleMax: number;
  options: { id: string }[];
};

type SurveyRow = { status: string; closesAt: Date | null; publicToken: string | null };

/** Per-register settings of the survey engine. */
const SCOPES: Record<SurveyScope, { prefix: string; activityType: string }> = {
  HR: { prefix: 'ENQ', activityType: 'hr-survey' },
};

@Injectable()
export class SurveysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly config: ConfigService,
  ) {}

  // ── helpers ────────────────────────────────────────────────────────────────
  private publicUrl(token: string | null) {
    if (!token) return null;
    const base = (this.config.get<string>('APP_URL') ?? '').replace(/\/+$/, '');
    return base ? `${base}/e/${token}` : null;
  }

  /** CLOSED, or PUBLISHED with a closing date in the past. */
  private isClosed(s: SurveyRow) {
    return s.status === 'CLOSED' || (s.closesAt != null && s.closesAt.getTime() <= Date.now());
  }

  /**
   * The share token is a bearer credential for answering: it is never sent to
   * plain readers, only the URL to those who manage the survey (hr-surveys:update).
   */
  private decorate<T extends SurveyRow>(s: T, canManage = false) {
    const { publicToken, ...rest } = s;
    return {
      ...rest,
      publicUrl: !canManage || s.status === 'DRAFT' ? null : this.publicUrl(publicToken),
      expired: s.status === 'PUBLISHED' && s.closesAt != null && s.closesAt.getTime() <= Date.now(),
    };
  }

  /** Anonymous results never expose the exact submission time (re-identification by timing). */
  private dayOf(d: Date) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  /** Keyed hash of a signed-in member — duplicate guard that cannot be recomputed from the DB alone. */
  private memberKey(surveyId: string, userId: string) {
    const secret =
      this.config.get<string>('APP_ENCRYPTION_KEY') || this.config.get<string>('JWT_ACCESS_SECRET') || 'astro';
    return createHmac('sha256', secret).update(`hr-survey:${surveyId}:member:${userId}`).digest('hex');
  }

  /** Keys that mean "this member already answered". */
  private memberKeys(_scope: SurveyScope, surveyId: string, userId: string) {
    return [this.memberKey(surveyId, userId)];
  }

  private async nextReference(scope: SurveyScope, orgId: string, offset = 0) {
    const count = await this.prisma.hrSurvey.count({ where: { organizationId: orgId, scope } });
    return `${SCOPES[scope].prefix}-${String(count + 1 + offset).padStart(4, '0')}`;
  }

  async assert(scope: SurveyScope, orgId: string, id: string) {
    const survey = await this.prisma.hrSurvey.findFirst({
      where: { id, organizationId: orgId, scope, deletedAt: null },
    });
    if (!survey) throw new NotFoundException('Enquête introuvable');
    return survey;
  }

  private async assertDraft(scope: SurveyScope, orgId: string, id: string) {
    const survey = await this.assert(scope, orgId, id);
    if (survey.status !== 'DRAFT') {
      throw new BadRequestException(
        "Les questions ne sont modifiables qu'à l'état brouillon. Repassez l'enquête en brouillon (possible tant qu'elle n'a reçu aucune réponse).",
      );
    }
    return survey;
  }

  private record(
    scope: SurveyScope,
    orgId: string,
    userId: string | null,
    id: string,
    verb: string,
    data?: Record<string, unknown>,
  ) {
    const entityType = SCOPES[scope].activityType;
    this.activity.record({ organizationId: orgId, entityType, entityId: id, actorId: userId, verb, data });
  }

  // ── surveys ────────────────────────────────────────────────────────────────
  async list(scope: SurveyScope, orgId: string, q: HrSurveyQuery, canManage = false) {
    const where: Prisma.HrSurveyWhereInput = {
      organizationId: orgId,
      scope,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      // drafts are only visible to those who can edit them
      ...(canManage ? {} : { NOT: { status: 'DRAFT' } }),
      ...(q.search
        ? {
            OR: [
              { reference: { contains: q.search, mode: 'insensitive' } },
              { title: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.hrSurvey.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
        include: { _count: { select: { questions: true, responses: true } } },
      }),
      this.prisma.hrSurvey.count({ where }),
    ]);
    const data = rows.map(({ _count, ...rest }) => ({
      ...this.decorate(rest, canManage),
      questionCount: _count.questions,
      responseCount: _count.responses,
    }));
    return paginate(data, total, q as unknown as PaginationQuery);
  }

  async get(scope: SurveyScope, orgId: string, id: string, canManage = false) {
    const survey = await this.prisma.hrSurvey.findFirst({
      where: { id, organizationId: orgId, scope, deletedAt: null, ...(canManage ? {} : { NOT: { status: 'DRAFT' } }) },
      include: { questions: questionInclude, _count: { select: { responses: true } } },
    });
    if (!survey) throw new NotFoundException('Enquête introuvable');
    const { _count, ...rest } = survey;
    return { ...this.decorate(rest, canManage), questionCount: rest.questions.length, responseCount: _count.responses };
  }

  async create(scope: SurveyScope, orgId: string, userId: string, dto: Record<string, unknown>) {
    const closesAt = dto.closesAt ? new Date(dto.closesAt as string) : null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const reference = await this.nextReference(scope, orgId, attempt);
      try {
        const survey = await this.prisma.hrSurvey.create({
          data: {
            organizationId: orgId,
            scope,
            reference,
            title: (dto.title as string).trim(),
            description: ((dto.description as string) ?? '').trim() || null,
            anonymous: (dto.anonymous as boolean) ?? true,
            allowMultipleResponses: (dto.allowMultipleResponses as boolean) ?? false,
            closesAt,
            createdById: userId,
          },
        });
        this.record(scope, orgId, userId, survey.id, 'created', { reference: survey.reference, title: survey.title });
        return this.get(scope, orgId, survey.id, true);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw new ConflictException('Impossible de générer une référence unique, réessayez');
  }

  async update(scope: SurveyScope, orgId: string, userId: string, id: string, dto: Record<string, unknown>) {
    const current = await this.assert(scope, orgId, id);
    const respondentRulesChange =
      (dto.anonymous !== undefined && dto.anonymous !== current.anonymous) ||
      (dto.allowMultipleResponses !== undefined && dto.allowMultipleResponses !== current.allowMultipleResponses);
    if (respondentRulesChange) {
      const responses = await this.prisma.hrSurveyResponse.count({ where: { surveyId: id } });
      if (responses > 0) {
        throw new BadRequestException(
          "L'anonymat et les réponses multiples ne peuvent plus être modifiés une fois des réponses reçues",
        );
      }
    }
    await this.prisma.hrSurvey.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: (dto.title as string).trim() } : {}),
        ...(dto.description !== undefined
          ? { description: ((dto.description as string | null) ?? '').trim() || null }
          : {}),
        ...(dto.anonymous !== undefined ? { anonymous: dto.anonymous as boolean } : {}),
        ...(dto.allowMultipleResponses !== undefined
          ? { allowMultipleResponses: dto.allowMultipleResponses as boolean }
          : {}),
        ...(dto.closesAt !== undefined ? { closesAt: dto.closesAt ? new Date(dto.closesAt as string) : null } : {}),
        updatedById: userId,
      },
    });
    this.record(scope, orgId, userId, id, 'updated');
    return this.get(scope, orgId, id, true);
  }

  async remove(scope: SurveyScope, orgId: string, userId: string, id: string) {
    await this.assert(scope, orgId, id);
    await this.prisma.hrSurvey.update({ where: { id }, data: { deletedAt: new Date(), updatedById: userId } });
    this.record(scope, orgId, userId, id, 'deleted');
    return { deleted: true };
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  private assertQuestionsValid(questions: { label: string; type: HrSurveyQuestionType; options: unknown[]; scaleMin: number; scaleMax: number }[]) {
    if (!questions.length) throw new BadRequestException('Ajoutez au moins une question avant de publier');
    for (const q of questions) {
      if (CHOICE_TYPES.includes(q.type) && q.options.length < 2) {
        throw new BadRequestException(`La question « ${q.label} » doit proposer au moins 2 options`);
      }
      if (q.type === 'RATING' && !(q.scaleMin < q.scaleMax)) {
        throw new BadRequestException(`L'échelle de la question « ${q.label} » est invalide`);
      }
    }
  }

  async publish(scope: SurveyScope, orgId: string, userId: string, id: string) {
    const survey = await this.assert(scope, orgId, id);
    if (survey.status !== 'DRAFT') throw new BadRequestException("Seule une enquête en brouillon peut être publiée");
    if (survey.closesAt && survey.closesAt.getTime() <= Date.now()) {
      throw new BadRequestException('La date de clôture est déjà passée : modifiez-la avant de publier');
    }
    const questions = await this.prisma.hrSurveyQuestion.findMany({ where: { surveyId: id }, include: { options: true } });
    this.assertQuestionsValid(questions);
    await this.prisma.hrSurvey.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        closedAt: null,
        publicToken: survey.publicToken ?? randomBytes(24).toString('base64url'),
        updatedById: userId,
      },
    });
    this.record(scope, orgId, userId, id, 'status_changed', { from: survey.status, to: 'PUBLISHED' });
    return this.get(scope, orgId, id, true);
  }

  async close(scope: SurveyScope, orgId: string, userId: string, id: string) {
    const survey = await this.assert(scope, orgId, id);
    if (survey.status !== 'PUBLISHED') throw new BadRequestException('Seule une enquête publiée peut être clôturée');
    await this.prisma.hrSurvey.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date(), updatedById: userId },
    });
    this.record(scope, orgId, userId, id, 'status_changed', { from: survey.status, to: 'CLOSED' });
    return this.get(scope, orgId, id, true);
  }

  async reopen(scope: SurveyScope, orgId: string, userId: string, id: string) {
    const survey = await this.assert(scope, orgId, id);
    if (survey.status !== 'CLOSED') throw new BadRequestException('Seule une enquête clôturée peut être rouverte');
    if (survey.closesAt && survey.closesAt.getTime() <= Date.now()) {
      throw new BadRequestException('La date de clôture est passée : reportez-la ou supprimez-la avant de rouvrir');
    }
    await this.prisma.hrSurvey.update({
      where: { id },
      data: { status: 'PUBLISHED', closedAt: null, updatedById: userId },
    });
    this.record(scope, orgId, userId, id, 'status_changed', { from: survey.status, to: 'PUBLISHED' });
    return this.get(scope, orgId, id, true);
  }

  /** Back to DRAFT — only while no response has been collected (structure would otherwise change under answers). */
  async unpublish(scope: SurveyScope, orgId: string, userId: string, id: string) {
    const survey = await this.assert(scope, orgId, id);
    if (survey.status === 'DRAFT') throw new BadRequestException("L'enquête est déjà en brouillon");
    const responses = await this.prisma.hrSurveyResponse.count({ where: { surveyId: id } });
    if (responses > 0) {
      throw new BadRequestException(
        "L'enquête a déjà reçu des réponses : sa structure est verrouillée et elle ne peut plus repasser en brouillon",
      );
    }
    await this.prisma.hrSurvey.update({
      where: { id },
      data: { status: 'DRAFT', closedAt: null, updatedById: userId },
    });
    this.record(scope, orgId, userId, id, 'status_changed', { from: survey.status, to: 'DRAFT' });
    return this.get(scope, orgId, id, true);
  }

  // ── questions ──────────────────────────────────────────────────────────────
  private normaliseQuestion(input: {
    type: HrSurveyQuestionType;
    label: string;
    helpText?: string | null;
    required?: boolean;
    scaleMin?: number;
    scaleMax?: number;
    scaleMinLabel?: string | null;
    scaleMaxLabel?: string | null;
    options?: HrSurveyOptionDto[];
  }) {
    const label = input.label.trim();
    if (!label) throw new BadRequestException("L'intitulé de la question est obligatoire");
    const isChoice = CHOICE_TYPES.includes(input.type);
    const options = isChoice
      ? (input.options ?? []).map((o) => ({ id: o.id, label: o.label.trim() })).filter((o) => o.label)
      : [];
    if (isChoice) {
      if (options.length < 2) throw new BadRequestException('Une question à choix doit proposer au moins 2 options');
      const labels = new Set(options.map((o) => o.label.toLowerCase()));
      if (labels.size !== options.length) throw new BadRequestException('Les options doivent être distinctes');
    }
    let scaleMin = 1;
    let scaleMax = 5;
    if (input.type === 'RATING') {
      scaleMin = input.scaleMin ?? 1;
      scaleMax = input.scaleMax ?? 5;
      if (scaleMin < 0 || scaleMax > 10 || scaleMin >= scaleMax) {
        throw new BadRequestException("L'échelle doit être comprise entre 0 et 10, avec minimum < maximum");
      }
    }
    return {
      type: input.type,
      label,
      helpText: (input.helpText ?? '').trim() || null,
      required: input.required ?? false,
      scaleMin,
      scaleMax,
      scaleMinLabel: input.type === 'RATING' ? (input.scaleMinLabel ?? '').trim() || null : null,
      scaleMaxLabel: input.type === 'RATING' ? (input.scaleMaxLabel ?? '').trim() || null : null,
      options,
    };
  }

  async addQuestion(scope: SurveyScope, orgId: string, userId: string, surveyId: string, dto: UpsertHrSurveyQuestionDto) {
    await this.assertDraft(scope, orgId, surveyId);
    const q = this.normaliseQuestion(dto);
    const last = await this.prisma.hrSurveyQuestion.findFirst({
      where: { surveyId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const { options, ...fields } = q;
    await this.prisma.hrSurveyQuestion.create({
      data: {
        ...fields,
        surveyId,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        options: { create: options.map((o, i) => ({ label: o.label, sortOrder: i })) },
      },
    });
    await this.touch(surveyId, userId);
    return this.get(scope, orgId, surveyId, true);
  }

  private async assertQuestion(surveyId: string, questionId: string) {
    const question = await this.prisma.hrSurveyQuestion.findFirst({
      where: { id: questionId, surveyId },
      include: { options: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!question) throw new NotFoundException('Question introuvable');
    return question;
  }

  async updateQuestion(scope: SurveyScope, orgId: string, userId: string, surveyId: string, questionId: string, dto: UpdateHrSurveyQuestionDto) {
    await this.assertDraft(scope, orgId, surveyId);
    const current = await this.assertQuestion(surveyId, questionId);
    const merged = this.normaliseQuestion({
      type: dto.type ?? current.type,
      label: dto.label ?? current.label,
      helpText: dto.helpText !== undefined ? dto.helpText : current.helpText,
      required: dto.required ?? current.required,
      scaleMin: dto.scaleMin ?? current.scaleMin,
      scaleMax: dto.scaleMax ?? current.scaleMax,
      scaleMinLabel: dto.scaleMinLabel !== undefined ? dto.scaleMinLabel : current.scaleMinLabel,
      scaleMaxLabel: dto.scaleMaxLabel !== undefined ? dto.scaleMaxLabel : current.scaleMaxLabel,
      options: dto.options ?? current.options.map((o) => ({ id: o.id, label: o.label })),
    });
    const { options, ...fields } = merged;
    // reconcile options: keep known ids (rename + reorder), drop missing, create new
    const known = new Set(current.options.map((o) => o.id));
    const kept = options.filter((o) => o.id && known.has(o.id));
    const keptIds = new Set(kept.map((o) => o.id!));
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.hrSurveyQuestion.update({ where: { id: questionId }, data: fields }),
      this.prisma.hrSurveyOption.deleteMany({
        where: { questionId, id: { notIn: [...keptIds] } },
      }),
    ];
    options.forEach((o, i) => {
      if (o.id && keptIds.has(o.id)) {
        ops.push(this.prisma.hrSurveyOption.update({ where: { id: o.id }, data: { label: o.label, sortOrder: i } }));
      } else {
        ops.push(this.prisma.hrSurveyOption.create({ data: { questionId, label: o.label, sortOrder: i } }));
      }
    });
    await this.prisma.$transaction(ops);
    await this.touch(surveyId, userId);
    return this.get(scope, orgId, surveyId, true);
  }

  async deleteQuestion(scope: SurveyScope, orgId: string, userId: string, surveyId: string, questionId: string) {
    await this.assertDraft(scope, orgId, surveyId);
    await this.assertQuestion(surveyId, questionId);
    await this.prisma.hrSurveyQuestion.delete({ where: { id: questionId } });
    await this.touch(surveyId, userId);
    return this.get(scope, orgId, surveyId, true);
  }

  async reorderQuestions(scope: SurveyScope, orgId: string, userId: string, surveyId: string, questionIds: string[]) {
    await this.assertDraft(scope, orgId, surveyId);
    const existing = await this.prisma.hrSurveyQuestion.findMany({ where: { surveyId }, select: { id: true } });
    const ids = new Set(existing.map((q) => q.id));
    if (questionIds.length !== ids.size || new Set(questionIds).size !== ids.size || !questionIds.every((q) => ids.has(q))) {
      throw new BadRequestException("L'ordre doit contenir exactement toutes les questions de l'enquête");
    }
    await this.prisma.$transaction(
      questionIds.map((id, i) => this.prisma.hrSurveyQuestion.update({ where: { id }, data: { sortOrder: i } })),
    );
    await this.touch(surveyId, userId);
    return this.get(scope, orgId, surveyId, true);
  }

  private async touch(surveyId: string, userId: string) {
    await this.prisma.hrSurvey.update({ where: { id: surveyId }, data: { updatedById: userId } });
  }

  // ── responses (admin) ──────────────────────────────────────────────────────
  async responses(scope: SurveyScope, orgId: string, surveyId: string) {
    const survey = await this.assert(scope, orgId, surveyId);
    const rows = await this.prisma.hrSurveyResponse.findMany({
      where: { surveyId, organizationId: orgId },
      orderBy: { submittedAt: 'desc' },
      take: 5000,
      include: {
        answers: {
          select: { questionId: true, textValue: true, numberValue: true, boolValue: true, optionIds: true },
        },
      },
    });
    const employeeIds = survey.anonymous ? [] : [...new Set(rows.map((r) => r.employeeId).filter(Boolean) as string[])];
    const employees = employeeIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: employeeIds }, organizationId: orgId },
          select: { id: true, reference: true, firstName: true, lastName: true },
        })
      : [];
    const byId = new Map(employees.map((e) => [e.id, e]));
    return {
      anonymous: survey.anonymous,
      total: rows.length,
      data: rows.map((r) => ({
        id: r.id,
        submittedAt: survey.anonymous ? this.dayOf(r.submittedAt) : r.submittedAt,
        // identity is never returned for an anonymous survey
        respondentName: survey.anonymous ? null : r.respondentName,
        respondentEmail: survey.anonymous ? null : r.respondentEmail,
        // a public answer only *claims* a name/e-mail; only signed-in answers are verified
        verified: survey.anonymous ? null : r.verified,
        employee: survey.anonymous || !r.employeeId || !r.verified ? null : byId.get(r.employeeId) ?? null,
        answers: r.answers,
      })),
    };
  }

  async results(scope: SurveyScope, orgId: string, surveyId: string) {
    const survey = await this.assert(scope, orgId, surveyId);
    const [questions, responseCount] = await Promise.all([
      this.prisma.hrSurveyQuestion.findMany({
        where: { surveyId },
        ...questionInclude,
      }),
      this.prisma.hrSurveyResponse.count({ where: { surveyId } }),
    ]);
    const answers = await this.prisma.hrSurveyAnswer.findMany({
      where: { response: { surveyId, organizationId: orgId } },
      select: {
        questionId: true,
        textValue: true,
        numberValue: true,
        boolValue: true,
        optionIds: true,
        response: { select: { id: true, submittedAt: true } },
      },
    });
    const byQuestion = new Map<string, typeof answers>();
    for (const a of answers) {
      const list = byQuestion.get(a.questionId) ?? [];
      list.push(a);
      byQuestion.set(a.questionId, list);
    }
    return {
      anonymous: survey.anonymous,
      responseCount,
      questions: questions.map((q) => {
        const list = byQuestion.get(q.id) ?? [];
        const base = { questionId: q.id, type: q.type, label: q.label, required: q.required };
        if (CHOICE_TYPES.includes(q.type)) {
          const counts = new Map<string, number>();
          let answered = 0;
          for (const a of list) {
            if (a.optionIds.length) answered++;
            for (const o of a.optionIds) counts.set(o, (counts.get(o) ?? 0) + 1);
          }
          return {
            ...base,
            answeredCount: answered,
            options: q.options.map((o) => ({ id: o.id, label: o.label, count: counts.get(o.id) ?? 0 })),
          };
        }
        if (q.type === 'YES_NO') {
          const yes = list.filter((a) => a.boolValue === true).length;
          const no = list.filter((a) => a.boolValue === false).length;
          return { ...base, answeredCount: yes + no, yes, no };
        }
        if (q.type === 'RATING') {
          const values = list.map((a) => a.numberValue).filter((v): v is number => v != null);
          const distribution: { value: number; count: number }[] = [];
          for (let v = q.scaleMin; v <= q.scaleMax; v++) {
            distribution.push({ value: v, count: values.filter((x) => x === v).length });
          }
          const average = values.length
            ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100
            : null;
          return {
            ...base,
            answeredCount: values.length,
            scaleMin: q.scaleMin,
            scaleMax: q.scaleMax,
            scaleMinLabel: q.scaleMinLabel,
            scaleMaxLabel: q.scaleMaxLabel,
            average,
            distribution,
          };
        }
        const texts = list
          .filter((a) => a.textValue && a.textValue.trim())
          .sort((a, b) => b.response.submittedAt.getTime() - a.response.submittedAt.getTime())
          .map((a) => ({
            responseId: a.response.id,
            text: a.textValue!,
            submittedAt: survey.anonymous ? this.dayOf(a.response.submittedAt) : a.response.submittedAt,
          }));
        return { ...base, answeredCount: texts.length, texts };
      }),
    };
  }

  async deleteResponse(scope: SurveyScope, orgId: string, userId: string, surveyId: string, responseId: string) {
    await this.assert(scope, orgId, surveyId);
    const res = await this.prisma.hrSurveyResponse.deleteMany({
      where: { id: responseId, surveyId, organizationId: orgId },
    });
    if (!res.count) throw new NotFoundException('Réponse introuvable');
    this.record(scope, orgId, userId, surveyId, 'response_deleted');
    return { deleted: true };
  }

  // ── public (no auth) ───────────────────────────────────────────────────────
  private async findPublic(token: string) {
    if (!token || token.length > 100) throw new NotFoundException('Enquête introuvable');
    const survey = await this.prisma.hrSurvey.findFirst({
      where: { publicToken: token, deletedAt: null, status: { not: 'DRAFT' } },
      include: { questions: questionInclude },
    });
    if (!survey) throw new NotFoundException('Enquête introuvable');
    return survey;
  }

  async publicSurvey(token: string) {
    return this.publicShape(await this.findPublic(token));
  }

  private async publicShape(
    survey: Prisma.HrSurveyGetPayload<{ include: { questions: { include: { options: true } } } }>,
  ) {
    const base = {
      title: survey.title,
      description: survey.description,
      anonymous: survey.anonymous,
      allowMultipleResponses: survey.allowMultipleResponses,
      closesAt: survey.closesAt,
    };
    if (this.isClosed(survey)) return { ...base, status: 'CLOSED' as const, questions: [] };
    return {
      ...base,
      status: 'PUBLISHED' as const,
      questions: survey.questions.map((q) => ({
        id: q.id,
        type: q.type,
        label: q.label,
        helpText: q.helpText,
        required: q.required,
        scaleMin: q.scaleMin,
        scaleMax: q.scaleMax,
        scaleMinLabel: q.scaleMinLabel,
        scaleMaxLabel: q.scaleMaxLabel,
        options: q.options.map((o) => ({ id: o.id, label: o.label })),
      })),
    };
  }

  /** Validates the answers against the survey's questions; shared by the public and member paths. */
  private buildAnswers(
    survey: { questions: AnswerableQuestion[] },
    answers: PublicSurveyResponseDto['answers'],
  ) {
    const questions = new Map(survey.questions.map((q) => [q.id, q]));
    const seen = new Set<string>();
    const rows: Prisma.HrSurveyAnswerCreateWithoutResponseInput[] = [];
    for (const a of answers) {
      const q = questions.get(a.questionId);
      if (!q) throw new BadRequestException('Question inconnue dans la réponse');
      if (seen.has(q.id)) throw new BadRequestException(`Question « ${q.label} » répondue plusieurs fois`);
      seen.add(q.id);
      const row = this.validateAnswer(q, a);
      if (row) rows.push({ ...row, question: { connect: { id: q.id } } });
    }
    const answered = new Set(rows.map((r) => r.question.connect!.id));
    for (const q of survey.questions) {
      if (q.required && !answered.has(q.id)) {
        throw new BadRequestException(`La question « ${q.label} » est obligatoire`);
      }
    }
    if (!rows.length) throw new BadRequestException('Répondez au moins à une question');
    return rows;
  }

  private async saveResponse(data: Prisma.HrSurveyResponseUncheckedCreateInput) {
    try {
      await this.prisma.hrSurveyResponse.create({ data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Vous avez déjà répondu à cette enquête');
      }
      throw e;
    }
    return { ok: true };
  }

  /**
   * Public link: nobody is authenticated, so the name/e-mail typed by the
   * respondent are stored as unverified claims — never attributed to an
   * Employee, and never used for duplicate detection (that would let anyone
   * lock a colleague out or probe whether they answered). The duplicate guard
   * is the per-browser respondentKey only.
   */
  async publicRespond(token: string, dto: PublicSurveyResponseDto) {
    const survey = await this.findPublic(token);
    if (this.isClosed(survey)) throw new GoneException('Cette enquête est clôturée et n’accepte plus de réponses');
    const rows = this.buildAnswers(survey, dto.answers);

    let respondentName: string | null = null;
    let respondentEmail: string | null = null;
    if (!survey.anonymous) {
      respondentName = (dto.respondentName ?? '').trim() || null;
      if (!respondentName) throw new BadRequestException('Votre nom est obligatoire pour cette enquête');
      respondentEmail = (dto.respondentEmail ?? '').trim().toLowerCase() || null;
      if (respondentEmail && !EMAIL_RE.test(respondentEmail)) {
        throw new BadRequestException('Adresse e-mail invalide');
      }
    }

    let respondentKey: string | null = null;
    if (!survey.allowMultipleResponses) {
      respondentKey = createHash('sha256').update(`${survey.id}:${dto.respondentKey}`).digest('hex');
      const dup = await this.prisma.hrSurveyResponse.findFirst({
        where: { surveyId: survey.id, respondentKey },
        select: { id: true },
      });
      if (dup) throw new ConflictException('Vous avez déjà répondu à cette enquête');
    }

    return this.saveResponse({
      organizationId: survey.organizationId,
      surveyId: survey.id,
      respondentName,
      respondentEmail,
      employeeId: null,
      verified: false,
      respondentKey,
      answers: { create: rows },
    });
  }

  // ── member (authenticated) ─────────────────────────────────────────────────
  private async findOpenForMember(scope: SurveyScope, orgId: string, surveyId: string) {
    const survey = await this.prisma.hrSurvey.findFirst({
      where: { id: surveyId, organizationId: orgId, scope, deletedAt: null, status: { not: 'DRAFT' } },
      include: { questions: questionInclude },
    });
    if (!survey) throw new NotFoundException('Enquête introuvable');
    return survey;
  }

  /** Published, still-open surveys a signed-in member can answer (any member — no survey permission needed). */
  async memberOpenList(scope: SurveyScope, orgId: string, userId: string) {
    const now = new Date();
    const surveys = await this.prisma.hrSurvey.findMany({
      where: {
        organizationId: orgId,
        scope,
        deletedAt: null,
        status: 'PUBLISHED',
        OR: [{ closesAt: null }, { closesAt: { gt: now } }],
      },
      select: {
        id: true,
        reference: true,
        title: true,
        description: true,
        anonymous: true,
        allowMultipleResponses: true,
        closesAt: true,
        publishedAt: true,
        _count: { select: { questions: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 100,
    });
    const keys = surveys.map((s) => this.memberKey(s.id, userId));
    const answered = keys.length
      ? await this.prisma.hrSurveyResponse.findMany({
          where: { surveyId: { in: surveys.map((s) => s.id) }, respondentKey: { in: keys } },
          select: { surveyId: true },
        })
      : [];
    const done = new Set(answered.map((a) => a.surveyId));
    return surveys.map(({ _count, ...s }) => ({
      ...s,
      questionCount: _count.questions,
      alreadyAnswered: !s.allowMultipleResponses && done.has(s.id),
    }));
  }

  /** The answering form for a signed-in member (any member — no survey permission needed). */
  async memberForm(scope: SurveyScope, orgId: string, userId: string, surveyId: string) {
    const survey = await this.findOpenForMember(scope, orgId, surveyId);
    const base = await this.publicShape(survey);
    const already =
      !survey.allowMultipleResponses &&
      !!(await this.prisma.hrSurveyResponse.findFirst({
        where: { surveyId, respondentKey: { in: this.memberKeys(scope, surveyId, userId) } },
        select: { id: true },
      }));
    return { ...base, alreadyAnswered: already };
  }

  /**
   * Signed-in answer: the identity is the session, so it is verified and
   * attributed to the member's linked Employee (non-anonymous surveys). On an
   * anonymous survey nothing identifying is stored — only a keyed hash used
   * as the one-answer guard.
   */
  async memberRespond(scope: SurveyScope, orgId: string, userId: string, surveyId: string, dto: MemberSurveyResponseDto) {
    const survey = await this.findOpenForMember(scope, orgId, surveyId);
    if (this.isClosed(survey)) throw new GoneException('Cette enquête est clôturée et n’accepte plus de réponses');
    const rows = this.buildAnswers(survey, dto.answers);

    let respondentName: string | null = null;
    let respondentEmail: string | null = null;
    let employeeId: string | null = null;
    if (!survey.anonymous) {
      const [user, employee] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } }),
        this.prisma.employee.findFirst({
          where: { organizationId: orgId, userId, deletedAt: null },
          select: { id: true, firstName: true, lastName: true },
        }),
      ]);
      employeeId = employee?.id ?? null;
      respondentName =
        [employee?.firstName ?? user?.firstName, employee?.lastName ?? user?.lastName].filter(Boolean).join(' ') ||
        user?.email ||
        null;
      respondentEmail = user?.email?.toLowerCase() ?? null;
    }
    const respondentKey = survey.allowMultipleResponses ? null : this.memberKey(surveyId, userId);
    if (respondentKey) {
      const dup = await this.prisma.hrSurveyResponse.findFirst({
        where: { surveyId, respondentKey: { in: this.memberKeys(scope, surveyId, userId) } },
        select: { id: true },
      });
      if (dup) throw new ConflictException('Vous avez déjà répondu à cette enquête');
    }
    return this.saveResponse({
      organizationId: orgId,
      surveyId,
      respondentName,
      respondentEmail,
      employeeId,
      verified: !survey.anonymous,
      respondentKey,
      answers: { create: rows },
    });
  }

  /** Returns the persisted shape of one answer, or null when it is empty (unanswered). */
  private validateAnswer(
    q: { id: string; type: HrSurveyQuestionType; label: string; scaleMin: number; scaleMax: number; options: { id: string }[] },
    a: { textValue?: string; numberValue?: number; boolValue?: boolean; optionIds?: string[] },
  ): { textValue?: string; numberValue?: number; boolValue?: boolean; optionIds?: string[] } | null {
    const bad = (msg: string) => new BadRequestException(`« ${q.label} » : ${msg}`);
    if (TEXT_TYPES.includes(q.type)) {
      const text = (a.textValue ?? '').trim();
      if (!text) return null;
      const max = TEXT_MAX[q.type as keyof typeof TEXT_MAX];
      if (text.length > max) throw bad(`réponse trop longue (max ${max} caractères)`);
      return { textValue: text };
    }
    if (CHOICE_TYPES.includes(q.type)) {
      const ids = [...new Set(a.optionIds ?? [])];
      if (!ids.length) return null;
      const valid = new Set(q.options.map((o) => o.id));
      if (!ids.every((id) => valid.has(id))) throw bad('option invalide');
      if (q.type === 'SINGLE_CHOICE' && ids.length !== 1) throw bad('une seule option attendue');
      return { optionIds: ids };
    }
    if (q.type === 'YES_NO') {
      if (a.boolValue === undefined || a.boolValue === null) return null;
      if (typeof a.boolValue !== 'boolean') throw bad('réponse oui/non attendue');
      return { boolValue: a.boolValue };
    }
    // RATING
    if (a.numberValue === undefined || a.numberValue === null) return null;
    if (!Number.isInteger(a.numberValue) || a.numberValue < q.scaleMin || a.numberValue > q.scaleMax) {
      throw bad(`note attendue entre ${q.scaleMin} et ${q.scaleMax}`);
    }
    return { numberValue: a.numberValue };
  }
}
