import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSubjectType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RecruitingAiService } from '../../modules/recruiting/recruiting-ai.service';
import { AuditChainService } from '../audit-log/audit-chain.service';
import { AuditWriter } from '../audit-log/audit-writer.service';
import { FilesService } from '../files/files.service';

/** Identifying fields scrubbed from history snapshots and diffs, per model. */
export const PII_FIELDS: Record<string, string[]> = {
  Employee: ['firstName', 'lastName', 'email', 'contact', 'cin', 'exitReason', 'userId'],
  EmployeeJourney: ['notes', 'trialComment', 'trialSignature', 'exitReason'],
  Candidate: [
    'fullName', 'email', 'cvText', 'profile', 'guardFlags', 'criteriaScores', 'justification',
    'dimsExplained', 'decisionReason', 'fileName', 'inviteToken',
  ],
  CandidateMessage: ['subject', 'body', 'summary', 'flags'],
};

export interface AnonymizeResult {
  subjectType: DataSubjectType;
  subjectId: string;
  /** reference kept for the record (never a name) */
  subjectLabel: string;
  alreadyAnonymized: boolean;
  historyScrubbed: number;
  auditRedacted: number;
  related: Record<string, number>;
  filesDeleted: number;
}

interface Opts {
  actorId: string | null;
  /** why: erasure request reference or retention category (written in the audit entry) */
  reason: string;
}

/**
 * Turns a person into an anonymous record. Shared by erasure requests and retention, idempotent
 * (`anonymizedAt`). Writes go through raw SQL on purpose: the Prisma history extension would
 * otherwise record the erased values in a new diff. What stays: ids, dates, skill levels,
 * attendance, scores — statistics remain true and nobody can be re-identified.
 */
