# Spec 003 — Design System Foundation: Tokens for Real (Phase 1)

STATUS: IMPLEMENTED
Depends on: 001. Blocks: 004 (redesign consumes these tokens).
Source: UI audit (spec-vs-reality gap) + house-standard token conventions, 2026-07-07.
Implemented: 2026-07-07 (branch phase-1-tokens). See `src/styles/tokens.css` +
`tailwind.config.ts`; DESIGN.md "Implementation" section.

---

## 0. The problem this fixes

DESIGN.md defines a full token system (Scholar's Vellum oklch palette, DM Sans, semantic
status colors, radius/spacing scales). **None of it exists in code.** `tailwind.config.ts`
is stock shadcn; `globals.css` is stock shadcn HSL; DM Sans is never loaded (app renders
in system-ui); components hardcode `emerald-300`/`amber-50`/`sky-300` across ~8 files.
This spec makes DESIGN.md true, using the house-standard token architecture.

## 1. Token layer (`src/styles/tokens.css`)

house-standard conventions: plain CSS custom properties; light on `:root`; **dark mode is a
complete re-declaration of the same names under `.dark`** — components never branch on
theme; dark values are re-derived (brighter accents, alpha tints), never reused.

Categories (values from DESIGN.md frontmatter, converted where noted):

```css
:root {
  /* neutrals — Scholar's Vellum (cool slate tints; never pure #fff/#000) */
  --canvas: #f8fafc;            /* page background */
  --surface: #fefeff;           /* cards/popovers — tinted per the Vellum Rule,
                                   replaces the current literal #fff */
  --surface-2: #f1f5f9;         /* muted fills, progress track */
  --border: #e2e8f0;
  --border-strong: #cbd5e1;
  --border-faint: #eef2f7;
  --text: #0f172a;  --text-2: #475569;  --text-3: #64748b;  --text-4: #94a3b8;

  /* status triads (base / text / tint) — house-standard triad convention.
     Base = borders+dots, text = on-tint text, tint = fills. */
  --complete: #34d399;  --complete-text: #065f46;  --complete-tint: #ecfdf5;
  --available: #fbbf24; --available-text: #92400e; --available-tint: #fffbeb;
  --waived: #a78bfa;    --waived-text: #5b21b6;    --waived-tint: #f5f3ff;
  --drop: #60a5fa;      --drop-text: #1e40af;      --drop-tint: #eff6ff;
  --destructive: #ef4444; --destructive-text: #991b1b; --destructive-tint: #fef2f2;

  /* type */
  --font-sans: "DM Sans", system-ui, sans-serif;
  --font-mono: "DM Mono", ui-monospace, monospace;   /* numbers only — see §3 */

  /* radii (DESIGN.md scale) */
  --r-sm: 4px; --r-md: 6px; --r-lg: 8px; --r-xl: 12px; --r-2xl: 24px; --r-pill: 9999px;

  /* spacing (DESIGN.md) + layout constants */
  --sp-xs: 6px; --sp-sm: 8px; --sp-md: 12px; --sp-lg: 16px; --sp-xl: 20px;
  --sidebar-w: 224px; --catalog-w: 480px; --topbar-h: 64px;

  /* elevation — slate-tinted, not pure black; only floating surfaces use these */
  --shadow-md: 0 4px 6px -1px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.08);
  --shadow-xl: 0 20px 25px -5px rgb(15 23 42 / 0.10), 0 8px 10px -6px rgb(15 23 42 / 0.10);
}
.dark {
  --canvas: #0b1120; --surface: #0f172a; --surface-2: #1e293b;
  --border: #1e293b; --border-strong: #334155; --border-faint: #16203a;
  --text: #f1f5f9; --text-2: #cbd5e1; --text-3: #94a3b8; --text-4: #64748b;
  --complete: #34d399; --complete-text: #a7f3d0; --complete-tint: rgb(6 78 59 / 0.5);
  --available: #fbbf24; --available-text: #fde68a; --available-tint: rgb(120 53 15 / 0.4);
  --waived: #a78bfa;   --waived-text: #ddd6fe;   --waived-tint: rgb(76 29 149 / 0.4);
  --drop: #60a5fa;     --drop-text: #bfdbfe;     --drop-tint: rgb(30 58 138 / 0.4);
  --destructive: #f87171; --destructive-text: #fecaca; --destructive-tint: rgb(127 29 29 / 0.4);
  /* shadows unchanged or slightly deeper */
}
```

