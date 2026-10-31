import * as argon2 from 'argon2';
import { usesDefaultPassword } from './default-credentials.check';
import { insecureConfiguration, isPublicDeployment, swaggerEnabled } from './deployment';

describe('default credentials / public deployment checks (P0-4)', () => {
  it('detects a hash of a documented default password', async () => {
    expect(await usesDefaultPassword(await argon2.hash('Astro-Super-2026!'))).toBe(true);
    expect(await usesDefaultPassword(await argon2.hash('Demo-Astro-2026!'))).toBe(true);
    expect(await usesDefaultPassword(await argon2.hash('a-real-long-passphrase-2026'))).toBe(false);
    expect(await usesDefaultPassword('not-a-hash')).toBe(false);
  });

  it('treats https as a public deployment even without NODE_ENV=production', () => {
    expect(isPublicDeployment({ APP_URL: 'https://app.example.com' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isPublicDeployment({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isPublicDeployment({ APP_URL: 'http://localhost:3000' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('refuses dev secrets on a public deployment', () => {
    const env = {
      APP_URL: 'https://app.example.com',
      JWT_ACCESS_SECRET: 'x'.repeat(40),
      S3_ACCESS_KEY: 'astro',
      S3_SECRET_KEY: 'astro-secret',
    } as NodeJS.ProcessEnv;
    const problems = insecureConfiguration(env);
    expect(problems.join('\n')).toMatch(/S3_ACCESS_KEY/);
    expect(problems.join('\n')).toMatch(/S3_SECRET_KEY/);
    expect(problems.join('\n')).toMatch(/APP_ENCRYPTION_KEY/);
    expect(
      insecureConfiguration({ ...env, S3_ACCESS_KEY: 'svc', S3_SECRET_KEY: 'long-random', APP_ENCRYPTION_KEY: 'a'.repeat(64) }),
    ).toEqual([]);
    expect(insecureConfiguration({ APP_URL: 'http://localhost:3000' } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('serves Swagger only in local development unless explicitly enabled', () => {
    expect(swaggerEnabled({ APP_URL: 'http://localhost:3000' } as NodeJS.ProcessEnv)).toBe(true);
    expect(swaggerEnabled({ APP_URL: 'https://app.example.com' } as NodeJS.ProcessEnv)).toBe(false);
    expect(swaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});
