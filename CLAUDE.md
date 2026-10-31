# Astro — HR management SaaS

pnpm monorepo: `apps/api` (NestJS 11 + Prisma + PostgreSQL + Redis/BullMQ + MinIO), `apps/web` (Next.js 16 + React 19 + Tailwind v4 + shadcn/ui + TanStack Query + Zustand + next-intl), `packages/shared` (built TS package: permissions/roles/enums/add-ons).

Extracted on 31 Oct 2026 from the HR module of Qualora (`../qualora`, ISO 9001 QMS), which still has its own copy of the module. Astro kept Qualora's platform layer (tenancy, RBAC, visibility, history, audit log, e-signatures, notifications, files, platform/billing, licensing) and dropped every QMS module, the AI assistant, the inbox, the marketing site and the clause registry.

## Commands
- Infra: `docker compose -f docker-compose.dev.yml up -d` (compose project `astro-dev`: postgres **:5434**, redis **:6380**, minio :9010/:9011, mailpit :1026/:8026 — chosen not to clash with Qualora's stack)
- API (:3011): `pnpm --filter @astro/api dev|build|test`, migrations `pnpm --filter @astro/api prisma:migrate`, seed `prisma:seed` (plans, super admin, HR demo org)
- Web (:3010): `pnpm --filter @astro/web dev|build` (`apps/web/.env.local` → `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_FILES_ORIGIN`)
- Shared package must be rebuilt after edits: `pnpm --filter @astro/shared build`

## Conventions
- All tenant tables carry `organizationId`, audit fields, `deletedAt` (explicit `deletedAt: null` filters in services).
- AuthZ: `@RequirePermissions('resource:action')` + global guards (JWT → Tenant → Permissions). Tenant chosen via `X-Organization-Id`. Resources: organization, users, roles, dashboard, employees, skills, job-descriptions, competency-evaluations, hr-trainings, hr-surveys, audit-log, notifications (`packages/shared/src/permissions.ts`). System roles: org_admin, hr_manager, manager, employee, viewer.
- Department-scoped visibility (`core/department-scope/registers.ts`: Employee (+ CompetencyEvaluation, EmployeeJourney), JobDescription, HrTraining). Departments are plain `Department` rows under a `Site` (no process ↔ department coupling as in Qualora); Admin → « Services & membres » (`GET /admin/departments`). Reference generators on scoped models wrap reads in `unscoped()`.
- Polymorphic entity types (attachments, history, shares) live in `core/entities/entity-registry.ts`.
- Frontend: full detail pages (no side drawers), i18n keys in `src/messages/{fr,en}.json` (FR default, cookie `astro.locale`), permissions via `useHasPermission()`. **Hide, don't disable** controls the user can't use. Nav in `components/layout/nav-config.ts` (groups people / competencies / trainings).
- Journey steps are `TRAINING` (auto-checked from attendance) or `TASK` (manual); offboarding handover only covers HR records (journeys owned).
- Single fresh migration `20261101000000_init` — generate new ones with `prisma migrate dev` against the astro database only.
- **Never mention Claude or add Co-Authored-By in commits.**

## Demo accounts (seed)
admin@ / hr@ / manager@ / employee@demo.astro.app — password `Demo-Astro-2026!` (org “Aurora Industries”). Super admin `superadmin@astro.app` / `Astro-Super-2026!` (dev only).
