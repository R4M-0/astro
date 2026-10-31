#!/usr/bin/env node
/**
 * Smoke test of a self-hosted (protected) API — run before shipping an image.
 *
 *   API_URL=http://localhost:3001/api/v1 ADMIN_EMAIL=… ADMIN_PASSWORD=… \
 *   LICENSE=acme.lic [FORGED_LICENSE=other-key.lic] node scripts/smoke-protected.mjs
 *
 * Checks: login, license state, read-only mode without a license (402),
 * rejection of a license signed by another key, license install, writes allowed
 * again, the main read endpoints, the SaaS-only routes being absent, and an
 * Excel import parsed in the bytecode worker thread.
 * The database is left with the license installed (nothing else is written).
 */
import { readFileSync } from 'node:fs';

const API = (process.env.API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '');
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const licenseFile = process.env.LICENSE;
if (!email || !password || !licenseFile) {
  console.error('ADMIN_EMAIL, ADMIN_PASSWORD and LICENSE are required');
  process.exit(2);
}

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

let token = '';
async function call(method, path, body, raw = false) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const data = raw ? Buffer.from(await res.arrayBuffer()) : await res.json().catch(() => null);
  return { status: res.status, data };
}

const login = await call('POST', '/auth/login', { email, password });
check(login.status === 200 || login.status === 201, 'login', String(login.status));
token = login.data?.accessToken ?? '';
if (!token) process.exit(1);

const before = await call('GET', '/license/status');
check(before.status === 200 && before.data?.mode === 'self-hosted', 'self-hosted mode', JSON.stringify(before.data));

if (before.data?.readOnly) {
  const blocked = await call('POST', '/risks', {});
  check(blocked.status === 402 && blocked.data?.error === 'LICENSE_READ_ONLY', 'writes refused while read-only', String(blocked.status));
}

if (process.env.FORGED_LICENSE) {
  const forged = await call('POST', '/license', { license: readFileSync(process.env.FORGED_LICENSE, 'utf8') });
  check(forged.status === 400 && forged.data?.code === 'BAD_SIGNATURE', 'license signed by another key rejected', `${forged.status} ${forged.data?.code}`);
}
const tampered = readFileSync(licenseFile, 'utf8').trim().replace(/\.([^.]+)\./, (_, p) => `.${p.slice(0, -2)}AA.`);
const bad = await call('POST', '/license', { license: tampered });
check(bad.status === 400, 'edited license rejected', `${bad.status} ${bad.data?.code}`);

const installed = await call('POST', '/license', { license: readFileSync(licenseFile, 'utf8') });
check(installed.status === 201 && !installed.data?.readOnly, 'license installed', `${installed.status} ${installed.data?.status} ${installed.data?.license?.reference ?? ''}`);

const write = await call('POST', '/risks', {});
check(write.status === 400, 'writes allowed again (validation answers, not the license)', String(write.status));

const details = await call('GET', '/license');
check(details.status === 200 && !!details.data?.instanceId, 'license details', `instance ${details.data?.instanceId}, seats ${details.data?.usage?.seatsUsed}/${details.data?.license?.seatLimit}`);

for (const path of [
  '/me',
  '/me/permissions',
  '/dashboard',
  '/actions?page=1&pageSize=5',
  '/nonconformities?page=1&pageSize=5',
  '/complaints?page=1&pageSize=5',
  '/risks',
  '/documents?page=1&pageSize=5',
  '/kpis',
  '/processes',
  '/audits?page=1&pageSize=5',
  '/hr/employees',
  '/suppliers?page=1&pageSize=5',
  '/notifications',
  '/audit-log?page=1&pageSize=5',
]) {
  const r = await call('GET', path);
  check(r.status === 200, `GET ${path}`, String(r.status));
}

for (const path of ['/platform/stats', '/billing/overview', '/public/plans']) {
  const r = await call('GET', path);
  check(r.status === 404, `${path} absent`, String(r.status));
}

const template = await call('GET', '/hr/import/employees/template', undefined, true);
check(template.status === 200 && template.data.length > 1000, 'xlsx template generated', `${template.data.length} bytes`);
if (template.status === 200) {
  const form = new FormData();
  form.append('file', new Blob([template.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'modele.xlsx');
  const preview = await call('POST', '/hr/import/employees/preview', form);
  check(preview.status === 201 || preview.status === 200, 'workbook parsed in the worker thread', `${preview.status} ${preview.data?.message ?? ''}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
