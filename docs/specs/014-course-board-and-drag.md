# Spec 014: Course board & drag

STATUS: IMPLEMENTED (2026-10-09 — built on fix-pass-2026-10, live on degree-planner-app.web.app;
rules EXPAND→CONTRACT deployed; e2e 11/11 on production. DEFERRED: gliding cards, dnd-kit fallback)
Depends on: nothing unbuilt. Uses spec 011's `majorMatch.assign()` and spec 008's derived edges as they are.
Supersedes:
- spec 009 §2/§5's slot-replace drop semantics;
- spec 004's slot-as-container board model;
- the fix plan in `docs/audits/2026-07-12-drag-system-audit.md`, absorbed into §D3.

Inputs:
- `docs/audits/2026-10-09-bug-sweep.md` (live reproduction of the drag failures);
- `docs/audits/2026-10-09-dnd-library-research.md` and `docs/audits/2026-10-09-dnd-landscape-research.md` (build vs buy).

## Why this shape

Drag has been broken since the project began, and the 2026-10-09 sweep showed why it kept *feeling* random:

- **Two different drags behind one look.** A card showing a template default dragged as a *requirement*: the slot moved, and
  it could only drop on a column. A card holding a course the user placed dragged as a *course*. The course moved, its slot
  stayed, and the slot's template default re-appeared (the "duplicate", sweep D9).
- **Concrete engine defects on top of that:**
  - a commit guard keyed on course id and never reset (sweep D3, "works once, then locked"; `dragState.ts:91`,
    `DragGhost.tsx:143`);
  - catalog drags that never start (D4);
  - whole-canvas text selection (D6);
  - a click firing after a drag;
  - a drag preview not scaled to the canvas zoom.

Every drop rule we tried to write on top of slots locked the user into something. The resolution came from Michael:
**a requirement is an attribution, not a container.** The board holds courses. Each course is *labelled* with what it
counts toward, using the position-independent matcher that spec 011 already ships. What's still unmet lives in a checklist,
not in empty cards. Once slots stop being containers, the drop semantics become simple: a drop inserts a course at a
position.

Both research passes, one with candidates handed to it and one without, concluded that our existing engine
architecture is the right one for a zoomed canvas: a fixed-position preview rendered at the top level, and hit-testing
with `elementsFromPoint`. Every library trades our known, located defects for a new set of gaps. So the engine is
repaired, not replaced.

## DECIDED

### D1. The board holds courses; requirements are attribution
A semester column is an ordered list of **placements**. Nothing else is drawn on the board: no empty requirement cards and
no template defaults. Requirement satisfaction comes from `majorMatch.assign(courses, requirements)`, fed by
`programToRequirements`, which is position-independent. Each placed card shows what it counts toward, and courses that
count toward nothing are shown as such.

- *Rejected: the card as requirement plus course together (an earlier draft of this decision).* It fixes the drag split,
  but filling a requirement in another semester leaves an orphan slot.
- *Rejected: courses move and requirements stay put.* Every move leaves an empty card behind.
- *Rejected: keep today's split and fix only the duplicate.* It keeps two kinds of drag hidden behind one look.
- *Rejected (Q5): placeholders stay on the board as plain cards.* Stale "covered" placeholders accumulate.
- *Rejected (Q5): placeholders auto-generated and auto-removed.* Cards would appear and vanish on their own, so the app
  decides things for the user.

