/**
 * Offline eval (docs/recruiting, mode 1): the deterministic parts of levels 1-3, run in CI as a
 * regression gate. Model-backed metrics live in live.ts.
 */
import { cvKind } from '../cv-text';
import { redactName, sanitizeCv } from '../guard';
import { followUp, needsHuman } from '../outreach';
import { CandidateProfile, hardFilter, verifyEvidence } from '../rules';
import { BENIGN, GOLDEN, INJECTIONS, PERSONAS, PII, REPLIES, body } from './datasets';
import { adverseImpactRatio, classification, kendallTau, mrr, ndcgAtK, precisionAtK, recallAtN, setF1 } from './metrics';

const report: Record<string, number | string> = {};
afterAll(() => console.log('offline eval\n' + Object.entries(report).map(([k, v]) => `  ${k}: ${v}`).join('\n')));

const profileOf = (cv: (typeof GOLDEN)[number]['cvs'][number], miss = false): CandidateProfile => ({
  skills: miss ? [] : cv.skills,
  languages: miss ? [] : (cv.text.match(/^(Languages|Langues)\s*:\s*(.*)$/im)?.[2].split(/,\s*/) ?? []),
  totalYearsExperience: cv.years,
  education: [],
  experiences: [],
  summary: '',
});

describe('metrics', () => {
  it('compute the textbook values', () => {
    expect(ndcgAtK(['a', 'b', 'c'], { a: 3, b: 2, c: 0 }, 3)).toBe(1);
    expect(ndcgAtK(['c', 'b', 'a'], { a: 3, b: 2, c: 0 }, 3)).toBeLessThan(0.7);
    expect(recallAtN(['a', 'x', 'b'], new Set(['a', 'b']), 2)).toBe(0.5);
    expect(precisionAtK(['a', 'x'], new Set(['a']), 2)).toBe(0.5);
    expect(mrr(['x', 'a'], new Set(['a']))).toBe(0.5);
    expect(kendallTau([1, 2, 3], [1, 2, 3])).toBe(1);
    expect(kendallTau([1, 2, 3], [3, 2, 1])).toBe(-1);
    expect(classification([{ gold: 'A', pred: 'A' }, { gold: 'B', pred: 'A' }]).perClass.A.precision).toBe(0.5);
    expect(setF1(['Java', 'Go'], ['java'], (a, b) => a.toLowerCase() === b.toLowerCase()).f1).toBeCloseTo(0.667, 3);
    expect(adverseImpactRatio({ a: { selected: 4, total: 10 }, b: { selected: 5, total: 10 } })).toBe(0.8);
  });
});

describe('level 1 — hard filters', () => {
  const rows = GOLDEN.flatMap((job) => job.cvs.map((cv) => ({ job, cv })));

  it.each([
    ['gold profiles', false],
    ['extractor missed every skill and language', true],
  ])('no qualified candidate is removed (%s)', (label, miss) => {
    const out = rows.map(({ job, cv }) => ({ cv, rejected: hardFilter(job.criteria, profileOf(cv, miss), cv.text).length > 0 }));
    const qualified = out.filter((r) => r.cv.passes);
    const falseRejections = qualified.filter((r) => r.rejected).map((r) => r.cv.id);
    const rejected = out.filter((r) => r.rejected);
    report[`filter false-rejection rate (${label})`] = falseRejections.length / qualified.length;
    report[`filter precision (${label})`] = rejected.filter((r) => !r.cv.passes).length / (rejected.length || 1);
    expect(falseRejections).toEqual([]);
  });

  it('removes every candidate who misses a must-have (gold profiles)', () => {
    const kept = rows.filter(({ job, cv }) => !cv.passes && !hardFilter(job.criteria, profileOf(cv), cv.text).length).map(({ cv }) => cv.id);
    expect(kept).toEqual([]);
  });
});

describe('level 1 — evidence check (faithfulness)', () => {
  const cvs = GOLDEN.flatMap((j) => j.cvs);

  it('keeps real quotes, even re-spaced or re-cased, and zeroes quotes from another CV', () => {
    let kept = 0, fabricated = 0;
    cvs.forEach((cv, i) => {
      const line = cv.text.split('\n').find((l) => l.startsWith('- ')) ?? cv.text.split('\n')[1];
      const other = cvs[(i + 1) % cvs.length].text.split('\n')[1];
      const [real, fake] = verifyEvidence(
        [
          { id: 'real', label: '', score: 3, evidence: `  ${line.toUpperCase().replace(/ /g, '   ')} ` },
          { id: 'fake', label: '', score: 3, evidence: other },
        ],
        cv.text,
      );
      kept += +real.verified;
      fabricated += +fake.verified;
    });
    report['evidence check: real quotes kept'] = `${kept}/${cvs.length}`;
    expect(kept).toBe(cvs.length);
    expect(fabricated).toBe(0);
  });
});

