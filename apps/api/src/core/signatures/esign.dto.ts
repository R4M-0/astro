import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/** Credentials re-entered to sign (password, or TOTP when 2FA is on). */
export class ESignDto {
  @IsOptional() @IsString() @MaxLength(128) password?: string;
  @IsOptional() @IsString() @MaxLength(16) totp?: string;
}

/** Mixin-style property for DTOs that carry an e-signature. */
export class WithESignDto {
  @IsOptional() @ValidateNested() @Type(() => ESignDto) esign?: ESignDto;
}
