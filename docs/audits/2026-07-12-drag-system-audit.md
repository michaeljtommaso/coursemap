# Drag-and-Drop System Audit & Diagnosis

> Session: 2026-07-12. Branch: `impl-007-013`.
> STATUS: **DIAGNOSED — NOT YET FIXED.** This doc is the brief for a dedicated
> "audit and perfect the drag system" session. Root cause is confirmed with a
> reproducible test using real (trusted) browser mouse events.

## TL;DR

Dragging a card to a **different semester column** silently does nothing — no
ghost, no snapping, no drop-target highlight, no placement, and **no console
error**. Dragging a catalog course onto a slot fails the same way.

**Root cause (confirmed):** the 6px "did the pointer move enough to be a drag?"
threshold check lives in a React `onPointerMove` handler bound **only to the
source element** (the card or the catalog row), and **no code anywhere calls
`setPointerCapture()`** (`grep -r setPointerCapture src` → zero matches).

Without pointer capture, the instant the real pointer leaves the source card's
small box (216×104px), the browser routes `pointermove` to whatever element is
now under the cursor — not back to the card. So the element-scoped handler stops
firing, the threshold is never crossed, and `dragState.start()` is never called.
Any drag that leaves the card's footprint — i.e. essentially every real
"move to another column" gesture — never even enters drag mode.

Everything **downstream** of drag-start (hover/target resolution, snapping,
drop-commit) is architecturally sound and was verified correct — it is simply
**unreachable** because the drag almost never starts.

---

## How the system is supposed to work (architecture map)

The drag system is a hand-rolled pointer-events state machine (no HTML5 native
drag, no library). Five pieces:

| File | Role |
|------|------|
| `src/lib/drag/dragState.ts` | Global singleton state machine + pub/sub. Phases: `dragging` → `dropping` → (end). Holds mode (`course` \| `slot`), source, cursor position, `overSlotId`/`overColumnSem` (hover targets), and drop target. |
| `src/components/roadmap/SlotCard.tsx` (≈812–852, 983, 989–991) | **Drag source #1** — a placed card drags its COURSE; an empty card drags the SLOT itself. Also the drop target (`data-slot={slot.id}` on the root). |
| `src/components/catalog/CourseCatalog.tsx` (≈78–100) | **Drag source #2** — a catalog row drags a COURSE onto the board. |
| `src/components/roadmap/SemesterColumn.tsx` (137) | Drop target for columns: `data-column={group.sem}` on the full-height column div. |
| `src/components/layout/AppShell.tsx` (28–100) | **Document-level** `pointermove`/`pointerup`/`pointercancel` listeners: continuous hover tracking (`dragState.move`), edge auto-scroll, and drop resolution (`dragState.startDrop`). |
| `src/components/drag/DragGhost.tsx` | The traveling ghost card (a `[data-drag-ghost]` portal on `<body>`), snapping animation, and the **commit** effect that calls `assignSlot`/`addCustomSlot`/`moveSlot`. |

### Intended lifecycle

1. **Arm:** `onPointerDown` on a card/row records `dragCandidate = {x, y}` (a ref).
2. **Start:** `onPointerMove` on that same element checks `hypot(dx,dy) > 6`; if so
   it calls `dragState.start()` (course) or `dragState.startSlotMove()` (slot).
   This adds body class `dragging-active` and mounts the ghost.
3. **Track:** AppShell's **document** `pointermove` → `dragState.move(x,y)` →
   `document.elementsFromPoint(x,y)` finds the first element with `dataset.slot`
   (hover slot) and `dataset.column` (hover column), storing them on the state.
   Slots only match in `course` mode; `slot` mode tracks columns only.
4. **Feedback:** the hovered slot renders `isDropTarget` styling ("Drop it here"
   + blue ring); the hovered column gets `ring-2 ring-drop`. The ghost
   (`DragGhost` `subscribeToPosition`) snaps onto the hovered slot's rect.
5. **Commit:** AppShell's document `pointerup` → `dragState.startDrop(...)`.
   `DragGhost`'s effect commits the mutation exactly once (guarded by
   `committedKeyRef`), then plays a decorative animation.

### What actually resolves a drop (AppShell `handleUp`, 60–77)

```
if (ds.mode === "slot")  dragState.startDrop(null, ds.overColumnSem);   // slot → column
else {
  const targetSlotId = ds.overSlotId && ds.courseId ? ds.overSlotId : null;
  dragState.startDrop(targetSlotId, targetSlotId ? null : ds.overColumnSem);
}
```

Mutations live in `PlanProvider.tsx`: `assignSlot` (765), `moveSlot` (884),
`addCustomSlot` (961). **These are the same functions click-to-place uses, and
click-to-place works** — so the mutation layer is not suspect.

---

## The bug, proven

Evidence gathered in-browser (localhost dev server) using **real trusted
`page.mouse` events**, not synthetic dispatch:

