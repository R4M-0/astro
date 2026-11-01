---
version: 1
slug: "src-app-app-dashboard-page-tsx"
primary_target: "src/app/(app)/dashboard/page.tsx"
related_targets: ["src/app/(app)/layout.tsx"]
---

# Dashboard + app shell

Scope: app shell (sidebar, topbar, main canvas), dashboard `/dashboard`, global tokens. Mode: Operate.
Audience/job: HR + line managers at FR industrial SMEs; see what needs action today, then totals. Constraints: hide-don't-disable, i18n FR/EN, light+dark, department scope.
Memorable moment: the attention board + a pixel worker mascot that reports the same real data.

## Direction contract

THESIS: HR status read the way a factory reads its walls — ISO 7010 safety signage as a semantic system. Refuses the indigo card-grid SaaS dashboard where every tile weighs the same.

OWN-WORLD: brushed-aluminium off-white ground (cool, never cream), ink-black type, sign-panel cards with 2px ink keylines and squared 4px corners. Signal colours only carry state: safety green = OK, signal yellow + black hazard stripe = attention, mandatory blue = brand/to-do, signal red = overdue. Status glyphs take sign shapes: triangle warning, circle mandatory, square information. Archivo (wdth axis) — condensed caps labels, expanded tabular numerals. Dark mode = night shift: graphite panels, same signals.

STORY: open → “À traiter aujourd'hui” board says what needs action; KPIs with big figures; distributions; the mascot walks the lower right and says the most urgent thing; click → go there.

FIRST VIEWPORT: greeting + date strip; full-width attention board with hazard-striped bottom edge (left 2/3) beside the headcount plate (1/3); KPI band of four sign plates; mascot in the lower right over a ruled floor line.

FORM: candidate 5 of 7 (ISO 7010 workshop signage); seed 750914c1. Raises: gate-board (attention items stay lit until seen), Emigre bitmap (mascot pixel-honest, integer scaling only), character catalog (mascot name plate).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
