import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Granted } from '../../common/decorators/granted.decorator';
import { OrgId } from '../../common/decorators/org.decorator';
import { HrDashboardService } from './dashboard.service';

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr')
export class HrDashboardController {
  constructor(private readonly dashboard: HrDashboardService) {}

  /** No single permission: each section is returned only for a register the caller can read. */
  @Get('dashboard')
  get(@OrgId() orgId: string, @Granted() granted: Set<string>) {
    return this.dashboard.dashboard(orgId, granted);
  }
}
