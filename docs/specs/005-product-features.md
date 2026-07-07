# Spec 005 — Product Feature Completion (Phase 4 → testable beta)

STATUS: NOT BUILT
Depends on: 002 (cloud plans), 004 (surfaces). This phase ends with testers invited.
Source: code audit (data-model gaps) + product docs, 2026-07-07.

---

## 1. Per-semester credit tracking (highest value ÷ effort)

A planner's first job: "am I at 12–18 credits, and will I hit 120?"

- Pure util `creditLoad(slots, plan): { perSemester: Map<sem, {min,max}>, total }` —
  course-kind slots use snapshot credits; filled elective/pattern slots use the placed
  course's credits; unfilled slots contribute a configurable estimate (default 3,
  shown as "~"). Unit-test against the CS program seed.
- UI: semester footer (004's `SemesterFooter`) shows `15` in `.num`; `--available-text`
  when < 12 (underload), `--destructive-text` when > 18 (overload) — with a `.t-meta`
  tooltip, not a warning banner (quiet confidence). Left rail: `Credits 62 / 120`
  progress rail beside the slots rail; `programs.totalCredits` finally used.

## 2. Major Match (the differentiator, currently a placeholder box)

- `useMajorMatch()`: for each program doc (all 4 already cached by ProgramProvider —
  prefetch the other 3 lazily after first paint): user's course pool =
  `completedSlotIds`-resolved courses + `slotSelections` values + alias-canonicalized
  (via `catalog/meta.aliases`). Score = matched required (`kind='course'`) slots /
  total required slots. Secondary signal: elective-group fits (course qualifies for a
  program's elective groups) shown as "+n electives fit", not in the primary percent.
- Rendering (004 §5, Majors tab): ranked list, `.num` percent, thin rail, expandable
  row → which specific courses matched / what's missing (top 3 unmet required courses
  as chips — each chip click-to-place armable: the loop closes).
- Recompute on plan change, memoized on (plan.updatedAt, programIds); pure function,
  unit-tested with a fixture plan.

## 3. Prereq-aware catalog + honest coreqs

- `evaluatePrereq` already works (AND/OR/course/pattern recursion). Wire it: catalog
  chips get the status dot per DESIGN.md (met = `--complete`, unmet = `--ink-4`,
  none = absent) + chip tooltip listing unmet prereqs. Completed pool for evaluation =
  completed slots' courses ∪ alias canonicalization.
- **Fix the `concurrent` no-op** (`evaluatePrereq.ts` returns `true` unconditionally):
  evaluate against (completed ∪ same-or-earlier-semester planned). Requires passing the
  candidate's target semester — signature becomes
  `evaluatePrereq(expr, completed: Set<string>, plannedBySem?: Map<string, number>, targetSem?: number)`.
- Placement warnings (informational, never blocking — matches the "arrows inform, don't
  gate" decision from session 2): placing a course whose prereqs aren't planned in
  earlier semesters marks the slot with a small `--available` dot + tooltip "MATH 1920
  isn't planned before this". A `usePlanWarnings()` hook aggregates these for the left
  rail ("2 sequencing warnings").

## 4. Waive UI (model exists, no trigger)

Slot action row (004 §2) gets `Waive` → sets `waivedSlotIds` (store logic already
mutual-exclusive with completed). Waived card: violet triad + "Waived" `.t-meta` tag.
Legend restored. That's the whole feature — it was 95% built.

## 5. Read-only share link (tester viral loop)

- `shares/{shareId}` doc: denormalized plan snapshot (program name, slots+selections,
  credits summary), `createdBy`, `createdAt`. Created client-side (rules: create-if-auth,
  immutable after, public read; `shareId` = randomUUID — unguessable). No update path —
  reshare = new link (immutability keeps rules trivial).
- Route `/s/{shareId}` (add `react-router-dom` — first real second route): read-only
  canvas render, no drag, "Make your own plan" CTA → home. OG meta tags for link
  unfurl.
- TopBar: `Share` → creates doc → copies URL, quiet toast "Link copied".

## 6. Plan management (multi-plan, model from 002)

- TopBar plan switcher: list plans (name + program shortName + updatedAt), `＋ New plan`
  (→ program picker), rename inline, delete with two-step confirm. `activePlanId` on
  profile. Custom templates stay deferred (spec 000) — a "blank plan" is just a plan
  whose program has open electives; revisit after testers.

## 7. Minimal tester telemetry (no analytics SDK)

Decision per spec 000 open question — default proposal: rely on Firestore console
queries (plans count, updatedAt recency) + a weekly manual check. If more is wanted
later, a `meta/counters` doc bumped on plan-create is the ceiling before proper
analytics. No user-behavior tracking in beta.

## 8. Beta gate (definition of "ready to hand out")

- [ ] New tester flow: link → anonymous plan in <10s → drag or tap-place a course →
      credits update → Majors tab shows live ranking → Google-link upgrade → same plan
      on second device → share link renders read-only
- [ ] All four programs load, render, and match-score correctly (spot-check ME + ORE
      against their seed flowcharts)
- [ ] Roster sync run once against dev; descriptions visible in course detail
- [ ] Rules re-tested post-shares (cross-uid write to shares must fail; share read
      without auth must succeed)
- [ ] STATUS.md + implementation-status.md updated; deploy to prod project; DEPLOY.md
      followed end-to-end once
