import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { getHistoryContext, TouchedRecord } from '../../core/history/history-context';
import { PrismaService } from '../../prisma/prisma.service';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const SKIP_PATHS = [/\/auth\//];
const SENSITIVE_KEY = /password|token|secret|otp|recoveryCode|challenge|authorization|apiKey|respondent/i;
// Private or anonymous content: the action line is kept, the body never is.
const NO_BODY_PATHS = [/\/inbox\//, /\/public\//, /\/satisfaction\/public\//, /\/hr\/trainings\/public\//, /\/hr\/surveys\/public\//];

/** Whether the request body may be stored in the audit log (private messages, public/anonymous forms never are). */
export function shouldCaptureBody(req: { url?: string; user?: unknown }): boolean {
  if (!req.user) return false;
  const url = req.url ?? '';
  return !NO_BODY_PATHS.some((r) => r.test(url));
}
const MAX_DEPTH = 6;
const AUDIT_MAX_FIELD_CHARS = 16_384;
const METHOD_OPERATION: Record<string, string> = { POST: 'create', DELETE: 'delete', PATCH: 'update', PUT: 'update' };

/** The record the request is "about": the first one written with the operation matching the verb. */
function primaryRecord(method: string, touched: TouchedRecord[]): TouchedRecord | undefined {
  const op = METHOD_OPERATION[method];
  return touched.find((r) => r.operation === op) ?? touched[0];
}

/** Records every mutating request into the immutable audit log. */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!MUTATING.has(req.method) || SKIP_PATHS.some((r) => r.test(req.url))) {
      return next.handle();
    }
    const historyCtx = getHistoryContext();
    return next.handle().pipe(
      tap({
        next: () => {
          const target = primaryRecord(req.method, historyCtx?.touched ?? []);
          // fire-and-forget; audit logging must never delay the response
          void this.prisma.auditLogEntry
            .create({
              data: {
                organizationId: req.orgId ?? null,
                actorId: req.user?.id ?? null,
                action: `${req.method} ${req.route?.path ?? req.url}`,
                entityType: target?.entityType ?? null,
                entityId: target?.entityId ?? null,
                ip: req.ip,
                userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 300),
                impersonatedById: req.user?.impersonatedById ?? null,
                after: shouldCaptureBody(req) ? this.sanitize(req.body) : undefined,
              },
            })
            .catch(() => undefined);
        },
      }),
    );
  }

  private sanitize(body: unknown): object | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const out = this.redact(body, 0) as Record<string, unknown>;
    // large payloads (spreadsheet / PDF annotation content) are summarised, never copied
    for (const [k, v] of Object.entries(out)) {
      const size = v && typeof v === 'object' ? JSON.stringify(v).length : typeof v === 'string' ? v.length : 0;
      if (size > AUDIT_MAX_FIELD_CHARS) out[k] = `[contenu volumineux — ${Math.round(size / 1024)} Ko]`;
    }
    return out as object;
  }

  /** Recursive redaction: nested payloads (signatures, form data…) get the same treatment. */
  private redact(value: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) return '[truncated]';
    if (Array.isArray(value)) return value.map((v) => this.redact(v, depth + 1));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : this.redact(v, depth + 1);
      }
      return out;
    }
    return value;
  }
}
