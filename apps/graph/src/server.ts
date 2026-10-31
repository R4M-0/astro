import "dotenv/config";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import { ask, draft } from "./ask.js";
import { auth, canAct, canReadMail, canSeeGalaxy, limit, visibleTo, type Ctx } from "./auth.js";
import { DATA_DIR, type Email, getDataset, isHrMail, participants, saveEmail } from "./data.js";
import { analyse, bridges, galaxy, signals, topTopics } from "./graph.js";
import { isXQdrant, ready } from "./vectors.js";

const app = express();
app.use(cors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3010" }));
app.use(express.json({ limit: "32kb" }));

app.get("/health", async (_req, res) => res.json({ ok: true, vectors: await ready(), xqdrant: await isXQdrant().catch(() => false) }));

const api = express.Router();
api.use(auth);
const need = (ok: (c: Ctx) => boolean) => (req: express.Request, res: express.Response, next: express.NextFunction) => (ok(req.ctx) ? next() : res.status(403).json({ message: "Forbidden" }));

// Audit: who looked at / did what about whom
const AUDIT = join(DATA_DIR, "audit.jsonl");
const audit = (c: Ctx, action: string, target?: string, extra: object = {}) =>
  appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), userId: c.userId, orgId: c.orgId, role: c.role, action, target, ...extra }) + "\n");

api.get("/galaxy", need(canSeeGalaxy), async (req, res) => {
  const ds = await getDataset(req.ctx.orgId);
  res.json({ ...galaxy(ds, visibleTo(req.ctx)), me: req.ctx.selfRef, role: req.ctx.role });
});

api.get("/employees/:ref", async (req, res) => {
  const ds = await getDataset(req.ctx.orgId);
  const e = ds.byRef.get(req.params.ref);
  if (!e || !visibleTo(req.ctx)(e)) return res.status(404).json({ message: "Not found" });
  audit(req.ctx, "employee.view", e.ref);
  const { edges, bc, deptLinks, topics } = analyse(ds);
  const neighbors = edges.filter(x => x.source === e.ref || x.target === e.ref)
    .map(x => ({ ref: x.source === e.ref ? x.target : x.source, weight: x.weight, topic: x.topic, hr: x.hr }))
    .sort((a, b) => b.weight - a.weight).slice(0, 10)
    .map(n => ({ ...n, name: ds.byRef.get(n.ref)?.name, department: ds.byRef.get(n.ref)?.department }));
  const bodies = canReadMail(req.ctx) || e.ref === req.ctx.selfRef;
  const name = (r: string) => ds.byRef.get(r)?.name ?? r;
  const timeline = ds.emails.filter(m => participants(m).includes(e.ref)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 150).map(m => ({
    id: m.id, thread: m.thread_id, date: m.date, kind: m.kind, hr: isHrMail(m), subject: m.subject, from: m.from, fromName: name(m.from), toNames: m.to.map(name),
    topics: topTopics(m.topics, 2), sentiment: m.sentiment, flagged: m.flagged ?? null,
    body: m.flagged ? null : bodies ? m.body : null,
  }));
  const sigs = signals(ds, visibleTo(req.ctx)).filter(s => s.refs.includes(e.ref)).map(({ refs, ...s }) => s);
  res.json({
    ...e, manager: e.managerRef ? { ref: e.managerRef, name: name(e.managerRef) } : null,
    reports: ds.employees.filter(x => x.managerRef === e.ref).map(x => ({ ref: x.ref, name: x.name })),
    topics: topTopics(topics.get(e.ref), 6, true), bridge: +(bc.get(e.ref) ?? 0).toFixed(3), bridgeDepts: [...(deptLinks.get(e.ref) ?? [])],
    neighbors, timeline, signals: sigs, canReadMail: bodies,
  });
});

api.get("/signals", need(canSeeGalaxy), async (req, res) => res.json(signals(await getDataset(req.ctx.orgId), visibleTo(req.ctx))));
api.get("/bridges", need(canSeeGalaxy), async (req, res) => res.json(bridges(await getDataset(req.ctx.orgId), visibleTo(req.ctx))));

