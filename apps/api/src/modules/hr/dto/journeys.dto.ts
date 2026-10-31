import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';
import { WithESignDto } from '../../../core/signatures/esign.dto';
import { HANDOVER_CATEGORIES } from '../journeys.service';

export const JOURNEY_KINDS = ['ONBOARDING', 'OFFBOARDING'] as const;
export const JOURNEY_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const JOURNEY_ITEM_KINDS = ['TRAINING', 'TASK'] as const;
export const TRIAL_DECISIONS = ['CONFIRMED', 'EXTENDED', 'TERMINATED'] as const;

export class JourneyQuery extends PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) override pageSize = 50;
  @IsOptional() @IsIn(JOURNEY_KINDS as unknown as string[]) kind?: string;
  @IsOptional() @IsIn(JOURNEY_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() departmentId?: string;
}

export class CreateJourneyDto {
  @IsIn(JOURNEY_KINDS as unknown as string[]) kind: string;
  @IsString() @IsNotEmpty() @MaxLength(64) employeeId: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() targetDate?: string;
  @IsOptional() @IsString() @MaxLength(64) ownerId?: string;
  @IsOptional() @IsString() @MaxLength(64) buddyId?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsString() @MaxLength(1000) exitReason?: string;
}

export class UpdateJourneyDto {
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsDateString() targetDate?: string | null;
  @IsOptional() @IsString() @MaxLength(64) ownerId?: string;
  @IsOptional() @IsString() @MaxLength(64) buddyId?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsString() @MaxLength(1000) exitReason?: string;
  @IsOptional() @IsIn(['IN_PROGRESS', 'CANCELLED']) status?: string;
}

export class JourneyItemDto {
  @IsIn(JOURNEY_ITEM_KINDS as unknown as string[]) kind: string;
  @IsString() @IsNotEmpty() @MaxLength(500) label: string;
  @IsOptional() @IsString() @MaxLength(64) trainingId?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class UpdateJourneyItemDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) label?: string;
  @IsOptional() @IsString() @MaxLength(64) trainingId?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null && v !== '') @IsDateString() dueDate?: string | null;
}

export class ToggleItemDto {
  @IsBoolean() done: boolean;
}

export class TrialSignOffDto extends WithESignDto {
  @IsIn(TRIAL_DECISIONS as unknown as string[]) decision: 'CONFIRMED' | 'EXTENDED' | 'TERMINATED';
  @IsOptional() @IsString() @MaxLength(4000) comment?: string;
  @IsOptional() @IsDateString() extendedUntil?: string;
}

export class HandoverDto {
  @IsString() @IsNotEmpty() @MaxLength(64) toUserId: string;
  @IsArray() @ArrayMaxSize(50) @IsIn(HANDOVER_CATEGORIES.map((c) => c.key), { each: true }) categories: string[];
}

class TemplateItemDto {
  @IsIn(JOURNEY_ITEM_KINDS as unknown as string[]) kind: string;
  @IsString() @IsNotEmpty() @MaxLength(500) label: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(730) dueDays?: number;
}

export class SetTemplateDto {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) @Max(730) trialPeriodDays?: number | null;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TemplateItemDto) items: TemplateItemDto[];
}

const bool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

/** Multipart fields of the HR workbook imports. */
export class HrImportOptionsDto {
  @IsOptional() @Transform(bool) @IsBoolean() updateExisting?: boolean;
  @IsOptional() @Transform(bool) @IsBoolean() createSkills?: boolean;
}
