import { Module } from '@nestjs/common';
import { UsersModule } from '../../core/users/users.module';
import { HrDashboardController } from './dashboard.controller';
import { HrDashboardService } from './dashboard.service';
import { HrImportService } from './hr-import.service';
import { HrImportController, JourneysController, OnboardingTemplateController, SelfServiceController } from './journeys.controller';
import { JourneysCronService } from './journeys-cron.service';
import { JourneysService } from './journeys.service';
import { SelfServiceService } from './self-service.service';
import {
  EmployeesController,
  EvaluationsController,
  JobDescriptionsController,
  SkillsController,
  TrainingsController,
} from './hr.controller';
import { EmployeesService } from './employees.service';
import { EvaluationsService } from './evaluations.service';
import { JobDescriptionsService } from './job-descriptions.service';
import { SkillsService } from './skills.service';
import { TrainingsService } from './trainings.service';
import { SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';

@Module({
  imports: [UsersModule],
  controllers: [
    HrDashboardController,
    SelfServiceController,
    HrImportController,
    JourneysController,
    // before JobDescriptionsController: `:id/onboarding` must not be shadowed
    OnboardingTemplateController,
    EmployeesController,
    SkillsController,
    JobDescriptionsController,
    EvaluationsController,
    TrainingsController,
    SurveysController,
  ],
  providers: [
    HrDashboardService,
    EmployeesService,
    SkillsService,
    JobDescriptionsService,
    EvaluationsService,
    TrainingsService,
    SurveysService,
    JourneysService,
    JourneysCronService,
    SelfServiceService,
    HrImportService,
  ],
})
export class HrModule {}
