import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CV_MAX_BYTES } from './cv-text';
import { RecruitingPipelineService } from './recruiting-pipeline.service';
import { CreateOpeningDto, DecisionDto, SuggestCriteriaDto, UpdateOpeningDto } from './recruiting.dto';
import { RecruitingService, type UploadedCv } from './recruiting.service';

const CV_UPLOAD = FilesInterceptor('files', 50, { limits: { fileSize: CV_MAX_BYTES, files: 50 } });

@ApiTags('recruiting')
@ApiBearerAuth()
@Controller('recruiting/openings')
export class OpeningsController {
  constructor(
    private readonly recruiting: RecruitingService,
    private readonly pipeline: RecruitingPipelineService,
  ) {}

  @Get()
  @RequirePermissions('recruiting:read')
  list(@OrgId() orgId: string) {
    return this.recruiting.listOpenings(orgId);
  }

  // before `:id` routes
  @Post('suggest-criteria')
  @RequirePermissions('recruiting:create')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  suggest(@Body() dto: SuggestCriteriaDto) {
    return this.pipeline.suggestCriteria(dto.title, dto.description);
  }

  @Get(':id')
  @RequirePermissions('recruiting:read')
  get(@OrgId() orgId: string, @Param('id') id: string) {
    return this.recruiting.getOpening(orgId, id);
  }

  @Post()
  @RequirePermissions('recruiting:create')
  create(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateOpeningDto) {
    return this.recruiting.createOpening(orgId, user.id, dto);
  }

  @Patch(':id')
  @RequirePermissions('recruiting:update')
  update(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateOpeningDto) {
    return this.recruiting.updateOpening(orgId, user.id, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('recruiting:delete')
  remove(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.recruiting.removeOpening(orgId, user.id, id);
  }

  /** HR edited the criteria (or new CVs arrived): rerun stages 2-4. */
  @Post(':id/rank')
  @RequirePermissions('recruiting:update')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  rank(@OrgId() orgId: string, @Param('id') id: string) {
    return this.recruiting.rank(orgId, id);
  }

  @Post(':id/candidates')
  @RequirePermissions('recruiting:create')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(CV_UPLOAD)
  upload(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFiles() files: UploadedCv[]) {
    return this.recruiting.upload(orgId, user.id, id, files);
  }
}

@ApiTags('recruiting')
@ApiBearerAuth()
@Controller('recruiting/candidates')
export class CandidatesController {
  constructor(private readonly recruiting: RecruitingService) {}

  @Get(':id')
  @RequirePermissions('recruiting:read')
  get(@OrgId() orgId: string, @Param('id') id: string) {
    return this.recruiting.getCandidate(orgId, id);
  }

  @Get(':id/file')
  @RequirePermissions('recruiting:read')
  file(@OrgId() orgId: string, @Param('id') id: string) {
    return this.recruiting.candidateFileUrl(orgId, id);
  }

  @Patch(':id/decision')
  @RequirePermissions('recruiting:approve')
  decide(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.recruiting.decide(orgId, user.id, id, dto);
  }

  @Post(':id/retry')
  @RequirePermissions('recruiting:update')
  retry(@OrgId() orgId: string, @Param('id') id: string) {
    return this.recruiting.retry(orgId, id);
  }

  @Delete(':id')
  @RequirePermissions('recruiting:delete')
  remove(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.recruiting.removeCandidate(orgId, user.id, id);
  }
}
