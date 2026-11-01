// Google AI Studio (Gemini Flash Lite + Gemini embeddings).
import { GoogleGenAI } from "@google/genai";

// GEMINI_API_KEY may hold several comma-separated keys: we rotate to the next one on a rate limit
const clients = (process.env.GEMINI_API_KEY ?? "").split(",").map(k => k.trim()).filter(Boolean).map(apiKey => new GoogleGenAI({ apiKey }));
let current = 0;
export const ai = clients.length ? { get models() { return clients[current].models; } } : null;
const rotate = () => { current = (current + 1) % clients.length; };
export const MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest";
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";
export const DIM = 768;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function retry<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e: any) {
      const status = e?.status ?? e?.code;
      if (i >= tries - 1 || (status && status !== 429 && status < 500)) throw e;
      if (status === 429 && clients.length > 1 && i < clients.length - 1) { rotate(); continue; }
      // free-tier quotas are per minute: honour the server's retry delay when it gives one
      const hinted = Number(String(e?.message ?? "").match(/retry in ([\d.]+)s/i)?.[1] ?? 0) * 1000;
      await sleep(Math.max(hinted, status === 429 ? 20000 : 1500 * 2 ** i));
    }
  }
}

export async function embed(texts: string[], task: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY"): Promise<number[][]> {
  if (!ai) throw new Error("GEMINI_API_KEY is not set");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const res = await retry(() => ai.models.embedContent({ model: EMBED_MODEL, contents: texts.slice(i, i + 100), config: { taskType: task, outputDimensionality: DIM } }));
    for (const e of res.embeddings ?? []) out.push(normalize(e.values ?? []));
  }
  return out;
}

export function normalize(v: number[]) {
  const n = Math.hypot(...v) || 1;
  return v.map(x => x / n);
}

export async function generateJson<T>(system: string, prompt: string, schema: object): Promise<T> {
  if (!ai) throw new Error("GEMINI_API_KEY is not set");
  const res = await retry(() => ai.models.generateContent({
    model: MODEL, contents: prompt,
    config: { systemInstruction: system, responseMimeType: "application/json", responseSchema: schema as any, temperature: 0.2 },
  }));
  return JSON.parse(res.text ?? "{}") as T;
}
