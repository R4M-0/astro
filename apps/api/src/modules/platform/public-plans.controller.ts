import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SubscriptionsService } from './subscriptions.service';

/** Unauthenticated plan catalogue for the public marketing / pricing page. */
@ApiTags('public')
@Controller('public')
export class PublicPlansController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Public()
  @Get('plans')
  plans() {
    return this.subs.listPlans({ publicOnly: true });
  }
}
