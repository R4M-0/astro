/**
 * Build-time deployment mode (NEXT_PUBLIC_DEPLOYMENT_MODE, baked into the
 * bundle). A self-hosted image has no marketing site, platform staff area or
 * billing — limits come from the signed license (Admin → Licence).
 */
export const SELF_HOSTED = process.env.NEXT_PUBLIC_DEPLOYMENT_MODE === 'self-hosted';
