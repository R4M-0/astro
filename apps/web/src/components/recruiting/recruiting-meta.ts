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
export type InviteStatus = 'NONE' | 'INVITED' | 'BOOKED' | 'DECLINED' | 'NO_RESPONSE';

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
  email: string | null;
  inviteStatus: InviteStatus;
  slot: { startsAt: string; durationMinutes: number } | null;
  createdAt: string;
}

export interface InterviewSlot {
  id: string;
  startsAt: string;
  durationMinutes: number;
  location: string | null;
  interviewer: string | null;
  bookedAt: string | null;
  candidate: { id: string; fullName: string | null; fileName: string } | null;
}

export type MessageStatus = 'DRAFT' | 'APPROVED' | 'SENDING' | 'SENT' | 'DISCARDED' | 'RECEIVED';
export type MessageKind = 'INVITATION' | 'REMINDER' | 'REJECTION' | 'REPLY' | 'INBOUND';
export type Intent = 'CONFIRM' | 'QUESTION' | 'RESCHEDULE' | 'DECLINE' | 'NONE_FIT' | 'OTHER';

export interface CandidateMessage {
  id: string;
  candidateId: string;
  direction: 'OUT' | 'IN';
  kind: MessageKind;
  status: MessageStatus;
  subject: string;
  body: string;
  intent: Intent | null;
  needsHuman: boolean;
  summary: string | null;
  flags: string[];
  inReplyToId: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
  candidate: { id: string; fullName: string | null; fileName: string; email: string | null; inviteStatus: InviteStatus };
}

/** Interview times are shown in the viewer's own time zone, labelled. */
export const formatSlot = (iso: string, locale?: string) =>
  new Date(iso).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

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

export const INVITE_TONE: Record<InviteStatus, string> = {
  NONE: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  INVITED: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  BOOKED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  DECLINED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  NO_RESPONSE: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};

export const MESSAGE_TONE: Record<MessageStatus, string> = {
  DRAFT: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  APPROVED: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  SENDING: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  SENT: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  DISCARDED: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  RECEIVED: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
};
