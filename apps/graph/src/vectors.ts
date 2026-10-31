// Qdrant / XQdrant access. Two vectors per email: "dense" (Gemini embedding, recall) and
// "concept" (dimension i = CONCEPTS[i], explanation). Employees get a concept profile vector.
// XQdrant returns `dims_explained` on query results; plain Qdrant ignores the flag and we compute
// the same per-dimension terms locally, so explanations work on both.
import { CONCEPTS, CONCEPT_LABEL, type Concept } from "./concepts.js";

const URL_ = process.env.QDRANT_URL ?? "http://localhost:6333";
export const COL = { emails: "astro_emails", employees: "astro_employees", policies: "astro_policies" };

export async function qdrant<T = any>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(URL_ + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`qdrant ${method} ${path}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { result: T }).result;
}

export interface Hit { id: number; score: number; payload: any; vector?: any; dims_explained?: Record<string, number> }

export async function query(collection: string, body: Record<string, unknown>): Promise<Hit[]> {
  const r = await qdrant<{ points: Hit[] }>(`/collections/${collection}/points/query`, "POST", body);
  return r.points;
}

let xq: boolean | null = null;
/** True when the server is XQdrant (accepts with_dims_explained). */
export async function isXQdrant() {
  if (xq !== null) return xq;
  // plain Qdrant silently ignores unknown fields, so check the explanation is actually returned
  try {
    const [hit] = await query(COL.employees, { query: CONCEPTS.map(() => 0.1), using: "concept", limit: 1, with_dims_explained: { top: 1 } });
    xq = !!hit?.dims_explained;
  } catch { xq = false; }
  return xq;
}

export interface Reason { concept: Concept; label: string; contribution: number }

/** Concept-space search with per-dimension explanations. */
export async function explainSearch(collection: string, conceptQuery: number[], filter: object | undefined, limit: number) {
  const native = await isXQdrant();
  const hits = await query(collection, {
    query: conceptQuery, using: "concept", limit, filter, with_payload: true,
    ...(native ? { with_dims_explained: { top: 4 } } : {}), with_vector: native ? false : ["concept"],
  });
  return hits.map(h => {
    let dims: [number, number][];
    if (h.dims_explained) dims = Object.entries(h.dims_explained).map(([k, v]) => [Number(k), v]);
    else {
      const v: number[] = h.vector?.concept ?? [];
      dims = v.map((x, i) => [i, x * conceptQuery[i]] as [number, number]).filter(([, c]) => c !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
    }
    const reasons: Reason[] = dims.filter(([, c]) => c > 0.001).map(([i, c]) => ({ concept: CONCEPTS[i], label: CONCEPT_LABEL[CONCEPTS[i]], contribution: +c.toFixed(3) }));
    return { ...h, reasons, explainedBy: native ? "xqdrant" : "local" };
  });
}

export async function ready() {
  try { await qdrant(`/collections/${COL.emails}`); return true; } catch { return false; }
}
