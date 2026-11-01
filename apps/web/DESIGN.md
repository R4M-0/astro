# Constella — Design system: Workshop signage

Constella's UI is built on the visual language of a factory wall: ISO 7010 safety signage, enamel plates and floor-marking tape. Mode: **Operate**. Expression lives in details; the task always wins.

## Colour (tokens in `src/app/globals.css`)
- **Ground:** brushed aluminium `--background` (cool, never cream); cards are enamel `--card`. Dark mode = "night shift": graphite panels with the same signals.
- **Ink:** `--foreground` / `--keyline`. Sign plates get a 2px keyline.
- **Signals are only for state:** safety green `--success` = OK / compliant · signal yellow `--warning` (always with ink, never white; `--warning-ink` for yellow-toned text on light grounds) = attention · mandatory blue `--primary` = brand / to do · signal red `--destructive` = overdue.
- **Sidebar:** a graphite enamel panel in both themes. Each nav group has a zone colour (`nav-config.ts`), and the active page becomes a plate in that colour with ink lettering.

## Shape & glyphs
- Squared corners (`--radius: 0.3rem`, plates 3–5px). No pills, except notification counters.
- `SignGlyph` (`components/dashboards/signage.tsx`): the shape carries the meaning before the colour does. Triangle = warning (red when overdue), circle = mandatory / to do, square = information (green = OK).
- `.hazard` / `.hazard-thin` stripes appear **only** where something is pending (the attention board's bottom band, skill-gap bars). `.floor-tape` marks the mascot's patrol range.

## Type
- **Archivo** variable, including the `wdth` axis (`--font-archivo`); Geist Mono for references and codes.
- `.plate-label`: condensed caps for plate titles and labels. `.figure`: expanded, heavy, tabular numerals for KPIs.

## Components
- `StatTile` / `Panel` (`components/layout/stat.tsx`) are `.sign-plate`s. Interactive plates use `.plate-press`, which lifts 2px with an ink under-edge.
- `AttentionBoard`: an ink header, rows sorted by severity, and a hazard band while anything is pending. Warning and overdue rows stay **lit (`.lamp-lit`) until opened**; seen ids are stored in localStorage `astro.dashboard.seen`.
- Buttons have a squared shape, semibold labels and an inset under-edge on primary. Inputs sit on the card ground.

## Mascot — Gus (`components/mascot/`)
- 16×24 pixel art composed from parts in `sprite.ts` (hat with Constella star, "bleu de travail" jacket with reflective stripe, plus a clipboard or envelope when he's working). Shown at ×5 (80×120) with `image-rendering: pixelated`. All pixels are authored in code; there is no raster asset.
- He's mounted once in `app/(app)/layout.tsx`, so he patrols a floor-tape strip in the bottom-right of **every** app page. The layout adds `h-36` of floor space while he's out (except on full-height pages such as the galaxy view).
- **Real work** (all data comes from `useWorkshopBoard()`, the same source as the dashboard's attention board):
  1. **Daily round:** "Faire la tournée" snapshots today's attention items and walks you to each page in turn, with Handled / Skip / Pause, progress pips and a "Tournée n/N" plate on the tape. Handled items stop glowing on the board. The round's state persists for the day (localStorage `astro.mascot.round`).
  2. **Postman:** a new unread notification arriving in realtime makes him jump in surprise with an envelope. The bubble offers Open (which marks it read and navigates) or Later.
  3. **Page inspector:** on the first visit to a page family that has pending items (e.g. `/hr/journeys`), he thinks, then says how many items need handling there, with a link to the first one.
- **Personality:** walk, blink, wave (hover), jump (click: next report), surprised, think, talk, laugh (triple-click), celebrate (good news, round finished), sleep (after 70s idle; click to wake). The greeting plays once per browser session.
- "Ranger Gus" hides him; a hard-hat button brings him back (`astro.mascot.hidden`). Under `prefers-reduced-motion` he doesn't walk or jump.
- The README GIF (`docs/assets/gus.gif`) is rendered from the same sprite code by `apps/web/scripts/render-gus-gif.mjs`.

## Motion
Exponential ease-out (`--ease-out`). Bubble motion runs on whole-pixel `steps()` timing to match the sprite. No bounce or elastic easing.
