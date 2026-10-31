import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NormalizeEmail } from '../../../common/decorators/normalize-email.decorator';
import { Equals, IsEmail, IsNotEmpty, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty()
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  firstName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  lastName: string;

  @ApiPropertyOptional({ description: 'Creates an organization and grants org_admin' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizationName?: string;

  @ApiProperty({ description: 'Must be true: the user accepts the terms of service and privacy policy' })
  @Equals(true, { message: 'The terms of service and privacy policy must be accepted' })
  acceptTerms: boolean;

  @ApiProperty({ description: 'Version (date) of the legal documents accepted, e.g. 2026-10-21' })
  @IsString()
  @MaxLength(20)
  termsVersion: string;
}

export class LoginDto {
  @ApiProperty()
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}

export class TwoFactorLoginDto {
  @ApiProperty({ description: 'Short-lived 2FA challenge token from /auth/login' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  challengeToken: string;

  @ApiProperty({ description: '6-digit TOTP code or a recovery code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code: string;
}

export class TwoFactorCodeDto {
  @ApiProperty({ description: '6-digit TOTP code' })
  @IsString()
  @Length(6, 6)
  code: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  newPassword: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;
}

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;
}