api.post("/ask", limit(20), async (req, res) => {
  const { question, refs, department } = req.body ?? {};
  if (typeof question !== "string" || !question.trim() || question.length > 1000) return res.status(400).json({ message: "Invalid question" });
  const ds = await getDataset(req.ctx.orgId);
  audit(req.ctx, "ask", undefined, { question: question.slice(0, 200), refs: Array.isArray(refs) ? refs.slice(0, 50) : undefined, department });
  try {
    res.json(await ask(ds, req.ctx, { question: question.trim(), refs: Array.isArray(refs) ? refs.filter((r: unknown) => typeof r === "string").slice(0, 200) : undefined, department: typeof department === "string" ? department : undefined }));
  } catch (e: any) {
    res.status(502).json({ message: e?.message ?? "Ask failed" });
  }
});

// ---------- Human-in-the-loop actions: draft → approve / reject. Nothing is sent without a click. ----------
interface Action { id: string; orgId: string; ref: string; replyTo?: string; intent: string; subject: string; body: string; status: "pending" | "approved" | "rejected"; createdBy: string; createdAt: string; decidedBy?: string; decidedAt?: string }
const ACTIONS = join(DATA_DIR, "actions.json");
const actions: Action[] = existsSync(ACTIONS) ? JSON.parse(readFileSync(ACTIONS, "utf8")) : [];
const persist = () => writeFileSync(ACTIONS, JSON.stringify(actions, null, 1));

api.get("/actions", need(canAct), (req, res) => res.json(actions.filter(a => a.orgId === req.ctx.orgId).slice().reverse()));
api.post("/actions/draft", need(canAct), limit(20), async (req, res) => {
  const { ref, intent, replyTo } = req.body ?? {};
  const ds = await getDataset(req.ctx.orgId);
  const e = ds.byRef.get(ref);
  if (!e || typeof intent !== "string" || intent.length > 500) return res.status(400).json({ message: "Invalid draft request" });
  try {
    const d = await draft(ds, ref, intent, typeof replyTo === "string" ? replyTo : undefined);
    const a: Action = { id: randomUUID(), orgId: req.ctx.orgId, ref, replyTo, intent, subject: d.subject, body: d.body, status: "pending", createdBy: req.ctx.userId, createdAt: new Date().toISOString() };
    actions.push(a); persist(); audit(req.ctx, "action.draft", ref, { action: a.id });
    res.json(a);
  } catch (err: any) { res.status(502).json({ message: err?.message ?? "Draft failed" }); }
});
api.post("/actions/:id/:decision", need(canAct), async (req, res) => {
  const a = actions.find(x => x.id === req.params.id && x.orgId === req.ctx.orgId);
  const decision = req.params.decision;
  if (!a || a.status !== "pending" || (decision !== "approve" && decision !== "reject")) return res.status(400).json({ message: "Invalid action" });
  if (decision === "approve") {
    if (typeof req.body?.subject === "string") a.subject = req.body.subject.slice(0, 200);
    if (typeof req.body?.body === "string") a.body = req.body.body.slice(0, 5000);
    const ds = await getDataset(req.ctx.orgId);
    const from = req.ctx.selfRef ?? ds.employees.find(e => e.isHr)!.ref;
    const orig = a.replyTo ? ds.emailById.get(a.replyTo) : undefined;
    // the approved email becomes part of the interaction graph
    const m: Email = { id: "m9" + String(Date.now()).slice(-4), thread_id: orig?.thread_id ?? "t9" + String(Date.now()).slice(-4), from, to: [a.ref], cc: [], date: new Date().toISOString(), subject: a.subject, body: a.body, kind: "hr_reply", topics: orig?.topics ?? { feedback: 0.5 }, sentiment: 0.5, flagged: null };
    saveEmail(req.ctx.orgId, m);
  }
  a.status = decision === "approve" ? "approved" : "rejected"; a.decidedBy = req.ctx.userId; a.decidedAt = new Date().toISOString();
  persist(); audit(req.ctx, `action.${a.status}`, a.ref, { action: a.id });
  res.json(a);
});

api.get("/audit", need(canAct), (req, res) => {
  const lines = existsSync(AUDIT) ? readFileSync(AUDIT, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
  res.json(lines.filter(l => l.orgId === req.ctx.orgId).slice(-200).reverse());
});

app.use(api);
const port = Number(process.env.GRAPH_PORT ?? 3012);
app.listen(port, () => console.log(`graph service on :${port}`));
