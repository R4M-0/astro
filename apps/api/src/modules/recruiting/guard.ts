/**
 * Security guard (pipeline 1, stage 1): runs on the extracted CV text before any model sees it.
 * Drops lines that try to instruct the model, strips invisible characters and redacts contact
 * details and protected attributes (age, birth date, gender title, nationality, family status).
 * ponytail: regex heuristics — a classifier when the adversarial set shows misses (eval level 3).
 */

const INJECTION: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,20}\b(all|any|previous|prior|above|earlier|the|your)\b.{0,20}\b(instructions?|prompts?)\b/i,
  /\b(ignorez|oubliez|ignorer|oublier)\b.{0,40}\b(instructions?|consignes)\b/i,
  /\b(system|developer)\s*prompt\b/i,
  /\byou are (now )?(an? )?(ai|assistant|language model|llm|chatgpt|claude|gpt)\b/i,
  /\b(rank|rate|score|place|put)\b.{0,30}\b(me|this (candidate|cv|resume|profile))\b.{0,30}\b(first|top|highest|best|#1|number one)\b/i,
  /\b(give|assign|award)\b.{0,30}\b(highest|maximum|max|perfect|full|top)\b.{0,15}\b(score|rating|marks?)\b/i,
  /\b(new|updated|additional) instructions?\s*:/i,
  /<\/?(system|instructions?|prompt|cv)>/i,
];

/** control chars (except tab/newlines) + format chars: zero-width, bidi overrides, soft hyphen, BOM */
const INVISIBLE = /[^\P{Cc}\t\n\r]|\p{Cf}/gu;

const REDACTIONS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]'],
  [/(https?:\/\/|www\.)\S+/gi, '[link]'],
  [/\b(linkedin|github)\.com\/\S+/gi, '[link]'],
  // (?<!\p{L}) / (?!\p{L}) instead of \b: \b ignores accented letters (« Nationalité », « âge »)
  [/^.*(?<!\p{L})(date of birth|birth ?date|born( on)?|née? le|date de naissance|DOB)(?!\p{L}).*$/gimu, '[birth date]'],
  [/^.*(?<!\p{L})(age|âge)\s*:?\s*\d{2}\b.*$/gimu, '[age]'],
  [/\b\d{2}\s*years old\b/gi, '[age]'],
  [/(?<!\p{L})âgée? de \d{2} ans\b/giu, '[age]'],
  [/^.*(?<!\p{L})(nationality|nationalité|citizenship)(?!\p{L}).*$/gimu, '[nationality]'],
  [/^.*(?<!\p{L})(marital status|situation familiale|married|mariée?|célibataire|single|children|enfants)(?!\p{L})\s*:.*$/gimu, '[family status]'],
  [/^.*(?<!\p{L})(gender|sexe|genre)\s*:.*$/gimu, '[gender]'],
  [/\b(Mr|Mrs|Ms|Miss|Mme|Mlle|Monsieur|Madame)\b\.?\s*/g, ''],
];

export interface GuardResult {
  text: string;
  flags: string[];
  /** first e-mail found, kept on the candidate for Pipeline 2 (never shown to models) */
  email: string | null;
}

export function sanitizeCv(raw: string): GuardResult {
  const flags: string[] = [];
  const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(raw)?.[0] ?? null;

  let text = raw.normalize('NFKC');
  const invisible = text.match(INVISIBLE)?.length ?? 0;
  if (invisible) flags.push(`hidden characters removed (${invisible})`);
  text = text.replace(INVISIBLE, '');

  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (INJECTION.some((re) => re.test(line))) flags.push(`instruction removed: "${line.trim().slice(0, 120)}"`);
    else kept.push(line);
  }
  text = kept.join('\n');

  for (const [re, label] of REDACTIONS) text = text.replace(re, label);
  // phone = 9+ digits in one run of digits/separators, so year ranges ("2015 - 2020") survive
  text = text.replace(/(\+|00)?\d[\d\s().-]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[phone]' : m));
  return { text: text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), flags, email };
}

/** Removes the candidate's name (each part, ≥ 2 letters) once the extractor has found it. */
export function redactName(text: string, fullName: string | null | undefined): string {
  const parts = (fullName ?? '').split(/\s+/).filter((p) => p.length >= 2);
  return parts.reduce(
    (t, p) => t.replace(new RegExp(`(?<!\\p{L})${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'giu'), '[name]'),
    text,
  );
}
