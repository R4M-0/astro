import { Global, Module } from '@nestjs/common';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';

/** Self-hosted licensing (inert on the SaaS) — see license.service.ts. */
@Global()
@Module({
  controllers: [LicenseController],
  providers: [LicenseService],
  exports: [LicenseService],
})
export class LicenseModule {}