describe('level 3 — security guard', () => {
  it('drops prompt injections (recall) and keeps ordinary lines (FPR = 0)', () => {
    const missed = INJECTIONS.filter((l) => !sanitizeCv(l).flags.some((f) => f.startsWith('instruction')));
    const falsePositives = BENIGN.filter((l) => sanitizeCv(l).flags.length);
    report['injection detection recall'] = (INJECTIONS.length - missed.length) / INJECTIONS.length;
    report['injection FPR'] = falsePositives.length / BENIGN.length;
    expect(missed).toEqual([]);
    expect(falsePositives).toEqual([]);
  });

  it('a poisoned CV reaches the models exactly as its clean twin (rank shift = 0 by construction)', () => {
    const shifted: string[] = [];
    for (const cv of GOLDEN.flatMap((j) => j.cvs))
      for (const inj of INJECTIONS) {
        const lines = cv.text.split('\n');
        lines.splice(3, 0, inj, `${'​'.repeat(3)}${inj}`);
        if (sanitizeCv(lines.join('\n')).text !== sanitizeCv(cv.text).text) shifted.push(`${cv.id}: ${inj}`);
      }
    expect(shifted).toEqual([]);
  });

  it('redacts personal data (redaction recall = 1)', () => {
    const leaks = PII.filter(({ line, secret }) => sanitizeCv(line).text.includes(secret)).map((p) => p.line);
    report['PII redaction recall'] = (PII.length - leaks.length) / PII.length;
    expect(leaks).toEqual([]);
  });

  it('counterfactual twins reach the models as the same text (protected attributes removed)', () => {
    const differing: string[] = [];
    for (const cv of GOLDEN.flatMap((j) => j.cvs)) {
      for (const lang of ['fr', 'en'] as const) {
        const seen = new Set(PERSONAS.map((p) => redactName(sanitizeCv(`${p[lang]}\n${body(cv)}`).text, p.name)));
        if (seen.size > 1) differing.push(`${cv.id} (${lang}):\n${[...seen].map((s) => s.split('\n').slice(0, 5).join(' | ')).join('\n')}`);
      }
    }
    report['counterfactual twins identical'] = `${GOLDEN.flatMap((j) => j.cvs).length - differing.length}/${GOLDEN.flatMap((j) => j.cvs).length}`;
    expect(differing).toEqual([]);
  });

  it('rejects malformed, disguised and oversized files at upload', () => {
    const bad: [string, Buffer][] = [
      ['empty.pdf', Buffer.alloc(0)],
      ['huge.txt', Buffer.alloc(10 * 1024 * 1024 + 1, 'a')],
      ['payload.pdf', Buffer.from('MZ\x90\x00 executable')],
      ['cv.pdf', Buffer.from('PK\x03\x04 not a pdf')],
      ['cv.txt', Buffer.from('text\x00binary')],
      ['cv.exe', Buffer.from('%PDF-1.7')],
    ];
    expect(bad.filter(([name, buf]) => { try { cvKind(name, buf); return true; } catch { return false; } }).map(([n]) => n)).toEqual([]);
    expect(cvKind('cv.txt', Buffer.from('Jane Doe\nNode.js'))).toBe('txt');
  });
});

describe('level 2 — follow-ups (mocked clock)', () => {
  const HOUR = 3_600_000, DAY = 24 * HOUR;

  it('one reminder within an hour of D1, closed within an hour of D2, nothing after', () => {
    const violations: string[] = [];
    for (const [reminderDays, closeDays] of [[1, 2], [3, 7], [2, 3], [5, 5]])
      for (const offsetMin of [0, 17, 59]) {
        const invitedAt = new Date(Date.UTC(2026, 9, 24, 9, offsetMin)); // spans the 25 Oct DST change
        const reminders: number[] = [];
        let closedAt: number | null = null, hasReminder = false;
        const start = Date.UTC(2026, 9, 24, 10); // hourly cron ticks on the hour
        for (let t = start; t < start + 14 * DAY; t += HOUR) {
          const action = followUp({ inviteStatus: closedAt ? 'NO_RESPONSE' : 'INVITED', invitedAt, hasReminder }, { reminderDays, closeDays }, new Date(t));
          if (action === 'REMIND') {
            reminders.push(t);
            hasReminder = true;
          }
          if (action === 'CLOSE') closedAt = t;
        }
        const tag = `D1=${reminderDays} D2=${closeDays} +${offsetMin}min`;
        const d1 = invitedAt.getTime() + reminderDays * DAY, d2 = invitedAt.getTime() + closeDays * DAY;
        if (reminders.length > 1) violations.push(`${tag}: ${reminders.length} reminders`);
        if (reminderDays < closeDays && (reminders.length !== 1 || reminders[0] < d1 || reminders[0] >= d1 + HOUR)) violations.push(`${tag}: reminder off-time`);
        if (!closedAt || closedAt < d2 || closedAt >= d2 + HOUR) violations.push(`${tag}: close off-time`);
        if (closedAt && reminders.some((r) => r >= closedAt!)) violations.push(`${tag}: reminder after close`);
      }
    expect(violations).toEqual([]);
  });

  it('routes every reply a human must see to HR whatever the model says', () => {
    const missed = REPLIES.filter((r) => {
      const flagged = sanitizeCv(r.text).flags.some((f) => f.startsWith('instruction'));
      // worst case: the model labels the intent right but says no human is needed
      const ruleOnly = needsHuman(r.intent, false, flagged);
      return (r.injected || ['DECLINE', 'NONE_FIT', 'OTHER'].includes(r.intent)) && !ruleOnly;
    });
    expect(missed.map((r) => r.text)).toEqual([]);
  });
});
