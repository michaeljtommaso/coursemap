# Spec 011 — Major Discovery Engine + Two-Doors Onboarding

STATUS: IMPLEMENTED — built 2026-07-11 on impl-007-013;
see docs/reference/implementation-status.md. (Designed 2026-07-11, brainstorm session with Michael;
approved section-by-section)
Depends on: 007 (single satisfaction function + credit profile),
010 (attribute requirement kind for category/list electives).
Source: docs/audits/2026-07-11-product-thesis.md (the whole doc — this
spec IS the thesis), 2026-07-11-vision-gap-and-graph-audit.md (#9, C6),
triage
2026-07-07 #19/#27.

The thesis, verbatim: **help a student figure out what to major in, based
on the classes they're actually interested in taking.** The major-match
engine is THE core feature, not a sidebar panel — and today it is the
weakest code in the app (190 lines, no tests, greedy first-fit, biased
toward the major you already picked, which defeats the product's stated
purpose). This spec rebuilds it as a real algorithm and inverts the
onboarding to match.

## 0. Summary of decisions (made 2026-07-11)

| Decision | Choice |
|---|---|
| Onboarding | Two doors, equal weight: "I know my major" → template flow; "Still figuring it out" → blank canvas + catalog + live discovery panel |
| Matcher | Bipartite matching with consumption (Hopcroft–Karp; upgradeable to min-cost flow), credit-weighted |
| Scoring | Credits-satisfied / credits-required; electives in the denominator; duplicate requirements stay distinct |
| Bias | Zero. Every major scored by the identical function on the identical course set (C6 dies). Waived/no-course slots grant score to NO major |
| Corpus | Eng-first (13 majors, labeled honestly), authoring pipeline so expansion is data entry |
| Credit requirements | Requirement schema encodes credit minimums, not just course counts (Michael, 2026-07-11) |
| Explanation | First-class output: what matched, what's missing, what didn't count and why |

## 1. The matcher, rebuilt (fixes #9 items 1–6 and C6)

Out of `hooks/useMajorMatch.ts`, into `lib/planner/majorMatch.ts` (the
hook becomes a thin memoized wrapper). Tests first.

### 1a. Model

For each program, build a bipartite graph:
- Left nodes: the student's courses — placed, in-progress, completed,
  plus **synthetic credit courses** from the credit profile (007 §2).
- Right nodes: the program's requirement instances — every slot and
  every elective-group seat, deduplicated NEVER ("two 4000-level CS
  electives" = two nodes). Each carries its credit weight.
- Edge (course → requirement) iff 007's `satisfies()` says the course
  can fill that requirement (course/pattern/attribute/list kinds all
  evaluated by the one function).

### 1b. Algorithm

- **Maximum-cardinality bipartite matching (Hopcroft–Karp), weighted by
  credits**: implemented as matching on a credit-expanded graph or via
  min-cost max-flow when double-counting budgets arrive — the module's
  public API commits only to `assign(courses, requirements) →
  Assignment`, so the algorithm can strengthen without breaking
  consumers. Each course satisfies at most one requirement (consumption
  — the audit's core complaint about `.some()` lookups dies here).
- Program score: `creditsSatisfied / creditsRequired` where
  `creditsRequired` includes electives and credit-minimum requirements
  (§2). A 1-credit seminar no longer equals a 4-credit core course.
- Cross-listings count once (alias map normalizes before matching).
- **No special-casing of the current program.** Completed/waived slots
  with no recorded course contribute to NO program's score — the credit
  profile is how "I already have this" enters, and synthetic courses
  count identically for every program. This kills C6 by construction,
  not by patch: the ranked list is finally an honest answer to "what
  should I even be doing?"
- Performance budget: 13 programs × ~50 courses × ~60 requirement nodes,
  recomputed on plan change, must stay <50ms (memoized per plan hash;
  Hopcroft–Karp on graphs this size is microseconds — the budget is
  really about not recomputing needlessly).

### 1c. Explainability — a first-class output, not a debug view

`Assignment` returns, per program:
- `matched: { courseId, requirementId, credits }[]`
- `missing: RequirementRef[]` (with human labels: "2 more 4000-level CS
  electives — 8 credits")
- `uncounted: { courseId, reason }[]` — reasons: "doesn't match any ORIE
  requirement", "requirement already filled", "overlap rule".

The **progress-explanation surface** (Michael's request, 2026-07-11):
the majors panel gains a per-program expansion answering "you've placed
47 credits, but only 31 count toward ORIE — here's what's not counting
and why." It is literally a render of `uncounted` + `missing` — whatever
the matcher couldn't assign IS the explanation. Same data feeds the
current-program progress in the left rail (replacing the slot-count math
with credit math from the same assignment).

## 2. Requirement schema (the authoring pipeline's contract)

Requirements live as **data files with a schema**, versioned by catalog
year from day one:

```
kinds:
  course        — exact course (with alias set)
  pattern       — code wildcard (CS-4xxx)
  attribute     — matches course properties (spec 010)
  list          — curated course-ID list
  nOfM          — fill N seats from M options (minNumberOfSlots idea)
  creditMin     — ≥ X credits from a qualifying set (Michael's note:
                  majors state credit requirements, not just counts —
                  "9 credits of technical electives")
each with: credits (per-seat or pool), label (student words), notes
```

Design ideas adopted:
compile-predicates→course-ID-lists at build time; an override table for
when Cornell's own data is wrong; a soft "this might count — confirm"
tier (maps onto our advisory visual language); catalog-year versioning.

### 2a. Validation harness (the pipeline's teeth)

`scripts/validate-programs.ts`, runs in CI/build:
- Every requirement in every authored major is evaluated against the
  full catalog. **Zero qualifying courses = build failure** (the FWS
  class of bug becomes impossible to ship).
- Per-major coverage report: total credits, per-requirement candidate
  counts, unreachable requirements, credit-total sanity vs the
  published degree total.
- Output goes to `docs/reference/program-coverage.md` so authoring
  progress is visible.

### 2b. Corpus plan

- Launch: the existing 13 engineering majors migrated onto the schema,
  labeled honestly in the UI ("ranked across Engineering").
- Expansion order (where engineering-adjacent students actually defect):
  CS in A&S, Info Science, Econ, AEM — authored from Cornell's public
  catalog pages (public facts).
- Adding a major is data entry + the harness, never code. That is the
  pipeline's success criterion.

## 3. Two-doors onboarding (the thesis on the first screen)

`FirstRun.tsx` + plan initialization:

- First open asks the honest question, two doors with equal visual
  weight:
  - **"I know my major"** → the existing template flow (program picker),
    plus the credit-profile step (007 §2b).
  - **"Still figuring it out"** → blank canvas, catalog drawer open,
    discovery panel live from the first placed course. The ranking
    visibly reacting to each course added is the product's aha moment —
    the panel animates its reorder on plan change.
- The credit-profile step serves both doors (skippable).
- The blank-canvas plan is the existing `_plan` custom-slot mechanism +
  the blank program seed (already built in spec 006 F); this spec makes
  it a first-class door instead of an escape hatch.
- Copy tone follows PRODUCT.md: calm, precise, no gamification.

## 4. Absorbed / repositioned items

- Triage #27 (compare majors by classes of interest) — this IS the
  discovery panel; absorbed.
- Triage #19 (auto-fill / plan generator) — explicitly out of scope;
  logged as a future idea that would sit on top of the matcher.
- Old "For my major" filter chip semantics stay unchanged (009 §2).

## 5. Testing

- Unit (the bulk of this spec's engineering): matcher table-driven cases
  — consumption (one course can't fill two requirements), the
  only-candidate case that defeats greedy first-fit (course X is the
  sole candidate for req B but also matches req A; greedy assigns X→A
  and reports B unfulfilled; Hopcroft–Karp must find the augmenting
  path), duplicate requirements, credit weighting, nOfM, creditMin,
  attribute electives, synthetic credits equal across programs, C6
  regression (waived slots grant nothing), cross-listing dedup.
- Property test: score is invariant to which program is "current."
- Harness: validation run over all 13 migrated majors passes; a
  deliberately-broken fixture major fails loudly.
- Browser (Sonnet subagent): two doors render and route; blank-canvas
  door → place 3 CS courses → CS ranks top with visible reorder;
  explanation panel shows unmatched courses with reasons.

## 6. Out of scope

- Double-counting budgets ("at most 2 distribution categories") — the
  flow-based upgrade path is designed for it; not built now.
- Minors and grad programs.
- Non-engineering corpus authoring beyond the pipeline + expansion order
  (the authoring itself is ongoing data work, tracked in the coverage
  report, not gated on this spec).
- Auto-fill (#19).
