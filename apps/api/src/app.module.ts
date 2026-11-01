import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
import { AuditLogModule } from './core/audit-log/audit-log.module';
import { AuthModule } from './core/auth/auth.module';
import { FilesModule } from './core/files/files.module';
import { MailModule } from './core/mail/mail.module';
import { NotificationsModule } from './core/notifications/notifications.module';
import { OrganizationsModule } from './core/organizations/organizations.module';
import { RbacModule } from './core/rbac/rbac.module';
import { UsersModule } from './core/users/users.module';
import { ActivityModule } from './core/activity/activity.module';
import { DepartmentScopeModule } from './core/department-scope/department-scope.module';
import { GroupsModule } from './core/groups/groups.module';
import { HistoryModule } from './core/history/history.module';
import { EntitiesModule } from './core/entities/entities.module';
import { EsignModule } from './core/signatures/esign.module';
import { HistoryInterceptor } from './core/history/history.interceptor';
import { HrModule } from './modules/hr/hr.module';
import { RecruitingModule } from './modules/recruiting/recruiting.module';
import { PlatformModule } from './modules/platform/platform.module';
import { LicenseModule } from './core/license/license.module';
import { LicenseGuard } from './core/license/license.guard';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './core/redis/redis.module';
import { AuthCacheModule } from './core/auth-cache/auth-cache.module';
import { OrgCacheModule } from './core/org-cache/org-cache.module';
import { JobsModule } from './core/jobs/jobs.module';
import { RUNS_JOBS } from './core/jobs/app-role';
import { RedisThrottlerStorage } from './core/redis/redis-throttler.storage';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    RedisModule,
    AuthCacheModule,
    OrgCacheModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.get('REDIS_URL', 'redis://localhost:6379'));
        return {
          prefix: 'astro:bull',
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            username: url.username || undefined,
            password: url.password ? decodeURIComponent(url.password) : undefined,
            db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
            maxRetriesPerRequest: null, // required by BullMQ workers
          },
        };
      },
    }),
    // daily schedules + queue consumers run only in `worker`/`all` processes
    ...(RUNS_JOBS ? [ScheduleModule.forRoot(), JobsModule] : []),
    // counters live in Redis so limits hold across API replicas and deploys
    ThrottlerModule.forRootAsync({
      inject: [RedisThrottlerStorage, ConfigService],
      useFactory: (storage: RedisThrottlerStorage, config: ConfigService) => ({
        // per client IP; raise temporarily for load tests driven from a single machine
        throttlers: [{ ttl: 60000, limit: Number(config.get('RATE_LIMIT_PER_MIN', 300)) }],
        storage,
      }),
    }),
    PrismaModule,
    LicenseModule,
    MailModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    RbacModule,
    NotificationsModule,
    FilesModule,
    AuditLogModule,
    ActivityModule,
    HistoryModule,
    EntitiesModule,
    EsignModule,
    DepartmentScopeModule,
    GroupsModule,
    HrModule,
    RecruitingModule,
    PlatformModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // self-hosted: refuse writes once the license is expired / missing (no-op on the SaaS)
    { provide: APP_GUARD, useClass: LicenseGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: HistoryInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
