export const SURVEY_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];

export const SURVEY_QUESTION_TYPES = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'YES_NO',
  'RATING',
] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export const CHOICE_TYPES: SurveyQuestionType[] = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'];

export const SURVEY_STATUS_TONE: Record<SurveyStatus, string> = {
  DRAFT: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  PUBLISHED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  CLOSED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export interface SurveyOption {
  id: string;
  label: string;
}

export interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  label: string;
  helpText: string | null;
  required: boolean;
  scaleMin: number;
  scaleMax: number;
  scaleMinLabel: string | null;
  scaleMaxLabel: string | null;
  options: SurveyOption[];
}

export interface SurveyRow {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  status: SurveyStatus;
  anonymous: boolean;
  allowMultipleResponses: boolean;
  /** never sent by the API any more — only `publicUrl`, to survey managers */
  publicToken?: string | null;
  publicUrl: string | null;
  expired: boolean;
  closesAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  questionCount: number;
  responseCount: number;
}

export interface SurveyDetail extends SurveyRow {
  questions: SurveyQuestion[];
}

/** What the employee-facing renderer needs (shared by the preview + public page). */
export interface RenderableSurvey {
  title: string;
  description: string | null;
  anonymous: boolean;
  questions: SurveyQuestion[];
}

export interface PublicSurvey extends RenderableSurvey {
  status: 'PUBLISHED' | 'CLOSED';
  allowMultipleResponses: boolean;
  closesAt: string | null;
}

export interface AnswerValue {
  textValue?: string;
  numberValue?: number;
  boolValue?: boolean;
  optionIds?: string[];
}

export type AnswerMap = Record<string, AnswerValue>;

export interface SurveyIdentity {
  name: string;
  email: string;
}

export const TEXT_MAX: Record<string, number> = { SHORT_TEXT: 500, LONG_TEXT: 5000 };

export function isAnswered(q: SurveyQuestion, a: AnswerValue | undefined) {
  if (!a) return false;
  switch (q.type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT':
      return !!a.textValue?.trim();
    case 'SINGLE_CHOICE':
    case 'MULTIPLE_CHOICE':
      return !!a.optionIds?.length;
    case 'YES_NO':
      return typeof a.boolValue === 'boolean';
    case 'RATING':
      return typeof a.numberValue === 'number';
  }
}

/** Builds the POST body answers (only answered questions). */
export function toAnswerPayload(questions: SurveyQuestion[], answers: AnswerMap) {
  return questions
    .filter((q) => isAnswered(q, answers[q.id]))
    .map((q) => {
      const a = answers[q.id]!;
      switch (q.type) {
        case 'SHORT_TEXT':
        case 'LONG_TEXT':
          return { questionId: q.id, textValue: a.textValue!.trim() };
        case 'SINGLE_CHOICE':
        case 'MULTIPLE_CHOICE':
          return { questionId: q.id, optionIds: a.optionIds };
        case 'YES_NO':
          return { questionId: q.id, boolValue: a.boolValue };
        case 'RATING':
          return { questionId: q.id, numberValue: a.numberValue };
      }
    });
}
