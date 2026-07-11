# Debug / Direction Log — 2026-07-11

> Live logging session. Michael walks the app post-Coursemap-rebrand and
> reports what's wrong, what's fake, and where the product has drifted from
> the vision. Each item carries a real diagnosis (file:line) from a code
> audit run during the session. **Logging + diagnosis only — no fixes this
> session.**

## North star (unchanged, still the measuring stick)
> **"How can we make picking a major the easiest, and remove as much
> doubtfulness and worry from a student's path as possible?"**

## The vision, stated plainly (new — this is the frame for everything below)
> **Coursemap is a live prerequisite graph, not a pre-drawn flowchart.**
>
> Look at the logo: three blocks flowing into one. That's the product. You
> put classes down, and the map *reacts* — it shows you, class to class,
> what unlocks what. Hover a course and the chain lights up in both
> directions: what feeds it, what it feeds. The major template is a
> **suggestion**, never a cage. Any class can go anywhere. The map is a
> visualization of *your* plan's dependencies, generated from real
> prerequisite data, updating constantly.
>
> **This is the main selling point of the website.** Item #3 below is the
> single largest gap between what we said we built and what we actually
> built.

## Legend
- **Type**: `bug` (broken) · `change` (works, wants different) · `feature` (new) · `later` (deferred idea)
- **Sev**: `blocker` (vision-level) · `high` · `med` · `low`
- **Status**: `open` · `diagnosed` (root cause found this session) · `fixed`

---

## Summary (11 reported + 6 Claude additions)

