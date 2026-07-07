# Spec 006 — Bug-Triage Workplan (six packages) + State Model & Engine v2

STATUS: PARTIAL (spec'd 2026-07-07 from docs/audits/2026-07-07-bug-triage.md;
packages A and B are this session's implementation targets, C–F are scoped
plans of action for future sessions. Update per-package status below as they
land.)
Depends on: 005 (Pass B live). Source: bug triage 2026-07-07 (27 items +
#9b + #28), Michael's design decisions this session.

North star (every item measured against this): "How can we make picking a
major the easiest, and remove as much doubtfulness and worry from a
student's path as possible?"

## 0. The six packages (plans of action)

| Pkg | Theme | Triage items | Status |
|-----|-------|--------------|--------|
| A | Quick-fix bug pass | #3, #7, #22, #25, #2 | NOT BUILT — this session |
| B | State model + engine surfacing | #28, #10, #9, #9b, #24, #5 (canvas half) | NOT BUILT — this session |
| C | Auth & save flow | #1, #23, #8 | NOT BUILT |
| D | Card visual language + course detail | #21, #6, #18, #17, #5 (tree half) | NOT BUILT |
| E | Directory & discovery | #11, #12, #13 | NOT BUILT |
| F | Canvas & polish | #4, #15, #16, #20, #26 | NOT BUILT |
| — | Deferred (logged, not scheduled) | #14, #19, #27 | DEFERRED |

Dependency notes: B's legend (#24) lands last inside B. D's tree view (#17)
consumes B's engine output. E's favorites (#13) implements the state
reserved in §1. C is independent. F items are independent of everything.

## Package A — Quick-fix bug pass (this session)

Five self-contained fixes, all diagnosed in the triage doc:

- **A1 (#3)** Drag highlights surrounding text → `user-select: none` on the
  drag source / body during active drag. `lib/drag/dragState.ts`,
  `components/drag/DragGhost.tsx`, `CourseCatalog.tsx`.
- **A2 (#7)** "Your plans" selector opens behind the card grid → z-index /
  stacking-context fix. `components/layout/RightSidebar.tsx` vs canvas;
  check for a transformed/positioned ancestor trapping the panel.
- **A3 (#22)** "Save your plan" sticks on "Signing in…" after popup cancel →
  missing catch/finally clearing the loading flag when the popup promise
  rejects. One reset in the shared sign-in handler, `TopBar.tsx`.
- **A4 (#25)** Reset dialog's "clear everything" button grayed/mis-styled →
  button variant fix in the reset confirmation UI (likely `TopBar.tsx` or a
  dialog component).
- **A5 (#2)** Remove CS "111x"-style placeholder slots now that the real
  courses exist in the 4,472-course catalog → seed/template data fix: find
  the placeholder pattern slots in the program templates and swap for the
  real CS courses. Data change, verify the affected majors still render.

## Package B — State model + engine v2 (this session)

The #28 brainstorm output. One state model that #9, #9b, #10, #24, and the
canvas half of #5 all implement against — so the legend is built once.

### 1. State model (decided 2026-07-07)

Manual states — user-set, persisted on the plan doc:
- **Complete** — existing `completedSlotIds`, unchanged.
- **In progress** (NEW) — "currently taking." New `inProgressSlotIds`
  array (cap 150, additive, defaults `[]`). Counts toward prereqs of later
  semesters (already true of any planned course — no evaluator change).
  Progress displays count it separately ("42 earned + 16 in progress");
  it does NOT count as earned credits.
- **Waived** — KEPT exactly as-is in data (`waivedSlotIds`, all counting
  logic untouched). The action is demoted (#9b): removed from the primary
  card action row, relocated to an overflow "⋯" menu on the card. Waived
  remains the only way to mark an empty requirement bucket satisfied.
- **Favorited** — RESERVED. Lives on the course (profile-level), not the
  slot. Implemented with package E (#13). Listed here so the legend design
  accounts for it once.

Derived states — engine-computed, never persisted:
- **Available** — placed, nothing blocking.
- **Blocked / unavailable** (#9's red state) — `prereq === false` OR
  `coreq === false`. Derived, user cannot set it. Do NOT repurpose the
  waived field for this.
- **Warnings** (amber, non-blocking):
  - **Wrong term** — the course's `offered` array (FA/SP/SU/WI tokens,
    already populated by roster-sync from `lastTermsOffered`) does not
    include the placed semester's term. Semester → term mapping: odd
    columns = FA, even = SP. Empty `offered` → no data → no warning.
  - **Semester overload** — column credit total exceeds a cap
    (constant `MAX_SEMESTER_CREDITS = 20`, one place, tunable).

Card display precedence: Complete > In progress > Waived > Blocked (red) >
Warning (amber) > Available.

### 2. Engine — unified status map

`lib/planner/computePrereqStatusMap` grows into `computeSlotStatusMap`:

```
statusMap: Map<slotId, {
  prereq:    true | false | null,   // null = no course / no expr
  coreq:     true | false | null,   // NEW — evaluates coreqExpr for real
  offeredOk: true | false | null,   // NEW — term match, null = no data
  blocked:   boolean,               // prereq === false || coreq === false
}>
semesterCredits: Map<sem, number>
```

- Coreq satisfaction reuses the existing recursive evaluator with the
  same-or-earlier-semester pool (concurrent semantics: a coreq planned in
  the same column satisfies it). Today `coreqExpr` is stored on every
  course but never evaluated — this wires it.
- One hook (`useSlotStatus` or extended `useEffectiveSlots`) feeds
  RoadmapCanvas, SlotCard, EdgeLayer, catalog chips, and the legend.
  Nothing else computes state.
- Unit tests on `computeSlotStatusMap`: coreq met/unmet/concurrent,
  offered match/mismatch/no-data, credit totals, blocked composition.

### 3. UI surfacing (#10 "where is my engine?", #9, #9b)

- **SlotCard blocked**: red status rail + red-tinted card + a message that
  NAMES the missing course(s) — "Needs CS 2110 first" — extracted from the
  unmet leaves of the prereq/coreq tree. Replaces the 12px amber triangle.
  Same data, amplified: this is the entire answer to #10.
- **Action row**: Complete / In progress / Clear primary; Waive/Unwaive in
  the "⋯" overflow (toggle stays `toggleWaived` in PlanProvider).
- **EdgeLayer**: edges feeding a blocked slot render red; coreq
  double-lines reflect evaluated state. Existing hover-chain highlight
  stays; unmet segments in the chain show red.
- **Catalog chips**: same red/amber/green vocabulary as the canvas.
- **SemesterColumn header**: shows the column's credit total; amber past
  the cap.
- **Legend (#24)**: rebuilt once from the unified map — Complete ·
  In progress · Waived · Available · Blocked · Warning.

### 4. #5 split — canvas now, tree with #17

Canvas half (in B): state-colored edges, real coreq evaluation, louder
unmet treatment (above). Tree half (in D/#17): course detail panel shows
the full recursive prereq tree from the 1,088 parsed trees for any course,
placed or not. Not built this session.

### 5. Migration & safety

Purely additive — no destructive migration, no schemaVersion bump
(new field defaults `[]`, old docs pass through):
- `inProgressSlotIds` joins `PlanSchema`, `ShareSchema`,
  `normalizePlan`, `ShareView` counting, and `firestore.rules` (cap 150,
  keep-in-sync comments like the sibling arrays).
- Rules must be DEPLOYED with hosting (the Pass B lesson — rules written
  but not pushed fail closed).
- Security-rule tests add cases for the new field (valid, oversized,
  wrong-type).

### 6. Build order within B

1. Engine: `computeSlotStatusMap` + unit tests (pure logic, no UI risk).
2. Surfacing: SlotCard red/blocked + named-missing-course message,
   EdgeLayer red edges, catalog chips, column credit totals.
3. In-progress state: schema + rules + rules-tests + action row + counts.
4. Waive demotion to overflow menu.
5. Legend rebuild, last, once all states are real.

## Package C — Auth & save flow (future session)

- **#1 login page** (high): Google sign-in plumbing exists
  (`AuthProvider.tsx`, `services/auth.ts`) — build the UI surface. Decide
  entry points: TopBar CTA + gated actions (save/share) funnel to it.
- **#23**: signed-out "Save your plan" gets a tooltip/state reading
  "sign in first" (same button as A3's fix — coordinate).
- **#8**: plain account button, bottom-left of the left sidebar
  (reference: house-standard — nothing fancy). `LeftSidebar.tsx` / `AppShell.tsx`.

## Package D — Card visual language + course detail (future session)

One cohesive design pass; run brainstorming on the card design first:
- **#21** cards feel empty → richer hierarchy (credits, term chips from
  `offered`, status from B's map).
- **#6** shape per class type (core / elective / math-sci), like the paper
  flowcharts. Low sev; ride along with #21.
- **#18** empty slot → explicit "suggested class" affordance instead of
  dead grey.
- **#17** click a class → full detail side-peek/modal: description,
  credits, offered terms, prereq TREE (the #5 tree half, consumes B's
  engine), major-match relevance. Central to the north star.

## Package E — Directory & discovery (future session)

- **#11** Classes page: full-directory route over `services/catalog.ts`
  (4,472 courses; the catalogIndex chunks already exist for search).
  Foundation for the rest.
- **#12** side-peek filters: type, offered term, major-relevance;
  `useCourseSearch.ts` grows filter params.
- **#13** favorites: course-level, persisted on profile
  (`services/profile.ts`), star affordance in catalog/directory/detail;
  implements the state reserved in B §1. Waive-from-directory ("I have
  credit for this") also belongs here per #9b's note.

## Package F — Canvas & polish (future session, items independent)

- **#4** failed drop animates the card back into the catalog (anime.js,
  `lib/motion.ts` + `dragState.ts`).
- **#15** zoom-out control in `RoadmapCanvas.tsx`.
- **#16** dark-mode scrollbars + hover polish (`styles/tokens.css`).
- **#20** top toolbar polish (`TopBar.tsx`).
- **#26** blank-canvas / start-from-scratch onboarding path
  (`FirstRun.tsx` + plan init in `PlanProvider.tsx`).

## Deferred (logged, not scheduled)

- **#14** external reviews/rankings (RateMyProfessor etc.) — licensing +
  pipeline questions.
- **#19** auto-fill / plan generator.
- **#27** compare plans/majors by classes of interest — big north-star
  differentiator, needs its own brainstorm when scheduled.
