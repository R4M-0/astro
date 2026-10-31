import { SetMetadata } from '@nestjs/common';

export const TENANT_OPTIONAL_KEY = 'tenantOptional';
/**
 * User-level routes (own profile, sign-out, sessions) that must also work for a
 * signed-in user with no organization — a platform super admin. When the caller
 * has no membership the request proceeds WITHOUT req.orgId, so the handler must
 * never read tenant data. Callers that do have a membership still get the full
 * tenant checks (suspended org, deactivated account).
 */
export const TenantOptional = () => SetMetadata(TENANT_OPTIONAL_KEY, true);
