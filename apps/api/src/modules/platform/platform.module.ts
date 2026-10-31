import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { MailModule } from '../../core/mail/mail.module';
import { RbacModule } from '../../core/rbac/rbac.module';
import { BillingController } from './billing.controller';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PublicContactController } from './public-contact.controller';
import { PublicPlansController } from './public-plans.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PlatformLicensesController } from './platform-licenses.controller';
import { PlatformLicensesService } from './platform-licenses.service';
import { SELF_HOSTED } from '../../core/license/deployment-mode';

/**
 * The SaaS / platform layer: Super Admin org & subscription management, seat
 * accounting (SubscriptionsService is exported so the invite flow can enforce
 * quota), org-facing billing, self-hosted license issuing, and the immutable
 * platform audit trail.
 */
@Module({
  imports: [AuthModule, RbacModule, MailModule],
  // a self-hosted install has no platform staff area, billing, public plans or contact form —
  // its limits come from the signed license (core/license)
  controllers: SELF_HOSTED
    ? []
    : [PlatformController, PlatformLicensesController, BillingController, PublicPlansController, PublicContactController],
  providers: [PlatformService, SubscriptionsService, PlatformAuditService, PlatformLicensesService],
  exports: [SubscriptionsService, PlatformAuditService],
})
export class PlatformModule {}
