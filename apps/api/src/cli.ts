/**
 * Operator CLI of a self-hosted installation (shipped in the protected image as
 * `node dist/cli.js …`; in dev: `pnpm --filter @astro/api cli -- …`).
 *
 *   setup --org "Acme" --email admin@acme.com --first-name Ada --last-name Lovelace
 *         (password from --password or SETUP_ADMIN_PASSWORD)
 *   instance-id                 prints the id a license can be bound to
 *   license status              prints the current license state
 *   license install <file>      verifies + stores a license (same as Admin → Licence)
 */
// no schedules / queue consumers in a one-shot process — must be set before app-role.ts loads
process.env.APP_ROLE = 'api';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  const [command, sub] = argv;
  if (!command || command === 'help' || command === '--help') {
    console.log(readUsage());
    return;
  }

  // loaded lazily so `help` works without a database
  const { AppModule } = await import('./app.module');
  const { PrismaService } = await import('./prisma/prisma.service');
  const { RbacService } = await import('./core/rbac/rbac.service');
  const { LicenseService } = await import('./core/license/license.service');
  const { SubscriptionsService } = await import('./modules/platform/subscriptions.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const license = app.get(LicenseService);

    if (command === 'instance-id') {
      console.log((await license.installState()).instanceId);
    } else if (command === 'license' && sub === 'status') {
      const s = await license.refresh();
      console.log(JSON.stringify({ ...s, payload: s.payload && { ...s.payload } }, null, 2));
    } else if (command === 'license' && sub === 'install') {
      const file = argv[2];
      if (!file) fail('usage: license install <file>');
      const token = readFileSync(file === '-' ? 0 : file, 'utf8');
      const s = await license.install(token, null).catch((e) => fail(e?.response?.message ?? e.message));
      console.log(`current license ${s.payload?.lid ?? '—'} (${s.status}${s.payload ? `, expires ${s.payload.expiresAt.slice(0, 10)}` : ''})`);
      if (s.upcoming) console.log(`renewal ${s.upcoming.lid} takes over on ${s.upcoming.startsAt.slice(0, 10)}`);
    } else if (command === 'setup') {
      const orgName = arg(argv, 'org');
      const email = arg(argv, 'email')?.trim().toLowerCase();
      const firstName = arg(argv, 'first-name') ?? 'Admin';
      const lastName = arg(argv, 'last-name') ?? '';
      const password = arg(argv, 'password') ?? process.env.SETUP_ADMIN_PASSWORD;
      if (!orgName || !email) fail('setup needs --org and --email');
      if (!password || password.length < 10) fail('the admin password (--password or SETUP_ADMIN_PASSWORD) needs at least 10 characters');
      if (await prisma.organization.count({ where: { deletedAt: null } })) {
        fail('this installation already has an organization — invite users from Administration → Membres');
      }
      if (!(await prisma.plan.count())) fail('run the seed first (node dist/seed.js)');

      const slugBase = orgName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const org = await prisma.organization.create({
        data: { name: orgName, slug: `${slugBase || 'org'}-${randomBytes(3).toString('hex')}`, status: 'ACTIVE' },
      });
      const roles = await app.get(RbacService).provisionSystemRoles(org.id);
      await app.get(SubscriptionsService).ensureSubscription(org.id);
      const adminRole = roles.find((r) => r.key === 'org_admin')!;
      const existing = await prisma.user.findUnique({ where: { email } });
      const user = existing
        ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: await argon2.hash(password), deletedAt: null } })
        : await prisma.user.create({
            data: { email, firstName, lastName, passwordHash: await argon2.hash(password), emailVerifiedAt: new Date() },
          });
      const now = new Date();
      await prisma.membership.create({
        data: { organizationId: org.id, userId: user.id, roleId: adminRole.id, isDefault: true, invitedAt: now, acceptedAt: now },
      });
      // mirror the license (if one is already configured) onto the new subscription
      await license.refresh();
      console.log(`organization « ${org.name} » created — sign in as ${email}`);
      console.log(`instance id: ${(await license.installState()).instanceId}`);
    } else {
      fail(`unknown command « ${argv.join(' ')} »\n\n${readUsage()}`);
    }
  } finally {
    await app.close();
  }
}

function readUsage() {
  return [
    'usage: node dist/cli.js <command>',
    '  setup --org <name> --email <admin e-mail> [--first-name <x>] [--last-name <y>] [--password <p>]',
    '  instance-id',
    '  license status',
    '  license install <file | ->',
  ].join('\n');
}

main().catch((e) => {
  new Logger('cli').error(e?.stack ?? e);
  process.exit(1);
});
