import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { uploadName } from '../../common/office-files';
import { FilesService } from '../../core/files/files.service';
import { PrismaService } from '../../prisma/prisma.service';
import { cvKind } from './cv-text';
import { RecruitingAiService } from './recruiting-ai.service';
import { RecruitingPipelineService } from './recruiting-pipeline.service';
import type { CreateOpeningDto, DecisionDto, UpdateOpeningDto } from './recruiting.dto';

export interface UploadedCv {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain' };

/** Columns shown in an opening's candidate table (no CV text). */
const CANDIDATE_ROW = {
  id: true,
  fullName: true,
  fileName: true,
  status: true,
  error: true,
  guardFlags: true,
  retrievalScore: true,
  filterReasons: true,
  score: true,
  rank: true,
  shortlisted: true,
  decision: true,
  email: true,
  inviteStatus: true,
  slot: { select: { startsAt: true, durationMinutes: true } },
  createdAt: true,
} satisfies Prisma.CandidateSelect;

@Injectable()
export class RecruitingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly ai: RecruitingAiService,
    private readonly pipeline: RecruitingPipelineService,
  ) {}

  async listOpenings(orgId: string) {
    const openings = await this.prisma.jobOpening.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, status: true, rankingStatus: true, rankedAt: true, createdAt: true },
    });
    const counts = await this.prisma.candidate.groupBy({
      by: ['jobOpeningId', 'shortlisted'],
      where: { organizationId: orgId, deletedAt: null },
      _count: true,
    });
    return openings.map((o) => {
      const mine = counts.filter((c) => c.jobOpeningId === o.id);
      return {
        ...o,
        candidates: mine.reduce((n, c) => n + c._count, 0),
        shortlisted: mine.find((c) => c.shortlisted)?._count ?? 0,
      };
    });
  }

  async getOpening(orgId: string, id: string) {
    const opening = await this.prisma.jobOpening.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: {
        candidates: {
          where: { deletedAt: null },
          select: CANDIDATE_ROW,
          orderBy: [{ rank: { sort: 'asc', nulls: 'last' } }, { retrievalScore: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        },
      },
    });
    if (!opening) throw new NotFoundException('Offre introuvable');
    return opening;
  }

  createOpening(orgId: string, userId: string, dto: CreateOpeningDto) {
    return this.prisma.jobOpening.create({
      data: {
        ...dto,
        criteria: (dto.criteria ?? []) as unknown as Prisma.InputJsonValue,
        organizationId: orgId,
        createdById: userId,
        updatedById: userId,
      },
    });
  }

  async updateOpening(orgId: string, userId: string, id: string, dto: UpdateOpeningDto) {
    await this.getOpening(orgId, id);
    return this.prisma.jobOpening.update({
      where: { id },
      data: { ...dto, criteria: dto.criteria as unknown as Prisma.InputJsonValue | undefined, updatedById: userId },
    });
  }

  async removeOpening(orgId: string, userId: string, id: string) {
    await this.getOpening(orgId, id);
    await this.prisma.jobOpening.update({ where: { id }, data: { deletedAt: new Date(), updatedById: userId } });
  }

  async rank(orgId: string, id: string) {
    const opening = await this.getOpening(orgId, id);
    if (!opening.candidates.some((c) => c.status === 'READY')) throw new BadRequestException('Aucun CV analysé pour cette offre');
    await this.pipeline.enqueueRank(orgId, id);
    return { ok: true };
  }

  /** Stores each CV and queues stage 1; content checks run before anything is stored. */
  async upload(orgId: string, userId: string, openingId: string, files: UploadedCv[]) {
    await this.getOpening(orgId, openingId);
    if (!files?.length) throw new BadRequestException('Fichier manquant');
    const checked = files.map((f) => {
      const name = uploadName(f.originalname);
      return { f, name, kind: cvKind(name, f.buffer) };
    });
    const created = [];
    for (const { f, name, kind } of checked) {
      const key = this.files.buildKey(orgId, 'candidate-cv', name);
      await this.files.putObject(key, f.buffer, MIME[kind]);
      const c = await this.prisma.candidate.create({
        data: {
          organizationId: orgId,
          jobOpeningId: openingId,
          fileKey: key,
          fileName: name,
          mimeType: MIME[kind],
          fileSize: f.buffer.length,
          createdById: userId,
          updatedById: userId,
        },
        select: CANDIDATE_ROW,
      });
      await this.pipeline.enqueueIngest(c.id);
      created.push(c);
    }
    return created;
  }

  async getCandidate(orgId: string, id: string) {
    const c = await this.prisma.candidate.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { jobOpening: { select: { id: true, title: true, criteria: true, shortlistSize: true } } },
    });
    if (!c) throw new NotFoundException('Candidat introuvable');
    const { fileKey: _key, inviteToken: _token, ...rest } = c;
    return rest;
  }

  async candidateFileUrl(orgId: string, id: string) {
    const c = await this.prisma.candidate.findFirst({ where: { id, organizationId: orgId, deletedAt: null } });
    if (!c) throw new NotFoundException('Candidat introuvable');
    return { url: await this.files.presignDownload(c.fileKey, c.fileName) };
  }

  /** Human in the loop. Going against the ranking (approve outside the shortlist, reject inside it) needs a reason. */
  async decide(orgId: string, userId: string, id: string, dto: DecisionDto) {
    const c = await this.getCandidate(orgId, id);
    const override = (dto.decision === 'APPROVED' && !c.shortlisted) || (dto.decision === 'REJECTED' && c.shortlisted);
    if (override && !dto.reason?.trim()) throw new BadRequestException({ code: 'recruiting.reasonRequired', message: 'Motif requis pour aller contre le classement' });
    return this.prisma.candidate.update({
      where: { id },
      data: {
        decision: dto.decision,
        decisionReason: dto.reason?.trim() || null,
        decidedById: dto.decision === 'PENDING' ? null : userId,
        decidedAt: dto.decision === 'PENDING' ? null : new Date(),
        updatedById: userId,
      },
      select: { id: true, decision: true, decisionReason: true, decidedAt: true },
    });
  }

  async retry(orgId: string, id: string) {
    const c = await this.getCandidate(orgId, id);
    if (c.status !== 'FAILED') throw new BadRequestException('Seuls les CV en échec peuvent être relancés');
    await this.prisma.candidate.update({ where: { id }, data: { status: 'RECEIVED', error: null } });
    await this.pipeline.enqueueIngest(id);
    return { ok: true };
  }

  async removeCandidate(orgId: string, userId: string, id: string) {
    await this.getCandidate(orgId, id);
    await this.prisma.$transaction([
      this.prisma.interviewSlot.updateMany({ where: { candidateId: id }, data: { candidateId: null, bookedAt: null } }),
      this.prisma.candidate.update({ where: { id }, data: { deletedAt: new Date(), updatedById: userId, inviteToken: null } }),
    ]);
    await this.ai.deleteCandidate(id);
  }
}