| #  | Item | Type | Sev | Status |
|----|------|------|-----|--------|
| 11 | Ingest `catalogForbiddenOverlaps` — we drop it today | feature | high | diagnosed |
| 1  | Placeholder slot keeps its identity after you drop a real course in it | bug | high | diagnosed |
| 2  | "FWIS-1xxx" is wrong — Cornell's abbreviation is **FWS** | bug | med | diagnosed |
| 3  | **Wires are hand-authored per major, not derived from real prereqs** | bug | **blocker** | diagnosed |
| 4  | MATH 1910 falsely requires MATH 1110 — systemic parser defect | bug | high | diagnosed |
| 5  | Drag refuses to place a course in an "unrelated" slot | bug | high | diagnosed |
| 6  | Empty ghost cards get the mark-complete hover pill | bug | med | diagnosed |
| 7  | Course drawer feels empty — no tools behind it | change | med | open |
| 8  | Classes page → a real decision hub (compare, rank, professors) | feature | med | open |
| 9  | Major match engine needs real work | change | high | diagnosed |
| 10 | Full prereq/coreq tree audit (correctness pass over the data) | bug | high | diagnosed |
| C1 | The card and the major-match panel **disagree** about FWS | bug | high | diagnosed |
| C2 | Wires draw for empty slots (the inverse of #3) | bug | med | diagnosed |
| C3 | "Find a class" on an FWS slot returns zero results — no FWS in catalog | bug | med | diagnosed |
| C4 | Switching majors silently deletes placements | bug | high | diagnosed |
| C5 | Interrupted drop animation silently loses the placement | bug | med | diagnosed |
| C6 | Major-match ranking is biased toward the major you already picked | bug | med | diagnosed |

---

# Part 1 — The big one

## #3 — The wires are fake · `bug` · `blocker` · `diagnosed`

**What you saw:** placed CS 1110 and CS 2110. The prereq registered as
satisfied — the card went green. **No line was drawn between them.**

**Root cause.** There are two completely separate prerequisite systems in
this codebase and they have never been introduced to each other.

**System A — real, correct, invisible.** Course prerequisites live as a
recursive expression tree (`prereqExpr`) on each course document. When you
place a course, `computeSlotStatusMap.ts:270` calls `evaluatePrereq()`
against the courses actually in your plan. This is what turned the card
green. It works.

**System B — fake, authored, visible.** The lines on the canvas come from a
static, hand-written list of **slot-ID pairs** embedded in each major
template:

```json
// scripts/seed-data/edges.json:26
{ "from": "cs-s1-cs111x", "to": "cs-s3-cs2110", "type": "prereq" }
```

`EdgeLayer.tsx:157` maps over that array and draws a Bézier for each entry.
**Nothing anywhere in the codebase reads a course's `prereqExpr` and emits
an edge.** The entire chain is a passthrough of authored data:

```
edges.json → programs/{id}.edges → normalizeProgram.ts:104
           → useProgramData.ts:107 → AppShell → RoadmapCanvas → EdgeLayer.tsx:157
```

So a wire appears **only** if you drop CS 1110 into the literal slot
`cs-s1-cs111x` *and* CS 2110 into the literal slot `cs-s3-cs2110`. Drop
either one into a custom slot, an elective slot, or a different semester and
`rects.get(edge.from_slot)` misses, `EdgeLayer.tsx:160` returns `null`, and
the wire silently doesn't exist. Custom slots literally **cannot** ever have
a wire — they're minted with plan-local IDs under `program_id: "_plan"`
(`useEffectiveSlots.ts:28`), which by construction can never match an
authored edge.

Each program ships 13–24 authored edges. The real CS prereq graph has
thousands.

**This is precisely the "cookie cutter pipeline" feeling.** The canvas isn't
visualizing your plan. It's replaying a drawing someone made by hand, and
your courses happen to sit near it.

**The good news:** the *interaction layer you want already exists and is
good.* Hover-to-highlight-chain is fully built — `EdgeLayer.tsx:58`
(`chainEdges()`) does a bidirectional BFS from the hovered slot, lights the
chain to opacity 1, recedes everything else to 0.1, and runs a flowing dash
animation down the live edges. It's keyboard-accessible. Completing a course
even fires a pulse down its outgoing wires. **All of that machinery is
sitting there with almost nothing to highlight**, because the graph it walks
is a sparse authored artifact instead of the live prereq graph.

**The fix, in one sentence:** replace the authored `SlotEdge[]` with a graph
*derived* at render time from the `prereqExpr` of whatever courses are
actually on the board. The renderer, the hover-chain BFS, the flow
animation, and the red-when-blocked styling all stay. Only the edge
*source* changes. This is the highest-leverage change available to us — it
converts an existing, polished, unused feature into the product's headline.

**Follow-on design questions this raises** (needs a proper brainstorm before
anyone writes code):
- Edges across *and* within semesters — how do we route without spaghetti?
- Do we draw edges to courses **not yet placed** (ghost forward-paths:
  "CS 2110 unlocks these 14 courses")? That's the "what does this lead to"
  half of the vision and it's arguably the most valuable half.
- How do we keep a 40-course plan from looking like a hairball? (Likely
  answer: default to dimmed/hidden, and let hover be the primary reveal —
  which is exactly what the existing 0.1-opacity treatment already does.)

### The OR-branch question — resolved (see also #11)
Original worry: CS 2110's prereq is `CS 1110 OR CS 1112`. Two lines? One
line with a fork?

**For the placed graph, it dissolves.** If edges are derived from what the
student has actually placed, the OR resolves against their plan — they have
CS 1110, so we draw one line from CS 1110. No ambiguity, no extra data, and
it's correct even for ORs whose branches are *not* mutually exclusive. The
canvas only ever draws real satisfied edges between real placed courses.
That is the whole rule, and it's the one to build.

**The ambiguity only lives in the forward/unplaced view** — "I have neither,
show me how to reach CS 2110." And there, collapsing to one line is probably
*wrong*: the entire point of that view is to surface that the student has a
choice to make. Show both, dimmed, as alternatives.

**Do not adopt a blanket "collapse every OR" rule.** Not every OR is
exclusive. A technical elective phrased as `CS 4700 OR CS 4780 OR CS 4820`
is a genuine choice where a student may take all three. Collapsing those
would be a lie. The correct rule is data-driven: collapse when the roster
says the alternatives are mutually exclusive, fan out when they're
independent. Which is what #11 buys us.

---

# Part 2 — Reported bugs

## #1 — Placeholder cards force their identity onto your course · `bug` · `high` · `diagnosed`

**What you saw:** dropped a CS course into the FWS slot. It still reads as
an FWS class.

**Root cause — it's deliberate, and it's wrong.** `SlotCard.tsx:194-208`:

```ts
if (placed) {
  // A filled bucket/pattern keeps its identity as the eyebrow
  const eyebrow =
    slot.kind === "elective" && slot.elective_groups
      ? slot.elective_groups.name
      : slot.kind === "pattern"
        ? (slot.pattern_title ?? slot.pattern ?? "Pattern")   // ← "First-Year Writing Seminar"
        : `${placed.subject} ${placed.number}`;
  const metaCode = slot.kind === "course" ? null : `${placed.subject} ${placed.number}`;
```

Drop CS 2110 into the FWS slot and the card renders:
- **Eyebrow** (the big bold line): `First-Year Writing Seminar`
- **Title**: `Object-Oriented Design and Data Structures`
- **metaCode** (8.5px, the smallest text on the card): `CS 2110`
- **Category chip + dot**: still `FWS`, in FWS colors — because the category
  is stored on the *slot* (`slot.category`) and is never re-derived from the
  placed course (`SlotCard.tsx:775, 992`).

The slot's identity wins; the actual course is demoted to the smallest text
on the card. Nothing validates the drop, either — `assignSlot`
(`PlanProvider.tsx:490`) just writes `slotSelections[slotId] = course.id`
and never looks at `slot.pattern`.

**What you want:** the slot is a *suggestion*. The moment a real course
lands in it, the card becomes that course — its code, its category color,
its identity. The requirement it was suggesting becomes a separate concern
(see C1 — the requirement should now read as *unmet*, because a CS course
does not satisfy an FWS requirement).

## #2 — "FWIS-1xxx" should be "FWS" · `bug` · `med` · `diagnosed`

Not a UI string — it's seed data, rendered verbatim (`SlotCard.tsx:216`:
`eyebrow: slot.pattern`). **50 occurrences across 17 files:**
- `scripts/seed-data/slots.json` — 8×
- `scripts/seed-data/programs.json` — 8×
- `scripts/seed-data/programs-2025/*.json` — 9 files, 2× each
- `scripts/legacy-sql/002_seed.sql` — 8×
- App source: `slotCategory.ts:71` (tolerates both — a rename is safe),
  plus two tests asserting the wrong token
  (`slotCategory.test.ts:41, 75`)

