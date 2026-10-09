# Spec 008 — The Living Graph (derived edges + hover unlocks)

STATUS: IMPLEMENTED (code; ghost data gated on re-index) — all three units
built 2026-07-11 on impl-007-013; see docs/reference/implementation-status.md.
Earlier progress note: Unit 8A done 2026-07-11 (impl-007-013): the pure data layer
only. `src/lib/planner/deriveEdges.ts` (§2a's derivation function, keyed by
slotId rather than courseId so a course placed twice gets distinct edges) and
the sync-time "unlocks" reverse index (§3a, refined — see note below):
`scripts/catalog-index.ts` buildUnlocksIndex/collectPrereqRefs computed at
catalog-index build time and shipped on `CatalogIndexRecord.unlocks`, with an
app-side reshape in `src/lib/planner/unlocks.ts` (buildUnlocksMap/unlockCount,
cross-listing-aware). NOT built: §2c renderer changes (EdgeLayer consuming
DerivedEdge[]), all of §3b/§3c (hover ghosts, tap-to-pin, hairball opacity
rules), and the §2b "what dies" removal of authored edges.json/SlotEdge. Tests:
27 new vitest (deriveEdges table-driven + unlocks map), 17 new corpus cases
(scripts/unlocks.corpus.ts) — see docs/reference/implementation-status.md for
the full run tally. (designed 2026-07-11, brainstorm session with Michael;
approved section-by-section)
Depends on: 007 (a live graph built on lying prereq data is worse than no
graph — trust lands first or alongside).
Source: docs/audits/2026-07-11-vision-gap-and-graph-audit.md (#3, C2),
docs/audits/2026-07-11-product-thesis.md §2.4.

This is the product's headline: a live prerequisite graph is what sets
Coursemap apart from a static requirement tracker. The thesis doc's framing
stands: the graph is not decoration on the plan; it is the exploration
mechanism for major discovery ("what does CS 2110 lead to?" is how a
student sees what a major actually looks like from the inside).

## 0. Summary of decisions (made 2026-07-11)

| Decision | Choice |
|---|---|
| Edge source | Derived at render time from `prereqExpr` of placed courses; authored `edges.json` dies |
| Scope of first build | Placed edges + hover-revealed forward unlocks (ghost paths) in one spec, two phases |
| OR branches, placed graph | Resolve against the student's plan — draw only the real satisfied edge |
| OR branches, forward view | Show alternatives dimmed (the choice IS the information); collapse only when forbidden-overlap data proves exclusivity |
| Hairball control | Hover is the primary reveal; resting state stays calm (existing 0.1-opacity treatment); ghost set capped |
| Implementation idiom | New recursive walk over the existing `PrereqExpr` tree (same shape as the evaluator, different return type) + one precomputed reverse index |

## 1. What already exists (build on, do not rebuild)

- The recursive `PrereqExpr` tree per course (spec 007 hardens it).
- The renderer: `EdgeLayer.tsx` Bézier drawing, hover-chain bidirectional
  BFS (`chainEdges()`), flowing-dash animation, red-when-blocked styling,
  completion pulse, keyboard accessibility. All of it stays.
- What does NOT exist: anything that walks a `prereqExpr` and emits an
  edge. The evaluator returns a boolean and discards which courses
  satisfied it. That walk is this spec's core new code.

## 2. Phase 1 — Derived placed edges (kills #3 and C2)

### 2a. The derivation function

New module `lib/planner/deriveEdges.ts`:

```
deriveEdges(placed: PlacedCourse[], catalog: CourseIndex): DerivedEdge[]
  DerivedEdge = { fromCourseId, toCourseId,
                  kind: "prereq" | "concurrent" | "advisory",
                  state: "satisfied" | "violated" }
```

- For every placed course, recursively walk its prereq tree (same
  recursion idiom as `satisfies.ts`; memoized per placed-course set —
  recompute only when the plan changes, not per render).
- A leaf that resolves to a course **also on the board** emits an edge.
- OR resolution against the plan: student has CS 1110 → one edge from
  CS 1110 to CS 2110. If both OR branches are placed, both edges draw
  (both are true).
- `pattern` leaves resolve against placed courses the same way the
  evaluator resolves them (a placed course matching `CS-4xxx` emits the
  edge from that concrete course).
- Semester direction: a prereq placed in a LATER semester than its
  dependent emits `state: "violated"` → red edge + red card state (this
  is the truth the student needs, from 007's single evaluator — the edge
  layer and the card can no longer disagree).
- `advisory` nodes emit `kind: "advisory"` when their inner course is
  placed — drawn lighter/dashed, matching 007's honesty rule. An
  UNsatisfied advisory emits no edge (nothing to point from).
- `concurrent` nodes emit `kind: "concurrent"` when satisfied same-or-
  earlier semester (keeps the existing double-line visual language).

### 2b. What dies

- `scripts/seed-data/edges.json`, the `edges` array on program docs,
  `normalizeProgram.ts` edge passthrough, and every consumer of authored
  `SlotEdge[]`. Seed scripts stop writing edges entirely.
- C2 dies structurally: edges derive from courses, so empty slots and
  unrelated courses can never have a wire. Custom slots and moved
  courses get wires for free — the structural fix for "the map is a
  replay of someone's drawing."

### 2c. Renderer changes (minimal by design)

- `EdgeLayer.tsx` consumes `DerivedEdge[]` keyed by course → resolved to
  slot rects via the existing placed-course → slot mapping. The BFS,
  animations, and styling are unchanged except: new dashed/lighter
  stroke for `advisory`, and the violated treatment now comes from the
  edge's own `state` rather than separate card math.

## 3. Phase 2 — Hover unlocks (the discovery half)

### 3a. The reverse index

The forward question ("what does CS 2110 unlock?") is answered by a
**precomputed reverse adjacency index**, built once per catalog load and
cached: `courseId → { unlocks: CourseRef[], viaPattern: boolean }[]` —
every course whose prereq tree references this course (or a pattern it
matches). Built in `lib/planner/reverseIndex.ts`; the hover handler is an
O(1) lookup, never a catalog scan. (Read-budget note per the 2026-07-07
lesson: built from the already-loaded catalog index, no extra Firestore
reads.)

### 3b. The interaction

- Hovering (or focusing) any placed course reveals, alongside the
  existing backward chain highlight: its **forward paths** — dimmed
  ghost cards for unlocked courses not on the board, wired with dimmed
  edges from the hovered course.
- **Cap and overflow:** ghosts render a capped set (default 6, nearest
  level first — CS 2110 shows 3000-level unlocks before 4000-level) with
  a "+N more" affordance opening the full unlock list in the drawer,
  pre-filtered. The card also carries a persistent quiet "unlocks 14"
  count (shared with spec 013's drawer signal).
- **Tap-to-pin:** clicking a ghost places the real course into a sensible
  default semester (first semester where its prereqs would be met),
  which the student can then move — placement is a normal placement,
  nothing special persists about having arrived via a ghost.
- **Unplaced OR alternatives** in the forward view: show both branches,
  dimmed, as alternatives — the choice is the information. Collapse to
  one only when `forbiddenOverlaps` (007 §5) proves the branches
  mutually exclusive, then labeled as "either" (e.g. CS 1110/CS 1112).
- Ghosts exist only during hover/focus (plus a grace period for pointer
  travel). The resting canvas never shows ghosts — calm by default.

### 3c. Hairball control (the routing rule)

- Resting state: all edges at the existing dim treatment; hover is the
  primary reveal. This is already the built behavior — the rule is
  simply reaffirmed as the design mechanism that keeps a 40-course plan
  readable.
- Long edges (spanning ≥3 semesters) render at further-reduced resting
  opacity; their full path lights on hover like any chain edge.
- Invariant: **if two placed courses have a prereq relationship, an edge
  exists** — control density with opacity and hover, never with silent
  omission.
- Edge routing within a semester column (coreq/concurrent pairs) keeps
  the current side-anchor approach; no routing-engine rewrite in this
  spec. If crossings prove ugly at scale, a follow-up polish item — not
  a blocker.

## 4. Performance

- `deriveEdges` and the reverse index are pure functions over in-memory
  data; both memoized (plan hash / catalog version).
- Budget: a 45-course plan on the 4,472-course catalog must derive edges
  in <5ms and build the reverse index in <100ms one-time. Ghost render
  respects the existing ring-animation performance envelope verified in
  the 2026-07-11 design pass (no console jank at 55% zoom).
- Reduced motion: ghosts appear without animation; flows already respect
  `prefers-reduced-motion`.

## 5. Testing

- Unit: `deriveEdges` table-driven — OR resolution single/both-placed,
  pattern leaves, violated ordering, advisory edges, concurrent edges,
  cross-semester spans, empty plan, self-referential/cyclic data guards
  (malformed data must not hang the recursion — visited-set).
- Unit: reverse index — pattern expansion, cross-listing aliases (a
  course unlocking via its alias counts once), cap ordering.
- Browser (Sonnet subagent per house rule): place CS 1110 + CS 2110 →
  one wire; move CS 2110 to a custom slot → wire survives (the #3
  regression case); place prereq after dependent → red; hover → unlocks
  ghosts appear/clear; tap-to-pin places correctly.

## 6. Out of scope

- Full explore mode (whole-catalog neighborhood browsing) — explicitly
  deferred; hover-unlocks is the discovery mechanism for now.
- Edge routing engine rewrite / crossing minimization.
- Coreq satisfaction logic (007 carries the note; edges for standalone
  coreqs stay visual-only until coreq evaluation exists).
