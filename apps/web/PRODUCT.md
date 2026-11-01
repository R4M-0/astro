# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
HR managers and line managers at French industrial / manufacturing SMEs (demo org: “Aurora Industries”). They open Constella at their desk during the working day to check headcount, follow onboarding/offboarding journeys and trial periods, track skill coverage (polyvalence) and plan trainings. Employees use a self-service “my space” (`/hr/me`). French first, English available.

## Product Purpose
Constella is an HR management SaaS that keeps people, competencies and trainings in one traceable register. Success: an HR manager sees what needs attention today (trials ending, skill gaps, trainings to run) and acts on it in one or two clicks.

## Positioning
Born from an ISO 9001 quality-management platform: every HR record carries history, audit log, e-signatures, department-scoped visibility and references — HR with the rigor of a quality system, linking job descriptions → required skills → evaluations → trainings.

## Operating Context
Desktop-first back-office use, mobile supported. Multi-tenant (org chosen via `X-Organization-Id`), role-based (org_admin, hr_manager, manager, employee, viewer); controls the user can't use are hidden, not disabled. Modules: employees, org chart, journeys, job descriptions, skills, competency evaluations & polyvalence matrix, trainings, surveys, HR inbox digest, a “galaxy” 3D people view.

## Capabilities and Constraints
- Next.js 16 + React 19 + Tailwind v4 + shadcn/ui; i18n via next-intl (`src/messages/{fr,en}.json`).
- Full detail pages, no side drawers. Department-scoped data visibility.
- A pixel-art mascot companion lives in the lower-right of the dashboard and nudges users about what needs attention, from live dashboard data.

## Brand Commitments
- Name: **Constella** (constellation metaphor; existing galaxy view). Repo/package name is Astro.
- Never mention Claude in commits.

## Evidence on Hand
Seeded demo org data only. No customers, testimonials or benchmarks exist — do not fabricate any.

## Product Principles
1. What needs attention today comes first; totals second.
2. Traceability is a feature — references, history and states are always visible.
3. Hide what the role can't use.
4. Delight is allowed when it carries information (the mascot reports real data).
