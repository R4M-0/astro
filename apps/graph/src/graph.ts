// Galaxy payload (nodes, aggregated edges with a per-month histogram), bridges and signals.
import { CONCEPTS, CONCEPT_LABEL, type Concept } from "./concepts.js";
import { type Dataset, type Email, type Employee, isHrMail, participants } from "./data.js";

const DAY = 86400000;
const month = (iso: string) => iso.slice(0, 7);
const PEER_TOPICS = new Set<Concept>(["project_collab", "feedback", "team_event", "recognition", "mentoring", "performance_review"]);

export interface Edge { source: string; target: string; weight: number; months: Record<string, number>; topic: Concept; hr: boolean }

function edgesOf(ds: Dataset): Edge[] {
  const map = new Map<string, Edge & { topicCount: Partial<Record<Concept, number>> }>();
  for (const m of ds.emails) {
    if (!m.to.length) continue; // broadcasts are not interactions
    for (const t of [...m.to, ...m.cc]) {
      if (t === m.from) continue;
      const [a, b] = [m.from, t].sort();
      const key = a + "|" + b;
      let e = map.get(key);
      if (!e) map.set(key, (e = { source: a, target: b, weight: 0, months: {}, topic: "project_collab", hr: false, topicCount: {} }));
      e.weight++;
      e.months[month(m.date)] = (e.months[month(m.date)] ?? 0) + 1;
      e.hr ||= isHrMail(m);
      for (const [c, w] of Object.entries(m.topics) as [Concept, number][]) e.topicCount[c] = (e.topicCount[c] ?? 0) + w;
    }
  }
  return [...map.values()].map(({ topicCount, ...e }) => ({ ...e, topic: (Object.entries(topicCount).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "project_collab") as Concept }));
}

/** Brandes betweenness centrality on the unweighted interaction graph. */
function betweenness(nodes: string[], adj: Map<string, Set<string>>) {
  const cb = new Map(nodes.map(n => [n, 0]));
  for (const s of nodes) {
    const stack: string[] = [], pred = new Map<string, string[]>(), sigma = new Map<string, number>(), dist = new Map<string, number>();
    for (const n of nodes) { pred.set(n, []); sigma.set(n, 0); dist.set(n, -1); }
    sigma.set(s, 1); dist.set(s, 0);
    const queue = [s];
    while (queue.length) {
      const v = queue.shift()!; stack.push(v);
      for (const w of adj.get(v) ?? []) {
        if (dist.get(w)! < 0) { queue.push(w); dist.set(w, dist.get(v)! + 1); }
        if (dist.get(w) === dist.get(v)! + 1) { sigma.set(w, sigma.get(w)! + sigma.get(v)!); pred.get(w)!.push(v); }
      }
    }
    const delta = new Map(nodes.map(n => [n, 0]));
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of pred.get(w)!) delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
      if (w !== s) cb.set(w, cb.get(w)! + delta.get(w)!);
    }
  }
  const max = Math.max(...cb.values(), 1);
  return new Map([...cb].map(([k, v]) => [k, v / max]));
}

interface Analysis { edges: Edge[]; bc: Map<string, number>; deptLinks: Map<string, Set<string>>; topics: Map<string, Partial<Record<Concept, number>>> }
const analysisCache = new WeakMap<Dataset, { n: number; a: Analysis }>();

export function analyse(ds: Dataset): Analysis {
  const hit = analysisCache.get(ds);
  if (hit && hit.n === ds.emails.length) return hit.a;
  const edges = edgesOf(ds);
  const adj = new Map<string, Set<string>>();
  const deptLinks = new Map<string, Set<string>>();
  for (const e of edges) {
    const a = ds.byRef.get(e.source)!, b = ds.byRef.get(e.target)!;
    // HR links everyone by design: leave them out so bridges are about the work itself
    if (a.isHr || b.isHr) continue;
    (adj.get(e.source) ?? adj.set(e.source, new Set()).get(e.source)!).add(e.target);
    (adj.get(e.target) ?? adj.set(e.target, new Set()).get(e.target)!).add(e.source);
    if (a.department !== b.department && e.weight >= 2) {
      (deptLinks.get(a.ref) ?? deptLinks.set(a.ref, new Set()).get(a.ref)!).add(b.department);
      (deptLinks.get(b.ref) ?? deptLinks.set(b.ref, new Set()).get(b.ref)!).add(a.department);
    }
  }
  const bc = betweenness(ds.employees.filter(e => !e.isHr).map(e => e.ref), adj);
  const topics = new Map<string, Partial<Record<Concept, number>>>();
  for (const m of ds.emails) {
    if (!m.to.length) continue;
    for (const p of participants(m)) {
      if (ds.byRef.get(p)?.isHr && isHrMail(m)) continue; // HR's own topics would be everybody's
      const t = topics.get(p) ?? topics.set(p, {}).get(p)!;
      for (const [c, w] of Object.entries(m.topics) as [Concept, number][]) t[c] = (t[c] ?? 0) + w;
    }
  }
  const a = { edges, bc, deptLinks, topics };
  analysisCache.set(ds, { n: ds.emails.length, a });
  return a;
}

