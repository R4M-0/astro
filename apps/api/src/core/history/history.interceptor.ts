import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { getHistoryContext } from './history-context';
import { DeletionNotifierService } from './deletion-notifier.service';

/**
 * Runs after the auth/tenant guards, so it can copy the resolved actor and org
 * into the (already-established) history context. On response, it flushes any
 * deletions collected during the request to the deletion-notifier.
 */
@Injectable()
export class HistoryInterceptor implements NestInterceptor {
  constructor(private readonly deletionNotifier: DeletionNotifierService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const ctx = getHistoryContext();
    if (ctx) {
      ctx.actorId = req.user?.id ?? null;
      ctx.impersonatedById = req.user?.impersonatedById ?? null;
      ctx.organizationId = req.orgId ?? ctx.organizationId ?? null;
    }
    return next.handle().pipe(
      tap({
        next: () => this.flush(ctx?.actorId ?? null),
        error: () => this.flush(ctx?.actorId ?? null),
      }),
    );
  }

  private flush(actorId: string | null) {
    const ctx = getHistoryContext();
    if (!ctx || ctx.deleteEvents.length === 0) return;
    const events = ctx.deleteEvents.splice(0); // drain
    void this.deletionNotifier.flush(events, actorId).catch(() => undefined);
  }
}
