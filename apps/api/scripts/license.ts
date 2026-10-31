/**
 * Vendor-side license tooling (never shipped to customers).
 *
 *   pnpm --filter @astro/api license keygen --out ~/.astro
 *   pnpm --filter @astro/api license issue --key ~/.astro/license-signing.key \
 *        --customer "Acme SA" --plan enterprise --seats 150 --expires 2027-10-31 \
 *        [--orgs 1] [--addons environment,health-safety] [--starts 2026-11-01] [--grace 14] \
 *        [--storage-mb 200000] [--instance QI-…] [--updates-until 2027-10-31] [--out acme.lic]
 *   pnpm --filter @astro/api license inspect acme.lic --public-key ~/.astro/license-public.pem
 *
 * Licenses issued here are not recorded in the platform register — prefer
 * /platform/licenses when the SaaS holds LICENSE_SIGNING_KEY.
 */
import { generateKeyPairSync } from 'crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  decodeLicense,
  evaluateLicense,
  type LicensePayload,
  loadPrivateKey,
  loadPublicKey,
  signLicense,
} from '../src/core/license/license-token';

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const need = (name: string) => opt(name) ?? fail(`--${name} is required`);
function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}
const day = (s: string, label: string) => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) fail(`--${label} is not a date`);
  return d;
};

const command = argv[0];

if (command === 'keygen') {
  const dir = opt('out') ?? '.';
  mkdirSync(dir, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const pubPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const privPath = join(dir, 'license-signing.key');
  const pubPath = join(dir, 'license-public.pem');
  writeFileSync(privPath, privPem, { flag: 'wx', mode: 0o600 });
  chmodSync(privPath, 0o600);
  writeFileSync(pubPath, pubPem, { flag: 'wx' });
  console.log(`private key → ${privPath}  (keep secret: SaaS LICENSE_SIGNING_KEY, never in an image)`);
  console.log(`public key  → ${pubPath}   (build arg LICENSE_PUBLIC_KEY of the self-hosted image)`);
  console.log(`\nLICENSE_SIGNING_KEY=${Buffer.from(privPem).toString('base64')}`);
  console.log(`LICENSE_PUBLIC_KEY=${Buffer.from(pubPem).toString('base64')}`);
} else if (command === 'issue') {
  const key = loadPrivateKey(readFileSync(need('key'), 'utf8'));
  const now = new Date();
  const startsAt = opt('starts') ? day(opt('starts')!, 'starts') : now;
  const expiresAt = day(need('expires'), 'expires');
  if (expiresAt <= startsAt) fail('--expires must be after --starts');
  const seats = Number(need('seats'));
  if (!Number.isInteger(seats) || seats < 1) fail('--seats must be a positive integer');
  const payload: LicensePayload = {
    v: 1,
    lid: opt('id') ?? `LIC-${now.getUTCFullYear()}-CLI-${now.getTime().toString(36).toUpperCase()}`,
    customer: need('customer'),
    plan: opt('plan') ?? 'enterprise',
    seatLimit: seats,
    orgLimit: Number(opt('orgs') ?? 1),
    addons: (opt('addons') ?? '').split(',').map((a) => a.trim()).filter(Boolean),
    storageLimitMb: opt('storage-mb') ? Number(opt('storage-mb')) : null,
    issuedAt: now.toISOString(),
    startsAt: startsAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    graceDays: Number(opt('grace') ?? 14),
    instanceId: opt('instance') ?? null,
    updatesUntil: opt('updates-until') ? day(opt('updates-until')!, 'updates-until').toISOString() : null,
  };
  const token = signLicense(payload, key);
  if (opt('out')) {
    writeFileSync(opt('out')!, `${token}\n`);
    console.error(`${payload.lid} → ${opt('out')}`);
  } else {
    console.log(token);
  }
} else if (command === 'inspect') {
  const file = argv[1] ?? fail('usage: inspect <file> --public-key <pem>');
  const pub = loadPublicKey(readFileSync(need('public-key'), 'utf8'));
  const payload = decodeLicense(readFileSync(file, 'utf8'), pub);
  console.log(JSON.stringify(payload, null, 2));
  try {
    console.log(JSON.stringify(evaluateLicense({ ...payload, instanceId: null }, { now: new Date(), instanceId: '' })));
  } catch (e) {
    console.log(`not usable now: ${(e as Error).message}`);
  }
} else {
  console.log('usage: license keygen | issue | inspect   (see scripts/license.ts)');
  process.exit(command ? 1 : 0);
}
