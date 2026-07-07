# Bug Triage — 2026-07-07

> Live logging session. Michael walks the app and reports what's buggy or
> what he wants changed; each item is logged here with a light diagnosis
> pointer for a future fix session. **Logging + overview only — no fixes
> this session.**

## North star (keep every item measured against this)
> **"How can we make picking a major the easiest, and remove as much
> doubtfulness and worry from a student's path as possible?"**
> Prioritize items that reduce doubt (prereq/coreq visibility, availability,
> class detail, comparison) over pure polish.

## Legend
- **Type**: `bug` (broken) · `change` (works, wants different) · `feature` (new) · `later` (deferred idea)
- **Status**: `open` · `diagnosed` (pointer found) · `fixed`
- **Sev**: `high` · `med` · `low`

---

## Summary (27 items + north star)

| #  | Item | Type | Sev | Area / pointer |
|----|------|------|-----|----------------|
| 1  | Build the login page (Google auth exists, unbuilt) | feature | high | `contexts/AuthProvider.tsx`, `services/auth.ts` |
| 2  | Un-grey "non-engineering" classes; show real class, drop "11x" placeholders | change | med | catalog seed / `CourseCatalog.tsx` |
| 3  | Dragging a card highlights surrounding text | bug | med | drag layer — add `user-select:none` |
| 4  | Failed drop should animate card back into the classes container | change | med | `dragState.ts` + `CourseCatalog.tsx` |
| 5  | Expand the prereq/coreq tree (core value prop) | change | high | `EdgeLayer.tsx`, `evaluatePrereq.ts` |
| 6  | Different card shapes per class type (like real flowcharts) | change | low | `SlotCard.tsx` / catalog card |
| 7  | "Your plans" selector opens *behind* the card grid | bug | high | z-index — `RightSidebar.tsx` vs canvas |
| 8  | Account / settings peek, bottom-left (standard shell) | feature | med | `LeftSidebar.tsx` / `AppShell.tsx` |
| 9  | Remove "waived"; add red "unavailable" (missing pre/co-reqs) | change | med | **data-model touch** — see notes |
| 10 | Surface the prereq/coreq engine — "where is it?" | bug | high | engine exists; not shown — see notes |
| 11 | Classes page — complete course directory | feature | med | new route + `services/catalog.ts` |
| 12 | Filters in the class side-peek (type, major-importance) | feature | med | `CourseCatalog.tsx` + `useCourseSearch.ts` |
| 13 | Favorites system (save classes for later) | feature | med | new state + profile persist |
| 14 | Import RateMyProfessor / external reviews & rankings | later | low | data pipeline, future |
| 15 | Zoom-out in grid view | feature | med | `RoadmapCanvas.tsx` |
| 16 | Refine dark mode + hover anims (scrollbars, side-peek hover) | change | med | `styles/tokens.css`, hover states |
| 17 | Click a class → full detail (side-peek or modal) | feature | med | new detail panel |
| 18 | Empty grey slot → clear "suggested class" affordance | change | med | `SlotCard.tsx` empty state |
| 19 | Auto-fill / "explore options" generator | later | low | future |
| 20 | Polish the top toolbar UI | change | med | `TopBar.tsx` |
| 21 | Redesign class cards — too empty | change | med | `SlotCard.tsx` / catalog card |
| 22 | "Save your plan" sticks on "signing in" after cancel | bug | high | `TopBar.tsx` sign-in handler |
| 23 | Make "Save your plan" explicit (tooltip / "sign in first") | change | med | `TopBar.tsx` |
| 24 | Expand the class legend — more states / student niches | change | med | legend component + item 9 |
| 25 | Reset → "clear everything" button mis-styled (grayed) | bug | med | reset dialog styling |
| 26 | Blank-canvas / start-from-scratch option | feature | med | `FirstRun.tsx` + plan init |
| 27 | Compare plans/majors directly by classes of interest | later | low | future |

---

## Items (detail — grouped by theme)

