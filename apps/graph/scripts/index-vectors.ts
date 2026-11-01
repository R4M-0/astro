// Indexes the dataset into Qdrant / XQdrant. Run once after `generate` (pnpm --filter @astro/graph index).
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONCEPTS, CONCEPT_LABEL, conceptVector as conceptVec, type Concept } from "../src/concepts.js";
import { detectInjection } from "../src/guard.js";
import { DIM, embed, normalize } from "../src/llm.js";
import { COL, qdrant } from "../src/vectors.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data");
interface Email { id: string; thread_id: string; from: string; to: string[]; cc: string[]; date: string; subject: string; body: string; kind: string; topics: Partial<Record<Concept, number>> }
const emails: Email[] = JSON.parse(readFileSync(join(DATA_DIR, "emails.json"), "utf8"));
const workforce = JSON.parse(readFileSync(join(DATA_DIR, "workforce.json"), "utf8"));
const hrRefs = new Set<string>(workforce.employees.filter((e: any) => e.department === "Ressources humaines").map((e: any) => e.reference));
const num = (s: string) => parseInt(s.replace(/\D/g, ""), 10);
const force = process.argv.includes("--force");

async function recreate(name: string, vectors: object) {
  const exists = await qdrant(`/collections/${name}`).then(() => true, () => false);
  if (exists && !force) return false;
  if (exists) await qdrant(`/collections/${name}`, "DELETE");
  await qdrant(`/collections/${name}`, "PUT", { vectors });
  return true;
}
async function upsert(name: string, points: object[]) {
  for (let i = 0; i < points.length; i += 256) await qdrant(`/collections/${name}/points?wait=true`, "PUT", { points: points.slice(i, i + 256) });
}

// 1. Concept label embeddings: map a free-text question onto the concept axes
if (force || !existsSync(join(DATA_DIR, "concept-embeddings.json"))) {
  console.log("embedding concepts...");
  const conceptEmb = await embed(CONCEPTS.map(c => `HR topic: ${CONCEPT_LABEL[c]}`), "SEMANTIC_SIMILARITY");
  writeFileSync(join(DATA_DIR, "concept-embeddings.json"), JSON.stringify(conceptEmb.map(v => v.map(x => +x.toFixed(5)))));
}

// 2. Emails: dense + concept. Flagged (prompt-injection) bodies are never embedded.
// One dense vector per unique text keeps us inside the free-tier embedding quota: an HR thread is embedded
// once (opening email), peer mail once per subject. Resumable: vectors already in Qdrant are reused.
await recreate(COL.emails, { dense: { size: DIM, distance: "Cosine" }, concept: { size: CONCEPTS.length, distance: "Dot" } });
{
  const HR_KINDS = new Set(["hr_request", "hr_reply", "followup"]);
  const keyOf = (m: Email) => (HR_KINDS.has(m.kind) ? "T:" + m.thread_id : "S:" + m.subject.replace(/^Re: /, ""));
  const mails = emails.filter(m => m.to.length);
  const byMid = new Map(mails.map(m => [m.id, m]));
  const vec = new Map<string, number[]>();
  for (let offset: unknown = null; ; ) {
    const r = await qdrant<{ points: { payload: { mid: string }; vector: { dense: number[] } }[]; next_page_offset: unknown }>(`/collections/${COL.emails}/points/scroll`, "POST", { limit: 500, offset, with_payload: ["mid"], with_vector: ["dense"] });
    for (const p of r.points) { const m = byMid.get(p.payload.mid); if (m && !vec.has(keyOf(m))) vec.set(keyOf(m), p.vector.dense); }
    if (!r.next_page_offset) break;
    offset = r.next_page_offset;
  }
  const textOf = new Map<string, string>();
  for (const m of mails) {
    const k = keyOf(m);
    if (vec.has(k) || textOf.has(k)) continue;
    textOf.set(k, detectInjection(m.body) || k.startsWith("S:") ? m.subject.replace(/^Re: /, "") : `${m.subject}\n${m.body}`.slice(0, 1500));
  }
  const todo = [...textOf];
  console.log(`embedding ${todo.length} unique texts (${vec.size} reused) for ${mails.length} emails...`);
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const dense = await embed(batch.map(([, t]) => t), "RETRIEVAL_DOCUMENT");
    batch.forEach(([k], j) => vec.set(k, dense[j]));
    console.log(`  ${Math.min(i + 50, todo.length)}/${todo.length}`);
  }
  await upsert(COL.emails, mails.map(m => ({
    id: num(m.id), vector: { dense: vec.get(keyOf(m))!, concept: normalize(conceptVec(m.topics)) },
    payload: { mid: m.id, from: m.from, people: [m.from, ...m.to, ...m.cc], date: m.date, kind: m.kind },
  })));
}

// 3. Employees: concept profile = sum of the topics of the mail they took part in
if (await recreate(COL.employees, { concept: { size: CONCEPTS.length, distance: "Dot" } })) {
  const profile = new Map<string, number[]>();
  for (const m of emails) {
    if (!m.to.length) continue;
    for (const p of [m.from, ...m.to, ...m.cc]) {
      if (hrRefs.has(p) && m.kind !== "peer" && m.kind !== "manager") continue;
      const v = profile.get(p) ?? CONCEPTS.map(() => 0);
      conceptVec(m.topics).forEach((x, i) => (v[i] += x));
      profile.set(p, v);
    }
  }
  // dampen everyday collaboration so HR topics drive the explanations
  const damp = CONCEPTS.map(c => (c === "project_collab" ? 0.15 : 1));
  await upsert(COL.employees, [...profile].map(([ref, v]) => ({ id: num(ref), vector: { concept: normalize(v.map((x, i) => x * damp[i])) }, payload: { ref } })));
}

// 4. Handbook sections for policy questions
if (await recreate(COL.policies, { dense: { size: DIM, distance: "Cosine" } })) {
  const sections = readFileSync(join(DATA_DIR, "handbook.md"), "utf8").split(/\n## /).slice(1).map(s => {
    const [title, ...rest] = s.split("\n");
    return { title: title.trim(), text: rest.join("\n").trim() };
  });
  const dense = await embed(sections.map(s => `${s.title}\n${s.text}`), "RETRIEVAL_DOCUMENT");
  await upsert(COL.policies, sections.map((s, i) => ({ id: i + 1, vector: { dense: dense[i] }, payload: s })));
}
console.log("indexed.");