**Note the card already contradicts itself today:** the eyebrow says
`FWIS-1xxx` while the category chip says `FWS` (`slotCategory.ts:57` sets
`tag: "FWS"`). We got the chip right and the pattern wrong.

Also — the `1xxx` suffix is a pattern wildcard, not a course code. Even
spelled right, `FWS-1xxx` is engineer-speak leaking to students. The card
should say **"First-Year Writing Seminar"** and leave the pattern for the
matcher.

## #4 + #10 — MATH 1910 falsely requires MATH 1110 · `bug` · `high` · `diagnosed`

You called this a niche bug that "might show up elsewhere." It shows up
**everywhere.** This is systemic and it's the worst data problem we have.

**It is not a bad seed.** The hand-written data is correct —
`courses.json:3` has `MATH-1910: prereqExpr: null`, and
`legacy-sql/002_seed.sql:20` agrees. The bad edge was written into Firestore
at runtime by `scripts/parse-prereqs.ts` parsing Cornell's catalog prose.

**The defect, exactly.** Cornell's catalog text for MATH 1910 is roughly:
*"Prerequisite: three years of high school mathematics including
trigonometry and logarithms, **or** MATH 1110."* Two alternatives — high
school prep OR the placement course.

1. `prereq-grammar.ts:112` — `NOISE_PATTERNS` includes `/\bhigh\s+school\b/i`
   and **deletes the high-school branch.**