### D2. The "Still needed" panel replaces the legend and slot-based progress in the left sidebar
- **Content:** grouped by requirement category (from slot categories, spec 006 D1), each with progress ("CS electives · 1
  of 3"). A sort toggle switches to **by suggested semester**. Satisfied requirements collapse into "Satisfied (N)", each
  naming the course that covers it.
- **Clicking a requirement:** if it's covered, the covering card or cards highlight on the board. If it's unmet, the
  catalog opens filtered to courses that would satisfy it.
- **Waiving** a requirement happens here. Waivers are keyed by requirement id.
- **What stays in the sidebar:** navigation, the journey progress (credits), the timeline, the Major Match teaser, My credits
  and Sign in.
- **Legend:** it moves to a **help button in the top bar** that shows the legend on hover or click.
- **Design requirement:** a new user's board is thin by design (D6). The panel must make that read as "your choices go
  here", not as "broken".

*Rejected:* a flat to-do list as the default, because it loses the category counts (kept as the sort option); two tabs,
because they hide progress behind a click.

### D3. Repair the hand-built drag engine; no new dependencies
- **One shared `useDragSource` hook.** On `pointerdown` it attaches *document-level* `pointermove`/`pointerup` listeners
  for the 6px threshold, then detaches them; this is the window-listener pattern proven in a prior project's production grid. It replaces the duplicated logic in `SlotCard.tsx` and `CourseCatalog.tsx`. Cards and catalog rows
  start drags identically.
- **A unique id per drag session** (`dragState` mints one at start). The commit guard keys on it, which ends "works once,
  then locked".
- **Canvas** gets `user-select: none`. Text inside the detail panel stays selectable.
- **The click synthesized after a real drag is suppressed**, so a plain click still opens the detail panel.
- **The drag preview renders at the canvas zoom.** It already lives in a fixed-position portal; it now gets
  `scale(zoom)`.
- **The anime.js feel is kept unchanged:** zero-latency `createAnimatable` tracking, velocity tilt and spring snap. One
  tune is applied: the snap spring gets an explicit settle duration (July audit §6). The commit stays **synchronous**, with
  the animation as decoration only (spec 009 §5).

*Rejected:* `@dnd-kit/react` now (see DEFERRED for the trigger that revisits it); repairing the engine *plus* gliding
neighbour cards in the same pass (DEFERRED).

### D4. A drop inserts at a position, shown by a placeholder outline
A drop target is a position in a column. While hovering, a dashed card-sized outline appears at the insertion point and the
preview springs into it. Cards below make room instantly, with no animation in this pass. Dropping in the empty space below
a column appends. Catalog drops insert the same way. Nothing is ever replaced by a drop.

*Rejected:* an insertion line only, because there's no snap and it's easy to miss at 55% zoom; animated gap-opening now,
which is DEFERRED.

### D5. Clean placement data model; no migration
Michael confirmed that no real saved plans exist, so the model is redesigned rather than adapted:

```ts
type Placement = { id: string; courseId: string; sem: number; order: number };
// plan doc
placements: Placement[]        // cap ~80, mirrored in firestore.rules
completedIds: string[]         // placement ids
inProgressIds: string[]        // placement ids
waivedRequirementIds: string[] // requirement ids
// removed: slotSelections, customSlots, slotOverrides, completedSlotIds,
//          inProgressSlotIds, waivedSlotIds
```

`schemaVersion` is bumped. A plan loaded with an older version resets to the chosen major's starting board (D6). Run
`scripts/backup-plans.ts` once before deploying.

*Rejected (Q8):* converting on load with a backup, keeping both shapes for a release, or a one-shot admin conversion. All
three are moot without user data. *Rejected (Q9):* reusing `customSlots` and `slotSelections` as placements, because the
names would lie permanently in a public repo; and a placement type over the old storage, because it means a translation
layer forever.

### D6. Picking a major places only fixed single-course requirements
`course`-kind requirements (MATH 1910, CS 2110, …) become placements in their suggested semesters. Every
choice-bearing requirement goes to the checklist, including two-way choices like CS 111x. The app never picks for the user.

*Rejected:* placing a suggested pick for small choices, because the app would still decide; an empty board with a "place
required courses" button, because it delays the product's best first impression.

### D7. Keyboard and touch
- **Keyboard:** every card's "⋯" menu gains **Move to…**, which picks a semester and puts the course at the top or bottom of
  that column. It calls the same move function as drag.
- **Touch:** a long-press of about 250ms starts a drag. Cards get `touch-action: none` only once a press is held, so a
  plain swipe still scrolls the canvas. iOS callout and selection are suppressed during the press.

*Rejected:* full keyboard drag (lift, arrows, drop, with announcements), because it's the most work for the fewest users of
a desktop tool and enlarges the engine; desktop-only with no touch drag, because it makes the core interaction menu-only on
tablets.

### D8. One removal action, with undo
Without slots, "Remove from roadmap" and "Take the course out" collapse into a single **Remove from board**, with an Undo
toast. Moves have no undo, because dragging back reverses them.

### D9. Corequisite connector
When two corequisites are stacked in the same column, the edge between them is drawn as a short straight connector from the
bottom-middle of the upper card to the top-middle of the lower card. This replaces today's dashed side loops (spec 008's
EdgeLayer).

