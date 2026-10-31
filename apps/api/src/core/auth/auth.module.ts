import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MailModule } from '../mail/mail.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DefaultCredentialsCheck } from './default-credentials.check';
import { InvitationsService } from './invitations.service';
import { JwtStrategy } from './jwt.strategy';
import { LoginGuardService } from './login-guard.service';

@Module({
  imports: [PassportModule, JwtModule.register({}), MailModule, RbacModule],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, InvitationsService, LoginGuardService, DefaultCredentialsCheck],
  exports: [AuthService, InvitationsService],
})
export class AuthModule {}
