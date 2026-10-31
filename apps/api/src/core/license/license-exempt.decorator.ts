import { SetMetadata } from '@nestjs/common';

export const LICENSE_EXEMPT_KEY = 'licenseExempt';
/**
 * Writes that stay allowed while a self-hosted install is read-only (license
 * expired / missing): signing in, installing a license, exporting data.
 */
export const LicenseExempt = () => SetMetadata(LICENSE_EXEMPT_KEY, true);
