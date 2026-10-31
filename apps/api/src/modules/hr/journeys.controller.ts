import { BadRequestException, Body, ForbiddenException, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Granted } from '../../common/decorators/granted.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateJourneyDto,
  HandoverDto,
  HrImportOptionsDto,
  JourneyItemDto,
  JourneyQuery,
  SetTemplateDto,
  ToggleItemDto,
  TrialSignOffDto,
  UpdateJourneyDto,
  UpdateJourneyItemDto,
} from './dto/journeys.dto';
import { HrImportService, type UploadedWorkbook } from './hr-import.service';
import type { HrImportKind } from './hr-import.parser';
import { JourneysService } from './journeys.service';
import { SelfServiceService } from './self-service.service';

const WORKBOOK_UPLOAD = FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const KINDS: HrImportKind[] = ['employees', 'competencies'];

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/journeys')
export class JourneysController {
  constructor(private readonly journeys: JourneysService) {}

  @Get()
  @RequirePermissions('employees:read')
  list(@OrgId() orgId: string, @Query() q: JourneyQuery) {
    return this.journeys.list(orgId, q);
  }

  @Get(':id')
  @RequirePermissions('employees:read')
  get(@OrgId() orgId: string, @Param('id') id: string) {
    return this.journeys.get(orgId, id);
  }

  @Post()
  @RequirePermissions('employees:update')
  create(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateJourneyDto) {
    return this.journeys.create(orgId, user.id, { ...dto });
  }

  @Patch(':id')
  @RequirePermissions('employees:update')
  update(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateJourneyDto) {
    return this.journeys.update(orgId, user.id, id, { ...dto });
  }

  @Delete(':id')
  @RequirePermissions('employees:delete')
  remove(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.journeys.remove(orgId, user.id, id);
  }

  @Post(':id/items')
  @RequirePermissions('employees:update')
  addItem(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: JourneyItemDto) {
    return this.journeys.addItem(orgId, user.id, id, { ...dto });
  }

  @Patch(':id/items/:itemId')
  @RequirePermissions('employees:update')
  updateItem(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateJourneyItemDto,
  ) {
    return this.journeys.updateItem(orgId, user.id, id, itemId, { ...dto });
  }

  @Post(':id/items/:itemId/toggle')
  @RequirePermissions('employees:update')
  toggleItem(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ToggleItemDto,
  ) {
    return this.journeys.toggleItem(orgId, user.id, id, itemId, dto.done);
  }

  @Delete(':id/items/:itemId')
  @RequirePermissions('employees:update')
  removeItem(@OrgId() orgId: string, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.journeys.removeItem(orgId, id, itemId);
  }

  @Post(':id/trial-signoff')
  @RequirePermissions('employees:update')
  trialSignOff(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: TrialSignOffDto) {
    return this.journeys.trialSignOff(orgId, user.id, id, dto);
  }

  @Get(':id/handover')
  @RequirePermissions('employees:read')
  handoverPreview(@OrgId() orgId: string, @Param('id') id: string) {
    return this.journeys.handoverPreview(orgId, id);
  }

  /** Reassigns the departing person's open records — a management decision (`employees:approve`). */
  @Post(':id/handover')
  @RequirePermissions('employees:approve')
  handover(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: HandoverDto) {
    return this.journeys.handover(orgId, user.id, id, dto);
  }

  @Post(':id/deactivate-account')
  @RequirePermissions('employees:update', 'users:admin')
  deactivateAccount(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.journeys.deactivateAccount(orgId, user.id, id);
  }

  @Post(':id/complete')
  @RequirePermissions('employees:update')
  complete(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.journeys.completeOffboarding(orgId, user.id, id);
  }
}

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/job-descriptions')
export class OnboardingTemplateController {
  constructor(private readonly journeys: JourneysService) {}

  @Get(':id/onboarding')
  @RequirePermissions('job-descriptions:read')
  get(@OrgId() orgId: string, @Param('id') id: string) {
    return this.journeys.templateItems(orgId, id);
  }

  @Put(':id/onboarding')
  @RequirePermissions('job-descriptions:update')
  set(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: SetTemplateDto) {
    return this.journeys.setTemplateItems(orgId, id, dto as unknown as { trialPeriodDays?: number | null; items: Record<string, unknown>[] });
  }
}

/** « Mon espace » — any member, own record only (no HR permission required). */
@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/me')
export class SelfServiceController {
  constructor(private readonly self: SelfServiceService) {}

  @Get()
  me(@OrgId() orgId: string, @CurrentUser() user: AuthUser) {
    return this.self.me(orgId, user.id);
  }
}

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/import')
export class HrImportController {
  constructor(private readonly importer: HrImportService) {}

  private kind(kind: string): HrImportKind {
    if (!KINDS.includes(kind as HrImportKind)) throw new BadRequestException('Import inconnu');
    return kind as HrImportKind;
  }

  private assertPermission(kind: HrImportKind, granted: Set<string>) {
    const needed = kind === 'employees' ? 'employees:create' : 'competency-evaluations:update';
    if (!granted.has(needed)) throw new ForbiddenException(`Permission requise : ${needed}`);
  }

  @Get(':kind/template')
  @RequirePermissions('employees:read')
  async template(@OrgId() orgId: string, @Param('kind') kind: string, @Res() res: Response) {
    const k = this.kind(kind);
    const body = await this.importer.template(orgId, k);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${k === 'employees' ? 'modele-collaborateurs' : 'matrice-competences'}.xlsx"`);
    res.send(body);
  }

  @Post(':kind/preview')
  @RequirePermissions('employees:read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(WORKBOOK_UPLOAD)
  preview(
    @OrgId() orgId: string,
    @Param('kind') kind: string,
    @Granted() granted: Set<string>,
    @UploadedFile() file: UploadedWorkbook | undefined,
    @Body() dto: HrImportOptionsDto,
  ) {
    const k = this.kind(kind);
    this.assertPermission(k, granted);
    return this.importer.preview(orgId, k, file, dto, granted);
  }

  @Post(':kind/commit')
  @RequirePermissions('employees:read')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(WORKBOOK_UPLOAD)
  commit(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Granted() granted: Set<string>,
    @UploadedFile() file: UploadedWorkbook | undefined,
    @Body() dto: HrImportOptionsDto,
  ) {
    const k = this.kind(kind);
    this.assertPermission(k, granted);
    return this.importer.commit(orgId, user.id, k, file, dto, granted);
  }
}
