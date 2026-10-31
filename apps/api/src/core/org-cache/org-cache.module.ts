import { Global, Module } from '@nestjs/common';
import { OrgCacheService } from './org-cache.service';

@Global()
@Module({
  providers: [OrgCacheService],
  exports: [OrgCacheService],
})
export class OrgCacheModule {}