2. Only `MATH-1110` survives. The connective is still correctly `"or"`.
3. `group()` at `prereq-grammar.ts:286-291` collapses a one-child OR:
   ```ts
   if (flat.length === 1) return flat[0];   // OR(MATH-1110) → REQUIRES MATH-1110
   ```
   **An optional on-ramp got promoted to a hard requirement.**
4. `parse-prereqs.ts:64` then writes it: noise-dropping sets
   `cls = "partial"`, and `const writable = cls === "clean" || cls === "partial"`.
   **"Partial" literally means "we deleted an alternative" — and those are
   exactly the rows we commit.** The safety valve is inverted.
5. The "never overwrite hand-authored trees" guard doesn't help:
   `parse-prereqs.ts:65` is `const prereqIsNull = doc.prereqExpr == null;` —
   a deliberate `null` ("this course has no prereqs" — MATH 1910's *correct*
   value) is indistinguishable from "not parsed yet." The script's own
   docblock claims it never overwrites the hand-authored trees. For every
   hand-authored `null`, that claim is false.

**Blast radius.** Every prereq of the form *"`<non-course alternative>` or
`SUBJ NNNN`"* becomes a false mandatory chain. The noise list that triggers
it (`prereq-grammar.ts:93-113`) includes `high school`, `AP credit`,
`or equivalent`, `or permission of instructor`, `graduate standing`. The
worst-hit courses are exactly the **entry points** — MATH 1110/1120/1910/1920,
CHEM 2090, PHYS 1112 — because their catalog text is almost entirely
"high-school prep *or* a placement course." These are the first courses every
freshman touches.

Secondary bug, same file, `prereq-grammar.ts:302`:
```ts
const wasNoise = NOISE_PATTERNS.some((re) => re.test(clause)) || clause.length > 0;
```
The `|| clause.length > 0` makes this **always true** for any non-empty
clause — inflating the `partial` bucket, which is the set we write.

**The audit you asked for.** This needs a real correctness pass, not a
one-line fix:
- Fix `group()` so a collapsed OR whose siblings were noise-stripped becomes
  a **soft/advisory** prereq, not a hard one (new node type, or `null` + a
  `prereqNote` string).
- Invert the write gate: `partial` should be **quarantined**, not committed.
- Distinguish "authored null" from "unparsed" (add `prereqSource` to the
  hand-seeds).
- Re-run the parser dry and **diff against the current Firestore state** to
  size the damage. Then spot-check the top ~50 highest-traffic courses by
  hand against the real Cornell catalog.

## #5 — Drag won't let you put a course where you want · `bug` · `high` · `diagnosed`

**Surprising finding: there is no category validation on drop. Anywhere.**
The drop handler never checks `slot.kind`, `slot.category`,
`elective_groups.qualifying_rule`, or `pattern`. Free placement is *already*
the policy. So what stopped you?

**Three separate mechanisms, all of which read as "the app refused":**

**(a) The one real gate is occupancy, and its failure mode is bizarre.**
`AppShell.tsx:33`:
```ts
const isSlotAvailable = (slotId, courseId) => {
  const sel = slotSelectionsRef.current;
  return !sel[slotId] || sel[slotId] === courseId;   // occupied by someone else → false
};
```
If the ORIE elective slot **already had a course in it**, `targetSlotId`
becomes `null` — and because the slot sits inside the column,
`AppShell.tsx:85` falls back to `ds.overColumnSem` and **silently diverts
your course into a brand-new custom slot appended at the bottom of that
column.** No toast, no rejection cursor, nothing. The card just… appears
somewhere else. That is almost certainly what you hit.

**(b) Click-to-place silently cancels.** `SlotCard.tsx:695` — arm a course,
click an occupied slot, and the arm is *disarmed* rather than the slot being
replaced. Nothing is placed. Nothing is said.

