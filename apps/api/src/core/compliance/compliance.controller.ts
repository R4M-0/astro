import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RetentionCategory } from '@prisma/client';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuditAccess } from '../audit-log/audit-access.decorator';
import { AuditChainService } from '../audit-log/audit-chain.service';
import {
  AuditExportQuery,
  CreateDsrDto,
  CreateHoldDto,
  DsrListQuery,
  HoldsQuery,
  RejectDto,
  ResolutionDto,
  SubjectsQuery,
  UpdatePolicyDto,
} from './compliance.dto';
import { ComplianceService } from './compliance.service';
import { DataSubjectRequestsService } from './data-subject-requests.service';
import { RETENTION_CATEGORIES, RetentionService } from './retention.service';

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // formula injection guard (spreadsheet opens the export)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly compliance: ComplianceService,
    private readonly requests: DataSubjectRequestsService,
    private readonly retention: RetentionService,
    private readonly chain: AuditChainService,
  ) {}

  @Get('overview')
  @RequirePermissions('compliance:read')
  overview(@OrgId() orgId: string) {
    return this.compliance.overview(orgId);
  }

  @Get('subjects')
  @RequirePermissions('compliance:read')
  subjects(@OrgId() orgId: string, @Query() q: SubjectsQuery) {
    return this.compliance.subjects(orgId, q.search);
  }

  @Get('processing-register')
  @RequirePermissions('compliance:read')
  register(@OrgId() orgId: string) {
    return this.compliance.processingRegister(orgId);
  }

  // ── audit trail ───────────────────────────────────────────────────────────
  /** Walks the whole chain: first break (edited, removed, re-hashed row) or ok. */
  @Get('audit/verify')
  @RequirePermissions('compliance:read')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  verify(@OrgId() orgId: string) {
    return this.chain.verify(orgId);
  }

  /** Sealed extract for an auditor: rows with seq / prevHash / hash + a manifest holding the head. */
  @Get('audit/export')
  @RequirePermissions('compliance:export')
  @AuditAccess('AuditLogEntry', { export: true, param: '-' })
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async exportAudit(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Query() q: AuditExportQuery, @Res({ passthrough: true }) res: Response) {
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    if (from && to && from > to) throw new BadRequestException('Période invalide');
    const { manifest, entries } = await this.chain.export(orgId, user.id, { from, to });
    const stamp = manifest.exportedAt.slice(0, 10);
    if (q.format === 'csv') {
      const cols = ['seq', 'createdAt', 'actorEmail', 'viaSupport', 'action', 'entityType', 'entityId', 'ip', 'redacted', 'bodyDigest', 'prevHash', 'hash'] as const;
      const lines = [
        ...Object.entries(manifest).map(([k, v]) => `# ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`),
        cols.join(','),
        ...entries.map((e) => cols.map((c) => csvCell(e[c])).join(',')),
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="audit-${stamp}.csv"`);
      return lines.join('\n');
    }
    res.setHeader('Content-Disposition', `attachment; filename="audit-${stamp}.json"`);
    return { manifest, entries };
  }

  // ── retention ─────────────────────────────────────────────────────────────
  @Get('retention')
  @RequirePermissions('compliance:read')
  async retentionState(@OrgId() orgId: string) {
    const [policies, runs] = await Promise.all([this.retention.policies(orgId), this.retention.runs(orgId)]);
    return { policies, runs };
  }

  @Patch('retention/:category')
  @RequirePermissions('compliance:update')
  updatePolicy(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('category') category: string, @Body() dto: UpdatePolicyDto) {
    if (!RETENTION_CATEGORIES.includes(category as RetentionCategory)) throw new BadRequestException('Catégorie inconnue');
    return this.retention.update(orgId, user.id, category as RetentionCategory, dto);
  }

  /** Dry run: what each policy would anonymize / purge today, nothing changes. */
  @Post('retention/preview')
  @RequirePermissions('compliance:read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  preview(@OrgId() orgId: string, @CurrentUser() user: AuthUser) {
    return this.retention.run(orgId, { dryRun: true, actorId: user.id });
  }

  /** Applies the enabled policies now instead of waiting for the daily job. */
  @Post('retention/run')
  @RequirePermissions('compliance:approve')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  runNow(@OrgId() orgId: string, @CurrentUser() user: AuthUser) {
    return this.retention.run(orgId, { dryRun: false, actorId: user.id });
  }

  // ── data subject requests ─────────────────────────────────────────────────
  @Get('requests')
  @RequirePermissions('compliance:read')
  listRequests(@OrgId() orgId: string, @Query() q: DsrListQuery) {
    return this.requests.list(orgId, q.status);
  }

  @Post('requests')
  @RequirePermissions('compliance:update')
  createRequest(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateDsrDto) {
    return this.requests.create(orgId, user.id, dto);
  }

  @Get('requests/:id')
  @RequirePermissions('compliance:read')
  getRequest(@OrgId() orgId: string, @Param('id') id: string) {
    return this.requests.get(orgId, id);
  }

  /** Art. 15 / 20: one JSON file with everything Astro holds about the person (logged as an export). */
  @Get('requests/:id/export')
  @RequirePermissions('compliance:export')
  @AuditAccess('DataSubjectRequest', { export: true })
  async exportRequest(@OrgId() orgId: string, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const data = await this.requests.export(orgId, id);
    res.setHeader('Content-Disposition', `attachment; filename="${data.request.reference}.json"`);
    return data;
  }

  @Post('requests/:id/complete')
  @RequirePermissions('compliance:update')
  complete(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ResolutionDto) {
    return this.requests.complete(orgId, user.id, id, dto.resolution);
  }

  @Post('requests/:id/reject')
  @RequirePermissions('compliance:update')
  reject(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.requests.reject(orgId, user.id, id, dto.resolution);
  }

  /** Executes an erasure: a human with compliance:approve, never the system on its own. */
  @Post('requests/:id/execute')
  @RequirePermissions('compliance:approve')
  execute(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.requests.execute(orgId, user.id, id);
  }

  // ── legal holds ───────────────────────────────────────────────────────────
  @Get('legal-holds')
  @RequirePermissions('compliance:read')
  holds(@OrgId() orgId: string, @Query() q: HoldsQuery) {
    return this.compliance.listHolds(orgId, q.all === 'true');
  }

  @Post('legal-holds')
  @RequirePermissions('compliance:update')
  createHold(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateHoldDto) {
    return this.compliance.createHold(orgId, user.id, dto);
  }

  @Post('legal-holds/:id/release')
  @RequirePermissions('compliance:update')
  releaseHold(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.compliance.releaseHold(orgId, user.id, id);
  }
}
