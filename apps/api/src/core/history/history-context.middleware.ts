import type { NextFunction, Request, Response } from 'express';
import { runWithHistoryContext } from './history-context';

/**
 * Early Express middleware that establishes the AsyncLocalStorage history
 * context for the whole request. It runs before the Nest guards, so actor/org
 * are not known yet — they are filled in by HistoryInterceptor once the guards
 * have populated the request. The store object is mutable, so later reads (in
 * the Prisma write middleware) see them. Registered via app.use() in main.ts.
 */
export function historyContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  runWithHistoryContext(
    {
      actorId: null,
      organizationId: null,
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
      deleteEvents: [],
      touched: [],
    },
    () => next(),
  );
}
