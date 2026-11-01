// Loads one organization's workforce: core HR fields from Astro's Postgres (source of truth),
// enriched with the fictional dataset (location, skills, leave, mail) keyed by employee reference.
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { CONCEPTS, type Concept } from "./concepts.js";
import { detectInjection } from "./guard.js";

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data");
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export interface Email {
  id: string; thread_id: string; from: string; to: string[]; cc: string[]; date: string;
  subject: string; body: string; kind: string; topics: Partial<Record<Concept, number>>; sentiment: number;
  flagged?: string | null;
  // set by live ingest (Gemini): one-line summary and whether HR must answer
  summary?: string; needsReply?: boolean;
}
export interface Employee {
  id: string; ref: string; name: string; firstName: string; email: string | null; title: string | null;
  department: string; departmentId: string | null; managerRef: string | null; hireDate: string | null; exitDate: string | null;
  trialEndDate: string | null; contract: string | null; active: boolean;
  team: string; level: string; location: string; skills: string[]; leave: { annual: number; taken: number; remaining: number }; sickDays: number;
  isHr: boolean;
}
export interface Dataset {
  orgId: string; employees: Employee[]; byRef: Map<string, Employee>; emails: Email[]; emailById: Map<string, Email>;
  departments: { name: string; color: string }[];
}

const json = <T,>(f: string): T => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8"));
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const cache = new Map<string, Dataset>();

export async function getDataset(orgId: string): Promise<Dataset> {
  const hit = cache.get(orgId);
  if (hit) return hit;
  const workforce = json<{ departments: { name: string; color: string }[]; employees: any[] }>("workforce.json");
  const extras = new Map(workforce.employees.map(e => [e.reference, e]));
  const { rows } = await pool.query(
    `SELECT e.id, e.reference, e."firstName", e."lastName", e.email, e."jobTitle", e."departmentId", d.name AS department,
            m.reference AS "managerRef", e."hireDate", e."exitDate", e."trialEndDate", e."contractType", e.active
       FROM "Employee" e
       LEFT JOIN "Department" d ON d.id = e."departmentId"
       LEFT JOIN "Employee" m ON m.id = e."managerId"
      WHERE e."organizationId" = $1 AND e."deletedAt" IS NULL`, [orgId]);
  const employees: Employee[] = rows.map(r => {
    const x = extras.get(r.reference);
    const department = r.department ?? "Sans service";
    return {
      id: r.id, ref: r.reference, name: `${r.firstName} ${r.lastName}`, firstName: r.firstName, email: r.email, title: r.jobTitle,
      department, departmentId: r.departmentId, managerRef: r.managerRef, hireDate: day(r.hireDate), exitDate: day(r.exitDate),
      trialEndDate: day(r.trialEndDate), contract: r.contractType, active: r.active,
      team: x?.team ?? department, level: x?.level ?? "Mid", location: x?.location ?? "Lyon", skills: x?.skills ?? [],
      leave: x?.leave ?? { annual: 25, taken: 0, remaining: 25 }, sickDays: x?.sickDays ?? 0,
      isHr: department === "Ressources humaines",
    };
  });
  const byRef = new Map(employees.map(e => [e.ref, e]));
  // Mail only exists for employees that are in this org (the demo dataset); plus approved actions saved later
  const emails = [...json<Email[]>("emails.json"), ...readSaved()].filter(m => byRef.has(m.from) && m.to.every(t => byRef.has(t)));
  // keep a flag set at live ingest (AI classifier), otherwise run the pattern check
  for (const m of emails) m.flagged = m.flagged ?? detectInjection(m.body);
  const known = new Map(workforce.departments.map(d => [d.name, d.color]));
  const palette = ["#5b8cff", "#2fd6c3", "#ff6fa8", "#ffb347", "#a98bff", "#8be06b", "#4dd2ff", "#ffe066"];
  const departments = [...new Set(employees.map(e => e.department))].map((name, i) => ({ name, color: known.get(name) ?? palette[i % palette.length] }));
  const ds: Dataset = { orgId, employees, byRef, emails, emailById: new Map(emails.map(m => [m.id, m])), departments };
  cache.set(orgId, ds);
  return ds;
}
export const invalidate = (orgId: string) => cache.delete(orgId);

// Approved actions become part of the interaction history
const SAVED = join(DATA_DIR, "saved-emails.jsonl");
function readSaved(): Email[] {
  if (!existsSync(SAVED)) return [];
  return readFileSync(SAVED, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
}
export function saveEmail(orgId: string, m: Email) {
  appendFileSync(SAVED, JSON.stringify(m) + "\n");
  const ds = cache.get(orgId);
  if (ds) { ds.emails.push(m); ds.emailById.set(m.id, m); }
}

export const conceptVec = (topics: Email["topics"]) => CONCEPTS.map(c => topics[c] ?? 0);
export const participants = (m: Email) => [m.from, ...m.to, ...m.cc];
export const isHrMail = (m: Email) => m.kind === "hr_request" || m.kind === "hr_reply" || m.kind === "followup";
