export type SubjectType = 'EMPLOYEE' | 'CANDIDATE';
export type DsrType = 'ACCESS' | 'ERASURE';
export type DsrStatus = 'OPEN' | 'COMPLETED' | 'REJECTED';
export type RetentionCategory = 'CANDIDATE_NOT_HIRED' | 'FORMER_EMPLOYEE' | 'SURVEY_IDENTITY' | 'AUDIT_LOG';
export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface ChainBreak {
  seq: number;
  id: string | null;
  reason: 'link' | 'gap' | 'hash' | 'body' | 'seal';
}

export interface VerifyResult {
  ok: boolean;
  entries: number;
  redacted: number;
  head: { seq: number; hash: string };
  sealsChecked: number;
  firstBreak: ChainBreak | null;
  verifiedAt: string;
}

export interface CheckData {
  verifiedAt?: string | null;
  entries?: number | null;
  firstBreak?: ChainBreak | null;
  ageHours?: number | null;
  seq?: number | null;
  failures?: number;
  enabled?: number;
  total?: number;
  open?: number;
  overdue?: number;
  dueSoon?: number;
}

export interface Overview {
  checks: { key: 'chain' | 'seal' | 'writes' | 'retention' | 'requests'; status: CheckStatus; data: CheckData }[];
  audit: {
    head: { seq: number; hash: string };
    lastSeal: { seq: number; hash: string; createdAt: string } | null;
    verification: VerifyResult | null;
    writeFailures: number;
  };
  retention: { enabled: number; total: number; lastRun: RetentionRun | null };
  requests: { open: number; overdue: number; dueSoon: number };
  legalHolds: number;
  personalData: { activeEmployees: number; formerEmployees: number; candidates: number; anonymized: number };
}

export interface Subject {
  type: SubjectType;
  id: string;
  label: string;
  email: string | null;
  status: string;
}

export interface Dsr {
  id: string;
  reference: string;
  type: DsrType;
  subjectType: SubjectType;
  subjectId: string;
  subjectLabel: string;
  requesterEmail: string | null;
  channel: string | null;
  notes: string | null;
  receivedAt: string;
  dueAt: string;
  status: DsrStatus;
  resolution: string | null;
  result: Record<string, unknown> | null;
  completedAt: string | null;
  completedById: string | null;
  createdAt: string;
  overdue?: boolean;
  legalHold?: LegalHold | null;
}

export interface LegalHold {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  subjectLabel: string;
  reason: string;
  createdAt: string;
  releasedAt: string | null;
}

export interface RetentionPolicy {
  id: string;
  category: RetentionCategory;
  retentionDays: number;
  action: 'ANONYMIZE' | 'PURGE';
  enabled: boolean;
  updatedAt: string;
}

export interface CategoryResult {
  enabled: boolean;
  retentionDays: number;
  cutoff: string;
  due: number;
  held: number;
  applied: number;
}

export interface RetentionRun {
  id: string;
  dryRun: boolean;
  results: Partial<Record<RetentionCategory, CategoryResult>>;
  triggeredById: string | null;
  startedAt: string;
  finishedAt: string | null;
}

type Text = { fr: string; en: string };
export interface ProcessingActivity {
  key: string;
  name: Text;
  purpose: Text;
  legalBasis: Text;
  subjects: Text;
  dataCategories: Text;
  recipients: Text;
  retention: Text;
  ai: Text | null;
  module: string;
  policy: { category: RetentionCategory; retentionDays: number; enabled: boolean } | null;
}

export const RETENTION_MIN_DAYS: Record<RetentionCategory, number> = {
  CANDIDATE_NOT_HIRED: 30,
  FORMER_EMPLOYEE: 365,
  SURVEY_IDENTITY: 30,
  AUDIT_LOG: 365,
};