@Injectable()
export class AnonymizerService {
  private readonly logger = new Logger('Anonymizer');

  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: AuditChainService,
    private readonly writer: AuditWriter,
    private readonly files: FilesService,
    private readonly recruitingAi: RecruitingAiService,
  ) {}

  async activeHold(orgId: string, subjectType: DataSubjectType, subjectId: string) {
    return this.prisma.legalHold.findFirst({ where: { organizationId: orgId, subjectType, subjectId, releasedAt: null } });
  }

  async anonymize(orgId: string, subjectType: DataSubjectType, subjectId: string, opts: Opts): Promise<AnonymizeResult> {
    if (await this.activeHold(orgId, subjectType, subjectId)) {
      throw new ConflictException('Gel juridique actif : les données de cette personne ne peuvent pas être effacées');
    }
    const result =
      subjectType === 'EMPLOYEE' ? await this.employee(orgId, subjectId) : await this.candidate(orgId, subjectId);
    if (!result.alreadyAnonymized) {
      await this.writer.write({
        organizationId: orgId,
        actorId: opts.actorId,
        action: 'COMPLIANCE subject.anonymized',
        entityType: subjectType === 'EMPLOYEE' ? 'Employee' : 'Candidate',
        entityId: subjectId,
        after: {
          subjectLabel: result.subjectLabel,
          reason: opts.reason,
          historyScrubbed: result.historyScrubbed,
          auditRedacted: result.auditRedacted,
          filesDeleted: result.filesDeleted,
          ...result.related,
        },
      });
    }
    return result;
  }

  // ── employee ────────────────────────────────────────────────────────────
  private async employee(orgId: string, id: string): Promise<AnonymizeResult> {
    const emp = await this.prisma.employee.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, reference: true, anonymizedAt: true },
    });
    if (!emp) throw new NotFoundException('Collaborateur introuvable');
    const base = { subjectType: 'EMPLOYEE' as const, subjectId: id, subjectLabel: emp.reference };
    if (emp.anonymizedAt) {
      return { ...base, alreadyAnonymized: true, historyScrubbed: 0, auditRedacted: 0, related: {}, filesDeleted: 0 };
    }
    const journeys = await this.prisma.employeeJourney.findMany({ where: { organizationId: orgId, employeeId: id }, select: { id: true } });
    const journeyIds = journeys.map((j) => j.id);
    const attachments = await this.prisma.attachment.findMany({
      where: { organizationId: orgId, entityId: { in: [id, ...journeyIds] }, deletedAt: null },
      select: { id: true, storageKey: true },
    });

    const out = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "Employee" SET "firstName" = 'Anonyme', "lastName" = "reference", email = NULL, contact = NULL,
               cin = NULL, "exitReason" = NULL, "userId" = NULL, "anonymizedAt" = now(), "updatedAt" = now()
         WHERE id = ${id} AND "organizationId" = ${orgId}`;
      const journeysUpdated = journeyIds.length
        ? await tx.$executeRaw`
            UPDATE "EmployeeJourney" SET notes = NULL, "trialComment" = NULL, "trialSignature" = NULL,
                   "exitReason" = NULL, "updatedAt" = now()
             WHERE id = ANY(${journeyIds})`
        : 0;
      const surveyResponses = await tx.$executeRaw`
        UPDATE "HrSurveyResponse" SET "respondentName" = NULL, "respondentEmail" = NULL, "employeeId" = NULL
         WHERE "organizationId" = ${orgId} AND "employeeId" = ${id}`;
      const attachmentIds = attachments.map((a) => a.id);
      const attachmentsRemoved = attachmentIds.length
        ? await tx.$executeRaw`UPDATE "Attachment" SET "deletedAt" = now(), "fileName" = 'anonymized' WHERE id = ANY(${attachmentIds})`
        : 0;
      const historyScrubbed =
        (await this.scrubHistory(tx, orgId, 'Employee', [id])) +
        (await this.scrubHistory(tx, orgId, 'EmployeeJourney', journeyIds));
      const auditRedacted = await this.chain.redactEntities(orgId, [id, ...journeyIds, ...attachmentIds], tx);
      await this.marker(tx, orgId, 'Employee', id);
      return { historyScrubbed, auditRedacted, related: { journeys: journeysUpdated, surveyResponses, attachments: attachmentsRemoved } };
    });
    const filesDeleted = await this.deleteObjects(attachments.map((a) => a.storageKey));
    return { ...base, alreadyAnonymized: false, ...out, filesDeleted };
  }

  // ── candidate ───────────────────────────────────────────────────────────
  private async candidate(orgId: string, id: string): Promise<AnonymizeResult> {
    const c = await this.prisma.candidate.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, fileKey: true, anonymizedAt: true, jobOpening: { select: { title: true } } },
    });
    if (!c) throw new NotFoundException('Candidat introuvable');
    const base = { subjectType: 'CANDIDATE' as const, subjectId: id, subjectLabel: `CAND-${id.slice(0, 8)}` };
    if (c.anonymizedAt) {
      return { ...base, alreadyAnonymized: true, historyScrubbed: 0, auditRedacted: 0, related: {}, filesDeleted: 0 };
    }
    const messages = await this.prisma.candidateMessage.findMany({ where: { organizationId: orgId, candidateId: id }, select: { id: true } });
    const messageIds = messages.map((m) => m.id);

    const out = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "Candidate" SET "fullName" = NULL, email = NULL, "cvText" = NULL, profile = NULL, "guardFlags" = '[]',
               "criteriaScores" = NULL, justification = NULL, "dimsExplained" = NULL, "decisionReason" = NULL,
               "inviteToken" = NULL, "fileName" = 'anonymized', "anonymizedAt" = now(), "updatedAt" = now()
         WHERE id = ${id} AND "organizationId" = ${orgId}`;
      const messagesUpdated = messageIds.length
        ? await tx.$executeRaw`
            UPDATE "CandidateMessage" SET subject = '[anonymisé]', body = '', summary = NULL, flags = '[]', "updatedAt" = now()
             WHERE id = ANY(${messageIds})`
        : 0;
      const historyScrubbed =
        (await this.scrubHistory(tx, orgId, 'Candidate', [id])) +
        (await this.scrubHistory(tx, orgId, 'CandidateMessage', messageIds));
      const auditRedacted = await this.chain.redactEntities(orgId, [id, ...messageIds], tx);
      await this.marker(tx, orgId, 'Candidate', id);
      return { historyScrubbed, auditRedacted, related: { messages: messagesUpdated } };
    });
    const filesDeleted = await this.deleteObjects([c.fileKey]);
    // the candidate vector encodes the profile: it goes too (best effort, retried by nothing — logged)
    await this.recruitingAi.deleteCandidate(id).catch((err) => this.logger.warn(`vector ${id}: ${(err as Error).message}`));
    return { ...base, alreadyAnonymized: false, ...out, filesDeleted };
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  /** Removes identifying keys from snapshots and diffs of these records (jsonb - text[]). */
  private async scrubHistory(tx: Prisma.TransactionClient, orgId: string, model: string, ids: string[]) {
    if (!ids.length) return 0;
    const keys = PII_FIELDS[model] ?? [];
    return tx.$executeRaw`
      UPDATE "HistoryEntry"
         SET snapshot = CASE WHEN jsonb_typeof(snapshot) = 'object' THEN snapshot - ${keys}::text[] ELSE snapshot END,
             changes = CASE WHEN jsonb_typeof(changes) = 'object' THEN changes - ${keys}::text[] ELSE changes END
       WHERE "organizationId" = ${orgId} AND "entityType" = ${model} AND "entityId" = ANY(${ids})`;
  }

  /** History line saying *that* the record was anonymized, without any value. */
  private marker(tx: Prisma.TransactionClient, orgId: string, model: string, id: string) {
    return tx.historyEntry.create({
      data: {
        organizationId: orgId,
        entityType: model,
        entityId: id,
        operation: 'update',
        changes: { anonymizedAt: { from: null, to: new Date().toISOString() } },
      },
    });
  }

  private async deleteObjects(keys: string[]) {
    let n = 0;
    for (const key of keys.filter((k) => k && k !== 'eval')) {
      try {
        await this.files.deleteObject(key);
        n++;
      } catch (err) {
        this.logger.warn(`storage object ${key} not deleted: ${(err as Error).message}`);
      }
    }
    return n;
  }
}
