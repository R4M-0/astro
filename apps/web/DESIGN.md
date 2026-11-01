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
- 16×24 pixel art composed from parts in `sprite.ts` (hat with Constella star, "bleu de travail" jacket with reflective stripe). Always shown at an integer scale (×4) with `image-rendering: pixelated`. All pixels are authored in code; there is no raster asset.
- Patrols a floor-tape strip in the bottom-right of the dashboard. Modes: walk, idle/blink, wave (hover), jump (click → next tip), surprised (overdue alert), think (before an unprompted tip), talk, laugh (triple-click), celebrate (good news), sleep (after 70s idle; click to wake).
- Tips come from the same data as the attention board, most severe first. The bubble has an action link, prev/next and close, and stays open while hovered or focused. "Ranger Gus" hides him; a hard-hat button brings him back (localStorage `astro.mascot.hidden`).
- `prefers-reduced-motion`: no walking or jumping; poses and bubbles still work.

## Motion
Exponential ease-out (`--ease-out`). Bubble motion runs on whole-pixel `steps()` timing to match the sprite. No bounce or elastic easing.
