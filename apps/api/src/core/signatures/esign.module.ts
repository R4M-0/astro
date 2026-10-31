import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EsignService } from './esign.service';

@Global()
@Module({
  imports: [AuthModule],
  providers: [EsignService],
  exports: [EsignService],
})
export class EsignModule {}
