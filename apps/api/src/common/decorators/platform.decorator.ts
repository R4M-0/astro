import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route/controller as PLATFORM-level (operated by Astro staff), not
 * tenant-scoped. TenantGuard and PermissionsGuard skip it (no organization or QMS
 * permission is required); a SuperAdminGuard must gate it instead.
 */
export const IS_PLATFORM_KEY = 'isPlatform';
export const Platform = () => SetMetadata(IS_PLATFORM_KEY, true);
