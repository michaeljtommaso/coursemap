# Writing a requirement layer (spec 019 Phases 4 and 5)

How one Arts & Sciences or CALS major's (or any minor's, see "Minor layers")
requirements become a layer file the Distribution engine can check. Read this
whole page before writing a draft. The
format itself is defined in
`cornell-degree-planner/src/lib/planner/distribution/types.ts` (read its header
for the counting rules); the draft envelope and file layout are in
`scripts/layer-authoring.ts`.

## The one rule that matters

**A false green is worse than a false red.** A student who sees a requirement
marked done that isn't may skip a course they need. So encode exactly what the
page says, never more generous. When the page leaves a decision to a person (a
department officer's approval, a judgment about which courses fit a theme), do
not guess a course rule: write a `confirm` row ("confirm with your advisor"), or
a narrower rule plus a `confirm` row, and say so in `notes`.

## What goes in a major layer, and what doesn't

In:
- Courses and course counts the major requires, electives with their rules,
  sub-limits ("no more than one 2000-level course"), and per-department caps.
- Things a student must do that the board cannot see (minimum grades, GPA,
  "must be taken at Cornell", letter grade only, admission to the major,
  application deadlines that gate the degree) as `confirm` rows.

Exclusions the page often states in a side sentence or footnote, which an
open rule ("any FREN course at 3000+") silently lets back in. Look for each one
and encode it with `not` (plus a confirm row when the board can't identify the
courses):
- first-year writing seminars ("FWS" titles) not counting toward the major;
- honors thesis, independent study, research or internship courses not counting,
  or counting only "in addition to" the major;
- language-instruction courses not counting in a literature/linguistics major;
- 1-credit or variable-credit courses, or a credit floor per course;
- graduate (5000+) courses, or "no more than one 2000-level course";
- a named course that "does not fulfill" a requirement (e.g. one seminar that
  isn't a seminar, an honors tutorial).

**"Not accepted as fulfilling" is not an exclusion.** A sentence like "the
following are NOT accepted as fulfilling X: A, B" names things that do not
STAND IN for X (an attribute or course that is not itself X). It does not
remove courses that ARE X and also carry A or B. Encode it by keeping the rule
to X alone, never as `{ "not": <A or B> }` beside it: that reading once
refused 83 of 128 qualifying biology courses and 15 of 21 ethics courses.
check-draft warns (`exclusion-size`) when a `not` removes more than half of
the courses the rest of its rule matches, and prints every exclusion's count
on its `exclusions:` line; read the sentence again whenever it fires.

Also give every major a confirm row for applying to or declaring the major when
the page asks for an application, a prerequisite grade or a director's approval.

Out:
- College requirements (distribution, first-year writing seminars, language,
  the 120-credit total, PE, swim test). They live once in the college layer.
- Honors, study abroad advice, sample schedules, "recommended" courses that
  are not required. If the page says "recommended", it is not a row. (A minor
  is its own layer: see "Minor layers". A major page's sentence about how its
  courses may count toward a minor or a second major goes in the major
  layer's `sharing`, with its quote.)
- Concentrations: each is its own layer (`<programId>--<concentrationId>`,
  kind `concentration`). Note them in `notes` unless your task says to author them.
  If the page makes the student choose concentrations, set the major layer's
  `concentrations: { "min": 1, "max": 1 }` (or the page's numbers, e.g. "at
  least one, at most two" → `{ "min": 1, "max": 2 }`). When the page has
  headings that look like concentrations or tracks but the student need not
  choose one (or they are not separate concentrations at all), set
  `{ "min": 0, "max": 1 }` explicitly and say why in `notes`; check-draft
  refuses a major whose page has such headings and no `concentrations`.

## Concentration layers

A concentration layer holds only what the page asks for under that
concentration's heading (plus anything the page says applies to that
concentration specifically). The major's rows already live in the major layer:
never repeat them. Header:

```json
{
  "id": "cornell-animal-science-bs-2026--dairy-management",
  "kind": "concentration",
  "family": "cals",
  "name": "Animal Science: Dairy Management",
  "catalogYear": "2026-27",
  "programId": "cornell-animal-science-bs-2026",
  "concentrationId": "dairy-management",
  "rows": []
}
```

Every concentration layer states `courseSharing`:
- `"shared"`: a course may count toward a major requirement and a concentration
  requirement at once (the page allows it, or says nothing about it);
- `"separate"`: the page says a course may not satisfy more than one requirement
  (or may not count toward both the major and the concentration). The engine
  then counts each course once across the major and the concentration.
Quote the sentence that decides it. check-draft refuses a concentration draft
without the field.

## College layers

A college layer (`kind: "college"`) encodes the requirements every student of
the college meets whatever their major: distribution areas, first-year writing,
language, credit totals, residency, grades, PE and swim. Rules that differ by
entry term or transfer status use `appliesTo` on the row or the layer (see
`types.ts`). Keep the layer's id exactly as your task gives it.

## Minor layers (spec 047)

A minor layer encodes one minor's own requirements. It is chosen beside the
student's major, so it never repeats college requirements and never picks a
college layer. Header:

```json
{
  "id": "cornell-data-science-minor-2026",
  "kind": "minor",
  "family": "other",
  "name": "Data Science (Minor)",
  "catalogYear": "2026-27",
  "programId": "cornell-data-science-minor-2026",
  "rows": []
}
```

- `id` = `programId` = `cornell-<catalog slug>-2026`, like a major
  (`programs/data-science-minor/` → `cornell-data-science-minor-2026`).
- `family`: `cas` or `cals` for a minor offered by Arts & Sciences or CALS,
  `other` for any other college (Engineering, Bowers CIS, SC Johnson). Only a
  minor may use `other`.
- No `concentrations`, no `courseSharing`, no `concentrationId`, no college
  rows (distribution, writing, language, credit totals).

**Course-counting requirements are consuming rows.** "Six courses from these
lists", "one of A, B or C", "18 credits of psychology": write each as a seat,
pool (with `requiredCredits` when the page counts credits) or distribution
row. Never write a minor's main requirement as a `credits` row or an
`overlay` row: overlay rows never count toward an overlap limit, so a minor
written that way escapes its limit (check-draft warns,
`minor-main-requirement`). A credits row is right only for a rule that
re-counts courses the consuming rows already hold ("at least 9 of the credits
with an AEM code", "at least 9 credits taken at Cornell").

**Eligibility, grades and declaring the minor are confirm rows.** Minimum
grades, letter grade only, a minor GPA, admission grades ("C+ or better in
three courses"), sign-up deadlines and "enrollment in a major that approves
the minor" are confirm rows. A rule that depends on the student's major ("if
your major requires CS 1110, take a more advanced course") is a `program`
leaf when the page names the majors, else a narrower rule plus a confirm row.

**"Not open to X majors" is not a row.** It goes in the minor's entry in
`scripts/seed-data/minor-index.json` (`notOpenTo`, program-id prefixes): the
picker lists the minor disabled for those students. In the sentence ledger,
map that sentence to `eligibility` with the reason (which prefixes).

**AP, transfer and "taken at Cornell"** go through `creditKind` exactly as for
majors (see "Exam and transfer credit"): "all courses must be taken at Cornell"
excludes every exam kind and `transfer`.

### Sharing (overlap limits)

A minor layer (and a major layer whose page states such a rule) sets
`sharing` from the sentence that limits how its courses may count toward
another program:

```json
"sharing": { "otherMajors": { "maxCourses": 2 } }
```

| Field | On a minor layer | On a major layer |
|---|---|---|
| `otherMajors` | toward any major on the plan (primary or second) | toward a second major; `"forbidden"`: no second major at all |
| `minors` | toward another minor | toward a minor |
| `forbiddenWith` | program-id prefixes it can't be combined with at all | the same |

A limit is `"none"` (no course may count for both), or `{ "maxCourses": n }`
and/or `{ "maxCredits": n }`, optionally with `"with": [<program-id
prefixes>]` when the cap applies only with those partners. Absent means no
limit: leave `sharing` out when the page says courses may also count toward
other programs, or says nothing.

- **Quote it.** `quotes` gets a `"sharing"` entry: the page's sentence(s) that
  set the limit, word for word, stating every number the field holds
  (check-draft `sharing-quote`). When the page explicitly allows unlimited
  sharing, you may quote that sentence under `"sharing"` with no field set.
- **Encode the stricter limit the fields can express, plus a confirm row with
  the exact rule.** When Cornell's rule is narrower than these fields can say
  (a cap on only the major's core rows, "12 credits must be unique", a cap on
  only some courses), encode the STRICTER limit (it can only hold back too
  much, never too little) and keep a confirm row stating the real rule. Never
  encode a more generous limit. A number you work out this way (an 18-credit
  minor with 12 unique credits gives `maxCredits: 6`) goes in
  `derivedNumbers` under `"sharing"`.
- Overlap counts consuming rows and credits rows of each program; overlay
  rows and the college layer never count.

### Row ids are never reused

Students' waivers and answers are keyed by layer id and row id, and a minor's
stay stored after the student removes it. Once a layer has been seeded, a row
id means that requirement forever: give a new requirement a new id, and when a
requirement goes away retire its id. promote-layer.ts and
`validate-layers.ts --previous` refuse a row id whose meaning changed.

### The single-author chain and its sentence ledger

Minors are written by ONE author (framing `"single-author"`, author
`"merged"`, straight to `merged.src.json`), checklist first: write the
plain-English checklist in `checklist`, then the rows, then the ledger. The
ledger (`ledger` in the draft) accounts for every in-scope block of
`extract.json`:

```json
"ledger": [
  { "block": "P3", "to": "core-statistics" },
  { "block": "P4", "to": ["sharing", "core-computing"] },
  { "block": "P5", "to": "eligibility", "reason": "notOpenTo in the minor index" },
  { "block": "L4", "to": "out-of-scope", "reason": "suggested courses, not required" },
  { "block": "H6", "to": "out-of-scope", "reason": "advising contacts" }
]
```

- `block`: a block id (`P12` prose, `T4` table row), a list id (`L3`: every
  row of the list) or a heading id (`H5`: the whole section up to the next
  heading of the same or a higher level). Rows of a list a row was expanded
  from (`listRefs`) are accounted for already.
- `to`: a row id (or `parent/child`), `"sharing"`, `"eligibility"` or
  `"out-of-scope"`, or a list of several. `eligibility` and `out-of-scope`
  need a `reason`, and so does `sharing` when the layer sets none.
- A sentence about overlap, grades, residency (at Cornell, transfer, AP) or
  eligibility can never be out of scope: overlap goes to `sharing` or a row,
  grades and residency to a row, eligibility to a row or `eligibility`.

Run `npx tsx check-coverage.ts ../docs/provenance/<id>/merged.json` after
check-draft passes: it writes `coverage.json`, which the review sheet and
promote-layer require. check-draft reports the same problems as
`sentence-coverage` errors.

### Golden plans for a minor

`golden-fixture.json` proves the minor alone: `layerIds: ["<minorId>"]`,
`ctx.programId` = a real major the minor is open to. When the minor sets a
limit toward majors (`sharing.otherMajors`), a second fixture,
`golden-overlap.json`, proves the limit (check-overlap-fixture.ts): a promoted
major from `scripts/seed-data/layers/` and the minor, a plan that completes
the minor while the two count more courses in common than the limit allows,
the courses both count (`shared`), the pair's `limit`, and `heldBack`: which
course(s) the limit holds back and from which program.

## Layer header

```json
{
  "id": "cornell-economics-ba-2026",
  "kind": "major",
  "family": "cas",
  "name": "Economics (BA)",
  "catalogYear": "2026-27",
  "programId": "cornell-economics-ba-2026",
  "rows": []
}
```

- `id` = `programId` = `cornell-<catalog slug>-2026` (the slug is the last part
  of the page URL, e.g. `programs/economics-ba/` → `economics-ba`).
- `family`: `cas` for Arts & Sciences, `cals` for CALS.
- `name`: the page title without "| Cornell University".

## Rows

Every row has a stable kebab-case `id` (unique in the layer; anyOf children too),
a plain-English `label` (what the student sees), a `group` heading ("Core",
"Electives", "Grades", …) and `source: { url, anchor }`:
- `url`: the page URL exactly (https).
- `anchor`: the nearest section heading above the requirement, exactly as the
  page writes it ("Program Requirements").

Choose the row kind by what the page asks for:

| Page says | Kind | Notes |
|---|---|---|
| one named course, or one of a short list | `seat` | `rule: { course: [...] }`; `credits` = the course's credits if not 3 |
| N courses (and/or N credits) from a rule or list | `pool` | `requiredCourses`, `requiredCredits` (0 when the page gives only a count, or only credits) |
| spread over areas ("one course in each of three of these five areas") | `distribution` | categories with their own rules; `minDistinctCategories`; `perCategory` min/max |
| a credit total ("at least 30 credits in the major") | `credits` | always overlay (it never uses a course up) |
| either this shape or that one | `anyOf` | children are seat/pool/distribution/credits |
| anything the board cannot check | `confirm` | grades, GPA, residency, approvals, admission |

Course rules (`types.ts`, `RuleLeaf`): `course` (ids in `SUBJ-NNNN` form, e.g.
`ECON-3130`), `subject`, `number: { min, max }`, `tag` (roster attributes),
`minCredits`, `not`, `allOf`, `anyOf`. Examples:
- "ECON courses numbered 3000 or above" → `{ "allOf": [{ "subject": ["ECON"] }, { "number": { "min": 3000 } }] }`
- "…excluding independent study ECON 4990" → add `{ "not": { "course": ["ECON-4990"] } }` to the `allOf`.
- "courses of at least 3 credits" → add `{ "minCredits": 3 }`.
- A course listed with a slash ("ECON 3130/ECON 3170") is two ids, either one counts.

### Extracted lists

`extract.json` (made from the saved page by `extract-catalog-page.ts`) splits
every course table into numbered lists: `L1`, `L2`, … Each list is one run of
course rows, with the header and comment lines just above it (`lead`, e.g.
"Select two of the following: | 6") and the headings above the table (`path`).
Instead of typing a list's courses, write `{ "list": "L3" }` anywhere a rule
goes (`{ "list": ["L3", "L4"] }` for two). Write your draft as
`draft-<you>.src.json`; `expand-draft.ts` replaces each list with its course ids
and records which lists each row used, and those lists then count as the
citation for their courses (you still quote the line that sets the count).
Check a list before using it whole:
- "or" rows are alternatives inside the list; "&" rows (`paired: true`) are two
  courses taken together. A seat may take such a list whole (it counts one
  course). A pool, credits or distribution row may NOT: counted course by
  course, "A or B" would let both count and an "A & B" pair would count as two.
  expand-draft refuses it. Name the courses yourself (often as several seats),
  or, only when every member truly counts on its own, write
  `{ "list": "L3", "flatten": true }` and say why in `notes`.
- Indented rows are the options under a chooser line ("Select one of the
  following"); the extractor ends the list where a non-indented course follows.
- A list contains only its own run of rows; a table with several "Select …"
  lines is several lists.
- To leave courses out: `{ "allOf": [{ "list": "L3" }, { "not": { "course": ["X-1234"] } }] }`.

**Another program's lists.** When the page defines a requirement by lists it
does not print itself (a minor's areas named by the codes the major's page
lists courses under), a rule may name a list of ANOTHER program's saved page:
`{ "list": "cornell-music-ba-2026:L3" }`. That program's provenance folder must
hold its own verified snapshot and `extract.json` (snapshot and extract it
first if it has none), of the same catalog edition. Its courses then count as
cited and as page-only courses like the page's own lists, but its lead lines
never state a count for this page: quote this page's sentence for every count.
Use it only when this page names the area, code or list the other page
defines (say which in `notes`); never to borrow a list the page does not
point to.

Pages written as paragraphs (no tables) have no lists: type the course ids,
and quote the sentence that names them. A sentence like "eight courses at the
2000 level or above in the department" is a pool over a subject and number
rule, not a list.

Counting: within one layer a course counts once. If the page says a course may
count for two requirements, say so in `notes` (the engine may need `overlay`).
If the page says a course may NOT count twice, that is the default.

Sub-limits go in `limits` on a pool or credits row:
`{ "rule": …, "maxCourses": 1 }` = "no more than one of these",
`{ "rule": …, "minCredits": 6 }` = "at least 6 of the credits from these".

Use `appliesTo` only when the page sets different rules by entry year or
transfer status (rare for majors).

## Questions (spec 020)

Some rules turn on a fact the board cannot see: "if counted toward the writing
seminar requirement", "with the DUS's approval", "when taught by department
faculty", "honors students", "taken for 4 credits". Before spec 020 the only
answer was a narrower rule plus a `confirm` row. Now a layer may also ASK the
student, with a `questions` list (at most 20) and an `answered` rule leaf.

Rules:
- **Pick a type from the closed list; never write wording.** The app owns every
  prompt (`cornell-degree-planner/src/lib/planner/questions/registry.ts`). A
  question is a type plus parameters; there is no text field for the question,
  and the schema rejects any other type, approver, condition or fact.
- **Every question carries Cornell's sentence** as `quote`: one whole sentence,
  copied word for word from `snapshot/page.txt` (check-draft rejects a quote
  not on the page; promote-layer re-checks it). Unlike row quotes, a question's
  quote is published with the layer, so quote only the sentence that decides it.
  Give it a `source: { url, anchor }` like a row's.
- **Read the answer with an `answered` leaf in the target row.** The leaf holds
  the question's ref: `<type>:<layerId>/<rowId>` for `usedAs`, `approvedFor`,
  `courseCondition`; `studentFact:<fact>:<subject>` for a fact. Put the course
  limit next to it with `allOf`, so a stray answer can never widen the rule:
  `{ "anyOf": [<the rule as before>, { "allOf": [{ "course": ["ENGL-2880"] }, { "answered": "usedAs:cas-college/fws" }] }] }`.
  Lint refuses a row-scoped question no leaf in its row reads, a leaf naming a
  question the layer does not declare, and a leaf naming a credit question.
- **`usedAs` must target an exclusive row** (`exclusive: true`, itself or its
  anyOf parent): a yes counts the course there and nowhere else.
- **Unanswered means no.** Write the rule so the strict reading (every answer
  "no") is what the page guarantees; a yes only ever adds courses or credits.
- **Facts the app already knows are NOT questions.** Internal vs external
  transfer is the student's start answer: use the row's `appliesTo` with
  `transfer`. Exam scores are on the student's credit entries: a score
  threshold is an `examScore` leaf (see "Exam and transfer credit" below),
  never a question. Entry term is `appliesTo` too.

| Type | Use when the page says | Parameters | Example |
|---|---|---|---|
| `usedAs` | a course counts here only if the student uses it here, and then for nothing else | `row` (exclusive), `courses` (a rule) | `{ "type": "usedAs", "row": "fws", "courses": { "course": ["ENGL-2860", "ENGL-2880"] }, "source": {…}, "quote": "First-year writing seminars and ENGL 2860 … may not count toward any other college or major requirement." }` |
| `approvedFor` | a course counts with an advisor's, the DUS's or the director's approval | `row`, `courses`, `approver`: `advisor` / `dus` / `director` | graduate BIOMG courses with DUS approval: `"courses": { "allOf": [{ "subject": ["BIOMG"] }, { "number": { "min": 5000 } }] }, "approver": "dus"` |
| `courseCondition` | a course counts only when something about that offering holds | `row`, `courses`, `condition`: `taughtByDepartmentFaculty` / `lifeScienceFocus` | a cross-listed course taught by the department's own faculty |
| `creditsTaken` | a variable-credit course must be taken for a certain number of credits | `course` (dash id), `values` (the allowed credits) | `{ "type": "creditsTaken", "course": "BIOMI-4850", "values": [2, 3, 4] }` (no leaf: the answer sets the course's credits for every row) |
| `sequenceDone` | a course counts for more credits when a sequence is finished | `course` (the anchor), `sequence`, `credits` | `{ "type": "sequenceDone", "course": "NTRES-4302", "sequence": ["NTRES-4300", "NTRES-4301", "NTRES-4302"], "credits": 6 }` (no leaf) |
| `studentFact` | a rule depends on the student, not a course | `fact`: `acceptedToProgram` / `honorsProgram` / `departmentExamPassed`; `subject` (a program id or a department, e.g. `ECON`); optional `row` | `{ "type": "studentFact", "fact": "departmentExamPassed", "subject": "GERST", "row": "german" }` with `{ "answered": "studentFact:departmentExamPassed:GERST" }` in that row |

A cap on approved courses ("up to two with approval") is an ordinary `limits`
entry whose rule is the same `answered` allOf. A narrowed rule plus a `confirm`
row stays a correct encoding of an approval rule; a question is better when the
student can answer it, and both together is fine (the confirm row reminds them
to get the approval). A `usedAs` / `approvedFor` / `courseCondition` question
belongs to its one target row (lint refuses a leaf for it anywhere else; two
rows needing the same approval need two questions); a `studentFact` may be read
by any row of its layer, and a layer declares each fact at most once.

Small worked examples of every type: `scripts/seed-data/layers-test/questions/`
(fictional test majors) and their students in `scripts/seed-data/golden/questions/`.

## Exam and transfer credit (spec 028)

**Every course-id rule already accepts credit.** The student's exam and
transfer credit reaches the engine as synthetic credit courses: the exam
tables (`cornell-degree-planner/src/data/credit-tables/<year>.json`) turn
"AP Calculus BC, 5" into a credit course for each Cornell id Cornell's table
grants (`MATH-1110`, `MATH-1120`), and a transfer course arrives under the
Cornell id it was credited as. A credit course has a subject and number taken
from its id but no tags and no title, so tag rules and `titleStartsWith` never
match it; `course`, `subject` and `number` rules do. So a row that lists
`STSCI-2100` counts AP Statistics credit unless you say otherwise, and a row
listing only tags never counts any credit. Read every AP/IB/transfer sentence
on the page and decide which of the cases below it is.

What a credit course carries:
- `creditKind`: `ap`, `ib`, `alevel` (GCE A-Level), `intl` (the smaller
  national tables: French Baccalaureate, Cambridge Pre-U, ...), `transfer`, or
  `placement` (CASE and department placement credit). An unknown kind matches
  every `creditKind` list, so exclusions fail closed.
- `examScore` data: the exam id from the tables (`ap-statistics`,
  `ib-economics-hl`, `alevel-economics`) and the score as printed (`"5"`,
  `"7"`, `"A*"`). The leaf `{ "examScore": { "exam": [...], "scores": [...] } }`
  matches only an exam credit course from a listed exam at a listed score;
  a transfer course and every Cornell course fail it.
- One of several ids: when Cornell grants "X or Y" (AP Chemistry is CHEM 2070
  & 2071 or CHEM 2090 & 2091; AP Statistics places out of one of a dozen
  statistics courses) the table's `courseOptions` give ONE credit course per
  position, which matches a rule as whichever option the rule accepts, and
  counts once. Taking one of the options at Cornell uses the credit up.
- A lecture and its lab are two credit courses when Cornell grants both, so
  a pool needing CHEM 2070 and CHEM 2071 fills from one AP exam.
- An award with no course ids (AP Biology, the English exams) makes no credit
  course at all: no layer row can count it. Keep a confirm row.

Encode the page's sentence, not the table's general rule:

| Page says | Encode | Example |
|---|---|---|
| "AP credit is not accepted" for this requirement | wrap the rule: `{ "allOf": [<rule>, { "not": { "creditKind": ["ap"] } }] }` | Biology & Society intro biology |
| the requirement must be taken at Cornell, or "AP, IB, or other test credit" / "AP/test credit" | exclude every exam kind (`["ap","ib","alevel","intl","placement"]`) and `transfer` too when the page says "at Cornell" | Nutritional Sciences statistics: `{ "not": { "creditKind": ["ap","ib","alevel","intl","placement"] } }` (transfer still counts) |
| only some exams are named ("AP, IB, and GCE credit ... is not accepted") | list exactly those kinds | Plant Sciences: `["ap","ib","alevel"]` |
| a score threshold ("AP Statistics with a score of 5") | an `examScore` branch next to the plain rule, and keep the other scores out of the plain branch when the table would grant them | Biological Sciences `second-math`: `{ "anyOf": [{ "allOf": [<list rule>, { "not": { "examScore": { "exam": ["ap-statistics","alevel-statistics"], "scores": [every score] } } }] }, { "allOf": [{ "course": ["STSCI-2100"] }, { "examScore": { "exam": ["ap-statistics"], "scores": ["5"] } }] }] }` |
| exam credit counts only with something the board cannot see (a department placement exam) | the `examScore` branch plus a spec 020 `studentFact` question in the same `allOf`; unanswered means no | Economics intro micro: `{ "allOf": [{ "course": ["ECON-1110"] }, { "examScore": {...} }, { "answered": "studentFact:departmentExamPassed:ECON" }] }` |
| "elective credit only" / "counts toward the 120 but not the major" | check that no major row's rule can match the granted ids (`subject` and `number` rules can); add an exclusion where one does | Biological Sciences: the table grants biology exams no id any Bio Sci row lists, so nothing to add |
| exam credit plus a Cornell course ("AP Chemistry 5 AND CHEM 2150") | a pool over both, with a `minCourses` limit on the Cornell course and a `maxCourses: 0` limit on the credit ids taken at Cornell | Nutritional Sciences option C: rule `{ "anyOf": [{ "course": ["CHEM-2070","CHEM-2071"] }, { "course": ["CHEM-2150"] }] }`, `requiredCourses: 3`, limits `[{ "rule": { "course": ["CHEM-2150"] }, "minCourses": 1 }, { "rule": { "allOf": [{ "course": ["CHEM-2070","CHEM-2071"] }, { "not": { "creditKind": ["ap","ib"] } }] }, "maxCourses": 0 }]` |
| exam credit counts here and the page names no course id | a branch over subject + kind, beside the course rule | Environment & Sustainability core physics: `{ "allOf": [{ "subject": ["PHYS"] }, { "creditKind": ["ap","ib","placement"] }] }` |

Checker constraints. validate-layers and check-draft see only catalog
courses, never credit: a seat, pool, anyOf child or limit-with-a-minimum
whose rule only credit can match is an error ("no catalog course matches"),
so put a credit-only branch inside a rule's `anyOf` next to a catalog branch,
or use the `maxCourses: 0` pattern above. Every course id in a credit branch
still needs a quote that names it, and the golden plan holds catalog courses
only: probe the Cornell side of a credit rule (a Cornell STSCI 2100 must not
count toward Biological Sciences `second-math`) and say in the ledger that the
credit side was checked against the engine.

## Quotes (provenance)

The draft envelope (`Draft` in `scripts/layer-authoring.ts`) carries `quotes`:
for every top-level row, one or more fragments copied WORD FOR WORD from
`snapshot/page.txt` (whitespace may differ; at least 12 characters each) that
together contain every number, course and condition the row encodes. A count
or course-number bound that no quote states is an error. When a number follows
from the page without being written on it ("twelve courses in all" minus the
nine required = "the remaining three"), record how in the draft's
`derivedNumbers` (`{ "<row id>": "how it follows" }`); the reviewers read it. A table
row is a valid fragment (copy the whole line). anyOf children may have their own
quotes; otherwise they use the parent's. `check-draft.ts` rejects any fragment
not found on the page and any course the row names that its quotes don't
mention, so never paraphrase inside a quote, and quote whole sentences or table
lines rather than stitching pieces.

Labels, notes, group headings and the layer name are public and must NOT copy
the page's sentences: paraphrase them in your own words (`check-draft.ts`
rejects any that share eight consecutive words with the page). Quotes live only
in the private provenance folder.

## Checking your draft

From `scripts/`:

```
npx tsx expand-draft.ts ../docs/provenance/<programId>/draft-a.src.json
npx tsx check-draft.ts ../docs/provenance/<programId>/draft-a.json
```

Always edit the `.src.json` and re-run both; never edit the expanded file.
check-draft checks the schema, the linter (including questions and `answered`
leaves), the snapshot hash, every quote (each question's quote too), and that every
rule and every question's courses match real catalog courses. Fix every error. The offline catalog only
holds courses on recent rosters, so a course the page lists may be missing from
it: KEEP it in the rule exactly as the page lists it (check-draft accepts any
course named on the saved page and reports it as a `page-only-course`
warning). Dropping it would mark a student who took it as short. A catalog
error on a course id the page does not name means a typo: fix it.
