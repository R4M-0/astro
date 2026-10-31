import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { isPublicDeployment, KNOWN_DEFAULT_PASSWORDS } from './deployment';

/** True when the stored hash accepts one of the documented default passwords. */
export async function usesDefaultPassword(passwordHash: string, defaults: readonly string[] = KNOWN_DEFAULT_PASSWORDS) {
  for (const candidate of defaults) {
    try {
      if (await argon2.verify(passwordHash, candidate)) return true;
    } catch {
      /* malformed hash: not a default */
    }
  }
  return false;
}

/**
 * Refuses to serve a public deployment while the super admin or the demo administrator
 * still accepts a documented default password (C-1).
 */
@Injectable()
export class DefaultCredentialsCheck implements OnModuleInit {
  private readonly logger = new Logger(DefaultCredentialsCheck.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (!isPublicDeployment()) return;
    const emails = [process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@astro.app', 'admin@demo.astro.app'];
    const users = await this.prisma.user.findMany({
      where: { email: { in: emails }, deletedAt: null },
      select: { email: true, passwordHash: true },
    });
    const weak: string[] = [];
    for (const u of users) if (await usesDefaultPassword(u.passwordHash)) weak.push(u.email);
    if (weak.length) {
      const msg = `Refusing to start: ${weak.join(', ')} still accept a documented default password. Rotate them first.`;
      this.logger.error(msg);
      process.exitCode = 1;
      throw new Error(msg);
    }
  }
}
