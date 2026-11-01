import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACCESS_KEY = 'auditAccess';

export interface AuditAccessMeta {
  /** Prisma model of the record read (entityType of the audit row) */
  entityType: string;
  /** route param holding the record id (default `id`) */
  param?: string;
  /** EXPORT instead of ACCESS (downloads of personal data in bulk) */
  export?: boolean;
}

/**
 * Logs a read of personal data: the interceptor writes `ACCESS <route>` (or `EXPORT <route>`)
 * with the record id once the handler succeeds. GDPR accountability: « who opened my file? ».
 */
export const AuditAccess = (entityType: string, opts: Omit<AuditAccessMeta, 'entityType'> = {}) =>
  SetMetadata(AUDIT_ACCESS_KEY, { entityType, ...opts } satisfies AuditAccessMeta);
