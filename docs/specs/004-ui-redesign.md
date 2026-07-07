# Spec 004 — UI Redesign: Canvas, Cards, First-Run (Phase 3)

STATUS: NOT BUILT
Depends on: 002 (data), 003 (tokens). Feeds: 005 (feature surfaces defined here).
Source: UI audit + house-standard grid/card conventions, 2026-07-07.

---

## 0. Redesign posture

Not a teardown. The motion layer and catalog panel already track DESIGN.md well; what's
wrong is the *structure*: pixel-math layout, rigid cards, shrug-quality first-run,
pointer-only interaction, and no home for Major Match. Design language stays "Scholar's
Vellum" (DESIGN.md), now backed by real tokens (spec 003). house-standard conventions applied:
card anatomy + selected-pill language + registry-style config where it fits; the
ROW+GAP sizing insight informs the new grid.

## 1. Canvas re-layout: CSS grid semesters (the structural bet)

Replace `buildRoadmapGrid`'s absolute pixel math (CARD_W 200 / CARD_H 90 / COL_STRIDE
244 / ROW_STRIDE 104) with real DOM structure:

```
<div class="canvas-scroll">          /* overflow-x auto; scrollbar-gutter: stable */
  <div class="semester-track">       /* grid: 8 columns, min-content rows */
    <SemesterColumn>                 /* one per semester */
      <SemesterHeader/>              /* sticky top within scroll container */
      <SlotCard/> × n                /* auto-flow; heights flex */
      <AddSlotGhost/>                /* future: custom rows, spec 005 */
      <SemesterFooter/>              /* credit total — spec 005 wires data */
    </SemesterColumn>
  </div>
  <EdgeLayer/>                       /* SVG overlay, measured from refs */
</div>
```

- Column width: `clamp(200px, 12vw, 240px)`; row gap fixed. Pick gap so
  **card min-height + gap = one clean row unit** (ROW+GAP insight) — slots align
  across columns without pixel math.
- Cards get `min-height` and flex to content — kills the 2-line-clamp title truncation.
  Cross-column alignment of `slot_row` peers is intentionally dropped (it forced the
  rigidity); prereq edges provide the cross-column relationships.
