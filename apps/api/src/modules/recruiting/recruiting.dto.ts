import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsISO8601,
  IsArray,
  IsBoolean,
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

export const CRITERION_KINDS = ['SKILL', 'LANGUAGE', 'YEARS', 'OTHER'] as const;
export const OPENING_STATUSES = ['OPEN', 'CLOSED'] as const;
export const DECISIONS = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export class CriterionDto {
  @IsString() @IsNotEmpty() @MaxLength(64) id: string;
  @IsString() @IsNotEmpty() @MaxLength(200) label: string;
  @IsInt() @Min(1) @Max(5) weight: number;
  @IsBoolean() mustHave: boolean;
  @IsIn(CRITERION_KINDS as unknown as string[]) kind: (typeof CRITERION_KINDS)[number];
  @IsOptional() @ValidateIf((_o, v) => v !== null && typeof v !== 'number') @IsString() @MaxLength(200) value?: string | number | null;
}

export class CreateOpeningDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @IsString() @IsNotEmpty() @MaxLength(20_000) description: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => CriterionDto) criteria?: CriterionDto[];
  @IsOptional() @IsInt() @Min(1) @Max(500) retrievalSize?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) shortlistSize?: number;
}

export class UpdateOpeningDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20_000) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => CriterionDto) criteria?: CriterionDto[];
  @IsOptional() @IsInt() @Min(1) @Max(500) retrievalSize?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) shortlistSize?: number;
  @IsOptional() @IsIn(OPENING_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsInt() @Min(1) @Max(30) reminderDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) closeDays?: number;
}

export class SuggestCriteriaDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @IsString() @IsNotEmpty() @MaxLength(20_000) description: string;
}

export class DecisionDto {
  @IsIn(DECISIONS as unknown as string[]) decision: (typeof DECISIONS)[number];
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

// ── pipeline 2 ──

export class SlotDto {
  @IsISO8601({ strict: true }) startsAt: string;
  @IsOptional() @IsInt() @Min(10) @Max(480) durationMinutes?: number;
  @IsOptional() @IsString() @MaxLength(300) location?: string;
  @IsOptional() @IsString() @MaxLength(200) interviewer?: string;
}

export class CreateSlotsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SlotDto) slots: SlotDto[];
}

export class RequestDraftsDto {
  @IsIn(['INVITATION', 'REJECTION']) kind: 'INVITATION' | 'REJECTION';
}

export class UpdateMessageDto {
  @IsString() @IsNotEmpty() @MaxLength(300) subject: string;
  @IsString() @IsNotEmpty() @MaxLength(10_000) body: string;
}

export class DraftMessageDto extends UpdateMessageDto {
  @IsOptional() @IsString() @MaxLength(64) inReplyToId?: string;
}

export class ApproveMessagesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsString({ each: true }) ids: string[];
}

export class BookSlotDto {
  @IsString() @IsNotEmpty() @MaxLength(64) slotId: string;
}

export class CandidateReplyDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) text: string;
}
