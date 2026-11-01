import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, mergeMap, Observable } from 'rxjs';
import { AUDIT_ACCESS_KEY, AuditAccessMeta } from '../../core/audit-log/audit-access.decorator';
import { AuditWriter } from '../../core/audit-log/audit-writer.service';
import { getHistoryContext, TouchedRecord } from '../../core/history/history-context';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const SKIP_PATHS = [/\/auth\//];
const SENSITIVE_KEY = /password|token|secret|otp|recoveryCode|challenge|authorization|apiKey|respondent/i;
/** National identifiers and bank details: the log keeps that a value was set, never the value. */
const PII_MASK_KEY = /^(cin|nationalId|ssn|iban|socialSecurityNumber)$/i;
// Private or anonymous content: the action line is kept, the body never is.
const NO_BODY_PATHS = [/\/inbox\//, /\/public\//, /\/satisfaction\/public\//, /\/hr\/trainings\/public\//, /\/hr\/surveys\/public\//];

/** Whether the request body may be stored in the audit log (private messages, public/anonymous forms never are). */
export function shouldCaptureBody(req: { url?: string; user?: unknown }): boolean {
  if (!req.user) return false;
  const url = req.url ?? '';
  return !NO_BODY_PATHS.some((r) => r.test(url));
}

/** « 1234567890 » → « ••••••••90 »: enough to tell two values apart, not enough to reuse one. */
export function maskIdentifier(v: unknown): unknown {
  if (typeof v !== 'string' || !v) return v;
  return v.length <= 2 ? '••' : `${'•'.repeat(Math.min(v.length - 2, 8))}${v.slice(-2)}`;
}

const MAX_DEPTH = 6;
const AUDIT_MAX_FIELD_CHARS = 16_384;
const METHOD_OPERATION: Record<string, string> = { POST: 'create', DELETE: 'delete', PATCH: 'update', PUT: 'update' };

/** The record the request is "about": the first one written with the operation matching the verb. */
function primaryRecord(method: string, touched: TouchedRecord[]): TouchedRecord | undefined {
  const op = METHOD_OPERATION[method];
  return touched.find((r) => r.operation === op) ?? touched[0];
}

/**
 * Records every mutating request, and every read marked `@AuditAccess`, into the tamper-evident
 * audit log. The write is awaited before the response leaves (a few ms): a failure is retried,
 * then logged and counted by AuditWriter instead of being silently dropped.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly writer: AuditWriter,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    if (!req?.method) return next.handle();
    const access = this.reflector.get<AuditAccessMeta | undefined>(AUDIT_ACCESS_KEY, context.getHandler());
    const mutating = MUTATING.has(req.method) && !SKIP_PATHS.some((r) => r.test(req.url));
    if (!mutating && !access) return next.handle();

    const historyCtx = getHistoryContext();
    return next.handle().pipe(
      mergeMap((data) =>
        from(
          (async () => {
            const route = req.route?.path ?? req.url;
            if (access) {
              await this.writer.write({
                ...this.who(req),
                action: `${access.export ? 'EXPORT' : 'ACCESS'} ${route}`,
                entityType: access.entityType,
                entityId: (req.params?.[access.param ?? 'id'] as string | undefined) ?? null,
              });
            } else {
              const target = primaryRecord(req.method, historyCtx?.touched ?? []);
              await this.writer.write({
                ...this.who(req),
                action: `${req.method} ${route}`,
                entityType: target?.entityType ?? null,
                entityId: target?.entityId ?? null,
                after: shouldCaptureBody(req) ? (this.sanitize(req.body) ?? null) : null,
              });
            }
            return data;
          })(),
        ),
      ),
    );
  }

  private who(req: any) {
    return {
      organizationId: req.orgId ?? null,
      actorId: req.user?.id ?? null,
      ip: req.ip ?? null,
      userAgent: (req.headers?.['user-agent'] as string | undefined) ?? null,
      impersonatedById: req.user?.impersonatedById ?? null,
    };
  }

  sanitize(body: unknown): object | undefined {
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
        out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : PII_MASK_KEY.test(k) ? maskIdentifier(v) : this.redact(v, depth + 1);
      }
      return out;
    }
    return value;
  }
}
