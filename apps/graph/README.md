# @astro/graph — Workforce Galaxy

Our hackathon module (Secure AI HR System): axes **Employee Questions** (extended to full employee management) and **Email Summary**.
The whole workforce of the organization is rendered as a 3D galaxy in Astro (`/hr/galaxy`): each **star** is an
employee, each **cluster** a department, and every email between HR and employees, or between employees, is a **beam**
that connects them. You can fly through it, open anyone's file, and ask questions about a person, a selection,
a department or the whole company. Every answer cites its sources and explains **why** each employee matched.

> Golden rule: *the agent executes, the human decides about people.* Signals are suggestions with reasons,
> drafts go to an approval queue, nothing is sent or recorded without a click.

## Features

| | Feature | Where |
|---|---|---|
| F1 | Galaxy view: bloom, starfield, glow sized by seniority and activity, fly-to camera | `apps/web/src/components/galaxy/galaxy-canvas.tsx` |
| F2 | Employee panel: facts from Astro's DB, leave, topics, strongest connections, mail timeline | `panels.tsx` · `GET /employees/:ref` |
| F3 | Ask the galaxy: matching stars light up, answer with `[m00123]` / `[policy:…]` citations | `galaxy-view.tsx` · `POST /ask` |
| F4 | Collection queries: shift-click stars or pick a department as scope | `POST /ask {refs \| department}` |
| F5 | Employee Q&A in « Mon espace »: handbook + own file only | `ask-hr.tsx` |
| F6 | Explainable matches: concept vectors + XQdrant `with_dims_explained` → reason bars | `src/vectors.ts` |
| F7 | Human in the loop: Gemini drafts, HR edits, then approves or rejects. Approved mail joins the graph | `/actions/*` |
| F8 | Timeline scrubber: replay month by month (hires appear, leavers fade, beams = last 3 months) | `galaxy-view.tsx` |
| F9 | Org lenses: departments, reporting lines (tree), dominant topic, location | `galaxy-view.tsx` |
| F10 | Signals: recurring concerns per team, silent employees, missed onboarding check-ins, unanswered requests, trial ends, unused leave, blocked injections | `src/graph.ts` |
| F11 | Bridges: betweenness centrality on work mail (HR excluded) and departments connected | `src/graph.ts` |
| F12 | Search-to-fly: `/` to focus, Enter flies to the star | `galaxy-view.tsx` |
| F13 | Live mail ingest: Mailpit acts as the company mail server. New mail is tagged by Gemini Flash Lite (topics, sentiment, summary, needs-a-reply, AI-instruction check), embedded into XQdrant, and shows up live as a beam and a toast. A composer in the galaxy sends demo mail through the same path | `src/ingest.ts` · `live-mail.tsx` · `GET /mail/events`, `POST /mail/send` |
| F14 | **Email Summary (spec axis 2):** HR inbox digest (`/hr/inbox`, « Boîte RH ») for today or the last 7 days, grouped by type, with rule-based urgency that states its reason. Emails needing a human answer come first, older unanswered requests included. A Gemini overview cites its source emails, and Draft reply → edit → approve sends a handbook-grounded answer through the approval flow | `src/digest.ts` · `components/digest/inbox-digest.tsx` · `GET /digest`, `GET /digest/overview` |

## How explanations work (XQdrant)

Raw embedding dimensions mean nothing to a person, so each email also gets an interpretable **concept vector**: 32 named
HR topics (`src/concepts.ts`), where dimension *i* is topic *i*. Employees get a concept profile (the sum of their mail).
A question is embedded with Gemini and projected onto the concept axes. XQdrant's `with_dims_explained` then returns
the top contributing dimensions per match, for example *"Workload +0.41, Overtime +0.22"*. On plain Qdrant the same
per-dimension terms are computed locally, so the UI works with both. Recall comes from the dense Gemini embedding.

## Security

- **Auth**: verifies Astro access tokens (same `JWT_ACCESS_SECRET`) and checks the session and the membership in the `X-Organization-Id` tenant.
- **RBAC** mirrors Astro: `org_admin`/`hr_manager` see everyone and mail bodies, `manager` sees their departments (subjects only), `employee` only themselves.
- **Prompt injection**, in two layers. Mail is untrusted data and is always delimited in prompts. (1) Regex patterns flag obvious attacks before any model sees the body (`src/guard.ts`). (2) At live ingest, the tagging call also classifies whether the email gives instructions to an AI, which catches subtle attacks with no keywords. Flagged bodies are never embedded and are withheld from the assistant afterwards. The dataset contains 3 planted attacks, and the composer has an "Injection" preset.
- **No sensitive inferences** in the taxonomy (health, religion, politics…). No scoring or ranking of people.
- Per-user rate limit on LLM endpoints, payload size limits, parameterized SQL, CORS locked to the web origin, audit log of every view, question and decision (`GET /audit`).

## Data

`scripts/generate.ts` (seeded, deterministic) creates **Aurora Industries**: 142 fictional employees across 10 departments, the 4 Astro demo
accounts included, and about 3.5k emails over 12 months with planted stories: a workload spike in Production / Assemblage,
remote-work questions in Commercial, a conflict in Quality, missed onboarding check-ins, silent employees and cross-department
bridges. `data/workforce.json` is read by `apps/api/prisma/seed.ts`, so the Astro employee registry and the galaxy show the same people.

## Run

```bash
docker compose -f docker-compose.dev.yml up -d postgres redis qdrant mailpit
cp apps/graph/.env.example apps/graph/.env      # set GEMINI_API_KEY and the same JWT_ACCESS_SECRET as apps/api
pnpm --filter @astro/graph generate             # optional: the generated data is committed
pnpm --filter @astro/api prisma:seed
pnpm --filter @astro/graph index                # embeds mail + handbook into Qdrant (once; --force to rebuild)
pnpm --filter @astro/graph dev                  # :3012
```

Live mail: the service polls Mailpit (`MAILPIT_URL`, default `http://localhost:8026`) every 4 s. Mail between employees of the demo org is ingested, and anything else is skipped. Send from the galaxy's composer, or with any SMTP client to `localhost:1026` using employee addresses (`@aurora-industries.example`, or the demo accounts' emails). Watch the raw mailbox at http://localhost:8026.

Vector DB: the dev compose runs the XQdrant image (`golden5ragon/xqdrant`). The published image predates `dims_explained`, so reason bars are computed by this service. `GET /health` reports `xqdrant: true` once an image with native explanations is used.

Stack: Express 5 + TypeScript (tsx), `pg`, Qdrant/XQdrant REST, Google AI Studio (`gemini-flash-lite-latest`, `gemini-embedding-001`).
Web: `react-force-graph-3d` + three.js (UnrealBloom), inside the Astro Next.js app.
