import { Type } from 'class-transformer';
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

export const HR_SURVEY_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const;
export const HR_SURVEY_QUESTION_TYPES = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'YES_NO',
  'RATING',
] as const;
export type HrSurveyQuestionTypeValue = (typeof HR_SURVEY_QUESTION_TYPES)[number];

export class HrSurveyQuery extends PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) override pageSize = 50;
  @IsOptional() @IsIn(HR_SURVEY_STATUSES) status?: (typeof HR_SURVEY_STATUSES)[number];
}

export class CreateHrSurveyDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsBoolean() anonymous?: boolean;
  @IsOptional() @IsBoolean() allowMultipleResponses?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() closesAt?: string | null;
}

export class UpdateHrSurveyDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000) description?: string | null;
  @IsOptional() @IsBoolean() anonymous?: boolean;
  @IsOptional() @IsBoolean() allowMultipleResponses?: boolean;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() closesAt?: string | null;
}

export class HrSurveyOptionDto {
  /** Existing option id (kept on edit) — omitted for new options. */
  @IsOptional() @IsString() id?: string;
  @IsString() @IsNotEmpty() @MaxLength(300) label: string;
}

export class UpsertHrSurveyQuestionDto {
  @IsIn(HR_SURVEY_QUESTION_TYPES) type: HrSurveyQuestionTypeValue;
  @IsString() @IsNotEmpty() @MaxLength(500) label: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) helpText?: string | null;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10) scaleMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10) scaleMax?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(100) scaleMinLabel?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(100) scaleMaxLabel?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HrSurveyOptionDto)
  options?: HrSurveyOptionDto[];
}

/** PATCH accepts a partial question; the merged result is re-validated in the service. */
export class UpdateHrSurveyQuestionDto {
  @IsOptional() @IsIn(HR_SURVEY_QUESTION_TYPES) type?: HrSurveyQuestionTypeValue;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) label?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) helpText?: string | null;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10) scaleMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10) scaleMax?: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(100) scaleMinLabel?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(100) scaleMaxLabel?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HrSurveyOptionDto)
  options?: HrSurveyOptionDto[];
}

export class ReorderHrSurveyQuestionsDto {
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) questionIds: string[];
}

export class PublicSurveyAnswerDto {
  @IsString() @IsNotEmpty() @MaxLength(64) questionId: string;
  @IsOptional() @IsString() @MaxLength(5000) textValue?: string;
  @IsOptional() @Type(() => Number) @IsInt() numberValue?: number;
  @IsOptional() @IsBoolean() boolValue?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) optionIds?: string[];
}

export class PublicSurveyResponseDto {
  @IsString() @IsNotEmpty() @MaxLength(200) respondentKey: string;
  @IsOptional() @IsString() @MaxLength(200) respondentName?: string;
  @IsOptional() @IsString() @MaxLength(320) respondentEmail?: string;
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PublicSurveyAnswerDto)
  answers: PublicSurveyAnswerDto[];
}

/** Signed-in answer: identity comes from the session, so only the answers are taken. */
export class MemberSurveyResponseDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PublicSurveyAnswerDto)
  answers: PublicSurveyAnswerDto[];
}