## Architecture / substrate

| Exists, reused | New / changed |
|---|---|
| `majorMatch.assign` / `programToRequirements` (spec 011), course→requirement attribution | `Placement` model and plan normalizer for the new `schemaVersion` |
| `dragState` singleton, `DragGhost` (anime.js), AppShell document listeners and edge auto-scroll | `useDragSource` hook; a per-drag session id; insertion-position hit-testing in place of slot hit-testing |
| `elementsFromPoint` hit-testing, fixed-position preview portal | Placeholder outline element; preview `scale(zoom)` |
| Status engine (`computeSlotStatusMap`), run per entry | Fed placements in place of slots; status keyed by placement id |
| Spec 008 derived edges (`deriveEdges`) | Corequisite connector geometry (D9) |
| Catalog "For my major" filter | Requirement-scoped catalog filter (D2) |
| — | "Still needed" panel; legend help popover; **Move to…** menu item |

**Rules change: yes.** The plan document shape is rewritten. There are no new collections and no new roles; plans stay
owner-only. Per the standing practice, rules are deployed **before** the app, with a rules-test case for every new field
and the field caps mirrored in `schemas.ts`.

## States and edge cases

| Case | Behavior |
|---|---|
| New user picks a major | Fixed courses placed; checklist shows choice requirements; panel copy frames empty space as "your choices" |
| Course counts toward nothing in this major | Card shows no requirement label (or "not counting toward your major"); it still drags and evaluates prereqs |
| Same course placed twice | Second placement is allowed (retakes happen); attribution counts it once (matcher consumption) |
| Placement cap (~80) reached | Drop or catalog add refused with a toast; never silent |
| Save fails (rules reject, offline) | Optimistic change rolls back **with a toast** (standing rule from July: silent ~300ms rollbacks shipped twice) |
| Drag cancelled (Esc, pointercancel, drop outside the canvas) | Preview returns to origin; no commit; `dragState.end()` on every exit path |
| Same card dragged twice in a row | Both moves commit (regression test for sweep D3) |
| Press shorter than 6px | Click opens the detail panel; no drag |
| Drop at 55% zoom | Outline and preview align with cards; hit-testing correct |
| Older-`schemaVersion` plan loaded | Reset to the major's starting board (no conversion; no real plans exist) |
| Requirement waived | It leaves "Still needed" and appears under Satisfied as "waived" |

## Testing

**Pure, unit-tested:**
- placement insert, move and reorder (`order` renumbering);
- the plan normalizer, including resetting an older `schemaVersion`;
- requirement attribution adapters (placements → `MatchCourse[]`);
- checklist grouping and sorting;
- corequisite connector geometry.

**Real-mouse Playwright regression suite** (stepped `page.mouse`, which reproduces real drags per the July audit):
1. card → a different column, at a specific position;
2. catalog row → a column position;
3. the **same card moved twice** in a row;
4. a different card after that;
5. a sub-threshold press opens the detail panel;
6. no text selection after a press-drag on the canvas;
7. 1–4 repeated at 55% zoom;
8. **Move to…** from the keyboard.

Rules tests cover the new plan fields, their caps and owner-only access.

## DEFERRED

- **Gliding neighbour cards (FLIP).** Cards slide to open the gap while hovering and settle after a drop. It's planned as the
  next polish pass. The D4 outline is its base, since the animation just smooths the same shifts. Deferred so the basic
  drag is proven reliable first.
- **`@dnd-kit/react` as the engine fallback.** *Trigger:* after this ships, the repaired engine produces another
  drag-start or commit bug, or long-press can't be made reliable on iOS. Notes for that day: pin an exact version, it's
  0.x; test zoom first, since that's its weakest point; keep the anime.js preview inside its `DragOverlay`.

## Dependencies and blast radius

