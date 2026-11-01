/**
 * Minimal iCalendar (.ics) reader for interview planning: the recruiter exports their calendar,
 * we read the busy events and propose free interview slots around them. Runs in the browser,
 * nothing is uploaded. Handles folded lines, UTC / floating / TZID times (read as local time),
 * all-day events, DURATION, cancelled and "free" (TRANSPARENT) events, and DAILY / WEEKLY RRULEs.
 */

export interface CalEvent {
  start: Date;
  end: Date;
  summary: string;
  location: string | null;
  allDay: boolean;
}

export interface ParsedCalendar {
  owner: string | null; // X-WR-CALNAME or the first ORGANIZER's CN
  busy: CalEvent[];
  /** events the recruiter explicitly titled as interview slots: proposed as-is */
  offered: CalEvent[];
}

const SLOT_TITLE = /\b(interview|entretien|cr[ée]neau|slot)s?\b/i;
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function parseDate(value: string, params: string): { date: Date; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || /VALUE=DATE(?!-)/.test(params)) return { date: new Date(+y, +mo - 1, +d), allDay: true };
  const parts = [+y, +mo - 1, +d, +h, +mi, +(s ?? 0)] as const;
  return { date: z ? new Date(Date.UTC(...parts)) : new Date(...parts), allDay: false };
}

function parseDuration(v: string): number {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 60 * 60_000;
  const [, w, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

/** Expands a DAILY / WEEKLY rule up to `until` (other rules: first occurrence only). */
function expand(ev: CalEvent, rrule: string | undefined, until: Date): CalEvent[] {
  if (!rrule) return [ev];
  const rule = Object.fromEntries(rrule.split(';').map((p) => p.split('=') as [string, string]));
  if (rule.FREQ !== 'DAILY' && rule.FREQ !== 'WEEKLY') return [ev];
  const interval = Math.max(1, Number(rule.INTERVAL ?? 1));
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  const end = rule.UNTIL ? parseDate(rule.UNTIL, '')?.date ?? until : until;
  const last = end < until ? end : until;
  const days = rule.BYDAY ? rule.BYDAY.split(',').map((d) => DAY_CODES.indexOf(d.slice(-2))) : [ev.start.getDay()];
  const length = ev.end.getTime() - ev.start.getTime();
  const out: CalEvent[] = [];
  const cursor = new Date(ev.start);
  for (let i = 0; cursor <= last && out.length < count && i < 2000; i++) {
    const weekIndex = Math.floor((cursor.getTime() - ev.start.getTime()) / (7 * 86_400_000));
    const onDay = rule.FREQ === 'DAILY' ? i % interval === 0 : days.includes(cursor.getDay()) && weekIndex % interval === 0;
    if (onDay && cursor >= ev.start) out.push({ ...ev, start: new Date(cursor), end: new Date(cursor.getTime() + length) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function parseIcs(text: string, horizon: Date): ParsedCalendar {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const cal: ParsedCalendar = { owner: null, busy: [], offered: [] };
  let cur: Record<string, { value: string; params: string }> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const [name, ...params] = line.slice(0, idx).split(';');
    const value = line.slice(idx + 1).replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
    if (!cur) {
      if (name === 'X-WR-CALNAME') cal.owner = value;
      continue;
    }
    if (line === 'END:VEVENT') {
      const start = cur.DTSTART && parseDate(cur.DTSTART.value, cur.DTSTART.params);
      if (start && cur.STATUS?.value !== 'CANCELLED' && cur.TRANSP?.value !== 'TRANSPARENT') {
        const endP = cur.DTEND && parseDate(cur.DTEND.value, cur.DTEND.params);
        const end = endP?.date ?? new Date(start.date.getTime() + (cur.DURATION ? parseDuration(cur.DURATION.value) : start.allDay ? 86_400_000 : 3_600_000));
        const summary = cur.SUMMARY?.value ?? '';
        const ev: CalEvent = { start: start.date, end, summary, location: cur.LOCATION?.value || null, allDay: start.allDay };
        for (const e of expand(ev, cur.RRULE?.value, horizon)) (SLOT_TITLE.test(summary) && !start.allDay ? cal.offered : cal.busy).push(e);
      }
      if (!cal.owner && cur.ORGANIZER) cal.owner = /CN=("?)([^;:"]+)\1/.exec(cur.ORGANIZER.params)?.[2] ?? null;
      cur = null;
      continue;
    }
    if (line.startsWith('END:') || line.startsWith('BEGIN:')) continue; // nested VALARM etc.
    cur[name] ??= { value, params: params.join(';') };
  }
  return cal;
}

export interface ProposedSlot { start: Date; durationMinutes: number; location: string | null; source: 'calendar' | 'free' }

/** French public holidays (fixed dates + Easter Monday, Ascension, Whit Monday): no interviews proposed. */
function isFrenchHoliday(d: Date): boolean {
  const y = d.getFullYear();
  const md = `${d.getMonth() + 1}-${d.getDate()}`;
  if (['1-1', '5-1', '5-8', '7-14', '8-15', '11-1', '11-11', '12-25'].includes(md)) return true;
  // Easter Sunday (anonymous Gregorian algorithm)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - dd - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  return [1, 39, 50].some((offset) => {
    const x = new Date(easter);
    x.setDate(x.getDate() + offset);
    return x.toDateString() === d.toDateString();
  });
}

/**
 * Free interview slots over the next `workingDays` (Mon–Fri, 9:00–17:30, lunch 12:00–13:30 kept free),
 * at least `buffer` minutes away from any busy event. Explicit "interview slot" events come first.
 */
export function proposeSlots(cal: ParsedCalendar, opts: { from?: Date; workingDays?: number; duration?: number; buffer?: number; max?: number } = {}): ProposedSlot[] {
  const { from = new Date(), workingDays = 10, duration = 45, buffer = 15, max = 12 } = opts;
  const offered = cal.offered
    .filter((e) => e.start > from)
    .map((e) => ({ start: e.start, durationMinutes: Math.round((e.end.getTime() - e.start.getTime()) / 60_000) || duration, location: e.location, source: 'calendar' as const }));
  const free: ProposedSlot[] = [];
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  for (let seen = 0; seen < workingDays && free.length < max * 3; ) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() === 0 || day.getDay() === 6 || isFrenchHoliday(day)) continue;
    seen++;
    for (const [h, m] of [[9, 0], [10, 0], [11, 0], [13, 30], [14, 30], [15, 30], [16, 30]]) {
      const start = new Date(day);
      start.setHours(h, m, 0, 0);
      const end = new Date(start.getTime() + duration * 60_000);
      if (end.getHours() * 60 + end.getMinutes() > 17 * 60 + 30) continue;
      const clash = [...cal.busy, ...cal.offered].some((b) => b.start.getTime() < end.getTime() + buffer * 60_000 && b.end.getTime() > start.getTime() - buffer * 60_000);
      if (!clash) free.push({ start, durationMinutes: duration, location: null, source: 'free' });
    }
  }
  // spread the free proposals over the period instead of filling the first days
  const step = Math.max(1, Math.floor(free.length / Math.max(1, max - offered.length)));
  const picked = free.filter((_, i) => i % step === 0).slice(0, Math.max(0, max - offered.length));
  return [...offered, ...picked].sort((a, b) => a.start.getTime() - b.start.getTime());
}
