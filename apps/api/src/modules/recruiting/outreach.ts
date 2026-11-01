/** Pipeline 2 rules: pure, no I/O. */
import { escapeHtml } from '../../common/html';

const DAY = 86_400_000;

export type InviteStatus = 'NONE' | 'INVITED' | 'BOOKED' | 'DECLINED' | 'NO_RESPONSE';
export type MessageKind = 'INVITATION' | 'REMINDER' | 'REJECTION' | 'REPLY';
export const INTENTS = ['CONFIRM', 'QUESTION', 'RESCHEDULE', 'DECLINE', 'NONE_FIT', 'OTHER'] as const;
export type Intent = (typeof INTENTS)[number];

/** The booking link is live only while the candidate is invited or booked. */
export const tokenLive = (inviteStatus: string) => inviteStatus === 'INVITED' || inviteStatus === 'BOOKED';

/**
 * Follow-up deadlines for an invitation still unanswered: D2 (`closeDays`) closes it as no-response,
 * D1 (`reminderDays`) asks for one reminder draft. At most one reminder per invitation.
 */
export function followUp(
  c: { inviteStatus: string; invitedAt: Date | null; hasReminder: boolean },
  o: { reminderDays: number; closeDays: number },
  now: Date,
): 'CLOSE' | 'REMIND' | null {
  if (c.inviteStatus !== 'INVITED' || !c.invitedAt) return null;
  const age = now.getTime() - c.invitedAt.getTime();
  if (age >= o.closeDays * DAY) return 'CLOSE';
  if (age >= o.reminderDays * DAY && !c.hasReminder) return 'REMIND';
  return null;
}

/** Reply triage: what still needs a human regardless of what the model says. */
export const needsHuman = (intent: Intent, modelSays: boolean, flagged: boolean) =>
  modelSays || flagged || intent === 'DECLINE' || intent === 'NONE_FIT' || intent === 'OTHER';

/** Plain-text draft → e-mail HTML. The booking link is added here, never by the model. */
export function renderMail(body: string, link: string | null): string {
  const text = escapeHtml(body).replace(/\r?\n/g, '<br>');
  const a = link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` : '';
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${text}${a}</div>`;
}
