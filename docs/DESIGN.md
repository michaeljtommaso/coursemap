---
name: Coursemap
description: A course-first degree planner for Cornell students — a drag-and-drop board of semesters with live prerequisite checking.
# Light-theme values. Dark values re-declare the same tokens under `.dark`; see §2.
colors:
  canvas: "#f8fafc"
  surface: "#fefeff"
  surface-2: "#f1f5f9"
  border: "#e2e8f0"
  border-strong: "#cbd5e1"
  border-faint: "#eef2f7"
  text: "#0f172a"
  text-2: "#475569"
  text-3: "#56657c"
  text-4: "#607088"
  complete: "#34d399"
  available: "#fbbf24"
  waived: "#a78bfa"
  drop: "#60a5fa"
  destructive: "#ef4444"
typography:
  headline:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.1em"
  meta:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "0.5625rem"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "normal"
  card-code:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.07em"
  code-chip:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "24px"
  pill: "9999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 12px"
  course-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "9px 10px 30px"
  catalog-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  semester-header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.lg}"
    padding: "6px 10px"
---

Last synced with the shipped UI: 2026-10-11.

# Design System: Coursemap

## 1. Overview

Coursemap is a planning tool, so the board is the product. Semester columns, course cards and the prerequisite wires between them carry the meaning; the top bar, left rail and right drawer stay neutral and recede.

Color is reserved for state. A card's 2px ring says whether the course is complete, in progress, blocked or needs attention; everything else is cool slate neutrals. A second, desaturated palette marks subject category (Math, Science, Eng, …), always paired with a text label so it never competes with status.

**Key characteristics**
- One UI family (Manrope) across all roles; IBM Plex Mono only for course-code chips in secondary surfaces.
- Uppercase, tracked labels (`.t-label`) open every panel section.
- Flat, tonal surfaces. Shadows only on things that float, plus a 1px rest shadow on cards.
- Motion explains the plan: wires flow along a hovered chain, a completion pulses down its edges. Every animation has a reduced-motion path.
- Light and dark themes are full re-declarations of the same tokens. Light is the default; the top-bar toggle switches and persists the choice.

## 2. Colors

All values live in `cornell-degree-planner/src/styles/tokens.css`: light on `:root`, dark under `.dark` (set on `<html>`). Components read `var(--token)` or the Tailwind names in parentheses and never branch on theme.

### Neutrals

| Token (Tailwind) | Light | Dark | Use |
|---|---|---|---|
| `--canvas` (`bg-canvas`) | `#f8fafc` | `#0b1120` | Page and board background |
| `--surface` (`bg-surface`) | `#fefeff` | `#0f172a` | Cards, panels, popovers |
| `--surface-2` (`bg-surface-2`) | `#f1f5f9` | `#1e293b` | Muted fills, progress tracks, hover wells |
| `--border` (`border-line`) | `#e2e8f0` | `#1e293b` | Structural borders, neutral card ring |
| `--border-strong` (`border-line-strong`) | `#cbd5e1` | `#334155` | Dashed affordances, resting edges |
| `--border-faint` (`border-line-faint`) | `#eef2f7` | `#16203a` | Hairlines |
| `--text` (`text-ink`) | `#0f172a` | `#f1f5f9` | Primary text |
| `--text-2` (`text-ink-2`) | `#475569` | `#cbd5e1` | Secondary text |
| `--text-3` (`text-ink-3`) | `#56657c` | `#94a3b8` | Labels, meta, in-chain edges |
| `--text-4` (`text-ink-4`) | `#607088` | `#8391a7` | Lowest-emphasis text, placeholders |

The canvas carries a 1px dot grid every 24px (`--canvas-dot`: `rgb(15 23 42 / .08)` light, `rgb(226 232 240 / .07)` dark). Scrollbars are themed from `--scrollbar-thumb` (`#cbd5e1` / `#334155`) on a transparent track.

### Status triads

Each status has a base (rings, dots, edges), a text color (on tints) and a tint (fills). Dark tints are translucent so filled surfaces do not get heavy.

| Status | Base (light / dark) | Text (light / dark) | Tint (light / dark) | Means |
|---|---|---|---|---|
| `complete` | `#34d399` / same | `#065f46` / `#a7f3d0` | `#ecfdf5` / `rgb(6 78 59/.5)` | Completed, prereqs met, credit coverage |
| `available` | `#fbbf24` / same | `#92400e` / `#fde68a` | `#fffbeb` / `rgb(120 53 15/.4)` | Warning: wrong term, choice pending, overload |
| `waived` | `#a78bfa` / same | `#5b21b6` / `#ddd6fe` | `#f5f3ff` / `rgb(76 29 149/.4)` | Waived requirement (checklist and legend only) |
| `drop` | `#60a5fa` / same | `#1e40af` / `#bfdbfe` | `#eff6ff` / `rgb(30 58 138/.4)` | In progress, drop targets, armed course, highlights |
| `destructive` | `#ef4444` / `#f87171` | `#991b1b` / `#fecaca` | `#fef2f2` / `rgb(127 29 29/.4)` | Blocked, violated edges, destructive actions |

