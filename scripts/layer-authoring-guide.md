# Writing a requirement layer (spec 019 Phase 4)

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
together contain every number, course and condition the row encodes. A table
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
npx tsx check-draft.ts ../docs/provenance/<programId>/draft-a.json
```

It checks the schema, the linter, the snapshot hash, every quote, and that every
rule matches real catalog courses. Fix every error. A catalog error usually
means a typo'd course id or a course Cornell no longer offers; if the page lists
a retired course, keep the others and say so in `notes`.