**(c) The "For my major" filter chip can remove the course from the drawer
entirely.** `useCourseFilters.ts:56` — with ORIE selected and that chip on,
CS 2110 is filtered out of the catalog and you literally cannot pick it up.
It's off by default, but it's one tap away, and it makes the app feel like
it's gatekeeping.

**Fix is small and matches the vision:** make drop-on-occupied **replace or
swap** the incumbent (`AppShell.tsx:33, 79-85`), make `canReceiveArmed`
unconditional (`SlotCard.tsx:583, 695`), and never silently divert a drop —
if it lands on a slot, it goes in that slot.

## #6 — Empty ghost cards have the mark-complete hover pill · `bug` · `med` · `diagnosed`

Confirmed. `<CornerActions>` is rendered inside the *empty* branch too —
`SlotCard.tsx:870-881` — with `placed={null}` and `onClear={() => {}}`, a
dead no-op. So hovering an empty slot expands the corner pill offering
**✓ Mark completed**, **◷ Currently taking**, and the ⋯ overflow, identical
to a filled card.

There's a defensible intent behind it (`SlotCard.tsx:822` cites spec 005 §11
— "my FWS is done, I don't care which one," and there's a real
`"Done — course not recorded"` state at `:846`). But as you said: there's no
class in there, so why is there a completion affordance? And the *inverse*
is worse — `SlotCard.tsx:858` hides the **"＋ Find a class"** button the
moment any status mark is set, so the one affordance an empty slot *should*
have is the one that disappears.

**Wanted:** an empty slot's hover state is "help me fill this." Mark-complete
without a course, if we keep it at all, belongs in the overflow menu, not the
primary hover pill.

## #11 — We throw away `catalogForbiddenOverlaps` · `feature` · `high` · `diagnosed`

Cornell's roster API returns a **`catalogForbiddenOverlaps`** field —
*"Students may not receive credit for both CS 1110 and CS 1112."* We do not
ingest it. `roster-sync.ts:64-88` declares the roster fields we read
(`catalogPrereq`, `catalogCoreq`, `catalogPrereqCoreq`) and
`roster-sync.ts:188` captures only the prereq/coreq prose. The overlap field
is dropped on the floor. It appears **nowhere** in the repo.

**Naming, so we get it right:** this is *not* a coreq. It's a credit-exclusion
rule — a transcript constraint, not a scheduling one. It is also distinct
from a **cross-listing** (CS 2110 ≡ ENGRD 2110 — the *same* course under two
codes, handled by the alias map). Three different concepts; keep them
separate:
- **alias / cross-listing** — same course, two codes.
- **forbidden overlap** — different courses, can't get credit for both.
- **coreq** — must be taken alongside.

**Why it's worth ingesting — three payoffs, in order of value:**

1. **A validation rule we don't have.** A student with **both** CS 1110 and
   CS 1112 on their board is burning credits that will not count toward the
   degree, and today the app says **nothing**. That is exactly the kind of
   doubt the north star exists to remove, and it's a check nobody else is
   running for them. This is the biggest win and it's independent of the
   graph work.
2. **It makes the OR-collapse rule data-driven** rather than a blanket
   guess — see the OR-branch section under #3.
3. **It probably helps the #4 parser.** A prereq clause that ORs two courses
   which are a known forbidden overlap is strong evidence the clause is a
   genuine "either/or equivalence" rather than the noise-stripped wreckage
   that produced the MATH 1910 bug. Useful as a *sanity check* on parser
   output, not as a fix for it.

Small, self-contained scope: add the field to the `RosterCourse` interface,
capture it on the course doc, and parse the prose into a course-ID list. The
UI surface (a warning on the plan) is a separate, easy follow-on.

---

# Part 3 — Product direction

## #7 — The course drawer feels empty · `change` · `med` · `open`

Your words: *"it's just a pullout drawer of straight classes you can search
in — it feels a little empty in the sense of tools and features. But maybe
that's a good thing."*

