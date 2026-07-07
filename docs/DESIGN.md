---
name: Cornell Degree Planner
description: A course-first degree planning tool for Cornell students.
colors:
  surface-bg: "#f8fafc"
  surface-card: "#ffffff"
  surface-muted: "#f1f5f9"
  ink-deep: "#0f172a"
  ink-slate: "#64748b"
  border-subtle: "#e2e8f0"
  status-complete: "#34d399"
  status-available: "#fbbf24"
  status-waived: "#a78bfa"
  status-drop: "#60a5fa"
  destructive: "#ef4444"
typography:
  headline:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.1em"
  meta:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.5625rem"
    fontWeight: 400
    lineHeight: 1.3
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
    backgroundColor: "{colors.ink-deep}"
    textColor: "{colors.surface-bg}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.ink-deep}"
    textColor: "{colors.surface-bg}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.md}"
    padding: "7px 12px"
  course-chip:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  course-chip-hover:
    backgroundColor: "#fffbeb"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  slot-node:
    backgroundColor: "transparent"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.lg}"
    padding: "8px 10px"
  slot-node-complete:
    backgroundColor: "#ecfdf5"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.lg}"
    padding: "8px 10px"
  slot-node-available:
    backgroundColor: "#fffbeb"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.lg}"
    padding: "8px 10px"
  slot-node-waived:
    backgroundColor: "#f5f3ff"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.lg}"
    padding: "8px 10px"
---

# Design System: Cornell Degree Planner

## 1. Overview

**Creative North Star: "The Navigator's Chart"**

The Cornell Degree Planner is built like a navigator's chart drawn on scholar's vellum: precise in structure, unhurried in tone, every marking meaningful. The interface does not announce itself. Surfaces recede so the roadmap speaks. Course nodes, prerequisite edges, and semester columns are the content; the chrome that frames them should be quiet enough to disappear.

The visual register follows Figma and Vercel: neutral surfaces, strong interaction states, functional beauty. Not "clean" as aesthetic performance, but clean because distraction costs students cognitive load they cannot afford. The only consistent chromatic presence is the status system: emerald when a course is complete, amber when it is available, violet when it is waived. These colors do real work. Nothing else should compete with them.

What this system explicitly rejects: SaaS dashboard theater (gradient cards, hero-metric layouts, promotional color), developer-tool austerity (zero warmth, no affordance for a first-time student user), and generic university portal design (gray tables, bureaucratic chrome, information hierarchies that serve the institution instead of the student).

**Key Characteristics:**
- Single humanist sans-serif (DM Sans) across all roles and weights
- UPPERCASE spaced labels as the navigational skeleton throughout every panel
- Tonal surface layering through opacity, not decorative shadows
- Anime.js for state-response motion: subtle, functional, never choreographed
- The roadmap canvas is the product; all surrounding chrome defers to it

## 2. Colors: The Scholar's Vellum Palette

A Restrained strategy: cool blue-tinted neutrals (the Slate family) plus a three-signal semantic status system. The only saturated colors in the interface communicate state. Decorative color is prohibited.

Both light and dark themes are supported via Tailwind's `darkMode: 'class'` and CSS variable swapping. Status colors use dedicated dark-mode variants (e.g. `border-emerald-700 bg-emerald-950/50`).

### Primary
- **Deep Slate Ink** (`#0f172a`, oklch(21% 0.04 265)): Primary text, button backgrounds, icon fills, the top bar brand mark. The heaviest weight in the neutral stack. Every element that must be read first uses this value.

### Neutral
- **Scholar's Vellum** (`#f8fafc`, oklch(98% 0.007 237)): Page background. A cool blue-white, the canvas on which everything is drawn. Future direction: warm this slightly toward true vellum by nudging chroma toward 90 (yellow-warm), keeping lightness at 98%.
- **Surface White** (`#ffffff`): Card and popover backgrounds. Should be tinted to `oklch(99.5% 0.005 237)` rather than left as pure white; the tint is nearly invisible but keeps the surface alive.
- **Whisper Mist** (`#f1f5f9`, oklch(96% 0.012 237)): Muted surface color; sidebar fills, secondary containers, progress bar track.
- **Slate Fog** (`#64748b`, oklch(52% 0.02 234)): Muted foreground. Section headers, credits, metadata, supporting labels. Never for primary reading text.
- **Chalk Border** (`#e2e8f0`, oklch(92% 0.012 238)): All structural borders. Keeps the grid readable without competing with status signals.

