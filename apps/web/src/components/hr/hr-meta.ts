export const SKILL_TYPES = ['TECHNICAL', 'BEHAVIORAL'] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

export const HR_TRAINING_TYPES = ['INTERNE', 'INTRA', 'EXTERNE', 'PRESTATAIRE'] as const;
export type HrTrainingType = (typeof HR_TRAINING_TYPES)[number];

export const TRAINING_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type TrainingStatus = (typeof TRAINING_STATUSES)[number];

export const JD_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type JdStatus = (typeof JD_STATUSES)[number];

export const PROFICIENCY_LEVELS = [1, 2, 3, 4, 5] as const;

export const CONTRACT_TYPES = ['CDI', 'CDD', 'INTERIM', 'APPRENTICESHIP', 'INTERNSHIP', 'FREELANCE', 'OTHER'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const JOURNEY_KINDS = ['ONBOARDING', 'OFFBOARDING'] as const;
export type JourneyKind = (typeof JOURNEY_KINDS)[number];
export const JOURNEY_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];
export const JOURNEY_ITEM_KINDS = ['TRAINING', 'TASK'] as const;
export type JourneyItemKind = (typeof JOURNEY_ITEM_KINDS)[number];
export const TRIAL_DECISIONS = ['CONFIRMED', 'EXTENDED', 'TERMINATED'] as const;
export type TrialDecision = (typeof TRIAL_DECISIONS)[number];

export const JOURNEY_STATUS_TONE: Record<JourneyStatus, string> = {
  IN_PROGRESS: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  COMPLETED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  CANCELLED: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

/** Quality-awareness checkbox keys stored on a job description. */
export const AWARENESS_KEYS = [
  'policy',
  'objectives',
  'risks',
  'customerReqs',
  'procedures',
  'productImpact',
  'improvement',
] as const;
export type AwarenessKey = (typeof AWARENESS_KEYS)[number];

export const SKILL_TYPE_TONE: Record<SkillType, string> = {
  TECHNICAL: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  BEHAVIORAL: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
};

export const TRAINING_STATUS_TONE: Record<TrainingStatus, string> = {
  PLANNED: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  IN_PROGRESS: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  COMPLETED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  CANCELLED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export const JD_STATUS_TONE: Record<JdStatus, string> = {
  DRAFT: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  PUBLISHED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  ARCHIVED: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

/** Gap → colour. Negative = deficit (red), 0 = on target (green), positive = above (blue). */
export function gapTone(gap: number): string {
  if (gap < 0) return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
  if (gap > 0) return 'bg-sky-500/15 text-sky-600 dark:text-sky-400';
  return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
}

export function levelTone(level: number): string {
  const tones = [
    'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    'bg-lime-500/15 text-lime-600 dark:text-lime-400',
    'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  ];
  return tones[Math.min(Math.max(level, 1), 5) - 1];
}

// ── shared types ─────────────────────────────────────────────────────────────
export interface EmployeeRow {
  id: string;
  reference: string;
  firstName: string;
  lastName: string;
  contact: string | null;
  email: string | null;
  cin: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  managerId: string | null;
  userId: string | null;
  active: boolean;
  hireDate?: string | null;
  contractType?: ContractType | null;
  trialEndDate?: string | null;
  exitDate?: string | null;
  exitReason?: string | null;
  jobDescription?: { id: string; jobTitle: string; reference: string } | null;
  evaluationCount?: number;
  trainingCount?: number;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  type: SkillType;
  _count?: { requirements: number; evaluations: number };
}

export interface JobActivityRow {
  id?: string;
  description: string;
  frequency?: string | null;
}
export interface SkillRequirementRow {
  id?: string;
  skillId: string;
  requiredLevel: number;
  skill?: SkillRow;
}
export interface RequiredTrainingRow {
  formation: string;
  level?: string;
}

export interface JobDescriptionRow {
  id: string;
  reference: string;
  version: string;
  applicationDate: string | null;
  jobTitle: string;
  departmentId: string | null;
  managerId: string | null;
  replacementId: string | null;
  mainMission: string | null;
  hierarchicalLink: string | null;
  functionalLink: string | null;
  jobPurpose: string | null;
  authority: string | null;
  minExperienceMonths: number | null;
  experienceDomain: string | null;
  requiredTraining: RequiredTrainingRow[];
  qualityAwareness: Record<string, boolean>;
  status: JdStatus;
  activities?: JobActivityRow[];
  skillRequirements?: SkillRequirementRow[];
  activityCount?: number;
  skillCount?: number;
  assignedCount?: number;
  assignments?: { employee: { id: string; firstName: string; lastName: string; reference: string } }[];
}

export interface TrainingRow {
  id: string;
  code: string;
  theme: string;
  type: HrTrainingType;
  startDate: string | null;
  endDate: string | null;
  status: TrainingStatus;
  observation: string | null;
  departmentId?: string | null;
  participantCount?: number;
  feedbackCount?: number;
}

export interface JourneyItemState {
  done: boolean;
  auto: boolean;
  completedAt: string | null;
  overdue: boolean;
}

export interface JourneyItem {
  id: string;
  kind: JourneyItemKind;
  label: string;
  trainingId: string | null;
  dueDate: string | null;
  doneAt: string | null;
  doneById: string | null;
  state: JourneyItemState;
}

export interface JourneyProgress {
  done: number;
  total: number;
  pct: number;
  overdue: number;
}

export interface JourneyRow {
  id: string;
  reference: string;
  kind: JourneyKind;
  status: JourneyStatus;
  employeeId: string;
  startDate: string;
  targetDate: string | null;
  ownerId: string | null;
  buddyId: string | null;
  notes: string | null;
  trialDecision: TrialDecision | null;
  trialComment: string | null;
  trialSignedAt: string | null;
  trialSignedById: string | null;
  exitReason: string | null;
  handoverToUserId: string | null;
  handoverAt: string | null;
  handoverSummary: Record<string, number> | null;
  accountDeactivatedAt: string | null;
  completedAt: string | null;
  employee: {
    id: string;
    reference: string;
    firstName: string;
    lastName: string;
    jobTitle: string | null;
    departmentId: string | null;
    userId: string | null;
    hireDate: string | null;
    contractType: ContractType | null;
    trialEndDate: string | null;
    exitDate: string | null;
    active: boolean;
  };
  buddy: { id: string; firstName: string; lastName: string; jobTitle: string | null } | null;
  progress: JourneyProgress;
}

export interface JourneyDetail extends JourneyRow {
  items: JourneyItem[];
  trialSignatureView: { signer: { name: string; function: string | null } | null; signedAt: string | null } | null;
  linked: {
    trainings: { id: string; code: string; theme: string; status: TrainingStatus; startDate: string | null }[];
  };
}

/** YYYY-MM-DD for <input type="date"> from an ISO string. */
export const toDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