### Auth & save flow
**#1 — Build the login page** · `feature` · `high` · `open`
Google sign-in is configured but there is no built login page. Save/share
are gated on auth, so this blocks the persist story.
→ Pointer: `contexts/AuthProvider.tsx`, `services/auth.ts` already exist —
this is UI, not plumbing. Ties to #22, #23.

**#22 — "Save your plan" sticks on "signing in"** · `bug` · `high` · `diagnosed`
Click "Save your plan", the sign-in popup opens, close it without signing in
→ button stays stuck on "Signing in…". State never resets on
cancel/rejection.
→ Pointer: `components/layout/TopBar.tsx` (sign-in handler around the save
button, ~L170–L210). Root cause is almost certainly a missing
`finally`/catch that clears the loading flag when the popup promise rejects
(user closed it). One reset in the shared handler, not per-caller.

**#23 — Make "Save your plan" explicit when signed out** · `change` · `med` · `open`
Unclear what the button does before sign-in. Add a tooltip or disabled state
reading "sign in first."
→ Pointer: `TopBar.tsx`, same button as #22.

### Core value prop — prereq/coreq
**#10 — "Where is my prereq/coreq engine?"** · `bug`/`question` · `high` · `diagnosed`
The engine *exists* in code: `lib/planner/evaluatePrereq.ts` +
`hooks/useEffectiveSlots.ts`. The complaint is it isn't visibly doing
anything in the UI. This is a surfacing gap, not a missing engine.
→ Pointer: trace where `evaluatePrereq` output is consumed and whether
`SlotCard` renders an unmet-prereq state. Directly enables #9's "unavailable."

**#5 — Expand the prereq/coreq tree** · `change` · `high` · `open`
The whole point of the site is seeing how classes stack. The current
edge/tree rendering is too thin.
→ Pointer: `components/roadmap/EdgeLayer.tsx` (draws arrows). Data now exists
— 1,088 courses have parsed prereq trees (per STATUS.md).

### Drag & drop
**#3 — Drag highlights surrounding text** · `bug` · `med` · `diagnosed`
Text selection fires while dragging a card.
→ Pointer: drag layer (`lib/drag/dragState.ts`, `components/drag/DragGhost.tsx`,
`CourseCatalog.tsx`). Fix is `user-select:none` on the drag source / during
active drag. Small, self-contained.

**#4 — Failed drop animates back to the classes container** · `change` · `med` · `open`
When a drag ends outside a slot, the card should animate cleanly back into
the classes container (the "pull-out"), so it's obvious it didn't land.
→ Pointer: `dragState.ts` drop handling + `CourseCatalog.tsx`. anime.js
already in use (`lib/motion.ts`).

### Cards & visual language
**#6 — Different card shapes per class type** · `change` · `low` · `open`
Mirror the real flowcharts: shape encodes class type (core / elective /
math-science / etc.).

**#21 — Redesign class cards (too empty)** · `change` · `med` · `open`
Cards feel bare; room for more info + better visual hierarchy.
→ Pointer: `components/roadmap/SlotCard.tsx` and the catalog card. Pairs with
#6 and #17.

**#18 — Empty slot → "suggested class"** · `change` · `med` · `open`
Turn the grey backing where no card sits into a clear "suggested class"
affordance instead of dead space.
→ Pointer: `SlotCard.tsx` empty state. Supports the north star (removes
"what goes here?" doubt).

