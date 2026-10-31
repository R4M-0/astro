# Astro — HR management SaaS

Astro is a multi-tenant B2B app for human-resources management: employees and org chart,
job descriptions, skills and competency matrix, cross-skilling (polyvalence), training plan with
hot/cold feedback, onboarding/offboarding plans with an e-signed trial-period sign-off, employee
surveys, Excel imports and a personal « Mon espace » for every member.

It keeps a mature, audit-ready platform layer:
multi-tenancy, RBAC, department-scoped visibility, modification history, audit log, e-signatures,
notifications (in-app + WebSocket), file attachments, plans/seats/billing, super-admin console and
self-hosted licensing. UI is French by default (English available).

## Stack

| Layer | Technology |
|---|---|
| Backend | NestJS 11, Prisma 6, PostgreSQL 16, Redis 7 (cache, throttling, pub/sub, BullMQ), MinIO (S3), Socket.IO (`/ws`) |
| Frontend | Next.js 16 (App Router), React 19, Tailwind v4, shadcn/ui, TanStack Query, Zustand, next-intl (FR/EN) |
| Shared | `@astro/shared` — permission catalogue (12 resources), 5 system roles, enums |

## Modules

- **Tableau de bord** (`/dashboard`) — headcount, onboarding, competency coverage, upcoming training, trial periods ending, surveys (`GET /hr/dashboard`, one section per readable register).
- **Collaborateurs** — employees (`/hr/employees`), org chart (`/hr/org-chart`, PNG/PDF export), onboarding/offboarding plans (`/hr/journeys`, handover + account deactivation), Excel import (`/hr/import`).
- **Compétences** — skills, job descriptions (activities, required skills, onboarding template), competency matrix, competency dashboard, polyvalence.
- **Formations** — training plan, attendance, hot/cold evaluation links (`/f/<token>`), training dashboard.
- **Enquêtes** (`/hr/surveys`) — survey builder, public link (`/e/<token>`), in-app answers, results.
- **Mon espace** (`/hr/me`) — the member's own record, job description, competencies, training and onboarding.
- **Administration** — members, roles & permissions, departments & members, groups, visibility, organization, audit log, billing / license.

## Getting started

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # postgres :5434, redis :6380, minio :9010/:9011, mailpit :1026/:8026
cp apps/api/.env.example apps/api/.env            # then set JWT_ACCESS_SECRET
pnpm --filter @astro/shared build
pnpm --filter @astro/api prisma:migrate           # or: cd apps/api && npx prisma migrate deploy
pnpm --filter @astro/api prisma:seed
pnpm dev                                          # api :3011, web :3010
```

`apps/web/.env.local` needs `NEXT_PUBLIC_API_URL=http://localhost:3011/api/v1` and
`NEXT_PUBLIC_FILES_ORIGIN=http://localhost:9010` (CSP allow-list for MinIO).

The dev ports avoid the usual defaults so other local stacks can run side by side.

### Demo accounts (seed)

Organization « Aurora Industries » — password `Demo-Astro-2026!`:

| E-mail | Role |
|---|---|
| admin@demo.astro.app | Organization Admin |
| hr@demo.astro.app | HR Manager |
| manager@demo.astro.app | Manager (department-scoped: Production) |
| employee@demo.astro.app | Employee (« Mon espace ») |

Super admin (dev only): `superadmin@astro.app` / `Astro-Super-2026!` (override with `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`).

## Roles

| Role | Grants |
|---|---|
| `org_admin` | everything, incl. organization / users / roles admin |
| `hr_manager` | full HR (create/update/delete/approve/export), read users & roles, audit log |
| `manager` | read everything, CRUD on HR registers — limited to their department(s) by default |
| `employee` | dashboard, skills and training read, own space |
| `viewer` | read-only |

## Tests & builds

```bash
pnpm --filter @astro/api test
pnpm --filter @astro/api build
pnpm --filter @astro/web build
```

## Deployment

`docker-compose.prod.yml` (Caddy edge, N API replicas + 1 worker, Postgres, Redis, MinIO, nightly
encrypted backups) with `.env.prod.example`; self-hosted customer bundle under `deploy/self-hosted`
(`apps/api/Dockerfile.selfhosted`, license keys via `pnpm --filter @astro/api license keygen|issue`).
