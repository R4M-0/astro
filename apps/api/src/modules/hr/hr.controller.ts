import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Granted } from '../../common/decorators/granted.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateEmployeeDto,
  CreateJobDescriptionDto,
  CreateSkillDto,
  CreateTrainingDto,
  EmployeeQuery,
  EvaluationQuery,
  JobDescriptionQuery,
  PresenceDto,
  PublicFeedbackDto,
  SkillQuery,
  TrainingQuery,
  UpdateEmployeeDto,
  UpdateJobDescriptionDto,
  UpdateSkillDto,
  UpdateTrainingDto,
  UpsertEvaluationDto,
} from './dto/hr.dto';
import { EmployeesService } from './employees.service';
import { EvaluationsService } from './evaluations.service';
import { JobDescriptionsService } from './job-descriptions.service';
import { SkillsService } from './skills.service';
import { TrainingsService } from './trainings.service';

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermissions('employees:read')
  list(@OrgId() orgId: string, @Query() q: EmployeeQuery) {
    return this.employees.list(orgId, q);
  }

  @Get('org-chart')
  @RequirePermissions('employees:read')
  orgChart(@OrgId() orgId: string) {
    return this.employees.orgChart(orgId);
  }

  @Get(':id')
  @RequirePermissions('employees:read')
  get(@OrgId() orgId: string, @Param('id') id: string) {
    return this.employees.get(orgId, id);
  }

  @Post()
  @RequirePermissions('employees:create')
  create(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(orgId, user.id, { ...dto });
  }

  @Patch(':id')
  @RequirePermissions('employees:update')
  update(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @Granted() granted: Set<string>,
  ) {
    return this.employees.update(orgId, user.id, id, { ...dto }, granted);
  }

  @Delete(':id')
  @RequirePermissions('employees:delete')
  remove(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.employees.remove(orgId, user.id, id);
  }
}

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  @RequirePermissions('skills:read')
  list(@OrgId() orgId: string, @Query() q: SkillQuery) {
    return this.skills.list(orgId, q);
  }

  @Get(':id')
  @RequirePermissions('skills:read')
  get(@OrgId() orgId: string, @Param('id') id: string, @Granted() granted: Set<string>) {
    return this.skills.get(orgId, id, granted);
  }

  @Post()
  @RequirePermissions('skills:create')
  create(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateSkillDto) {
    return this.skills.create(orgId, user.id, { ...dto });
  }

  @Patch(':id')
  @RequirePermissions('skills:update')
  update(@OrgId() orgId: string, @Param('id') id: string, @Body() dto: UpdateSkillDto) {
    return this.skills.update(orgId, id, { ...dto });
  }

  @Delete(':id')
  @RequirePermissions('skills:delete')
  remove(@OrgId() orgId: string, @Param('id') id: string) {
    return this.skills.remove(orgId, id);
  }
}

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/job-descriptions')
export class JobDescriptionsController {
  constructor(private readonly jobDescriptions: JobDescriptionsService) {}

  @Get()
  @RequirePermissions('job-descriptions:read')
  list(@OrgId() orgId: string, @Query() q: JobDescriptionQuery) {
    return this.jobDescriptions.list(orgId, q);
  }

  @Get(':id')
  @RequirePermissions('job-descriptions:read')
  get(@OrgId() orgId: string, @Param('id') id: string) {
    return this.jobDescriptions.get(orgId, id);
  }

  @Post()
  @RequirePermissions('job-descriptions:create')
  create(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateJobDescriptionDto,
  ) {
    return this.jobDescriptions.create(orgId, user.id, { ...dto });
  }

  @Patch(':id')
  @RequirePermissions('job-descriptions:update')
  update(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateJobDescriptionDto,
  ) {
    return this.jobDescriptions.update(orgId, user.id, id, { ...dto });
  }

  @Delete(':id')
  @RequirePermissions('job-descriptions:delete')
  remove(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobDescriptions.remove(orgId, user.id, id);
  }
}

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/evaluations')
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Get('matrix')
  @RequirePermissions('competency-evaluations:read')
  matrix(@OrgId() orgId: string, @Query('departmentId') departmentId?: string) {
    return this.evaluations.matrix(orgId, departmentId || undefined);
  }

  @Get('dashboard')
  @RequirePermissions('competency-evaluations:read')
  dashboard(@OrgId() orgId: string, @Query('departmentId') departmentId?: string) {
    return this.evaluations.dashboard(orgId, departmentId || undefined);
  }

  @Get()
  @RequirePermissions('competency-evaluations:read')
  list(@OrgId() orgId: string, @Query() q: EvaluationQuery) {
    return this.evaluations.list(orgId, q.employeeId, q.skillId);
  }

  @Post()
  @RequirePermissions('competency-evaluations:update')
  upsert(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertEvaluationDto,
  ) {
    return this.evaluations.upsert(orgId, user.id, { ...dto });
  }

  @Delete(':id')
  @RequirePermissions('competency-evaluations:delete')
  remove(@OrgId() orgId: string, @Param('id') id: string) {
    return this.evaluations.remove(orgId, id);
  }
}

@ApiTags('hr')
@Controller('hr/trainings')
export class TrainingsController {
  constructor(private readonly trainings: TrainingsService) {}

  // public — no auth (must precede ':id')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get('public/:token')
  publicTraining(@Param('token') token: string) {
    return this.trainings.publicTraining(token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('public/:token/responses')
  publicRespond(@Param('token') token: string, @Body() dto: PublicFeedbackDto) {
    return this.trainings.publicRespond(token, { ...dto });
  }

  @ApiBearerAuth()
  @Get('dashboard')
  @RequirePermissions('hr-trainings:read')
  dashboard(@OrgId() orgId: string, @Query('departmentId') departmentId?: string) {
    return this.trainings.dashboard(orgId, departmentId || undefined);
  }

  @ApiBearerAuth()
  @Get()
  @RequirePermissions('hr-trainings:read')
  list(@OrgId() orgId: string, @Query() q: TrainingQuery, @Granted() granted: Set<string>) {
    return this.trainings.list(orgId, q, granted.has('hr-trainings:update'));
  }

  @ApiBearerAuth()
  @Get(':id')
  @RequirePermissions('hr-trainings:read')
  get(@OrgId() orgId: string, @Param('id') id: string, @Granted() granted: Set<string>) {
    return this.trainings.get(orgId, id, granted.has('hr-trainings:update'));
  }

  @ApiBearerAuth()
  @Post()
  @RequirePermissions('hr-trainings:create')
  create(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateTrainingDto) {
    return this.trainings.create(orgId, user.id, { ...dto });
  }

  @ApiBearerAuth()
  @Patch(':id')
  @RequirePermissions('hr-trainings:update')
  update(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTrainingDto,
  ) {
    return this.trainings.update(orgId, user.id, id, { ...dto });
  }

  @ApiBearerAuth()
  @Post(':id/participants/:participantId/presence')
  @RequirePermissions('hr-trainings:update')
  setPresence(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Param('participantId') participantId: string,
    @Body() dto: PresenceDto,
  ) {
    return this.trainings.setPresence(orgId, id, participantId, dto.present);
  }

  @ApiBearerAuth()
  @Delete(':id')
  @RequirePermissions('hr-trainings:delete')
  remove(@OrgId() orgId: string, @CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.trainings.remove(orgId, user.id, id);
  }
}
