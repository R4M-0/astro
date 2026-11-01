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
export const mentions = (haystack: string, needle: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}+#])${escape(norm(needle))}($|[^\\p{L}\\p{N}+#])`, 'u').test(norm(haystack));

const fold = (s: string) => norm(s).normalize('NFD').replace(/\p{M}/gu, '');

/** Names a language goes by in the CVs and offers we see (fr, en, de, es, it, pt, native), accent-free. */
const LANGUAGES: string[][] = [
  ['english', 'anglais', 'englisch', 'ingles', 'inglese', 'anglophone'],
  ['french', 'francais', 'franzosisch', 'frances', 'francese', 'francophone'],
  ['german', 'allemand', 'deutsch', 'aleman', 'tedesco', 'alemao'],
  ['spanish', 'espagnol', 'spanisch', 'espanol', 'castellano', 'spagnolo', 'hispanophone'],
  ['italian', 'italien', 'italienisch', 'italiano'],
  ['portuguese', 'portugais', 'portugiesisch', 'portugues', 'portoghese'],
  ['dutch', 'neerlandais', 'hollandais', 'niederlandisch', 'nederlands', 'flemish', 'flamand'],
  ['arabic', 'arabe', 'arabisch', 'arabo'],
  ['chinese', 'chinois', 'mandarin', 'chinesisch', 'chino', 'cinese'],
  ['japanese', 'japonais', 'japanisch', 'japones', 'giapponese'],
  ['russian', 'russe', 'russisch', 'ruso', 'russo'],
  ['polish', 'polonais', 'polnisch', 'polaco', 'polacco', 'polski'],
  ['turkish', 'turc', 'turkisch', 'turco', 'turkce'],
  ['romanian', 'roumain', 'rumanisch', 'rumano', 'romeno', 'romana'],
];

/** The language a text names (canonical English name), or null when none is recognised. */
export function languageKey(text: string): string | null {
  const t = fold(text);
  return LANGUAGES.find((names) => names.some((n) => mentions(t, n)))?.[0] ?? null;
}

/** CEFR rank (A1 = 1 … C2 = 6) of each level wording, highest first so "très bon" wins over "bon". */
const LEVELS: [number, string[]][] = [
  [6, ['c2', 'natif', 'native', 'langue maternelle', 'maternelle', 'mother tongue', 'bilingue', 'bilingual', 'muttersprache']],
  [5, ['c1', 'courant', 'fluent', 'fluently', 'tres bon', 'tres bonne', 'excellent', 'avance', 'advanced', 'fliessend']],
  [4, ['b2', 'professionnel', 'professional', 'operationnel', 'working', 'bon niveau', 'bonne maitrise', 'good', 'gut']],
  [3, ['b1', 'intermediaire', 'intermediate', 'moyen', 'conversationnel', 'conversational']],
  [2, ['a2', 'notions', 'basic', 'basics', 'bases', 'debutant', 'beginner', 'elementaire', 'elementary', 'scolaire', 'quelques mots', 'grundkenntnisse']],
  [1, ['a1']],
];

/** CEFR rank a text states, or null when it gives no level. */
export function languageLevel(text: string): number | null {
  const t = fold(text);
  return LEVELS.find(([, words]) => words.some((w) => mentions(t, w)))?.[0] ?? null;
}

/**
 * A must-have language: the same language in any of its names, at the required level when both the
 * offer and the CV state one. An unstated level never rejects (the judge scores it). Returns the
 * reason to show HR, or null when it passes.
 */
function languageGap(c: Criterion, profile: CandidateProfile, cvText: string): string | null {
  const wanted = String(c.value);
  const key = languageKey(wanted);
  const same = (s: string) => (key ? languageKey(s) === key : mentions(s, wanted));
  const entry = profile.languages.find(same);
  if (!entry) {
    // extractor miss: the CV still names the language, so let the judge weigh it
    const inCv = key ? LANGUAGES.find((n) => n[0] === key)!.some((n) => mentions(fold(cvText), n)) : mentions(cvText, wanted);
    return inCv ? null : c.label;
  }
  const required = languageLevel(`${wanted} ${c.label}`);
  const has = languageLevel(entry);
  return required && has && has < required ? `${c.label} (CV : ${entry})` : null;
}

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
    if (c.kind === 'LANGUAGE') {
      const gap = languageGap(c, profile, cvText);
      if (gap) missing.push(gap);
    }
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