### Status Signals
These are the only saturated color in the interface. Sourced from Tailwind's named palette families; do not substitute custom hex values.

- **Completed Emerald** (`#34d399`, emerald-400): A course is done. Fills the slot node border and background.
- **Available Amber** (`#fbbf24`, amber-400): A course is available, or a prerequisite is met. Slot borders, legend dot, catalog chip hover state.
- **Waived Violet** (`#a78bfa`, violet-400): A course requirement has been waived.
- **Drop Indigo** (`#60a5fa`, blue-400): Active drop target during drag operations. Transient; never a persistent UI color.

### Destructive
- **Alert Red** (`#ef4444`, oklch(62% 0.22 24)): Error states, destructive button variants.

### Named Rules
**The Chart Signal Rule.** The status system is the only saturated chromatic presence. Emerald, amber, and violet exist to communicate state, not to decorate. Every other surface defers to them. Introducing a fourth accent color requires removing one of the existing three.

**The Vellum Rule.** No surface token is `#fff` or `#000`. Every neutral carries a subtle cool tint from the Slate hue family (chroma 0.005–0.012). As the palette matures, that cool bias should warm slightly toward parchment to earn the "Scholar's Vellum" name fully.

## 3. Typography

**Body Font:** DM Sans (humanist sans-serif, `system-ui` fallback)

No secondary or display family. Hierarchy is achieved through weight and size contrast, not font pairing. DM Sans's slight geometric warmth avoids the coldness of pure geometric sans (Inter, Helvetica) while maintaining the precision the tool aesthetic demands.

**Character:** A scholar's working document: controlled, legible, without typographic decoration. Every size step earns its place by doing a different job.

### Hierarchy
- **Headline** (600, 1.125rem / 18px, tracking-tight -0.02em): Top bar brand mark only. Reserved for the single page identity element. Not reused for in-panel headings.
- **Body** (500, 0.75rem / 12px, normal): Card titles, sidebar labels, input and option text. The primary reading weight in the tool environment.
- **Label** (600, 0.625rem / 10px, UPPERCASE, letter-spacing 0.1em): Section headers, panel titles, legend keys. The navigational skeleton. This is the most frequently recurring style in the application; it precedes every functional group.
- **Meta** (400, 0.5625–0.625rem / 9–10px, normal, muted-foreground color): Credits, metadata, supporting notes, catalog chip subtitles. Always muted.

Scale compression is intentional: this is a dense tool interface. Large display sizes would waste canvas space the roadmap needs.

### Named Rules
**The Label-First Rule.** Every section, panel, and functional group opens with a Label (10px / 600 / UPPERCASE / tracking-widest). No section opens with body-weight prose. The label is the spine; content hangs from it.

**The One-Family Rule.** DM Sans is the only typeface in this system. Do not introduce a serif for headings or a monospace for code. If code display becomes necessary, use DM Mono at Meta weight only.

## 4. Elevation

Flat by default, tonal layers. No decorative shadows on nodes, sidebar content, or stationary elements. Depth is communicated through surface opacity and background tint, not box-shadow.

Three elevation levels in active use:

### Shadow Vocabulary
- **Structural layer** (no shadow): Sidebars use `bg-card/60`; the top bar uses `bg-card/90 backdrop-blur`. Translucent over the canvas. No shadow.
- **Floating panel** (`box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)`): The right-side course catalog panel when open. `shadow-xl` in Tailwind. Reserved for surfaces that escape the grid entirely.
- **Tab control** (`box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)`): The catalog toggle tab. `shadow-md`. A functional cue that the tab is above the canvas, not a decorative lift.

Course nodes: border-only at rest. No shadow. The status border color IS the elevation signal. A completed node with an emerald border reads as elevated relative to an empty dashed-border node without any actual shadow.

### Named Rules
**The Flat-by-Default Rule.** No surface receives a shadow unless it floats above the canvas grid. Cards, sidebars, and panels are flat at rest. Depth is tonal, not shadowed.

**The Blur Reserve Rule.** `backdrop-blur` is applied exactly once: the top bar. It is not a default treatment for cards, overlays, or secondary panels. Glassmorphism as decoration is prohibited.

## 5. Components

### Slot Node (Signature Component)
The core interactive element. Fixed dimensions defined by the `CARD_W` / `CARD_H` constants in `buildRoadmapGrid.ts`.

