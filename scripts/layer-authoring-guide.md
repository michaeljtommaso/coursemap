# Writing a requirement layer (spec 019 Phases 4 and 5)

How one Arts & Sciences or CALS major's requirements become a layer file the
Distribution engine can check. Read this whole page before writing a draft. The
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

Out:
- College requirements (distribution, first-year writing seminars, language,
  the 120-credit total, PE, swim test). They live once in the college layer.
- Honors, minors, study abroad advice, sample schedules, "recommended" courses
  that are not required. If the page says "recommended", it is not a row.
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

A course may count in both the major layer and its concentration layer (layers
are checked independently). If the page says a concentration course may NOT also
count toward a major requirement, use a `confirm` row and say so in `notes`.

## College layers

A college layer (`kind: "college"`) encodes the requirements every student of
the college meets whatever their major: distribution areas, first-year writing,
language, credit totals, residency, grades, PE and swim. Rules that differ by
entry term or transfer status use `appliesTo` on the row or the layer (see
`types.ts`). Keep the layer's id exactly as your task gives it.

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
check-draft checks the schema, the linter, the snapshot hash, every quote, and that every
rule matches real catalog courses. Fix every error. The offline catalog only
holds courses on recent rosters, so a course the page lists may be missing from
it: KEEP it in the rule exactly as the page lists it (check-draft accepts any
course named on the saved page and reports it as a `page-only-course`
warning). Dropping it would mark a student who took it as short. A catalog
error on a course id the page does not name means a typo: fix it.
