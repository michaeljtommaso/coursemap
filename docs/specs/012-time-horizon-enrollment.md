# Spec 012 — Time-Horizon Cards + Enrollment Week

STATUS: IMPLEMENTED (code; near face gated on enrollmentTarget + sections data) — built 2026-07-11 on impl-007-013;
see docs/reference/implementation-status.md. (Designed 2026-07-11, brainstorm session with Michael;
approved section-by-section)
Depends on: 010 (enrollGroups ingest: instructors, meetings, openStatus).
Feeds: 013 (the hub reuses the horizon rule and conflict logic).
Source: docs/audits/2026-07-11-product-thesis.md §3–4 (the time-horizon
model — "the sharpest idea in this session"),
vision-gap audit #13b.

The thesis: **data has a shelf life, and nobody models this.** Who is
teaching matters enormously for next semester and is unknowable four
semesters out. The synthesis: enrollment week is the door, major
discovery is the room — this spec builds the door well.

The honesty rule, stated once and enforced everywhere:
> **A card never displays data whose shelf life is shorter than the
> card's distance.**

That sentence is what makes Coursemap the only tool that doesn't lie
about the future.

## 0. Summary of decisions (made 2026-07-11)

| Decision | Choice |
|---|---|
| First build scope | Horizon-aware cards + time-conflict detection (the audit's "sleeper feature") |
| Horizon boundary | Binary: near (the enrollment-target semester) vs far (everything beyond). No sliding scale in v1 |
| Conflicts | Advisory, never blocking; computed only where real meeting data exists |
| Full enrollment-week mode (schedule grid, section picker) | Deferred — second surface, not now |
| RMP on cards | Near-horizon only, arrives via spec 013's adapter; this spec renders the slot for it |

## 1. The horizon model

- **`enrollmentTarget`** — a single app-level value naming the semester
  students are currently enrolling for (e.g. "FA26"). Stored in app
  config (one Firestore doc read at boot, cached), updated by us each
  cycle. Not user-editable in v1.
- Every rendered card/detail derives `horizon: "near" | "far"`:
  `near` iff the card's semester === enrollmentTarget (and the semester
  is not in the past). Past semesters render as they do today
  (complete/record-keeping view — horizons are about the future).
- The boundary is deliberately binary in v1. "Two semesters out with
  provisional data" tiers can come later; the honesty rule makes the
  binary version already differentiated.

## 2. Near-horizon card + detail ("should I take this, right now?")

Data: the placed course's `sections` for the active roster (010 §1).

Card (kept glanceable — the card is not a table):
- **Instructor line**: primary instructor name(s); multi-section courses
  show "3 sections · 2 instructors" with detail in the panel.
- **Meeting chip**: pattern + time ("TR 10:10–11:25") for the primary
  section; conflicts state (§4) when applicable.
- **openStatus dot**: open / waitlist / closed, live from the last sync.
- **"varies by instructor" indicator** when spec 013's data shows sharp
  rating divergence across a course's instructors — on the card as a
  quiet badge; the panel carries the full timeline (§3 of spec 013).
- Reserved slot for the professor rating (013's adapter; renders nothing
  until 013 lands — never a placeholder).

Detail panel (near): all sections listed — instructor, times, status,
S/U availability (`gradingBasis`), components ("also requires a
discussion section"), each instructor deep-linkable once 013 lands.

## 3. Far-horizon card + detail ("do I even like this field?")

- Description, credits, distribution tags (010), **unlocks count + list**
  (008's reverse index), prereq status (007).
- **Honestly omits the instructor** — no professor, no rating, no
  meeting times. A subtle line in the detail panel says why:
  "Instructors and schedules are announced closer to the semester."
  The absence is a feature and the copy says so calmly.
- Course evals (the OfficialEvalsAdapter idea) remain the designated
  far-horizon peer signal — parked behind the 013 seam, not built now.

One component, horizon-driven content: `SlotCard` and
`CourseDetailPanel` branch on `horizon` internally — not two designs,
not two components.

## 4. Time-conflict detection (the sleeper feature)

`lib/planner/conflicts.ts`:

```
findConflicts(placed: PlacedCourse[], semester: SemesterId,
              sections: SectionData): Conflict[]
  Conflict = { aCourseId, bCourseId, overlap: { days, timeRange } }
```

- Pairwise comparison of meeting times within the near-horizon column
  only. Day-pattern parse ("TR", "MWF") + minute-range overlap; sections
  missing times are skipped silently.
- Multi-section handling, v1 decision: compare **primary sections only**,
  with the honest caption "based on the main lecture times — other
  sections may differ." The full every-combination check ("section
  choice avoids the conflict") is the designed v2 upgrade inside the
  same `findConflicts` API; v1 must not overclaim beyond its caption.
- Rendering: advisory conflict state on both cards ("meets at the same
  time as CS 2110") + detail-panel specifics. Never blocking, never red
  — sections change and students plan around them.
- Never computed where meeting data doesn't exist: far-horizon columns
  can't have conflicts by definition (the honesty rule again).

## 5. Data freshness

- `openStatus` and sections are as fresh as the last roster sync; the
  near-horizon panel carries a quiet "as of <sync date>" stamp. During
  enrollment week we run the sync daily (manual or scheduled — ops note
  in DEPLOY.md, not new infra in this spec).
- A course with no sections in the active roster renders its far-horizon
  face even in the near column, with "not offered this term" — honest,
  and it reuses the offered-terms data that already exists.

## 6. Testing

- Unit: horizon derivation (near/far/past), conflict math (day parse,
  overlap, contained ranges, no-data skips, multi-section logic), the
  not-offered case.
- Browser (Sonnet subagent): near card shows instructor/time/status;
  same course moved to a far semester drops them and shows
  description/unlocks; two colliding courses in the near column show the
  conflict both ways; moving one away clears it.

## 7. Out of scope

- Full enrollment-week mode (schedule grid, section picker, live refresh)
  — deliberately deferred; this spec makes the canvas enrollment-aware
  without building a second surface.
- Section *selection* (persisting which section a student intends) —
  needed by the schedule grid later, not by advisory conflicts now.
- RMP/evals data acquisition (spec 013).
- Multi-year enrollmentTarget automation (manual config update is fine
  at our scale).
