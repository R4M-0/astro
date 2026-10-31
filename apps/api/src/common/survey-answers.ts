import { createHmac } from 'crypto';
import { BadRequestException } from '@nestjs/common';

type SurveyQuestion = { id: string; type?: string };

/**
 * Keeps only answers to the survey's own questions: scale → integer 1..5,
 * anything else → trimmed text (≤ 2000 chars). Rejects unknown keys so the
 * stored JSON stays bounded and shaped.
 */
export function sanitizeSurveyAnswers(questions: unknown, answers: Record<string, unknown>) {
  const list = (Array.isArray(questions) ? questions : []) as SurveyQuestion[];
  const byId = new Map(list.filter((q) => q && typeof q.id === 'string').map((q) => [q.id, q]));
  const out: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(answers ?? {})) {
    const q = byId.get(key);
    if (!q) throw new BadRequestException(`Unknown question "${key.slice(0, 40)}"`);
    if (value === null || value === undefined || value === '') continue;
    if (q.type === 'scale') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new BadRequestException(`Answer to "${key}" must be 1–5`);
      out[key] = n;
    } else {
      const text = String(value).trim();
      if (text.length > 2000) throw new BadRequestException(`Answer to "${key}" is too long`);
      if (text) out[key] = text;
    }
  }
  if (!Object.keys(out).length) throw new BadRequestException('Answer at least one question');
  return out;
}

/**
 * One-answer guard for internal (anonymous) surveys: a keyed hash of the
 * member, so the response row carries no identity yet a member answering
 * again replaces their previous answer instead of stacking a new one.
 */
export function surveyRespondentKey(kind: string, surveyId: string, userId: string) {
  const secret = process.env.APP_ENCRYPTION_KEY || process.env.JWT_ACCESS_SECRET || 'astro';
  return createHmac('sha256', secret).update(`${kind}:${surveyId}:member:${userId}`).digest('hex');
}