export const topTopics = (t: Partial<Record<Concept, number>> = {}, n = 3, hrOnly = false) =>
  (Object.entries(t) as [Concept, number][]).filter(([c]) => !hrOnly || !PEER_TOPICS.has(c)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([c, w]) => ({ concept: c, label: CONCEPT_LABEL[c], weight: +w.toFixed(1) }));

export function galaxy(ds: Dataset, visible: (e: Employee) => boolean) {
  const { edges, bc, deptLinks, topics } = analyse(ds);
  const now = Date.now();
  const activity = new Map<string, number>(), hrCount = new Map<string, number>();
  for (const m of ds.emails) {
    const recent = now - Date.parse(m.date) < 30 * DAY;
    for (const p of participants(m)) {
      if (recent) activity.set(p, (activity.get(p) ?? 0) + 1);
      if (isHrMail(m)) hrCount.set(p, (hrCount.get(p) ?? 0) + 1);
    }
  }
  const nodes = ds.employees.filter(visible).map(e => ({
    ref: e.ref, id: e.id, name: e.name, title: e.title, department: e.department, team: e.team, level: e.level,
    managerRef: e.managerRef, hireDate: e.hireDate, exitDate: e.exitDate, location: e.location, contract: e.contract, isHr: e.isHr,
    topic: topTopics(topics.get(e.ref), 1, true)[0]?.concept ?? "project_collab",
    topics: topTopics(topics.get(e.ref), 3, true),
    activity: activity.get(e.ref) ?? 0, hrCount: hrCount.get(e.ref) ?? 0,
    bridge: +(bc.get(e.ref) ?? 0).toFixed(3), bridgeDepts: [...(deptLinks.get(e.ref) ?? [])],
  }));
  const keep = new Set(nodes.map(n => n.ref));
  const months = [...new Set(ds.emails.map(m => month(m.date)))].sort();
  return {
    departments: ds.departments, concepts: CONCEPTS.map(c => ({ key: c, label: CONCEPT_LABEL[c] })), months,
    nodes, edges: edges.filter(e => keep.has(e.source) && keep.has(e.target)),
  };
}

export function bridges(ds: Dataset, visible: (e: Employee) => boolean, n = 10) {
  const { bc, deptLinks } = analyse(ds);
  return ds.employees.filter(e => visible(e) && !e.isHr && e.active)
    .map(e => ({ ref: e.ref, name: e.name, department: e.department, title: e.title, score: +(bc.get(e.ref) ?? 0).toFixed(3), connects: [...(deptLinks.get(e.ref) ?? [])] }))
    .sort((a, b) => b.score - a.score).slice(0, n);
}

// ---------- signals: suggestions for a human, each with its reason and evidence ----------
export interface Signal { id: string; kind: string; severity: "info" | "attention" | "important"; title: string; reason: string; refs: string[]; evidence: string[] }