The token named `available` is the amber warning hue. A card that is simply available renders a neutral ring, not amber.

**Derived ring and glow tokens** (both themes, `color-mix` in sRGB against that theme's base):
- `--{status}-bd` = base at 55%: the card's 2px status ring.
- `--destructive-glow` (45%) and `--destructive-ring` (22%): the blocked card's halo.
- Hover chain glow, neutral rather than a status hue:

| Token | Light | Dark |
|---|---|---|
| `--chain-bd` | `#64748b` at 75% | `#e2e8f0` at 70% |
| `--chain-glint` | `#334155` | `#ffffff` |
| `--chain-glow` | `#475569` at 30% | `#e2e8f0` at 26% |

### Category accents

A quiet subject taxonomy (`lib/planner/slotCategory.ts`). A placed course's category comes from its subject: MATH → Math; natural sciences (PHYS, CHEM, BIO…) → Science; FWS/WRIT → FWS; PE → PE; everything else → Eng (`core`). Liberal and Elective exist for requirement data. Shown as an 8px dot plus a tag, never as a shape.

| Category (tag) | Light text / tint | Dark text / tint |
|---|---|---|
| math (Math) | `#4f46e5` / `#eef2ff` | `#a5b4fc` / `rgb(49 46 129/.4)` |
| science (Science) | `#0f766e` / `#f0fdfa` | `#5eead4` / `rgb(19 78 74/.4)` |
| core (Eng) | `#475569` / `#f1f5f9` | `#cbd5e1` / `rgb(51 65 85/.4)` |
| liberal (Liberal) | `#b83280` / `#fdf2f8` | `#f0abfc` / `rgb(112 26 117/.4)` |
| elective (Elective) | `#0e7490` / `#ecfeff` | `#67e8f9` / `rgb(22 78 99/.4)` |
| fws (FWS) | `#b45309` / `#fff7ed` | `#fdba74` / `rgb(120 53 15/.4)` |
| pe (PE) | `#57534e` / `#f5f5f4` | `#d6d3d1` / `rgb(68 64 60/.4)` |

### Contrast

`tokens.css` records the low-emphasis inks being raised to WCAG AA, since `.t-meta` text is 9px: light `--text-3` 5.66:1 on canvas and 5.40:1 on surface-2; light `--text-4` 4.81:1 on canvas and 4.60:1 on surface-2; dark `--text-4` 5.89:1 on canvas and 4.58:1 on surface-2; dark `--text-3` 5.71:1 on surface-2. The raw Tailwind placeholder grey was about 2.5:1 on the light canvas, so placeholders use `--text-4`.

Additional pairs computed for this document with the WCAG 2.x relative-luminance formula (sRGB linearization, `(L1 + 0.05) / (L2 + 0.05)`; dark translucent tints composited over `--surface` first):
- Every status text on its own tint: 6.84 to 8.19:1 light (lowest `available`), 10.46 to 11.76:1 dark.
- Category tag text on its tint: 4.73 to 6.99:1 light (lowest `fws`), 7.71 to 10.00:1 dark.
- `--text-2` on surface-2: 6.92:1 light, 9.85:1 dark.

**Known gap:** the white status glyph inside the 13px badge does not reach 3:1 on the light hues (for example 1.92:1 on `--complete`, 1.67:1 on `--available`). The glyph is `aria-hidden` and status is also carried by the ring, the status line and the card's accessible name, but the glyph alone should not be relied on.

## 3. Typography

**Manrope** (400–800) for all UI text; **IBM Plex Mono** (400/500) for course-code chips in the course detail panel, prerequisite tree and compare views. Both are self-hosted through `@fontsource` and imported in `main.tsx`; there is no Google Fonts request.

| Role | Class | Spec | Use |
|---|---|---|---|
| Headline | `.t-headline` | 18px / 600 / -0.02em | Page-level statements (small-screen notice, first run) |
| Body | `.t-body` | 12px / 500 / 1.5 | Names, list items, inputs, toasts |
| Label | `.t-label` | 10px / 600 / UPPERCASE / 0.1em, `--text-3` | Section openers, tabs, menu items |
| Meta | `.t-meta` | 9px / 400 / 1.3, `--text-3` | Credits, hints, secondary lines |
| Wordmark | LogoMark | Manrope 800, -0.03em | "Coursemap" beside the mark |

Course cards use their own denser scale: code 11px/800 uppercase (0.07em), title 12px/600 (2-line clamp), status line 9.5px/700, attribution 9px/600, meta row 8.5px.

**Numbers.** `.num` applies tabular figures to every load-bearing number (credits, percentages, years). Its family is the `--font-num` token, currently Manrope. Setting it to `var(--font-mono)` switches all numbers to IBM Plex Mono in one place.

## 4. Elevation and layering

| Shadow | Light | Dark | Where |
|---|---|---|---|
| `--card-rest-shadow` | `0 1px 2px rgb(15 23 42/.05)` | `0 1px 2px rgb(0 0 0/.3)` | Course card at rest |
| `--shadow-md` | slate at 8% | black at 40% | Card and catalog-row hover, drawer pull tab, zoom control |
| `--shadow-xl` | slate at 10% | black at 50% | Drawer, detail panel, menus, popovers, toast, drag ghost |

Shadows are slate-tinted in light mode. **Backdrop blur** appears on the top bar (`bg-surface/90`), the zoom control, and the scrims behind true modals (`bg-ink/40 backdrop-blur-sm`). Nothing else blurs.

**Stacking order** (`tokens.css`): canvas content and sticky semester headers (20) < top bar (25) < drawer scrim (30) < drawer (40) < detail-panel scrim (45) < detail panel (50) < modals (55) < small-screen notice (60) < toast (65) < drag ghost (9999).

## 5. Layout

- **Shell:** full-height column, never scrolls horizontally at page level. Top bar, then a row of left rail, canvas and right drawer.
- **Top bar** (min height 64px): Coursemap mark and wordmark, the inline-editable plan name with a "Your plans" switcher, program select, Share, Reset (two-step "Clear everything?" / "Keep it", reverts after 3s), My credits, Sign in or account menu, the Legend "?" popover (opens on hover, pins on click) and the theme toggle.
- **Left rail** (224px, `bg-surface/60`, right border): Planner/Classes nav; "Your journey" (earned of total credits, an emerald progress bar, a plain-language phrase, courses completed); the **Still needed** checklist, which takes the free height and scrolls; a Major Match teaser; the catalog year.
- **Canvas:** scrolls on both axes with a stable scrollbar gutter. Columns are 216px wide with 40px gaps, padded 24px × 16px. Zoom presets are 100/85/70/55% (CSS `zoom`, so sticky headers keep working), set from a segmented control pinned bottom-right. Text selection is disabled on the board.
- **Right drawer** (480px): a Catalog | Majors segmented control. Slides in over the canvas and is not modal, so the board stays clickable for click-to-place. Closed, it leaves a 10px sliver at the edge for the 28×64px pull tab to dock into.
- **Course detail panel** (480px, max 92vw): a side peek from the right, above the drawer.
- **Viewport floor:** the planner needs at least 1024px (tablet landscape and up). Below that, a full-screen notice ("Your roadmap deserves a bigger canvas.") covers the app, which stays mounted behind it.

## 6. Components

### Course card (signature component)

`SlotCard.tsx`. Every card is one placed course. Minimum height 104px, full column width.

**Anatomy**
1. **Chassis:** a 2px ring in the state color (`--*-bd`, radius 8px) around a `--surface` body (radius 6px). Two conic-gradient glint layers spin inside the ring: a slow layer (5.5s) always on, a fast layer (1.3s) that fades in on hover.
2. **Eyebrow row:** 8px category dot, course code, then the 13px status glyph and a credits pill (`8.5px`, pill radius, `surface-2` fill).
3. **Title** (2-line clamp; turns `complete-text` when completed) and a **status line** in plain language.
4. Optional lines: "↳ counts toward …" requirement attribution; an "Add AP credit" link when credit could clear a block; instructor and "not offered this term" lines for the upcoming semester.
5. **Meta row** (bottom): category tag, `PRE met/total` counter (green when all met, amber while a choice is pending, red when unmet, grey "PRE —" when there are none), `→N` unlocks count, offered terms (`FA · SP`), and the upcoming term's meeting time with an open/waitlist/closed dot.
6. **Corner actions:** a 24×20px "⋯" pill bottom-right that widens on hover or focus to Complete, In progress, Clear (only when a manual state is set) and the full "Course actions" menu (Mark complete, In progress, Move to…, Remove from board). On devices with no hover-capable input it stays expanded.

**States** (precedence top to bottom):

| State | Ring / glint | Glyph | Status line |
|---|---|---|---|
| Completed | `complete` | check | none |
| In progress | `drop` | clock | "In progress" (`drop-text`) |
| Blocked | `destructive`, plus a halo (3px `--destructive-ring`, 12px `--destructive-glow`) | ✕ | "Needs CS 2110 first" (`destructive-text`) |
| Warning | `available` | triangle | Wrong term, overlap or time conflict (`available-text`) |
| Waiting on a choice | `available` | triangle | "Pick your … first" (`available-text`), a dotted-underline button that opens the catalog filtered to that requirement |
| Advisory | neutral `--border` | info, on `--text-3` | Advisory note (`text-3`), never red or amber |
| Available | neutral `--border` | none | none, or "Covered by your AP credit" (`complete-text`) |

A blocked card whose only missing prerequisite is an open choice requirement uses the amber choice state, not red: the plan is not wrong, a pick is still pending.

**Hover chain glow.** Hovering or focusing a card lights that card and every card its outgoing wires point to. Neutral-ring cards switch to `--chain-bd` / `--chain-glint`; cards with a status ring keep their color. All lit cards get a soft halo (`0 0 0 1px --chain-bd, 0 0 14px 2px --chain-glow`) and the fast glint. The glow is off during a drag.

**Other faces.** Dragged or armed out: a dashed 1.5px `border-strong` placeholder with the code and title at 60% opacity. Hidden entirely while the drag hovers an insertion point. Eligible for an armed course: 1px `drop` ring. Highlighted from the Still-needed checklist: 3px `drop` ring with a 2px offset; the first one scrolls into view.

### Edges

`EdgeLayer.tsx` draws an SVG overlay of edges derived from each placed course's real prerequisite tree, using the same rules as the card status engine.

| Kind | Stroke | Shape |
|---|---|---|
| Prerequisite | solid, arrowhead | Curve from the feeder's right edge to the dependent's left edge |
| Concurrent (corequisite) | dashed `4 4`, arrowhead across columns | Same column and adjacent: a short straight connector, solid, no arrow. Same column with cards between: a rounded bracket just outside the column, dashed |
| Advisory | dashed `2 6`, base opacity × 0.7 | Curve; never red |

- Width 1.5px. At rest: `--border-strong`, opacity 0.55.
- Red (`--destructive`) only when a prerequisite or corequisite is violated by semester order.
- Hovering a card lifts its whole chain (ancestors and descendants) to `--text-3` at full opacity with a flowing dash overlay; other edges recede to 0.1.
- Completing a course fires a one-shot pulse down its outgoing edges.
- Edges are hidden while a drag is in flight.

### Semester column

A sticky header on a solid canvas band (`bg-surface/70`, bordered, radius 8px): term and year (`.t-label`), class year (`.t-meta`), a credit chip that turns amber when the semester goes over the 20-credit cap, and "Sem N". Cards stack with 10px gaps, then a dashed "+ Add a class" button (min 40px). The footer reads "N credits planned", with the number amber under 12 credits and red over 18. When every course in the column is complete, the footer takes the `complete` tint, reads "Semester complete" and plays one bloom.

While a drag hovers the column, it gets a 2px `drop` ring and a dashed 2px `drop` outline (on `drop-tint`, card-sized) appears at the insertion point. Neighbouring cards glide to make room.

### Catalog row

Rounded 6px, 1px border, `surface` fill. Code (label weight, normal case), credits and unlocks on the first line, title (`.t-meta`) below. A 6px corner dot shows the prerequisite state: emerald (met), red (blocked) or `text-3` (advisory). Blocked rows sit on a `destructive-tint` fill with red code text. Hover adds `--shadow-md` and, for non-blocked rows, the `complete` border and tint. An armed row has a 1.5px `drop` border on `drop-tint`. A row being dragged dims to 30%. Favorite, compare and details actions are revealed on hover.

### Still-needed checklist

Requirement rows with an 8px status dot: unmet (hollow `text-4` ring), partial (`drop` ring on `drop-tint`), satisfied (`complete`), waived (`waived`). A highlighted row sits on `drop-tint`. "Waive" / "Remove waiver" is revealed on hover and always visible on touch.

### Drag ghost

A card-sized preview (216×104 at 100%, scaled to the canvas zoom): 2px `drop` border on `drop-tint`, `--shadow-xl`. It follows the pointer without lag, tilts with horizontal velocity (clamped to ±10°) and springs into the insertion outline.

### Controls

- **Buttons** (shadcn variants on the token bridge): primary is ink on canvas; outline is bordered on canvas with a `surface-2` hover; ghost has no chrome. Radius 6px, 40px tall by default, 36px for `sm`. Focus is a 2px ink ring with a 2px offset.
- **Inputs and selects:** radius 6–8px, `border-line`, `bg-surface`; focus is an ink border plus a 1px ink ring.
- **Cards** focus with a 2px ink ring offset by 1px against the canvas.
- **Toast:** bottom-center, `surface` with border and `--shadow-xl`, a single optional action in `drop-text` (for example Undo after "Remove from board"). Auto-dismisses after 6s and is announced politely.
- **Logo mark:** three course blocks flow along curved tracks into an emerald "next course" block, with a dashed emerald flow animating along the tracks. All colors come from tokens.

## 7. Motion

anime.js drives scripted motion; CSS keyframes in `tokens.css` drive the rest.

| Motion | Spec |
|---|---|
| Card hover lift | y −3px, 140ms `out(2)`; back in 180ms. Not during drags |
| Live border | conic glint via the registered `--bA` angle: 5.5s linear, plus 1.3s on hover |
| State change | glyph pop `.45s cubic-bezier(.34,1.56,.64,1)` (overshoot to 1.22) and one ring sweep `.5s` |
| Corner pill | width `.22s cubic-bezier(.3,1.2,.4,1)` |
| Edge flow / pulse | dash `5 17` drifting every 1.4s / one `26 300` surge in 0.9s |
| Semester bloom | 0.5s expanding `complete-tint` ring |
| Column glide | spring, bounce 0.12, 200ms |
| Drag ghost | pickup scale 0.82 → 1.04 → 1 in 280ms; snap spring (bounce 0.25, 320ms); land 260ms; return home 320ms |
| Drawer | x slide 360ms, `out(3)` open / `in(2)` close |
| Detail panel | spring in (bounce 0.08, 340ms); out 300ms `in(2)` |
| Catalog list | rows fade up 10px, 220ms, staggered 18ms; hover lift y −2px, 170ms |
| Toast | rise and fade 8px, 0.22s |

**Reduced motion.** `prefersReducedMotion()` (`lib/motion.ts`) gates the scripted animations, and a `prefers-reduced-motion` media query disables the CSS ones. Under it: card rings are static (no glint), glyph pops, ring sweeps and card hover lifts are skipped, edge flow and pulse are hidden, the bloom, skeleton pulse and logo flow stop, columns reflow without gliding, a landed drag ghost fades out in place (120ms) instead of travelling, the detail panel and toast appear without sliding, and the edge-recede fade is instant.

**Not yet gated:** the right drawer's slide, the catalog list stagger and catalog-row hover lift, and the drag ghost's pickup scale still run under reduced motion.

## 8. Do's and Don'ts

**Do**
- Use status hues only for status, with each triad's text color on its own tint.
- Keep plain "available" neutral. Amber means a warning, red means the plan breaks a rule.
- Pair every category accent with its text tag.
- Open each panel section with `.t-label`.
- Put every load-bearing number in `.num`.
- Add new colors as tokens in both `:root` and `.dark`, bridged through `tailwind.config.ts`.
- Give every new animation a reduced-motion path.
- Use the z-index tokens; do not invent new layers.

**Don't**
- Don't render advisory information in red or amber. Advisories never block.
- Don't use literal Tailwind palette classes (`bg-emerald-50`) or raw hex in components.
- Don't add shadows to resting surfaces beyond `--card-rest-shadow`.
- Don't add backdrop blur outside the top bar, the zoom control and modal scrims.
- Don't encode category as shape; it would break the uniform grid and the drag ghost.
- Don't use a modal where a drawer or side peek works. The catalog and course details are non-blocking panels.
- Don't use Cornell red or other institutional color for structure.

## 9. Implementation

- `cornell-degree-planner/src/styles/tokens.css`: every color, type, radius, spacing, shadow, z-index and layout token in both themes, the `.t-*` and `.num` utilities, and the motion keyframes.
- `cornell-degree-planner/tailwind.config.ts`: maps tokens to semantic utilities (`canvas`, `surface`, `ink`, `line`, the status triads, `cat-*`) plus font, radius, shadow and spacing scales. Dark mode is `class`.
- `cornell-degree-planner/src/styles/globals.css`: base styles, themed scrollbars, drag-time selection and cursor guards, and an HSL alias layer so the shadcn `button` and `card` primitives resolve to the same tokens.
- Fonts: `@fontsource/manrope` (400–800) and `@fontsource/ibm-plex-mono` (400/500), imported in `src/main.tsx`.