- **Hit-testing is fine.** At a card's center, `elementsFromPoint` returns an
  element with the correct `dataset.slot` and `pointerEvents: auto`. Column-gap
  points resolve `data-column` with `pointerEvents: auto`. The EdgeLayer `<svg>`
  is `pointer-events: none` (correct — deliberately excluded). So target
  resolution *can* work.

- **Drag with the pointer kept INSIDE the card box works.** Dragging
  `cs-s1-math1910` straight down (same x, so the cursor stays within the card's
  216px width): `dragging-active` and the ghost both become `true` at the first
  move — the drag starts and proceeds normally.

- **Drag that LEAVES the card box never starts.** Dragging the same card to
  column 3 (real horizontal travel, exits the 216×104 box on the first sampled
  move): `dragging-active=false` and `ghost=false` for **all 12 move steps**.
  `elementsFromPoint` at each intermediate point still resolved `col:1/2/3` and
  slot ids correctly — proving resolution is not the failure; the drag simply
  never entered active mode.

- **Catalog → slot never starts.** The first sampled move from a catalog row is
  already ~96px away (outside the row); `active=false`/`ghost=false` for all
  steps; target slot text stays "…Find a class"; nothing placed.

- **Silent.** Zero console errors/warnings through every attempt.

### Why the source-scoped handler stops firing

`onPointerMove` is a React prop on the card root (`SlotCard.tsx:990`) / catalog
row. React delivers it only while the pointer is over that element (or its
descendants). Native pointer events are **not** captured to the source, so once
the cursor moves off the small card, `pointermove` targets a different element
and the card's handler goes quiet. `dragCandidate.current` is left stale
(`onPointerUp` is *also* element-scoped, so a release off the card never resets
it either — a secondary latent issue).

### Why this maps to every reported symptom

- *"No snapping."* Snapping is driven by `DragGhost.subscribeToPosition`, which
  only runs while a drag is active. Never active → never snaps.
- *"No UI feedback."* The drop-target highlight and column ring key off
  `overSlotId`/`overColumnSem`, set only during an active drag. Never set.
- *"Drag to a new column doesn't work."* Cross-column drags are exactly the
  gestures that leave the source box immediately, so they never start.
- *"It doesn't work / nothing happens."* Silent no-op: no start, no ghost, no
  commit.

---

## Secondary findings (fold into the "perfect it" pass)

1. **Duplicated drag-source logic.** The identical arm/threshold/start block
   exists in *two* files (`SlotCard.tsx` and `CourseCatalog.tsx`). The fix (and
   all future drag-source behavior) should live in **one** shared hook, e.g.
   `useDragSource({ mode, onStart })`, so the two paths can never drift.

2. **Stale `dragCandidate` on off-source release.** Because `onPointerUp` is
   element-scoped, releasing the pointer away from the source leaves
   `dragCandidate.current` set. Harmless today (next `pointerdown` overwrites it)
   but it disappears for free once start-detection moves to document/captured
   listeners.

3. **Touch reliability.** `onPointerDown` deliberately avoids `preventDefault`
   to keep the catalog list scrollable, and cards have `touch-action: auto`. On
   touch, a drag gesture can be stolen by native scrolling before the threshold
   is met. When adding capture, decide `touch-action` per surface (likely
   `none` on roadmap cards, keep list scroll behavior in the catalog).

4. **Snapping/feedback are unverified, not just unreachable.** Once drag-start is
   fixed, re-verify: (a) the ghost snap onto a hovered slot, (b) the "Drop it
   here" state, (c) the column `ring-2 ring-drop`, (d) edge auto-scroll near the
   canvas edges (`AppShell.tsx:28`), (e) behavior at 55% zoom (canvas uses CSS
   `zoom`; ghost is `position: fixed`, snap uses `getBoundingClientRect` — should
   be consistent but must be checked).

5. **No keyboard alternative.** Moving a placed course is drag-only; the old
   click-to-pick-up gesture was retired (STATUS 2026-07-10). A11y gap to decide
   on separately — not part of this bug.