export function signals(ds: Dataset, visible: (e: Employee) => boolean): Signal[] {
  const now = Date.now(), out: Signal[] = [];
  const active = ds.employees.filter(e => e.active && visible(e));
  const hrMail = ds.emails.filter(isHrMail);
  const lastHr = new Map<string, number>();
  for (const m of hrMail) for (const p of participants(m)) lastHr.set(p, Math.max(lastHr.get(p) ?? 0, Date.parse(m.date)));

  // 1. Recurring concerns per team over the last 90 days vs the 90 days before
  const CONCERNS: Concept[] = ["workload", "overtime", "conflict", "wellbeing"];
  const byTeam = new Map<string, { now: Set<string>; before: Set<string>; mails: string[] }>();
  for (const m of hrMail) {
    if (m.kind !== "hr_request" || !CONCERNS.some(c => (m.topics[c] ?? 0) >= 1)) continue;
    const e = ds.byRef.get(m.from);
    if (!e || !visible(e)) continue;
    const age = now - Date.parse(m.date), key = `${e.department} · ${e.team}`;
    const t = byTeam.get(key) ?? byTeam.set(key, { now: new Set(), before: new Set(), mails: [] }).get(key)!;
    if (age < 90 * DAY) { t.now.add(e.ref); t.mails.push(m.id); } else if (age < 180 * DAY) t.before.add(e.ref);
  }
  for (const [team, t] of byTeam) if (t.now.size >= 3) out.push({
    id: `concern:${team}`, kind: "recurring_concern", severity: t.now.size >= 6 ? "important" : "attention",
    title: `Recurring workload / wellbeing concerns in ${team}`,
    reason: `${t.now.size} different people raised workload, overtime, conflict or wellbeing topics in the last 90 days (${t.before.size} in the 90 days before).`,
    refs: [...t.now], evidence: t.mails.slice(0, 12),
  });

  // 2. Silent employees: no HR interaction for 6 months
  const silent = active.filter(e => !e.isHr && e.hireDate && now - Date.parse(e.hireDate) > 180 * DAY && now - (lastHr.get(e.ref) ?? 0) > 180 * DAY);
  if (silent.length) out.push({ id: "silent", kind: "silent", severity: "info", title: `${silent.length} employees with no HR contact for 6+ months`,
    reason: "No HR email in either direction for more than 180 days. A short check-in can surface issues early.", refs: silent.map(e => e.ref), evidence: [] });

  // 3. Onboarding check-ins due (hired < 120 days, no 30-day check-in)
  for (const e of active) {
    if (!e.hireDate) continue;
    const age = now - Date.parse(e.hireDate);
    if (age < 30 * DAY || age > 120 * DAY) continue;
    const had = hrMail.some(m => m.topics.onboarding && participants(m).includes(e.ref));
    if (!had) out.push({ id: `onboarding:${e.ref}`, kind: "onboarding", severity: "attention", title: `Onboarding check-in missing: ${e.name}`,
      reason: `Joined ${Math.round(age / DAY)} days ago (${e.department}). The 30-day HR check-in never happened.`, refs: [e.ref], evidence: [] });
  }

  // 4. Unanswered HR requests older than 5 days
  const threads = new Map<string, Email[]>();
  for (const m of hrMail) (threads.get(m.thread_id) ?? threads.set(m.thread_id, []).get(m.thread_id)!).push(m);
  const unanswered = [...threads.values()].filter(t => t.length === 1 && t[0].kind === "hr_request" && !ds.byRef.get(t[0].from)?.isHr && now - Date.parse(t[0].date) > 5 * DAY && !t[0].flagged)
    .map(t => t[0]).filter(m => visible(ds.byRef.get(m.from)!));
  if (unanswered.length) out.push({ id: "unanswered", kind: "unanswered", severity: "important", title: `${unanswered.length} employee requests without an HR answer`,
    reason: "HR requests with no reply for more than 5 days.", refs: [...new Set(unanswered.map(m => m.from))], evidence: unanswered.map(m => m.id) });

  // 5. Trial periods ending within 30 days
  for (const e of active) if (e.trialEndDate) {
    const left = (Date.parse(e.trialEndDate) - now) / DAY;
    if (left >= 0 && left <= 30) out.push({ id: `trial:${e.ref}`, kind: "trial_end", severity: "attention", title: `Trial period ends in ${Math.ceil(left)} days: ${e.name}`,
      reason: `Trial period ends on ${e.trialEndDate}. The decision belongs to the manager and HR.`, refs: [e.ref], evidence: [] });
  }

  // 6. Unused leave close to year end
  const highLeave = active.filter(e => e.leave.remaining >= 15 && !e.isHr);
  if (highLeave.length && new Date().getUTCMonth() >= 8) out.push({ id: "leave", kind: "unused_leave", severity: "info", title: `${highLeave.length} employees with 15+ leave days left`,
    reason: "Only 5 days can be carried over (handbook, Annual leave). Remind them to plan their leave.", refs: highLeave.map(e => e.ref), evidence: [] });

  // 7. Security: prompt-injection attempts caught in mail
  const flagged = ds.emails.filter(m => m.flagged && visible(ds.byRef.get(m.from)!));
  if (flagged.length) out.push({ id: "injection", kind: "security", severity: "important", title: `${flagged.length} emails contained AI instructions (blocked)`,
    reason: "These emails try to give orders to the AI assistant. Their content is never sent to the model.", refs: [...new Set(flagged.map(m => m.from))], evidence: flagged.map(m => m.id) });

  const rank = { important: 0, attention: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
