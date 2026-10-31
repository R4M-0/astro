/**
 * A public deployment = production mode OR served over https. Development safeguards
 * (default secrets, demo accounts, Swagger) are refused on either signal, so forgetting
 * NODE_ENV=production on an internet-facing instance does not switch them back on.
 */
export function isPublicDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || (env.APP_URL ?? '').startsWith('https://');
}

/** Documented dev passwords (README / seed) that must never be valid on a public deployment. */
export const KNOWN_DEFAULT_PASSWORDS = ['Astro-Super-2026!', 'Demo-Astro-2026!'] as const;

/** Problems with the configuration of a public deployment (empty = fine). */
export function insecureConfiguration(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!isPublicDeployment(env)) return [];
  const problems: string[] = [];
  const secret = env.JWT_ACCESS_SECRET ?? '';
  if (secret.length < 32 || /change-me/i.test(secret)) problems.push('JWT_ACCESS_SECRET must be ≥32 random chars');
  if (!env.S3_ACCESS_KEY || env.S3_ACCESS_KEY === 'astro') problems.push('S3_ACCESS_KEY is the dev default');
  if (!env.S3_SECRET_KEY || env.S3_SECRET_KEY === 'astro-secret') problems.push('S3_SECRET_KEY is the dev default');
  // validated for length by secret-cipher.ts; must be set before the first TOTP secret is stored
  if (!env.APP_ENCRYPTION_KEY) problems.push('APP_ENCRYPTION_KEY must be set (openssl rand -hex 32)');
  if (!(env.APP_URL ?? '').startsWith('https://')) problems.push('APP_URL must be https on a public deployment');
  return problems;
}

/** Swagger is served only in local development, or when explicitly enabled. */
export function swaggerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SWAGGER_ENABLED === 'true' || (!isPublicDeployment(env) && env.SWAGGER_ENABLED !== 'false');
}
