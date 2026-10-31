import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { SELF_HOSTED } from '../../core/license/deployment-mode';

/**
 * Gates platform-level routes: only a User with isSuperAdmin may pass. Relies on
 * JwtStrategy having populated req.user.isSuperAdmin. Pair with @Platform() so the
 * tenant/permission guards don't also run.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    // never on a self-hosted install (platform controllers are not even registered there)
    if (SELF_HOSTED || !req.user?.isSuperAdmin) {
      throw new ForbiddenException('Super administrator access required');
    }
    return true;
  }
}
