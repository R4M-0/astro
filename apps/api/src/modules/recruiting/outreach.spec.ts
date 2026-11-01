import { followUp, needsHuman, renderMail, tokenLive } from './outreach';

const o = { reminderDays: 3, closeDays: 7 };
const at = (days: number) => new Date(Date.UTC(2026, 10, 1) + days * 86_400_000);
const invited = { inviteStatus: 'INVITED', invitedAt: at(0), hasReminder: false };

describe('pipeline 2 follow-ups', () => {
  it('reminds once at D1 and closes at D2', () => {
    expect(followUp(invited, o, at(2))).toBeNull();
    expect(followUp(invited, o, at(3))).toBe('REMIND');
    expect(followUp({ ...invited, hasReminder: true }, o, at(5))).toBeNull();
    expect(followUp({ ...invited, hasReminder: true }, o, at(7))).toBe('CLOSE');
    expect(followUp(invited, o, at(9))).toBe('CLOSE');
  });

  it('leaves answered or never-sent invitations alone', () => {
    for (const inviteStatus of ['NONE', 'BOOKED', 'DECLINED', 'NO_RESPONSE']) expect(followUp({ ...invited, inviteStatus }, o, at(30))).toBeNull();
    expect(followUp({ ...invited, invitedAt: null }, o, at(30))).toBeNull();
  });

  it('keeps the booking link live only while invited or booked', () => {
    expect(['NONE', 'INVITED', 'BOOKED', 'DECLINED', 'NO_RESPONSE'].filter(tokenLive)).toEqual(['INVITED', 'BOOKED']);
  });

  it('routes declines, unknown intents and flagged replies to a human', () => {
    expect(needsHuman('QUESTION', false, false)).toBe(false);
    expect(needsHuman('QUESTION', false, true)).toBe(true);
    for (const i of ['DECLINE', 'NONE_FIT', 'OTHER'] as const) expect(needsHuman(i, false, false)).toBe(true);
  });

  it('escapes the draft and appends the link itself', () => {
    const html = renderMail('Bonjour <script>x</script>\nÀ bientôt', 'https://app/b/t"1');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<br>');
    expect(html).toContain('href="https://app/b/t&quot;1"');
    expect(renderMail('x', null)).not.toContain('<a');
  });
});
