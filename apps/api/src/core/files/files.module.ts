import { Global, Module } from '@nestjs/common';
import { AttachmentsCleanupCronService } from './attachments-cleanup-cron.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { StorageQuotaService } from './storage-quota';

@Global()
@Module({
  controllers: [FilesController],
  providers: [FilesService, StorageQuotaService, AttachmentsCleanupCronService],
  exports: [FilesService, StorageQuotaService],
})
export class FilesModule {}