6. **Animation smoothing — one concrete tune (apply AFTER the start fix).** The
   ghost's motion layer is already correct: `createAnimatable` gives zero-latency
   x/y cursor tracking (never call `animate()` per `pointermove` — that builds up
   timelines and janks), velocity tilt, and a `spring()` snap. The vault pattern
   this project's ghost was extracted into (`wiki/coding/anime-drag-ghost.md`) has
   one lever we currently omit: give the **snap spring an explicit settle
   duration** so the snap timing is bounded/predictable (reads as crisper):

   ```tsx
   // DragGhost.tsx snap (subscribeToPosition) — current:
   animate(ghostRef.current, { x: rect.left, y: rect.top, rotate: 0,
     ease: spring({ bounce: 0.25 }) });
   // suggested: bound the settle time
   animate(ghostRef.current, { x: rect.left, y: rect.top, rotate: 0, duration: 220,
     ease: spring({ bounce: 0.25, duration: 320 }) });
   ```

   Purely a *feel* tweak — it changes nothing until drag-start works, since the
   snap animation is downstream of `dragState.start()`. Consider the same
   explicit-duration treatment on the drop-commit spring (`DragGhost.tsx:159–174`).

   ⚠️ **Do NOT re-adopt the vault page's "commit state in `onComplete`" advice.**
   That page predates spec 009 §5; our current code commits the mutation
   *synchronously* and animates as pure decoration on purpose (an interrupted
   animation was eating placements). Keep the synchronous commit. (The vault page
   itself is stale on this point and should be updated later.)

---

## Recommended fix (for the next session — do NOT ship blind)

**Primary, minimal fix:** capture the pointer at drag-arm time so the
source-scoped `onPointerMove` keeps firing across the whole gesture.

```tsx
const onPointerDown = (e: React.PointerEvent) => {
  if (isDraggingOut || isSlotMoving) return;
  dragCandidate.current = { x: e.clientX, y: e.clientY };
  e.currentTarget.setPointerCapture(e.pointerId);   // ← the missing piece
};
```

With capture, `pointermove`/`pointerup` continue targeting the card even when the
cursor is outside it, so the 6px threshold reliably crosses and `dragState.start()`
runs. AppShell's **document** listeners still fire (events bubble from the capture
target up to `document`), so continuous tracking + commit are unaffected. Release
with `releasePointerCapture` on pointerup (or rely on auto-release).

**Preferred, more robust fix (recommended for a "perfect it" pass):** extract a
shared `useDragSource` hook that, on `pointerdown`, attaches **document-level**
`pointermove`/`pointerup` listeners for the threshold check (mirroring how
AppShell already owns the continuous phase), then detaches them once the drag
starts or the gesture ends as a click. This avoids pointer-capture edge cases
(capture dropped if the source re-renders/unmounts mid-gesture — cards re-render
frequently on hover), fixes the stale-candidate issue for free, and unifies both
sources. Evaluate both; the hook approach is cleaner long-term.

### Watch-outs when implementing
- The source card **re-renders often** (hover chain, near-face). Pointer capture
  survives re-render as long as the same DOM node persists (`outerRef` is
  stable), but capture is lost if the node unmounts — a reason to prefer the
  document-listener hook.
- Keep the plain-click path intact: a sub-6px press must still ARM (catalog) /
  open the detail panel (card). Don't `preventDefault` pointerdown on the catalog
  list or you kill touch scroll (the existing comment at `CourseCatalog.tsx:74`
  explains why).
- `dragState.end()` must run on every exit path (drop, empty-drop, cancel) or the
  `dragging-active` body class + capture stick. It currently funnels through
  `DragGhost` → `dragState.end()`; preserve that.

---

## Verification plan

Good news that overturns a prior assumption: **real `page.mouse` drags in
Playwright faithfully reproduce this** (the same-x drag starts; the cross-column
drag doesn't). The old "automated browser can't simulate drags" note referred to
tap-to-place workarounds — a genuine stepped `mouse.down → mouse.move×N →
mouse.up` **does** exercise the real path. So the fix can carry an automated
regression test:

1. **Repro test (write first, must fail pre-fix):** real stepped mouse drag of a
   placed card from column 1 to column 3; assert the card's semester changed.
2. **Catalog → slot:** stepped drag of a catalog row onto an empty slot; assert
   the slot now holds that course.
3. **Feedback:** mid-drag, assert the hovered slot shows "Drop it here" and the
   hovered column has the drop ring.
4. **Same-column short drag still works** (regression guard for the capture
   change).
5. **Click still arms / opens detail** (sub-threshold press).
6. Manual pass at 55% zoom and on a touch device.

---

## Key references

- `src/components/roadmap/SlotCard.tsx:812` (`onPointerDown`), `:816`
  (`onPointerMove` threshold), `:850` (`onPointerUp`), `:983` (`data-slot`),
  `:989–991` (handlers bound).
- `src/components/catalog/CourseCatalog.tsx:78–100` (same pattern, catalog).
- `src/components/layout/AppShell.tsx:28–100` (document listeners, edge scroll,
  `handleUp` drop resolution).
- `src/lib/drag/dragState.ts:139` (`move` + `elementsFromPoint` hit-testing),
  `:170` (`startDrop`), `:178` (`end`).
- `src/components/drag/DragGhost.tsx:96` (snap), `:136` (commit effect).
- `src/components/roadmap/SemesterColumn.tsx:137` (`data-column`).
- `src/contexts/PlanProvider.tsx:765` (`assignSlot`), `:884` (`moveSlot`),
  `:961` (`addCustomSlot`).