- **New dependencies:** none.
- **About 25 files touched**, mostly the slot→placement rename, among them:
  - `PlanProvider`, `normalizePlan`, `schemas.ts`, `services/plans.ts`;
  - `SemesterColumn`, `SlotCard` (becoming the course card), `CourseCatalog`, `AppShell`, `DragGhost`, `dragState`;
  - `LeftSidebar`, `TopBar`;
  - `useSlotStatus`, `useEnrichedPlan`, `useDerivedEdges`, `useHorizonMap`, `useMajorMatch`;
  - `computeSlotStatusMap`, `buildPlacements`, `seedPlanFromPrevious`, `matchAdapters`, `importLocalPlan`;
  - `ShareView`, `CompareModal`, `CourseDetailPanel`.
- **Shared primitives:** the toast (Undo on removal already exists); EdgeLayer (connector geometry).
- **Rules:** the plan document allowlist is rewritten and deployed first; `rules-tests` updated.
- **Shares:** existing share snapshots are immutable documents in the old shape. ShareView must render a share written
  before this change, or such shares must be treated as expired. *Decided:* ShareView reads both shapes. It's read-only, so
  this is a small adapter, and no data is rewritten.

## Surfaced, not created, by this spec

Each is recorded where it belongs, not fixed here:
- **Data track:**
  - CHEM 2090 shows "Credit is given for only one of this and CHEM 2091". They're a lecture and its lab, so it's a likely
    forbidden-overlap import bug.
  - All prereq-audit fixes F2–F8 (`docs/audits/2026-10-09-prereq-accuracy-audit.md`).
- **Bug list** (`docs/audits/2026-10-09-bug-sweep.md`):
  - AP credit saves but has no visible effect;
  - catalog search ranking ("CS 3" ranks BCS 3302 above CS 3110);
  - low-contrast empty-card text;
  - the 55% zoom button overlapped by the collapsed panel's container;
  - InfoSci column headers disagree with the footer credit totals;
  - the `/classes` page title never updates.
- **Public mirror:** the new spec is classified when it's published. Add it to `publish/include.txt` once the
  prerequisite-data references in it are confirmed public-safe.

## Cross-references

- Supersedes (partially): spec 009 §2/§5 slot-replace semantics; spec 004 slot-container board; the July drag audit's fix
  plan.
- Consumes: spec 011 (`majorMatch`), spec 008 (derived edges), spec 006 D1 (slot categories → checklist groups).
- Living status: `docs/reference/implementation-status.md`.

## Build notes & deviations (2026-10-09)

- **Rules shipped expand-then-contract.** Local QA had to write new-shape plans to the single live project, so
  rules accepting BOTH shapes deployed first, then the app, then a CONTRACT deploy to placement-only rules.
  Rules tests were mutation-checked after CONTRACT.
- **The engine-internal "slot" type kept.** The status engine, derived edges and horizon still take
  `ProgramSlotWithData`, fed one synthesized entry per placement by `lib/planner/board.ts` (`useBoard`). Stored
  data and UI are slot-free; renaming the engine types is a follow-up refactor.
- **"Move to…" options.** Each semester appends to the bottom of that column; a separate "Top of this column" item
  moves the card to the top of its current column (not a top/bottom choice per semester).
- **Unscorable requirements.** Elective pools with list/category rules (42 groups) can't be evaluated client-side;
  `RequirementItem.checkable` marks them and the panel says "Can't check this automatically — confirm with your
  advisor".
- **A new board starts with red cards for CS 2110/CS 2800** ("Needs CS 111x first") because CS 111x is a choice
  (checklist, D6) and the stored prereq is an authored pattern leaf. Fixed by the prerequisite-data track (audit
  F2/F7), not here.
- **Known polish, not fixed:** the "Add a class" suggestion popover doesn't close on Esc; the card menu reads
  "Mark complete" even when the card is completed (the corner pill toggles correctly).
- **Also landed in this pass (bug list, outside the spec):** ranked catalog search, per-route page titles, AA
  contrast for the low-emphasis ink tokens, credit-covered course status ("Covered by your AP credit") and credit
  in the journey total, and one column-credit computation for header and footer.

