import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
}

export class SuggestCriteriaDto {
  @IsString() @IsNotEmpty() @MaxLength(200) title: string;
  @IsString() @IsNotEmpty() @MaxLength(20_000) description: string;
}

export class DecisionDto {
  @IsIn(DECISIONS as unknown as string[]) decision: (typeof DECISIONS)[number];
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
