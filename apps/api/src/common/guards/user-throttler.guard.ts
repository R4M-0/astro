import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttler keyed by the authenticated user (falls back to the IP). Used on
 * expensive routes (LLM calls) on top of the global per-IP limiter, so users
 * behind one NAT do not share a budget and one user cannot spread calls over IPs.
 * Route-level guards run after the global auth guards, so `req.user` is set.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ? `user:${req.user.id}` : (req.ip as string);
  }
}
