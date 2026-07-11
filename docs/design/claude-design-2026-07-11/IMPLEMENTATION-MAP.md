# Implementation Map — Coursemap brand + Card 11 (Claude Design 2026-07-11)

Source prototypes (read visually; extracts are reference, never imported):
`Logo Options.dc.html` (winner: option 4 — "Coursemap" converging-web mark) and
`Card Explorations.dc.html` (winner: direction 11 — live border · dot eyebrow ·
credits badge · PRE counter · corner-morph · Manrope + IBM Plex Mono).
Verbatim extracts: `winner-logo-4.svg`, `winner-card-11-extract.md`.

Decisions (Michael, 2026-07-11): rename is APP-FACING ONLY ("Coursemap";
repo/docs/package stay Cornell Degree Planner) · fonts switch APP-WIDE
(Manrope + IBM Plex Mono, self-hosted @fontsource, DM Sans/DM Mono removed) ·
live border AS DESIGNED (always-on slow spin, reduced-motion static,
perf-verified on a full canvas before shipping) · deploy after verification.

| Region | Prototype treatment | Implementation (existing component + tokens) | Gaps / notes |
|---|---|---|---|
| Type system | Manrope 400–800 + IBM Plex Mono 400/500 via Google Fonts | `@fontsource` packages imported where DM Sans/DM Mono are today; `tokens.css` font-family vars + `.t-*`/`.num` roles updated; DM packages removed | Type SCALE per element comes from the extract (code 11px/800/uppercase, title 12px/600, mono meta 8.5px) but lands as updated `.t-*` roles, not per-component hardcodes |
| Card chassis (2px status ring, white body, live conic border) | Two conic-gradient layers, registered `@property --bA`, 5.5s slow spin + 1.3s fast layer on hover | `SlotCard.tsx` — replaces `railStyles`/`statusStyles` top-rail treatment; keyframes + `@property` into `tokens.css` (precedent: edge/bloom keyframes live there) | Status hue mapping unchanged (green/blue/violet/red/amber; available = neutral). Derived ring/glow colors via `color-mix` become tokens (`--*-bd`, `--destructive-glow/ring`) |
| Dot eyebrow + code + status glyph + credits pill | 8px `--cat-*` dot · Manrope 800 uppercase code · 13px glyph circle · mono "4 cr" pill | `SlotCard` eyebrow row restyle; category dot uses package-D `--cat-*` tokens; glyph = lucide icons already in use (Check/Clock/…) | No raw SVG from prototype; lucide equivalents |
| Title + status line | Manrope 600 12px 2-line clamp; 9.5px/700 status ink line | Existing title + status-line slots in `SlotCard` | Copy unchanged ("Needs CS 2110 first" etc.) |
| Meta row: category tag · PRE counter · term chips | Tag chip in `--cat-*`/tint · `PRE 1/1 ✓` mono, green/red/gray · `FA · SP` | Tag + term chips exist (package D); **PRE counter is NEW** | Gap → new pure helper `countPrereqAlternatives`-style met/total from `prereqExpr` + engine pools (lib/planner, unit-tested); SlotCard renders it from `useSlotStatus` data |
| Corner-morph actions | Pill 24px→116px morph `.22s cubic-bezier(.3,1.2,.4,1)`; ✓/◷/✕/⋯ fade-in | Replaces current `ActionRow` hover-reveal in `SlotCard`; SAME handlers (complete / in-progress / clear / `CardOverflowMenu`) | Touch (`hover:none`) keeps always-visible affordance; keyboard focus opens morph too |
| State-change feedback | Glyph pop `popA/B .45s spring`, ring sweep `.5s` | CSS keyframes in `tokens.css`, class toggles in `SlotCard` | Respect `prefersReducedMotion` (instant) |
| Empty slot | Dashed, centered bucket label, "＋ Find a class" | Existing D3 empty-slot affordance — restyle only | Behavior (catalog pre-seed) unchanged |
| Side-peek (per-status content) | 480px, `translateX` spring `.34s cubic-bezier(.22,1.12,.36,1)`, scrim .35 · unique body per status (prereq chips w/ met/unmet + placement notes, waived copy, coreq notes) | `CourseDetailPanel` + `PrereqTree` restyle; per-status matrix from `winner-card-11-extract.md` §side-peek | Placement note ("planned — Fall of year 2") = small derivation from plan slot data; presentation-only, no new fetching. Existing scrim stays visual-only where click-through is required |
| Logo mark (animated converging web) | 3 blocks → curved tracks → emerald block; `lm-flow` dash animation 1.5s staggered | NEW `components/brand/LogoMark.tsx` (sizes: topbar / hero; light+dark via tokens; reduced-motion static) — brand asset, so first-party SVG is correct here | Recreated from `winner-logo-4.svg` structure with token colors, not pasted with hardcoded hex |
| Wordmark + rename | "Coursemap", Manrope 800, −0.03em; tab "Coursemap — My roadmap"; tagline "EVERYTHING LEADS SOMEWHERE" | TopBar (replaces GraduationCap + h1), `FirstRun` headline area (tagline lives here), `ShareView` brand + invite line, `SmallScreenNotice` if it names the app, `index.html` `<title>` | App-facing strings only; `fb-project` meta + package.json + docs untouched |
| Favicon | 14px dark tile, 2-block mini mark, emerald target | `public/favicon.svg` (+ 32px png, 180px apple-touch png), linked in `index.html` | Generated from the mini-mark spec in `winner-logo-4.svg` comments |

States the prototype doesn't show (keep existing behavior, restyle only as it
falls out of tokens): loading skeletons, catalog error banner, drag ghost,
share read-only view, zoom 55% (must stay scannable — verify).

Chrome subtraction: the gallery's page background, section headers, toggles,
and its own side-peek shell are discarded — only card + panel + brand regions
are implemented, inside the app's existing shell.

Verification gate: no hardcoded hex where a token exists · no raw prototype
SVG paste with inline hex · no `body/html` CSS · no imports from
`docs/design/**` · build + 91 tests green · side-by-side screenshots vs
prototype per state · live-border perf check on a full 45-card canvas at 100%
and 55% zoom.