Agreed on both halves, and I'd resolve the tension this way: **the drawer
should stay lean, and the depth should live in the Classes page (#8).** The
drawer's job is *place a class fast*. A tool-heavy drawer fights the canvas
for attention.

What the drawer is genuinely missing is not *tools* but *signal* — the
information you need at the exact moment you're choosing:
- **Does this fit where I'm about to drop it?** (prereqs met by that
  semester? offered that term?) — we have all of this data and show none of
  it in the drawer.
- **What does this unlock?** — the forward-path count. Ties directly to #3.
- **Credits + workload** at a glance.

That's not more chrome. That's the same list, answering the question the
student is actually asking.

## #8 — Classes page → a real decision hub · `feature` · `med` · `open`

Reviving old-doc #14 and #27, both deferred. You want back in, and I agree —
this is the second-biggest product idea in the log after #3.

The pitch: **a place to decide, not just a place to browse.**
- **Head-to-head comparison** — pin 2–4 classes, see them side by side:
  credits, terms offered, prereqs, what they unlock, difficulty, workload.
- **Historical data** — how the class has actually gone, term over term.
- **Professor data** (RateMyProfessor et al.) — the thing students *actually*
  use to pick classes, and nobody has it in the same place as the degree
  requirements.
- **Ranking / shortlisting** — students should be able to rank the classes
  they want and have the roadmap reflect it.

**Real talk on this one:** the professor/historical data is a *data
acquisition* project, not a UI project, and RMP has no public API. Scope this
as its own spec with a data-sourcing section before any UI work. The
comparison view, though, is buildable today from data we already have and
would be valuable on its own.

## #9 — Major match engine · `change` · `high` · `diagnosed`

You said "definitely could use some work." Having read it — it's worse than
that. `useMajorMatch.ts`, ~190 lines, **no tests.** The real problems:

1. **No assignment or consumption.** Matching is N independent boolean
   `.some()` tests (`:144`). One CS 4820 in your plan satisfies `CS-4xxx`,
   `CS-xxxx`, and every other pattern it matches — **all at once.** This is
   not a matching algorithm; it's a series of unrelated lookups, and it
   inflates every percentage.
2. **Requirements are deduplicated** (`:130`), so *"take two 4000-level CS
   electives"* collapses into one requirement.
3. **Electives are excluded from the score entirely** — there's no
   `kind === "elective"` branch in the requirement loop. For an
   elective-heavy major the denominator is just the fixed core, which
   misrepresents the whole degree.
4. **`list` and `category` elective rules always return `false`** (`:46`) —
   silently, with no UI signal. Any major with curated-list electives scores
   zero elective fit.
5. **It's biased toward the major you already picked** (`:122`) — for the
   *current* program, a completed/waived slot counts as matched even with no
   course recorded. Other programs get no such credit. Since the output is a
   **ranked list meant to suggest majors**, it systematically ranks your
   existing choice above the alternatives. (Logged separately as C6 — this
   one's a real bug, not a design gap.)
6. **No credit accounting.** A 1-credit seminar matching `CS-1xxx` counts the
   same as a 4-credit core requirement.

This wants to be a proper **bipartite matching with consumption** (each
course satisfies at most one requirement; find the assignment that maximizes
coverage), scored by **credits, not slot count**, with electives in the
denominator. That's a real algorithm with real tests, and it should come out
of `hooks/` and into `lib/planner/`.

---

# Part 4 — Claude's additions (things you haven't seen yet)

## C1 — The card and the major-match panel actively disagree · `bug` · `high`
Falls straight out of #1. Drop CS 2110 into the FWS slot:
- **The card** says the FWS requirement is filled (`SlotCard.tsx:194`).
- **The major-match panel** correctly says FWS is **unmet** — it regex-tests
  the pattern against the courses you actually have (`useMajorMatch.ts:143`).

Two surfaces, same plan, opposite answers. Whichever way we fix #1, these two
must be made to share one requirement-satisfaction function. Right now there
are three separate notions of "satisfied" in the app (card, major-match,
prereq engine) and no single source of truth. **Note the July 10 review
already caught this exact class of bug once** (the prereq tree using
different math than the cards). It grew back. It'll keep growing back until
there's one function.

## C2 — Wires draw for empty slots · `bug` · `med`
The exact inverse of #3, same root cause: edges are keyed on **slot IDs**,
never on slot *contents* (`EdgeLayer.tsx:157`). So an authored edge renders
between two slots that are **empty**, or that hold two completely unrelated
courses. The canvas is drawing prerequisite relationships between things that
have no prerequisite relationship. Fixing #3 fixes this for free.

## C3 — "Find a class" on an FWS slot is a dead end · `bug` · `med`
`slotSearchSeed()` (`semesters.ts:91`) turns `FWIS-1xxx` into the catalog
query `"FWIS 1"`. But `scripts/seed-data/courses.json` contains only CHEM,
CS, ECE, ENGRD, MAE, MATH, ORIE, PHYS — **there is no FWS/FWIS/WRIT course in
the catalog at all.** The button returns zero results, and will keep doing so
after the #2 rename. (If the live Firestore catalog has all 4,472 courses this
may only affect the seed path — worth confirming against production before
scoping.)

