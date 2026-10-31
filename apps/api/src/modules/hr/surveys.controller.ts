import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Granted } from '../../common/decorators/granted.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateHrSurveyDto,
  HrSurveyQuery,
  MemberSurveyResponseDto,
  PublicSurveyResponseDto,
  ReorderHrSurveyQuestionsDto,
  UpdateHrSurveyDto,
  UpdateHrSurveyQuestionDto,
  UpsertHrSurveyQuestionDto,
} from './dto/surveys.dto';
import { SurveysService } from './surveys.service';

@ApiTags('hr')
@Controller('hr/surveys')
export class SurveysController {
  constructor(private readonly surveys: SurveysService) {}

  // ── public — no auth (must precede ':id') ──
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get('public/:token')
  publicSurvey(@Param('token') token: string) {
    return this.surveys.publicSurvey(token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('public/:token/responses')
  publicRespond(@Param('token') token: string, @Body() dto: PublicSurveyResponseDto) {
    return this.surveys.publicRespond(token, dto);
  }

  // ── surveys ──
  @ApiBearerAuth()
  @Get()
  @RequirePermissions('hr-surveys:read')
  list(@OrgId() orgId: string, @Query() q: HrSurveyQuery, @Granted() granted: Set<string>) {
    return this.surveys.list('HR', orgId, q, granted.has('hr-surveys:update'));
  }

  @ApiBearerAuth()
  @Get(':id')
  @RequirePermissions('hr-surveys:read')
  get(@OrgId() orgId: string, @Param('id') id: string, @Granted() granted: Set<string>) {
    return this.surveys.get('HR', orgId, id, granted.has('hr-surveys:update'));
  }

  // ── answering as a signed-in member (any member; identity = session → verified) ──
  @ApiBearerAuth()
  @Get(':id/form')
  memberForm(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.surveys.memberForm('HR', orgId, user.id, id);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':id/respond')
  memberRespond(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MemberSurveyResponseDto,
  ) {
    return this.surveys.memberRespond('HR', orgId, user.id, id, dto);
  }

  @ApiBearerAuth()
  @Post()
  @RequirePermissions('hr-surveys:create')
  create(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateHrSurveyDto) {
    return this.surveys.create('HR', orgId, user.id, { ...dto });
  }

  @ApiBearerAuth()
  @Patch(':id')
  @RequirePermissions('hr-surveys:update')
  update(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateHrSurveyDto) {
    return this.surveys.update('HR', orgId, user.id, id, { ...dto });
  }

  @ApiBearerAuth()
  @Delete(':id')
  @RequirePermissions('hr-surveys:delete')
  remove(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.surveys.remove('HR', orgId, user.id, id);
  }

  // ── lifecycle ──
  @ApiBearerAuth()
  @Post(':id/publish')
  @RequirePermissions('hr-surveys:update')
  publish(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.surveys.publish('HR', orgId, user.id, id);
  }

  @ApiBearerAuth()
  @Post(':id/close')
  @RequirePermissions('hr-surveys:update')
  close(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.surveys.close('HR', orgId, user.id, id);
  }

  @ApiBearerAuth()
  @Post(':id/reopen')
  @RequirePermissions('hr-surveys:update')
  reopen(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.surveys.reopen('HR', orgId, user.id, id);
  }

  @ApiBearerAuth()
  @Post(':id/unpublish')
  @RequirePermissions('hr-surveys:update')
  unpublish(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.surveys.unpublish('HR', orgId, user.id, id);
  }

  // ── questions (DRAFT only) ──
  @ApiBearerAuth()
  @Post(':id/questions')
  @RequirePermissions('hr-surveys:update')
  addQuestion(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpsertHrSurveyQuestionDto,
  ) {
    return this.surveys.addQuestion('HR', orgId, user.id, id, dto);
  }

  @ApiBearerAuth()
  @Put(':id/questions/order')
  @RequirePermissions('hr-surveys:update')
  reorder(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReorderHrSurveyQuestionsDto,
  ) {
    return this.surveys.reorderQuestions('HR', orgId, user.id, id, dto.questionIds);
  }

  @ApiBearerAuth()
  @Patch(':id/questions/:questionId')
  @RequirePermissions('hr-surveys:update')
  updateQuestion(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() dto: UpdateHrSurveyQuestionDto,
  ) {
    return this.surveys.updateQuestion('HR', orgId, user.id, id, questionId, dto);
  }

  @ApiBearerAuth()
  @Delete(':id/questions/:questionId')
  @RequirePermissions('hr-surveys:update')
  deleteQuestion(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
  ) {
    return this.surveys.deleteQuestion('HR', orgId, user.id, id, questionId);
  }

  // ── responses ──
  @ApiBearerAuth()
  @Get(':id/responses')
  @RequirePermissions('hr-surveys:read')
  responses(@OrgId() orgId: string, @Param('id') id: string) {
    return this.surveys.responses('HR', orgId, id);
  }

  @ApiBearerAuth()
  @Get(':id/results')
  @RequirePermissions('hr-surveys:read')
  results(@OrgId() orgId: string, @Param('id') id: string) {
    return this.surveys.results('HR', orgId, id);
  }

  @ApiBearerAuth()
  @Delete(':id/responses/:responseId')
  @RequirePermissions('hr-surveys:delete')
  deleteResponse(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('responseId') responseId: string,
  ) {
    return this.surveys.deleteResponse('HR', orgId, user.id, id, responseId);
  }
}
