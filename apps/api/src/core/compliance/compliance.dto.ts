import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DataSubjectType, DsrStatus, DsrType } from '@prisma/client';
import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

const SUBJECT_TYPES: DataSubjectType[] = ['EMPLOYEE', 'CANDIDATE'];

export class CreateDsrDto {
  @ApiProperty({ enum: ['ACCESS', 'ERASURE'] })
  @IsIn(['ACCESS', 'ERASURE'])
  type!: DsrType;

  @ApiProperty({ enum: SUBJECT_TYPES })
  @IsIn(SUBJECT_TYPES)
  subjectType!: DataSubjectType;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  subjectId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  requesterEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional({ description: 'ISO date the request was received (default: now)' })
  @IsOptional()
  @IsDateString()
  receivedAt?: string;
}

export class DsrListQuery {
  @ApiPropertyOptional({ enum: ['OPEN', 'COMPLETED', 'REJECTED'] })
  @IsOptional()
  @IsIn(['OPEN', 'COMPLETED', 'REJECTED'])
  status?: DsrStatus;
}

export class ResolutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  resolution?: string;
}

export class RejectDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  resolution!: string;
}

export class CreateHoldDto {
  @ApiProperty({ enum: SUBJECT_TYPES })
  @IsIn(SUBJECT_TYPES)
  subjectType!: DataSubjectType;

  @ApiProperty()
  @IsString()
  @MaxLength(64)
  subjectId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

export class UpdatePolicyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(36_500)
  retentionDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class SubjectsQuery {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  search!: string;
}

export class AuditExportQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: ['json', 'csv'] })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

export class HoldsQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['true', 'false'])
  all?: string;
}