- **Sticky semester headers** inside the scroll container (audit #9): you always know
  which semester you're in mid-scroll. Add a "jump to semester" segmented strip above
  the canvas on narrow viewports.
- **EdgeLayer**: keep SVG cubic beziers, but source coordinates from a
  `Map<slotId, ref>` measured via `ResizeObserver` + rAF batch (recompute on layout
  change, not per frame). Edge style: `--border-strong` at rest; when a slot is
  selected/hovered, its incoming/outgoing edges lift to `--text` — complexity made
  navigable without saturated color.
- **Drop targets** stay `data-slot` attributes (drag system unchanged); add
  **edge auto-scroll** during drag (pointer within 48px of scroll edge → scroll,
  rAF loop) — fixes "can't drop on off-screen semester" (audit S5).
- Delete `buildRoadmapGrid.ts` (superseded); slot ordering/grouping logic moves into a
  pure `groupSlotsBySemester(slots)` util with unit tests.

## 2. Slot card redesign (the house-standard card-anatomy pass)

Current problems: code-first hierarchy (students recognize titles), three 12px icons
stacked in a corner over a reserved gutter, fixed size, waived unreachable.

New anatomy (top → bottom):
1. **Status rail**: 3px full-width top border in status base color (reads at a glance
   across the whole grid; replaces nothing — border stays 1px `--border` elsewhere).
2. **Title** (`.t-body`, 600, `--text`, up to 3 lines) — the read-first element.
3. **Meta row**: course code as `.t-label` chip + credits in `.num` (`--text-3`).
4. **Action row** (revealed on hover/focus-within; always visible on touch):
   `✓ Complete` toggle, `Waive` (small), `✕` clear for user-placed courses. Real
   `<button>`s, 24px+ targets, `aria-label`s. Replaces the corner icon stack.
- States: tokens only — `available` = `--available-tint` bg at 100% opacity;
  `empty` = dashed `--border`, 40% content opacity; `drop` = `--drop` border +
  `--drop-tint` + scale 1.02; `completed`/`waived` per triad. Keep hover lift
  (y:-4, 140ms, out(2)) and the fill spring exactly as-is (they're spec-compliant and
  good). Add the missing **cancel-on-unmount** for running anime instances (audit smell).
- Pattern slots (`CS-111x`): render pattern title + a `.t-meta` "satisfies CS 111x"
  hint; elective slots show group name + a subtle `min-credits` meta. Both keep the
  dashed treatment until filled.

## 3. First-run & empty states (the product's handshake)

- **No-program state** becomes the onboarding moment (currently two gray sentences):
  centered panel on the canvas: product thesis line ("Start with courses you love —
  see where they lead."), a **program picker rendered inline as pill cards**
  (house-standard: primary-axis + small set = show all as pills, not a dropdown in the
  corner): CS · ECE · ME · ORE with college + catalog year in `.t-meta`. One click →
  plan created (spec 002) → canvas loads. Behind it, a low-opacity ghost roadmap
  (static SVG, `--border-faint`) so the empty state previews the product.
- TopBar keeps a compact program/plan switcher for later switches; it stops being the
  only entry point.
- **Empty catalog search** ("No matches for 'xyz'") gets a teach line: "Try a course
  code like CS 2110, or a topic like 'algorithms'."
- **Error states**: already tokenized in 003; this spec places them (canvas-level error
  panel with Retry when a program doc fails).

## 4. Click-to-place (keyboard + touch + discoverability in one)

Drag remains the fast path; add a selection path that makes the product usable without
a mouse (audit #4, PRODUCT.md's own a11y promise):

- Catalog chips and filled slot cards are focusable (`tabindex=0`, `role=button`).
  Enter/Space on a chip **arms placement mode**: eligible slots highlight with
  `--drop-tint`; the armed chip gets the selected-pill treatment (1.5px `--drop` border
  — house-standard selected language). Click/Enter on a slot places; Esc cancels.
- Same affordance solves touch: tap chip → tap slot (no drag needed). Then relax the
  chip `preventDefault` so the catalog list scrolls on touch again; pointer-drag
  initiates only after an 8px movement threshold.
- Screen-reader labels: chip = "CS 2110, 4 credits, prerequisites met, press Enter to
  place"; slot = "Fall freshman, elective slot, press Enter to place CS 2110".

## 5. Catalog panel & Major Match placement

- Catalog panel keeps its geometry (480px slide-over is spec-compliant and works). Add:
  sticky search field, result count in `.num`, prereq-status chips (spec 005 wires the
  evaluator), skeleton rows (003).
- **Major Match gets the panel's second tab**, not the left rail: the right panel becomes
  a two-tab surface — `Catalog | Majors` (segmented control, house-standard primitive). The
  match list needs breathing room a 224px rail can't give, and pairing it with the
  catalog puts both halves of the course-first loop (pick courses ↔ see majors) in one
  place. Rendered as a ranked **list** (name, `.num` percent, thin progress rail,
  "N of M required courses" meta) — explicitly not hero-metric cards (PRODUCT.md
  anti-reference). Data logic in spec 005.
- Left rail slims to: program identity, progress (slots now; credits when 005 lands),
  legend, and a "Waived" legend entry restored.

## 6. Deletions & replacements (already-decided, execute here if not in 001)

- Trash bin gone (001 cuts code; verify no UX hole: ✕ on hover/touch action row is the
  delete path, plus drag-out-to-nowhere simply springs the ghost back).
- `window.confirm` replaced (003).
- SemHeader colors neutralized (003); this spec makes headers sticky.

## 7. Responsive posture (bounded scope)

Full mobile is out of scope for beta. Commit to: graceful ≥1024px experience (sticky
headers + jump-to-semester + edge auto-scroll make horizontal scroll livable);
below 1024px, a styled "Best on a laptop for now" interstitial with the ghost-roadmap
visual — honest, on-brand, cheap. Track real mobile as a post-beta epic (likely a
one-semester-at-a-time column view; note in backlog).

## 8. Motion cleanup (small)

- Backdrop pointer-events flips via subscription state change only (audit S7), not per
  pointermove.
- Remove dead `duration` param beside spring ease (001 touches DragGhost anyway).
- Status-change beat: completing a course gets a 180ms tint fade + check draw —
  the one place "quiet confidence" earns a confirming beat (fill has a spring;
  completion currently has nothing).

## Acceptance checklist
- [ ] No `buildRoadmapGrid.ts`; canvas is DOM grid; long titles render un-truncated
- [ ] Sticky headers during horizontal scroll; drag near edge auto-scrolls
- [ ] Keyboard-only: place, complete, waive, and clear a course without a pointer
- [ ] Touch (devtools emulation): catalog scrolls; tap-tap placement works
- [ ] First run: pick a program from the canvas itself in one click
- [ ] Right panel: Catalog | Majors tabs; Majors renders (mock data until 005)
- [ ] Edges highlight on slot hover/selection
- [ ] `prefers-reduced-motion` disables lifts/springs/stagger (single utility guard)
