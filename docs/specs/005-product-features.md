# Spec 005 — Product Feature Completion (Phase 4 → testable beta)

STATUS: IMPLEMENTED (Pass B done 2026-07-07 — shares live + browser-verified
(/s/{id} read-only render, rules 29/29), plan switcher with multiple plans per
program (create/switch/delete verified), concurrent-prereq fix, prereq trees
parsed for 1,088 courses (repeatable pipeline), ALL 13 CoE majors digitized
from official 2025 flowcharts and seeded (ChemE render-verified: 47 slots,
24 edges, honest off-roster pattern slots). Existing 4 programs PASS chart
verification. Beta-gate leftovers deliberately deferred to tester-invite day:
App Check enforce (needs console reCAPTCHA registration), CSP report-only →
enforce, Michael's manual Google-login test, invite links.)
Depends on: 002 (cloud plans), 004 (surfaces). This phase ends with testers invited.
Source: code audit (data-model gaps) + product docs, 2026-07-07.
Scope revision 2026-07-07 (Michael, morning review of Phase 3): Phase 4 splits
into TWO passes. Pass A (now): §9 roadmap mutability, §10 full-catalog scrape,
§11 bucket completion, Major Match §2 to FULLY BUILT. Pass B (final): §3
concurrent fix, §5 share links, §6 plan switcher, §7 telemetry, §8 beta gate.

## 9. Roadmap mutability — slots move, leave, and join the graph (Pass A)

The original product promise (2026-05-17 handoffs, Priority 7) finally built:
the roadmap is the student's to reshape, not a fixed template.

Data (plan doc → schemaVersion 2; rules caps mirror, keep-in-sync comments):
```
slotOverrides: { [slotId]: { sem?: 1..10, removed?: true } }   # ≤ 80 keys
customSlots:   [ { id: "cus-<uuid>", sem: 1..10, title: ≤60 } ] # ≤ 40 items
```
- Effective slots = template slots (apply overrides: drop removed, remap sem)
  ∪ customSlots (synthetic generic buckets, kind 'elective', "Any course").
  One `useEffectiveSlots` merge point feeds canvas/catalog/sidebars/match.
- Edges touching removed slots vanish naturally (EdgeLayer skips unmeasured ids).
- FWS / Liberal Studies / PE stay GENERIC BUCKETS (decision 2026-07-07) —
  movable, removable, completable; a specific course is optional garnish.

Drag semantics (one system, drop target decides):
- Unfilled card (bucket/pattern/template-course) dragged → moves the SLOT;
  drop on a semester column's background (data-column) applies a sem override.
- Filled card dragged → drags the COURSE (unchanged); drop on a slot places it
  there; drop on a column background creates a custom slot in that semester and
  places the course in it (the "take it a semester later" gesture).
- Catalog chip dropped on a column background → new custom slot + placement.
- Click-to-place parity: armed course + column "+ Add a class" = same result.

UI: every card's action row gains Remove (slot leaves the graph — override
removed:true, or customSlot deleted). Every column footer gets a "+ Add a
class" ghost card. A quiet "N hidden" chip beside the column header restores
removed slots (click → list → restore). Keyboard slot-MOVE is deferred
(remove/add/restore are buttons, so keyboard-reachable).

## 10. Full-catalog scrape (Pass A — decision: scrape now)

`roster-sync.ts` expands from the hardcoded 13 engineering subjects to ALL
subjects (fetched dynamically from /config/subjects.json), runs LIVE against
degree-planner-app, regenerates catalogIndex chunks (~4–5k compact records ≈
~15 chunks — the chunk design was built for this). Hand-authored prereq/coreq
trees are preserved (merge). Buckets stay generic; the full catalog just lets
a student name their FWS/liberal-studies course when they want to.

## 11. Bucket completion (Pass A)

Empty bucket/pattern cards get the SAME action row as filled cards
(Complete / Waive / Remove) — a student finishes "First-Year Writing Seminar"
without recording which one. Credits for a completed empty bucket use the
group's min_credits (journey + semester footers already read slotCredits).

## 2b. Major Match — definition of FULLY BUILT (Pass A)

- Alias canonicalization: the pool and program requirements both map through
  catalog/meta.aliases (ENGRD-2110 ≡ CS-2110 must match either way).
- Pattern slots count: a program's pattern slot (CS-111x) is a requirement,
  matched when any pool course satisfies the pattern regex.
- Elective fit as a secondary signal: "+N of your courses fit its electives"
  (list-type qualifying rules v1), shown in the expanded row, never in the %.
- Effective slots feed the pool (removed slots' contents are gone with them).

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

## 7. Minimal tester telemetry

GA4 exists on the project (`degree-planner-app` was created with Analytics;
measurementId `G-XXXXXXXXXX`). Stance for beta:
- Analytics initializes **prod builds only**, lazily via `isSupported()` (spec 002 §2) —
  default page-view/session collection, **no custom behavioral events**.
- Primary signal stays Firestore console queries (plans count, `updatedAt` recency) +
  a weekly manual check; GA4 answers only "did testers come back."
- If more is wanted later, a `meta/counters` doc bumped on plan-create is the ceiling
  before deliberate product analytics.

## 8. Beta gate (definition of "ready to hand out")

Verification is two-stage (decided 2026-07-07): Michael self-tests on his own program
first; before links go to mixed-engineering testers, all four programs get verified to
even moderate depth against the **official 2025 flowcharts in
`docs/reference/flowcharts/`** (course-by-course: slot placement per semester, prereq
arrows and their types, elective counts). Log discrepancies as seed-data fixes in the
seed JSON + reseed — the charts are ground truth, the seed was hand-approximated.

- [ ] New tester flow: link → anonymous plan in <10s → drag or tap-place a course →
      credits update → Majors tab shows live ranking → Google-link upgrade → same plan
      on second device → share link renders read-only
- [ ] All four programs verified against docs/reference/flowcharts/ (per above)
- [ ] Roster sync run once against dev; descriptions visible in course detail
- [ ] Rules re-tested post-shares (cross-uid write to shares must fail; share read
      without auth must succeed; forged `createdBy` must fail)
- [ ] Pre-tester security pass per spec 002 §8f: re-audit against the vault 50-point
      checklist subset, numbered findings with file:line, one commit per fix
- [ ] STATUS.md + implementation-status.md updated; deploy to prod project; DEPLOY.md
      followed end-to-end once
