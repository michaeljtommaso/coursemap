# Spec 010 — Attribute Requirements + Roster Ingest (crseAttrs, enrollGroups)

STATUS: IMPLEMENTED (code; gated re-seed pending) — built 2026-07-11 on impl-007-013;
see docs/reference/implementation-status.md. (Designed 2026-07-11, brainstorm session with Michael;
approved section-by-section)
Depends on: nothing above — can run parallel to 007/008/009.
Blocks: 011 (category/list elective rules need attributes), 012 (horizon
cards need enrollGroups), 013 (hub + reviews need instructors).
Source: docs/audits/2026-07-11-vision-gap-and-graph-audit.md (#2, #13a,
#13b, C3, Part 1.5 measured API audit).

The principle this spec establishes once, generally: **requirements can
match on course properties, not just course codes.** FWS, distribution
categories, and liberal studies all have this shape.

## 0. Summary of decisions (made 2026-07-11)

| Decision | Choice |
|---|---|
| Distribution source | `crseAttrs` ONLY — `catalogDistr`/`catalogSatisfiesReq` are deprecated (measured 0% on FA26) |
| FWS matching | Attribute/title requirement kind: `titleLong` starting with "FWS:" (the durable signal), plus writing-related `crseAttrs` where present |
| FWS naming | Cards say "First-Year Writing Seminar" — student words; the pattern token `FWIS-1xxx` dies from all seeds |
| enrollGroups | Full ingest: instructors, meetings, openStatus, gradingBasis, componentsRequired (we currently read credits and discard the rest) |
| Ingest hygiene | Defensive parse; malformed → raw + flagged, never nonsense; rerunnable per semester |

## 1. Course document additions

`roster-sync.ts` + `lib/schemas.ts` course schema:

```
attrs:      { value: string, descr: string, group: string }[]  // from crseAttrs
sections:   {
  code: string,                 // e.g. "LEC 001"
  instructors: { netid: string, firstName: string, lastName: string }[],
  meetings: { pattern: string, timeStart: string, timeEnd: string }[],
  openStatus: "O" | "C" | "W" | string,   // open/closed/waitlist, stored raw
  gradingBasis: string | null,            // e.g. "OPI" (S/U option)
  components: string[]                    // e.g. ["LEC","DIS"]
}[]
rosterId:   string             // which roster this snapshot came from (e.g. "FA26")
```

- All fields parse defensively: missing/odd values stored raw with a
  flag, never invented. The sync stays merge-upsert and rerunnable,
  preserving `authored` prereq data per 007 §3.4.
- Sections are per-roster snapshots: near-term rosters have rich
  sections; future terms simply have none — which is exactly the
  honesty spec 012 renders. (Historical rosters for the instructor
  timeline are spec 013's pipeline, not this ingest.)
- Firestore size note: sections go on the course doc for the active
  roster only; the catalog index (search) gains only lightweight
  derived flags (has-open-sections, attrs list) to keep the index lean
  and the read budget flat.

## 2. The attribute requirement kind (fixes #2 and C3 structurally)

The requirement/slot model gains a kind that matches on course
properties:

```
{ kind: "attribute",
  label: "First-Year Writing Seminar",
  match: { anyOf: [
    { field: "titleLong", op: "startsWith", value: "FWS:" },
    { field: "attrs.value", op: "in", value: ["WRT-AG", ...] }
  ] },
  credits?: number }
```

- Evaluated inside 007's single `satisfies()` — one function, all
  surfaces (card, majors panel, Find-a-class).
- **FWS re-modeled:** every `FWIS-1xxx` pattern slot in seeds
  (slots.json, programs.json, programs-2025/*) becomes an attribute
  requirement labeled "First-Year Writing Seminar." The unsatisfiable-
  by-construction bug dies; the two tests asserting the wrong token
  (`slotCategory.test.ts:41, 75`) are corrected.
- **"Find a class" honors attribute requirements:** `slotSearchSeed()`
  (semesters.ts:91) stops emitting code-prefix queries for attribute
  slots and instead runs the attribute match against the catalog index —
  the FWS slot now returns the real ~59+ FWS courses across 20 subjects
  (C3 dies).
- Distribution/liberal-studies requirements become expressible the same
  way (consumed by spec 011's authoring pipeline; this spec only
  provides the kind + evaluation).

## 3. Catalog index + search

- `catalogIndex` gains `attrs` values and an `fws: boolean` derived flag
  so attribute matching is an index filter, not a per-doc read (read
  budget: scan once at sync time, cache in the index — per the
  2026-07-07 quota lesson).
- The Classes page + drawer filters can expose attribute facets
  (Distribution: ALC-AS, …) — minimal UI here; spec 013 owns the hub.

## 4. What is deliberately NOT ingested

Measured 0% populated on FA26 (Part 1.5) — do not scope work against:
`catalogDistr`, `catalogCrosslistings`, `catalogWhenOffered`,
`catalogSatisfiesReq`, `catalogComeets`, `catalogPermission`.
Cross-listings continue via the existing alias map.
`catalogOutcomes` (35%) — parked; candidate for the hub's detail view
later, not needed by anything specced.

## 5. Testing

- Unit: attribute matcher (startsWith/in/anyOf), FWS fixture courses
  from 20 subjects, attribute slot inside `satisfies()`, index flag
  derivation.
- Ingest: golden-file tests on real API responses (including a malformed
  coreq row and an empty enrollGroups row); sync dry-run diff reviewed
  before live run (house rule from spec 002/006 era).
- Browser (Sonnet subagent): FWS slot "Find a class" returns FWS courses;
  card label reads "First-Year Writing Seminar"; majors panel and card
  agree on FWS satisfaction (C1-class regression).

## 6. Out of scope

- RMP/professor data (spec 013 pipeline; this spec only lands roster
  instructor identity).
- Time-conflict logic and horizon card rendering (spec 012 — this spec
  lands the data).
- Authoring the majors corpus (spec 011).
