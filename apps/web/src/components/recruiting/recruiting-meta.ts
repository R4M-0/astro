export type CriterionKind = 'SKILL' | 'LANGUAGE' | 'YEARS' | 'OTHER';
export const CRITERION_KINDS: CriterionKind[] = ['SKILL', 'LANGUAGE', 'YEARS', 'OTHER'];

export interface Criterion {
  id: string;
  label: string;
  weight: number;
  mustHave: boolean;
  kind: CriterionKind;
  value?: string | number | null;
}

export type RankingStatus = 'IDLE' | 'RUNNING' | 'DONE' | 'FAILED';
export type CvStatus = 'RECEIVED' | 'PROCESSING' | 'READY' | 'FAILED';
export type Decision = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface CandidateRow {
  id: string;
  fullName: string | null;
  fileName: string;
  status: CvStatus;
  error: string | null;
  guardFlags: string[];
  retrievalScore: number | null;
  filterReasons: string[] | null;
  score: number | null;
  rank: number | null;
  shortlisted: boolean;
  decision: Decision;
  createdAt: string;
}

export const RANKING_TONE: Record<RankingStatus, string> = {
  IDLE: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  RUNNING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  DONE: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  FAILED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export const CV_TONE: Record<CvStatus, string> = {
  RECEIVED: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  PROCESSING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  READY: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  FAILED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export const DECISION_TONE: Record<Decision, string> = {
  PENDING: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  APPROVED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  REJECTED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};
