import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SELF_HOSTED } from './deployment-mode';
import { LICENSE_EXEMPT_KEY } from './license-exempt.decorator';
import { currentLicense } from './license.service';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Self-hosted read-only mode: once the license is past its grace period (or
 * missing / invalid / the clock was moved back) every write answers 402
 * LICENSE_READ_ONLY. Reads and exports keep working — records stay available
 * as documented information whatever the license state.
 */
@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (!SELF_HOSTED || context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<{ method: string }>();
    if (READS.has(req.method)) return true;
    const state = currentLicense();
    if (!state.readOnly) return true;
    if (this.reflector.getAllAndOverride<boolean>(LICENSE_EXEMPT_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'LICENSE_READ_ONLY',
        status: state.status,
        message:
          state.status === 'missing'
            ? 'No license is installed: the application is read-only. An administrator can install one in Administration → Licence.'
            : state.status === 'clock_tampered'
              ? (state.error?.message ?? 'The server clock is inconsistent: the application is read-only.')
              : state.status === 'invalid'
                ? `The license is not valid (${state.error?.message ?? 'unknown error'}): the application is read-only.`
                : 'The license has expired: the application is read-only until a renewed license is installed.',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
