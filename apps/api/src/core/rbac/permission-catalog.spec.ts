import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { ACTIONS, ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, RESOURCES } from '@astro/shared';
import { ORG_ADMIN_LOCKED_PERMISSIONS } from './rbac.service';

/** Every `.ts`/`.tsx` source file under `dir` (no specs, no build output). */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === '.next' ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

const ROOTS = [join(__dirname, '../..'), join(__dirname, '../../../../web/src')];
const KEY = new RegExp(`['\`"]((?:${RESOURCES.join('|')}):(?:${ACTIONS.join('|')}))['\`"]`, 'g');

describe('permission catalogue', () => {
  const supported = new Set<string>(ALL_PERMISSIONS);

  it('contains every permission key the API or the web app checks', () => {
    const missing: string[] = [];
    for (const file of ROOTS.flatMap(sources)) {
      for (const [, key] of readFileSync(file, 'utf8').matchAll(KEY)) {
        if (!supported.has(key)) missing.push(`${key} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('role defaults and org_admin locks only reference supported keys', () => {
    for (const keys of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      expect(keys.filter((k) => !supported.has(k))).toEqual([]);
    }
    expect(ORG_ADMIN_LOCKED_PERMISSIONS.filter((k) => !supported.has(k))).toEqual([]);
  });

  it('every resource keeps read', () => {
    expect(RESOURCES.filter((r) => !supported.has(`${r}:read`))).toEqual([]);
  });
});
