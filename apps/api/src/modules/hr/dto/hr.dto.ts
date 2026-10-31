import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';
import { MaxJsonSize } from '../../../common/validators/max-json-size';

export const CONTRACT_TYPES = ['CDI', 'CDD', 'INTERIM', 'APPRENTICESHIP', 'INTERNSHIP', 'FREELANCE', 'OTHER'] as const;

export const SKILL_TYPES = ['TECHNICAL', 'BEHAVIORAL'] as const;
export const HR_TRAINING_TYPES = ['INTERNE', 'INTRA', 'EXTERNE', 'PRESTATAIRE'] as const;
export const TRAINING_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const TRAINING_EVAL_TYPES = ['HOT', 'COLD'] as const;
export const JOB_DESCRIPTION_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

// ── employees ──────────────────────────────────────────────────────────────
export class EmployeeQuery extends PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) override pageSize = 50;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsBoolean() @Type(() => Boolean) active?: boolean;
  @IsOptional() @IsIn(CONTRACT_TYPES as unknown as string[]) contractType?: string;
}

export class CreateEmployeeDto {
  @IsString() @IsNotEmpty() @MaxLength(120) firstName: string;
  @IsString() @IsNotEmpty() @MaxLength(120) lastName: string;
  @IsOptional() @IsString() @MaxLength(200) contact?: string;
  @IsOptional() @IsEmail() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(200) cin?: string;
  @IsOptional() @IsString() @MaxLength(200) jobTitle?: string;
  @IsOptional() @IsString() @MaxLength(64) departmentId?: string;
  @IsOptional() @IsString() @MaxLength(64) managerId?: string;
  @IsOptional() @IsString() @MaxLength(64) userId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsDateString() hireDate?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsIn(CONTRACT_TYPES as unknown as string[]) contractType?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsDateString() trialEndDate?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsDateString() exitDate?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) exitReason?: string;
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) firstName?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) lastName?: string;
  @IsOptional() @IsString() @MaxLength(200) contact?: string;
  @IsOptional() @IsString() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(200) cin?: string;
  @IsOptional() @IsString() @MaxLength(200) jobTitle?: string;
  @IsOptional() @IsString() @MaxLength(64) departmentId?: string;
  @IsOptional() @IsString() @MaxLength(64) managerId?: string;
  @IsOptional() @IsString() @MaxLength(64) userId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsDateString() hireDate?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsIn(CONTRACT_TYPES as unknown as string[]) contractType?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsDateString() trialEndDate?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsDateString() exitDate?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) exitReason?: string;
  @IsOptional() @IsString() @MaxLength(64) jobDescriptionId?: string; // assign / reassign fiche de poste (null clears)
}

// ── skills ─────────────────────────────────────────────────────────────────
export class SkillQuery {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(SKILL_TYPES as unknown as string[]) type?: string;
}

export class CreateSkillDto {
  @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsIn(SKILL_TYPES as unknown as string[]) type: string;
}

export class UpdateSkillDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsIn(SKILL_TYPES as unknown as string[]) type?: string;
}

// ── job descriptions ─────────────────────────────────────────────────────────
class JobActivityDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) description: string;
  @IsOptional() @IsString() @MaxLength(200) frequency?: string;
}

class SkillRequirementDto {
  @IsString() @IsNotEmpty() skillId: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(5) requiredLevel: number;
}

class RequiredTrainingDto {
  @IsString() @IsNotEmpty() @MaxLength(300) formation: string;
  @IsOptional() @IsString() @MaxLength(200) level?: string;
}

export class JobDescriptionQuery extends PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) override pageSize = 50;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsIn(JOB_DESCRIPTION_STATUSES as unknown as string[]) status?: string;
}

export class CreateJobDescriptionDto {
  @IsString() @IsNotEmpty() @MaxLength(60) reference: string;
  @IsString() @IsNotEmpty() @MaxLength(30) version: string;
  @IsString() @IsNotEmpty() @MaxLength(200) jobTitle: string;
  @IsOptional() @IsDateString() applicationDate?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsString() replacementId?: string;
  @IsOptional() @IsString() @MaxLength(4000) mainMission?: string;
  @IsOptional() @IsString() @MaxLength(4000) hierarchicalLink?: string;
  @IsOptional() @IsString() @MaxLength(4000) functionalLink?: string;
  @IsOptional() @IsString() @MaxLength(4000) jobPurpose?: string;
  @IsOptional() @IsString() @MaxLength(4000) authority?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minExperienceMonths?: number;
  @IsOptional() @IsString() @MaxLength(500) experienceDomain?: string;
  @IsOptional() @IsIn(JOB_DESCRIPTION_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => RequiredTrainingDto)
  requiredTraining?: RequiredTrainingDto[];
  @IsOptional() @IsObject() @MaxJsonSize(4000) qualityAwareness?: Record<string, boolean>;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => JobActivityDto)
  activities?: JobActivityDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SkillRequirementDto)
  skillRequirements?: SkillRequirementDto[];
}

export class UpdateJobDescriptionDto extends CreateJobDescriptionDto {
  @IsOptional() declare reference: string;
  @IsOptional() declare version: string;
  @IsOptional() declare jobTitle: string;
}

// ── competency evaluations ───────────────────────────────────────────────────
export class EvaluationQuery {
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() skillId?: string;
}

export class UpsertEvaluationDto {
  @IsString() @IsNotEmpty() employeeId: string;
  @IsString() @IsNotEmpty() skillId: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(5) evaluatedLevel: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) expectedLevel?: number;
  @IsOptional() @IsString() @MaxLength(2000) evaluationMethod?: string;
  @IsOptional() @IsString() @MaxLength(2000) requiredAction?: string;
}

// ── trainings ────────────────────────────────────────────────────────────────
export class TrainingQuery extends PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) override pageSize = 100;
  @IsOptional() @IsIn(TRAINING_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsIn(HR_TRAINING_TYPES as unknown as string[]) type?: string;
  @IsOptional() @IsString() departmentId?: string;
}

export class CreateTrainingDto {
  @IsString() @IsNotEmpty() @MaxLength(60) code: string;
  @IsString() @IsNotEmpty() @MaxLength(300) theme: string;
  @IsIn(HR_TRAINING_TYPES as unknown as string[]) type: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsIn(TRAINING_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsString() @MaxLength(5000) observation?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsString({ each: true }) participantIds?: string[];
}

export class UpdateTrainingDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) code?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(300) theme?: string;
  @IsOptional() @IsIn(HR_TRAINING_TYPES as unknown as string[]) type?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsIn(TRAINING_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsString() @MaxLength(5000) observation?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() departmentId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsString({ each: true }) participantIds?: string[];
}

// public feedback (à chaud / à froid)
export class PublicFeedbackDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5) satisfactionScore: number;
  @IsOptional() @IsObject() @MaxJsonSize(10000) answers?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(200) respondentName?: string;
}

export class PresenceDto {
  @IsBoolean() present: boolean;
}
