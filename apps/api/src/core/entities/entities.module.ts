import { Global, Module } from '@nestjs/common';
import { EntityResolverService } from './entity-resolver.service';

@Global()
@Module({
  providers: [EntityResolverService],
  exports: [EntityResolverService],
})
export class EntitiesModule {}
