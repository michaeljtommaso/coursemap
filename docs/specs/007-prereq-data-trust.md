# Spec 007 — Trustworthy Prerequisite Data + State Model v3

STATUS: IMPLEMENTED (code; 3 gated data ops pending) — built 2026-07-11 on impl-007-013;
see docs/reference/implementation-status.md. (Designed 2026-07-11, brainstorm session with Michael;
approved section-by-section)
Depends on: 006 (state model v2 is the base being extended).
Blocks: 008 (the living graph must not be built on lying data), 011 (the
matcher consumes the credit profile and the single satisfaction function).
Source: docs/audits/2026-07-11-vision-gap-and-graph-audit.md (#4, #10, #11,
#12, C1), docs/audits/2026-07-11-product-thesis.md, triage 2026-07-07 #28.

North star: "How can we make picking a major the easiest, and remove as
much doubtfulness and worry from a student's path as possible?" A prereq
engine that falsely blocks the modal engineering freshman (34% of prereq
texts carry "or equivalent AP credit" that we strip into hard blocks) is
manufacturing doubt, not removing it. This spec is the trust layer under
everything else.

## 0. Summary of decisions (made 2026-07-11)

| Decision | Choice |
|---|---|
| AP/transfer/placement credit | Credit profile (user input, synthetic courses) + advisory prereq state — both layers |
| Advisory prereqs | New node type emitted whenever the parser strips a non-course alternative |
| Parser write gate | Inverted: only `clean` commits; `partial` quarantined |
| Authored-vs-parsed nulls | New `prereqSource` field; authored data is never overwritten |
| Satisfaction logic | ONE function in `lib/planner/`, consumed by every surface |
| Forbidden overlaps | Ingested, self-stripped, surfaced as a plan warning |
| Waive | Kept as legacy fallback, stays demoted; credit profile is the primary "I already have this" mechanism. Never re-promote. |

## 1. State model v3 (extends spec 006 §1; answers triage #28 fully)

Two families that never mix. Manual states are user-set and persisted;
derived states are engine-computed and never persisted.

### 1a. Manual states (user-set)

- **Complete** — `completedSlotIds`, unchanged.
- **Currently taking** — `inProgressSlotIds`, unchanged.
- **Waived** — `waivedSlotIds`, kept exactly as-is in data and demoted in
  UI (overflow menu only). Context recorded from Michael: students who
  don't need a class simply won't place it — waive exists mainly for the
  "loaded a template, don't want to fight it" flow. It is a legacy
  fallback. No new UI investment; nothing new may build on it.
- **Credit profile** — NEW, and the headline of this spec. See §2.

### 1b. Derived states (engine-computed)

- **Met** — prereqs satisfied by strictly-earlier-semester courses
  (planned / in-progress / completed) or by the credit profile.
- **Advisory** — NEW. The prereq tree contains an `advisory` node that is
  not satisfied by the plan. Rendered as a quiet informational treatment
  ("Usually needs MATH 1910 — AP credit also counts"), never red, never
  the word "blocked." A card with only unsatisfied advisory nodes is NOT
  blocked.
- **Blocked** — a genuinely hard prereq is unmet. Red treatment stays,
  but after this spec it only appears where it is the truth.
- **Overlap warning** — NEW. Two courses on the plan appear in each
  other's forbidden-overlap sets ("Credit is only given for one of
  CS 1110 and CS 1112"). Advisory tone, amber-family, never blocking.
- **No data** — course has no prereq information (`prereqSource: none` or
  an unparseable text). The card shows nothing. We do not pretend.

Legend and card treatments extend the spec 006 legend; the new states are
additive. Overlap and Advisory both need distinct visual language from
Blocked — this is a hard requirement, because the entire point is the
difference between "you cannot" and "heads up."

## 2. The credit profile (fixes #12, the blocker)

### 2a. Model — exam as synthetic course

A student records the credit they arrived with, once. Each recognized
credit maps to one or more **synthetic course IDs** (e.g.
`credit:ap-calc-bc-5` → satisfies as `MATH 1910`-equivalent). Synthetic
courses are injected into the evaluation pool exactly like completed
courses — the prereq evaluator and the major matcher never learn that
exams exist. 

- New profile field `creditProfile: CreditEntry[]`, where
  `CreditEntry = { id, kind: "ap" | "ib" | "transfer" | "placement",
  label, satisfiesCourseIds: string[], credits?: number }`.
- The AP/IB → Cornell equivalency table is authored by us from Cornell's
  **published** credit tables (public university pages, facts not
  expression). Stored as seed data
  (`scripts/seed-data/credit-equivalencies.json`), versioned by catalog
  year from day one.
- Transfer credit (arbitrary outside courses) is entered as "counts as
  <Cornell course>" picked from the catalog — same synthetic mechanism.
- Firestore: `creditProfile` on the profile doc (not the plan — credit
  follows the student across plans). Rules cap the array (~60 entries)
  and validate shape, following the existing rules style.

### 2b. Entry points

- An **onboarding step** in the two-doors first-run flow (spec 011 §4):
  "Did you come in with AP/IB/transfer credit?" — skippable, searchable
  checklist of common AP exams, never a wall.
- Always editable later from the account/profile surface.
- Cards in Advisory state deep-link to it: "Have AP credit? Add it" —
  the moment a student sees an advisory prereq is the moment they care.

### 2c. Effect

- Prereq evaluation: synthetic courses join the completed pool in the
  single satisfaction function (§4). A hard prereq satisfied by a
  synthetic course renders Met, with the detail panel noting "satisfied
  by your AP credit."
- Major matching (spec 011): synthetic courses count identically for
  every program — no bias. Credits attached to a CreditEntry count
  toward credit totals where Cornell's published table grants credit.

## 3. Parser overhaul (fixes #4/#10 and the #12 parser half)

All in `scripts/prereq-grammar.ts` + `scripts/parse-prereqs.ts`.

1. **Advisory node type.** `PrereqExpr` gains
   `{ type: "advisory", expr: PrereqExpr, note: string }`. Emission rule:
   when noise-stripping removes ≥1 alternative from an OR group, the
   surviving expression is wrapped in `advisory` with the stripped prose
   preserved as `note` (e.g. "or equivalent AP credit"). A one-child OR
   collapse therefore can never mint a hard requirement.
2. **The e.g./i.e. rule.** Never emit a prereq node from a course code
   inside an `e.g.`/`i.e.`/parenthetical-example construction. Kills the
   MATH 1910 → MATH 1110 fiction and the MATH 1110 → MATH 1101 twin.
3. **Write gate inverted.** `parse-prereqs.ts`: only `cls === "clean"`
   commits. `partial` rows are written to a quarantine review file
   (`scripts/out/prereq-quarantine.json`) with course ID, raw text, and
   the parsed candidate — for hand promotion, never auto-commit.
4. **`prereqSource` field** on course docs: `"authored" | "parsed" |
   "none"`. Hand-seeded courses (including deliberate `null` = no
   prereqs) are stamped `authored`; the parser refuses to touch them.
   The old sentinel (`prereqExpr == null` means unparsed) dies.
5. **Bug fix:** `prereq-grammar.ts:302` — remove the `|| clause.length > 0`
   that made `wasNoise` always true.
6. **Malformed-field survival.** Fields like CS 3110's coreq
   (`"or prerequisites: CS 2800."`) classify as unparseable → stored raw
   with `prereqSource`-style flag, surfaced as No data. The parser must
   never emit nonsense from prose it doesn't understand.
7. **Overlap sanity signal.** When a prereq OR joins two courses that are
   a known forbidden overlap, tag the parse high-confidence (genuine
   either/or). Advisory input to parse classification only — not a fix.

### 3a. Data repair deliverable (not just code)

- **Dry-run diff**: re-run the fixed parser against the live roster and
  diff the output against current Firestore `prereqExpr` state. The diff
  is the damage report: every edge the old parser invented, every
  advisory that was a false hard block.
- **Top-50 hand audit**: spot-check the ~50 highest-traffic courses
  (intro MATH/CS/PHYS/CHEM/ENGRD/ECON sequence) against the real catalog
  text before the repaired data ships. Recorded in
  `docs/reference/prereq-audit-2026-07.md`.
- Repair is **rerunnable**: the whole pipeline stays a script that can
  re-run every semester without touching `authored` rows.

## 4. One satisfaction function (fixes C1)

New module `lib/planner/satisfies.ts` — the only place in the app that
answers "is this requirement/prereq satisfied, and by what?" It owns two
entry points sharing one core: `evaluate()` for prereq expression trees
(below), and `courseSatisfiesRequirement(course, requirement)` for
slot/requirement matching (course, pattern, and — once spec 010 lands —
attribute/list/nOfM/creditMin kinds). Specs 009, 010, and 011 all consume
the latter; no surface keeps local matching logic.

```
evaluate(expr: PrereqExpr, ctx: EvalContext): EvalResult
  ctx = { coursePool (placed/in-progress/completed by semester),
          creditPool (synthetic courses from creditProfile),
          targetSemester }
  EvalResult = { state: "met" | "advisory" | "blocked",
                 satisfiedBy: CourseRef[],   // incl. synthetic credits
                 missing: PrereqLeaf[],      // for chips/explanations
                 advisoryNotes: string[] }
```

- Consumers (all migrate, none keep local logic): `SlotCard` status,
  `computeSlotStatusMap`, the prereq tree in `CourseDetailPanel`, the
  major-match engine (spec 011), catalog fit chips, `ShareView`.
- `evaluatePrereq.ts`'s recursive evaluator becomes the internal core of
  this module; the change is that it returns structured results (who
  satisfied, what's missing, advisory notes) instead of a bare boolean,
  and honors `advisory` nodes and the credit pool.
- **Tests first.** Table-driven unit tests over: and/or nesting, pattern
  nodes, concurrent nodes, advisory nodes (never block), synthetic
  credits, semester ordering, the CS 3110 malformed coreq, and the
  MATH 1910 / MATH 1920 regression cases verbatim from the audit.

## 5. Forbidden overlaps ingest (fixes #11)

- `roster-sync.ts`: capture `catalogForbiddenOverlaps`, parse the prose
  into course-ID lists, **strip the course itself** (the API includes
  self), store as `forbiddenOverlaps: string[]` on the course doc.
- Derived overlap warning (§1b) computed plan-wide in the same pass that
  computes slot statuses; surfaced on both cards + detail panel.
- Kept queryable for spec 008 (OR-collapse rule: collapse only when
  overlap-proven exclusive) and §3.7's parser signal.

## 6. Error handling & honesty rules

- Unknown/unparseable prereq text → No data, never a guess.
- A synthetic credit whose mapped course ID no longer exists in the
  catalog → ignored with a console warning, never a crash.
- The engine never renders Blocked from an advisory-only tree — enforced
  in `satisfies.ts`, asserted in tests, not left to UI discipline.

## 7. Out of scope

- Coreq evaluation (still dead data; deliberately unchanged — candidate
  for a later spec once trust work lands).
- Grade-minimum and permission-of-instructor gates (stored in advisory
  notes as prose; no enforcement).
- Requirements matching on attributes (spec 010).
- Any UI redesign beyond the new state treatments + credit profile entry.

## 8. Open questions (carried, non-blocking)

- Placement exams (e.g. math placement) as first-class CreditEntry kind:
  included in the model (`kind: "placement"`), but which placements to
  seed is a data question for the top-50 audit.
- Whether the quarantine review file gets a tiny admin UI or stays a
  hand-edited JSON — start hand-edited, revisit at scale.