(Exact dark values are a starting point — tune on screen; the *structure* is the spec.
Tints go alpha in dark mode per house-standard so surfaces don't get heavy.)

## 2. Tailwind bridge

Keep Tailwind v3 as the utility engine; map tokens into the config so components write
semantic classes:

```ts
// tailwind.config.ts (extend)
colors: {
  canvas: "var(--canvas)", surface: "var(--surface)", "surface-2": "var(--surface-2)",
  ink: { DEFAULT: "var(--text)", 2: "var(--text-2)", 3: "var(--text-3)", 4: "var(--text-4)" },
  line: { DEFAULT: "var(--border)", strong: "var(--border-strong)", faint: "var(--border-faint)" },
  complete: { DEFAULT: "var(--complete)", text: "var(--complete-text)", tint: "var(--complete-tint)" },
  available: { … }, waived: { … }, drop: { … }, destructive: { … },
},
fontFamily: { sans: ["DM Sans", "system-ui", "sans-serif"],
              mono: ["DM Mono", "ui-monospace", "monospace"] },
borderRadius / boxShadow / spacing: map the --r-* / --shadow-* / --sp-* scales
```

Keep the existing shadcn HSL variables working during the refactor (token-aliasing
bridge — house-standard technique, explicitly temporary): point `--card`, `--background`,
`--muted`, etc. at the new tokens' values in `globals.css` so `button.tsx`/`card.tsx`
keep rendering while call sites migrate. Remove the bridge when no `bg-card`-style
class remains (grep gate).

## 3. Fonts — load them, and add the numeric signature

- `npm i @fontsource/dm-sans @fontsource/dm-mono`; import weights 400/500/600(/700) in
  `main.tsx`. Self-hosted via Vite — no Google Fonts request, no FOUT flash from a
  third-party origin. **This single change re-skins every glyph in the app.**
- **Numeric signature (house-standard convention, sanctioned by DESIGN.md's DM Mono carve-out):**
  every load-bearing number — credits, slot counts, match percentages, semester years —
  renders in DM Mono with `font-variant-numeric: tabular-nums` via a `.num` utility
  class. Numbers align in columns and the app gets a cheap, recognizable identity trait.
- Type roles from DESIGN.md become four utility classes (`.t-headline`, `.t-body`,
  `.t-label`, `.t-meta`) in `tokens.css` so the Label-First rule is one class, not five
  utilities re-typed per call site (`text-[10px] font-semibold uppercase tracking-widest
  text-ink-3` → `.t-label`).

## 4. Component migration (mechanical pass)

Refactor every active component to token classes; **zero raw palette classes survive**
(`grep -E "(emerald|amber|violet|sky|blue|red|gray|slate)-[0-9]"` over `src/` must
return nothing outside `tokens.css`). Files: GridSlotNode, SemHeaderNode, RoadmapCanvas,
CourseCatalog, LeftSidebar, RightSidebar, TopBar, DragGhost, App. The `statusStyles`
map in GridSlotNode collapses to the triad tokens. Remove the now-dead `"planned"`
status entry while in there.

Canvas dot-grid: replace the JS theme branch (`RoadmapCanvas.tsx:83`) with a CSS
variable (`--canvas-dot: rgb(15 23 42 / 0.08)` re-declared in `.dark`) — decouples
render from the theme store.

## 5. Quick visual wins bundled into this phase

(From the UI audit's quick-win cluster — small, all token-adjacent:)

1. **Semester headers neutralized**: kill sky/amber season fills and the `shadow-sm`
   (Chart Signal + Flat-by-Default violations). New header: flat, `border-line`,
   `.t-label` season+year in `ink-3`, year in `.num`. Season may keep a 6px dot in
   `ink-4` — no saturated color.
2. **Error honesty** (consumes 001's error threading): distinct error rows with a Retry
   button in the program dropdown area and the catalog ("Couldn't reach the course
   catalog — Retry"), styled with `destructive-tint/text`. Failure must be visually
   distinct from "no results."
3. **Skeletons** (house-standard convention): `Skeleton` primitive that mirrors real layout —
   chip-row skeletons in the catalog, a slot-grid skeleton on the canvas while a program
   loads. Shimmer animates opacity (themes for free), `aria-hidden`, honors
   `prefers-reduced-motion`.
4. **Replace `window.confirm` Reset** with a two-step inline confirm (Reset → "Confirm
   reset?" + cancel, auto-revert after 3s). Removes the only OS-chrome moment.
5. **Unmet-prereq dot** gets `ink-4` (was raw `bg-gray-400`, no dark variant).

## 6. Explicitly out of scope here
Layout/IA changes (canvas grid, slot card anatomy, empty states, Major Match surface,
click-to-place) — all spec 004, which assumes these tokens exist.

## Acceptance checklist
- [ ] DM Sans visibly rendering (compare a screenshot before/after; check computed
      font-family in devtools)
- [ ] Palette grep returns zero raw Tailwind color classes in components
- [ ] Dark mode: every surface/status legible; no unstyled grays
- [ ] Kill the network: dropdown + catalog show error-with-retry, not empty states
- [ ] Program load shows skeleton grid, not "Loading…" text
- [ ] DESIGN.md gets a short "Implementation" section pointing at tokens.css +
      tailwind.config.ts (doc and code now agree)
