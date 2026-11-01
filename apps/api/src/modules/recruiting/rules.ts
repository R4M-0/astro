/** Pipeline 1 stage 2 (hard filters) and stage 4 (business rules): pure, no I/O. */

export type CriterionKind = 'SKILL' | 'LANGUAGE' | 'YEARS' | 'OTHER';

export interface Criterion {
  id: string;
  label: string;
  /** HR weight, 1-5 */
  weight: number;
  mustHave: boolean;
  kind: CriterionKind;
  /** skill / language name, or minimum years */
  value?: string | number | null;
}

export interface CandidateProfile {
  skills: string[];
  languages: string[];
  totalYearsExperience: number;
  education: { degree: string; field: string }[];
  experiences: { title: string; durationYears: number; highlights: string }[];
  summary: string;
}

export interface CriterionScore {
  id: string;
  label: string;
  /** 0 = no evidence … 3 = strong evidence */
  score: number;
  evidence: string;
  /** the evidence quote really is in the CV */
  verified: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** whole-word match so "Java" does not pass on "JavaScript" */
const mentions = (haystack: string, needle: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}+#])${escape(norm(needle))}($|[^\\p{L}\\p{N}+#])`, 'u').test(norm(haystack));

/**
 * Stage 2: must-have criteria that can be checked without a model. Returns the missing ones
 * ([] = passes). Skills also match against the CV text so an extractor miss never rejects
 * a qualified candidate; OTHER must-haves are left to the judge.
 */
export function hardFilter(criteria: Criterion[], profile: CandidateProfile, cvText: string): string[] {
  const missing: string[] = [];
  for (const c of criteria) {
    if (!c.mustHave || c.value === null || c.value === undefined || c.value === '') continue;
    const v = String(c.value);
    if (c.kind === 'SKILL' && !profile.skills.some((s) => mentions(s, v)) && !mentions(cvText, v)) missing.push(c.label);
    if (c.kind === 'LANGUAGE' && !profile.languages.some((l) => mentions(l, v))) missing.push(c.label);
    if (c.kind === 'YEARS' && profile.totalYearsExperience < Number(v)) missing.push(c.label);
  }
  return missing;
}

/**
 * Stage 4 evidence check: a score only counts when its quote is found in the CV
 * (whitespace/case-insensitive); otherwise it drops to 0.
 */
export function verifyEvidence(scores: Omit<CriterionScore, 'verified'>[], cvText: string): CriterionScore[] {
  const cv = norm(cvText);
  return scores.map((s) => {
    const verified = s.score > 0 && s.evidence.trim().length > 0 && cv.includes(norm(s.evidence));
    return { ...s, score: verified ? s.score : 0, verified };
  });
}

/** Stage 4: weighted score on 0-100 from verified criterion scores. */
export function weightedScore(criteria: Criterion[], scores: CriterionScore[]): number {
  const byId = new Map(scores.map((s) => [s.id, s.score]));
  const total = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (!total) return 0;
  const got = criteria.reduce((sum, c) => sum + c.weight * (byId.get(c.id) ?? 0), 0);
  return Math.round((got / (3 * total)) * 1000) / 10;
}

/** Stage 4 ordering: by score, retrieval score breaks ties; top `k` are shortlisted. */
export function rankAndCut<T extends { id: string; score: number; retrievalScore: number }>(rows: T[], k: number) {
  return [...rows]
    .sort((a, b) => b.score - a.score || b.retrievalScore - a.retrievalScore)
    .map((r, i) => ({ ...r, rank: i + 1, shortlisted: i < k }));
}
