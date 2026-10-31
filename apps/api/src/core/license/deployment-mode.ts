/**
 * Build-time constants injected by `scripts/build-protected.mjs` (esbuild
 * `define`) into the self-hosted image. A protected build is ALWAYS self-hosted
 * and only trusts the public key it was built with — neither can be changed by
 * the customer through environment variables.
 *
 * Unbundled runs (dev, `nest build`, tests) fall back to DEPLOYMENT_MODE /
 * LICENSE_PUBLIC_KEY so the license flow can be exercised locally.
 */
declare const __ASTRO_PROTECTED_BUILD__: boolean | undefined;
declare const __ASTRO_LICENSE_PUBLIC_KEY__: string | undefined;
declare const __ASTRO_BUILD_DATE__: string | undefined;

export const PROTECTED_BUILD = typeof __ASTRO_PROTECTED_BUILD__ !== 'undefined' && __ASTRO_PROTECTED_BUILD__ === true;

export const SELF_HOSTED = PROTECTED_BUILD || process.env.DEPLOYMENT_MODE === 'self-hosted';

export const DEPLOYMENT_MODE: 'saas' | 'self-hosted' = SELF_HOSTED ? 'self-hosted' : 'saas';

export function licensePublicKey(): string | null {
  if (PROTECTED_BUILD) {
    return typeof __ASTRO_LICENSE_PUBLIC_KEY__ !== 'undefined' ? __ASTRO_LICENSE_PUBLIC_KEY__ : null;
  }
  return process.env.LICENSE_PUBLIC_KEY || null;
}

/** When this image was built — compared to the license's update entitlement. */
export const BUILD_DATE: Date | null =
  typeof __ASTRO_BUILD_DATE__ !== 'undefined' && __ASTRO_BUILD_DATE__ ? new Date(__ASTRO_BUILD_DATE__) : null;