- **Shape:** 8px radius (`rounded-lg`), 1px border
- **Empty state:** Dashed border (`border-dashed`), `border-subtle` color, transparent background. Opacity 40% when unfilled.
- **Drop target:** Solid `border-blue-400`, `bg-blue-50`, "Drop here" label. Transient; clears on pointer release.
- **Completed:** `border-emerald-300 bg-emerald-50` (light); `border-emerald-700 bg-emerald-950/50` (dark)
- **Available:** `border-amber-300 bg-amber-50` (light); `border-amber-700 bg-amber-950/50` (dark)
- **Waived:** `border-violet-300 bg-violet-50` (light); `border-violet-700 bg-violet-950/50` (dark)
- **Content layout:** Course code (Label style), course title (Body, 2-line clamp), credits (Meta)
- **Hover lift:** anime.js `y: -4, duration: 140, ease: "out(2)"`; suppressed during active drag
- **Fill entrance:** anime.js `scale: [0.65, 1.06, 1.0], opacity: [0, 1]`, spring `{ bounce: 0.4, duration: 480 }` on first fill only

### Course Chip (Catalog)
Draggable course item in the right panel. Compact; designed to be scanned quickly in a staggered list.

- **Shape:** 6px radius (`rounded-md`), 1px border, `bg-card`
- **Default:** `border-subtle`
- **Hover (prereqs met):** `border-amber-300 bg-amber-50`. The amber signal pre-announces the slot's color on drop.
- **Prereqs unmet:** `opacity-60` at rest, `opacity-90` on hover. Visible but subordinated.
- **Status dot:** 6px filled circle, top-right corner. Emerald (met), gray/muted (unmet), absent (no prereqs)
- **Stagger entrance:** anime.js `opacity: [0, 1], y: [10, 0], delay: stagger(18), duration: 220, ease: "out(3)"` on each catalog update
- **Hover micro-lift:** `y: -2, scale: 1.02, duration: 120, ease: "out(2)"`

### Buttons
- **Primary** (default variant): `bg-ink-deep text-surface-bg`. 6px radius, 40px height, `px-4 py-2`. Hover: `opacity-90`. Used for primary destructive confirmations and future CTAs.
- **Outline** variant: `border border-input bg-background`. Same radius. Hover: `bg-accent` (muted surface). Used for Reset, secondary controls.
- **Ghost** variant: No border, no background. Hover: `bg-accent`. Used for icon-only controls (theme toggle, small icon buttons).
- **Focus:** 2px `ring-ring` (ink-deep) with 2px ring-offset. No custom treatment beyond the shadcn default.

### Search Input
- **Shape:** 6px radius, `border-subtle`, `bg-background`
- **Focus:** `border-ring` (ink-deep) + `ring-1 ring-ring`. A clean ink-dark ring, not a colored glow.
- **Prepended icon:** 12px search icon (muted foreground), 24px leading padding to clear it
- **Placeholder:** Meta weight, muted foreground color

### Navigation (Top Bar)
- **Surface:** `bg-card/90 backdrop-blur`, `border-b border-subtle`. The only blurred surface in the system.
- **Brand mark:** `rounded-2xl` (24px) icon container, `GraduationCap` icon. Headline text beside it.
- **Program selector:** Native `<select>` with `appearance-none`, overlaid `ChevronDown` icon. `rounded-lg`, small text. Avoids a custom dropdown component.
- **Layout:** Full-width top bar, content maxed at 1800px, `px-4 pt-6 pb-3`. The asymmetric vertical padding (more top) gives the bar a slight breathing room above its content.

### Sidebars
- **Left:** Fixed `w-56`. `bg-card/60 border-r`. Sections separated by spacing only, no dividers. Label style precedes each section.
- **Right (Catalog Panel):** Fixed `w-[480px]`, slides in from the right edge. `bg-card border-l shadow-xl`. Animated by anime.js: open `x: 0, ease: "out(3)", duration: 360`; close `x: 480, ease: "in(2)", duration: 360`. Backdrop dims behind it during open state.
- **Panel toggle tab:** `h-14 w-7 rounded-l-xl border border-r-0 bg-card shadow-md`. The only instance of `shadow-md`.

