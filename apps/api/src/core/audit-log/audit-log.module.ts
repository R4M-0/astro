import { Global, Module } from '@nestjs/common';
import { AuditChainService } from './audit-chain.service';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { AuditWriter } from './audit-writer.service';

/** Global: the app-level interceptor and every module that records a compliance event write through AuditWriter. */
@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService, AuditWriter, AuditChainService],
  exports: [AuditWriter, AuditChainService],
})
export class AuditLogModule {}