### Legend & class states
**#9 — Remove "waived", add red "unavailable"** · `change` · `med` · `diagnosed`
Drop the waived state; add a red "unavailable" = can't take due to missing
pre/co-reqs.
→ **Caution: `waived` is deeply wired.** `waivedSlotIds` appears in
`lib/schemas.ts` (+ `firestore.rules` cap of 150), `contexts/PlanProvider.tsx`
(toggleWaived, persistence, migration), `hooks/useMajorMatch.ts`,
`services/plans.ts`, `TopBar.tsx`. This is a data-model migration, not a
label swap — plan documents in Firestore carry `waivedSlotIds`. Scope
carefully. "Unavailable" is *derived* (from #10's engine), not user-set, so
it's a different kind of state — don't just rename the field.

**#24 — Expand the class legend** · `change` · `med` · `open`
More states / niches students actually need (beyond complete/available).
Depends on #9 and #10 landing first so the legend reflects real states.

### Navigation & pages
**#7 — "Your plans" selector opens behind the grid** · `bug` · `high` · `diagnosed`
The plan switcher panel renders under the card grid — z-index/stacking issue.
→ Pointer: `components/layout/RightSidebar.tsx` (panel + backdrop, anime.js)
vs the canvas stacking context. Check z-index and whether the panel is inside
a transformed/positioned ancestor that traps it.

**#8 — Account / settings peek (bottom-left)** · `feature` · `med` · `open`
Standard app-shell move: clickable account chip bottom-left → settings/profile
peek. (Note: "check house-standard" — assume a reference design Michael has in mind;
confirm which.)
→ Pointer: `components/layout/LeftSidebar.tsx` / `AppShell.tsx`.

**#11 — Classes page (full directory)** · `feature` · `med` · `open`
A complete course directory as its own page.
→ Pointer: new route; data via `services/catalog.ts`. Foundation for #12/#13.

**#12 — Filters in the class side-peek** · `feature` · `med` · `open`
Filter by many options: type, whether it matters for your major, etc.
→ Pointer: `components/catalog/CourseCatalog.tsx` + `hooks/useCourseSearch.ts`.

**#13 — Favorites system** · `feature` · `med` · `open`
Save classes to revisit later.
→ Pointer: new state slice + persist on profile (`services/profile.ts`).

### View controls & theming
**#15 — Zoom-out in grid view** · `feature` · `med` · `open`
→ Pointer: `components/roadmap/RoadmapCanvas.tsx`.

**#16 — Dark mode + hover polish** · `change` · `med` · `open`
Scrollbars in dark mode, hover-on-class in the side-peek, and hover anims
generally need refinement.
→ Pointer: `styles/tokens.css`, `store/useThemeStore.ts`, per-component hover.

**#20 — Polish top toolbar UI** · `change` · `med` · `open`
→ Pointer: `components/layout/TopBar.tsx`.

### Class detail
**#17 — Click a class → full detail** · `feature` · `med` · `open`
Detail side-peek or modal with everything about a course. Central to reducing
doubt (north star).
→ Pointer: new panel; hangs off catalog + `SlotCard` click.

### Catalog data
**#2 — Un-grey non-engineering classes / real names not "11x"** · `change` · `med` · `open`
Now that the catalog is large, replace grey "11x"-style placeholders with the
actual class. No reason to keep placeholders.
→ Pointer: check catalog seed data and how placeholder slots are rendered
(`CourseCatalog.tsx`, program templates). May be a seed/data fix, not UI.

### Onboarding
**#26 — Blank-canvas / start-from-scratch option** · `feature` · `med` · `open`
Offer an empty canvas like the previous app, for people who want to build
from zero rather than a template.
→ Pointer: `components/roadmap/FirstRun.tsx` + plan initialization in
`PlanProvider.tsx`.

**#25 — Reset "clear everything" button mis-styled** · `bug` · `med` · `open`
On reset, the "clear everything" button is grayed / not styled properly.
→ Pointer: the reset confirmation UI (find the reset/clear dialog; likely
`TopBar.tsx` or a dialog component) — button variant/disabled styling.

---

## Later / future ideas (logged, not scheduled)
- **#14** — Bring in RateMyProfessor + other sources for rankings/reviews;
  centralize class picking. Data pipeline + licensing questions.
- **#19** — Auto-fill / "explore different options" generator (suggest a
  valid plan or alternatives).
- **#27** — Compare plans/majors directly, by the classes a student is
  interested in taking. Big differentiator; sits squarely on the north star.

---

## Cross-cutting notes for the fix session
1. **Dependency chain:** #10 (surface engine) → unlocks #9 ("unavailable"
   state) → feeds #24 (legend). Do them in that order.
2. **#22 and #1/#23** are the same auth surface — batch them.
3. **#3, #4** are both drag-layer; batch in one drag pass.
4. **#6, #17, #18, #21** are one visual-language pass on the card.
5. **#9 is the only data-model risk** in the batch — everything else is UI or
   additive. Treat with a migration mindset.
