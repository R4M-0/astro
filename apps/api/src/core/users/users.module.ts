import { Module } from '@nestjs/common';
import { PlatformModule } from '../../modules/platform/platform.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { MemberAdminService } from './member-admin.service';

@Module({
  imports: [MailModule, PlatformModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService, MemberAdminService],
  exports: [UsersService, MemberAdminService],
})
export class UsersModule {}