### Progress Rail
- **Track:** `h-1.5 rounded-full bg-muted`
- **Fill:** `bg-emerald-500` (one step darker than the node's completed color). Width animated via CSS `transition-all duration-500`.
- **No label, no number.** Context comes from the count above it (`N / M slots`), not from the bar itself.

## 6. Do's and Don'ts

### Do:
- **Do** use the status system (emerald / amber / violet) as the only saturated color in any screen. Reserve all three signals for their named states: completed, available/prereq-met, waived.
- **Do** open every section, panel, and functional group with a Label (10px / 600 / UPPERCASE / tracking-widest / muted foreground). This is the navigational skeleton.
- **Do** use tonal layering (surface opacity, background tint) for depth on non-floating surfaces. Use `shadow-xl` only for panels that fully escape the layout grid.
- **Do** use anime.js for hover and state-response motion. Keep easing at `"out(2)"` or `"out(3)"`. Cap durations at 480ms. Never bounce, never elastic.
- **Do** keep all neutral surfaces tinted (chroma 0.005 or higher). Never use literal `#fff` or `#000` as a final token value.
- **Do** use 8px radius for slot nodes, 6px for chips and inputs and buttons, 12px for secondary containers, 24px for the brand icon mark.
- **Do** cite PRODUCT.md's design principles in new feature work. "Complexity, made navigable" and "Course-first, not major-first" should visibly influence layout decisions, not just copy.

### Don't:
- **Don't** introduce a fourth saturated accent color. The Chart Signal Rule prohibits it. Adding a color requires removing an existing status signal.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored stripe on cards, callouts, or list items. Rewrite with a full border, a background tint, or no border at all.
- **Don't** apply `background-clip: text` with a gradient for any text emphasis. Use a single solid color, with weight or size for differentiation.
- **Don't** apply `backdrop-blur` to any surface other than the top bar. The Blur Reserve Rule permits exactly one blurred surface in the system.
- **Don't** build hero-metric layouts: big number, small label, supporting stats, gradient accent. From PRODUCT.md: "Generic SaaS dashboards" are an explicit anti-reference. The Major Match panel, progress display, and any future analytics surface must avoid this template.
- **Don't** create identical card grids (same-sized cards, icon + heading + body text, repeated). Not the aesthetic of this system.
- **Don't** reach for a modal as the first response to a user action. The catalog uses a slide panel; detail views should expand inline or use a dedicated panel section. Modals are a last resort.
- **Don't** add decorative color to structural elements (borders, backgrounds, shadows) to signal "university" or "Cornell." The first-order reflex for education tools is blue-and-red institutional color. This system does not use Cornell red. State signals earn their color; structure does not.
- **Don't** build developer-tool austerity into new surfaces. From PRODUCT.md: "Bare-bones developer tools (terminal-only aesthetic, zero warmth)" is an explicit anti-reference. The student audience needs affordance and warmth alongside precision.

## 7. Implementation

As of Phase 1 (spec 003, branch `phase-1-tokens`, 2026-07-07) this design system
is implemented in code — DESIGN.md and the app now agree.

- **`cornell-degree-planner/src/styles/tokens.css`** is the source of truth for
  colors, type roles, radii, spacing, and elevation. Light values live on
  `:root`; dark mode is a *complete re-declaration* of the same custom-property
  names under `.dark` (toggled on `<html>` by the theme store). Components never
  branch on theme — they read `var(--token)`. This file also defines the type
  role utilities `.t-headline` / `.t-body` / `.t-label` / `.t-meta` (the
  Label-First rule as one class) and `.num` (the DM Mono + `tabular-nums`
  numeric signature).
- **`cornell-degree-planner/tailwind.config.ts`** bridges those tokens into
  Tailwind's utility engine as semantic color names (`canvas`, `surface`,
  `ink`, `line`, and the `complete` / `available` / `waived` / `drop` /
  `destructive` status triads), plus `fontFamily`, `borderRadius`, `boxShadow`,
  and spacing scales. Components write semantic classes (`bg-surface`,
  `text-ink-2`, `border-line`, `bg-complete-tint`) rather than raw palette
  classes.
- **Fonts** are self-hosted via `@fontsource/dm-sans` (400/500/600/700) and
  `@fontsource/dm-mono` (400/500), imported in `main.tsx` — no Google Fonts
  request.
- The stock shadcn HSL variables are kept alive as a **temporary aliasing
  bridge** in `globals.css` so `button.tsx` / `card.tsx` render against the same
  tokens; remove that block once no shadcn-namespaced class remains.

Layout, canvas structure, and per-component anatomy remain the target of spec
004 — Phase 1 only re-colored and re-typeset the existing structure.