## C4 — Switching majors silently deletes your placements · `bug` · `high`
`PlanProvider.tsx:381` prunes any `slotSelection` whose slot ID isn't in the
current program document. Switch from CS to ORIE and every course sitting in
a CS-template slot **is dropped from the plan without warning.** Given the
whole point of the major-match panel is to encourage students to explore
other majors, this punishes the exact behavior we're trying to drive. Under
the new vision (courses are primary, slots are suggestions) this bug largely
dissolves — but it needs to be an explicit design decision, not an accident.

## C5 — An interrupted drop animation loses the placement · `bug` · `med`
The actual mutation runs inside the drop animation's `onComplete`
(`DragGhost.tsx:136-184`). If the animation is interrupted — fast second
drag, tab blur, reduced-motion edge case — `onComplete` never fires and the
placement is silently lost. State mutation should not be gated on an
animation callback; commit first, animate second.

## C6 — Major-match ranking is biased toward your current major · `bug` · `med`
Detailed in #9 item 5. Logged separately because it's a correctness bug in a
*ranking* feature, not a design gap — it makes the suggestion engine
suggest what you already chose.

---

# Suggested sequencing

**Tier 0 — the product.** #3 (derive edges from the real prereq graph). This
is the vision, the logo, and the sell. Everything in the interaction layer
already exists; only the data source changes. Needs a brainstorm first (OR-branches,
forward-paths, hairball control), then a spec.

**Tier 1 — trust.** #4/#10 (the prereq data is *wrong*, systematically, on
the courses freshmen touch first) and C1 (three different answers to "is this
satisfied?"). A live prereq graph built on bad prereq data is worse than no
graph — it will confidently show students false chains. **#4 must land before
or alongside #3.**

**Tier 2 — the cage comes off.** #1, #5, #6, C4 — every place the template
overrides the student. These are all small, they're all the same idea, and
together they're what makes the app feel like *yours* instead of a form to
fill in.

**Tier 3 — polish + depth.** #2 (FWS rename — trivial, do it any time), #9
(rewrite major match properly, with tests), #11 (forbidden-overlap ingest —
small, self-contained, and the "you're burning credits" warning is a
standalone win that doesn't wait on anything), C2/C3/C5/C6.

**Tier 4 — the next product.** #7, #8. Own spec, own data-sourcing plan.

---

## One editorial note

Items #1, #5, #6, and C4 are all the same bug wearing four coats: **the
template is being treated as truth, and the student's actual choices as
exceptions to it.** Item #3 is that same bug at the architectural level — we
drew the map first and hoped the student would walk it.

Invert that single assumption and most of this log collapses. The courses the
student places are the truth. The template is a hint. The map is generated
from what's actually there.

That's the product.
