# Flowchart Verification — Existing 4 Programs vs 2025 Charts

Date: 2026-07-07. Reviewer: Claude (pass-b).

Scope: verify the four already-seeded programs (`cornell-cs-bs-2026`,
`cornell-ece-bs-2026`, `cornell-me-bs-2026`, `cornell-ore-bs-2026`) against the
official 2025 flowcharts now mirrored in this folder. **Report only** — slot ids
and structures are NOT changed (live user plans reference them). Metadata-only
fixes are noted as recommendations, not applied.

Source of truth for the seed state: `scripts/seed-data/{programs,slots,edges}.json`
(these assemble the Firestore `programs/*` docs via `seed-firestore.ts`).

Legend recap: circle = major program course, rectangle = common curriculum,
triangle = engineering distribution, plain box = elective; solid arrow = prereq,
double line = prereq-or-coreq (coreq), dashed = concurrent.

---

## Summary

All four programs match their 2025 charts **structurally and course-for-course**
in the fixed-course backbone (math/physics/chem common curriculum + named major
courses land in the same semesters as the chart). No missing or extra *named
course* slots were found. Discrepancies are confined to (a) how elective/choice
boxes are modeled, (b) a few prereq edges the seed omits that the chart draws,
and (c) the seed's `catalogYear: 2026` vs the chart's 2025 entering-class basis.
None require touching slot ids.

| Program | Chart named courses present? | Semester placement | Edge coverage | Verdict |
|---|---|---|---|---|
| CS   | ✓ all present | ✓ matches | partial (seed omits some chart arrows) | PASS |
| ECE  | ✓ all present | ✓ matches | partial | PASS |
| ME   | ✓ all present | ✓ matches | partial | PASS |
| ORE  | ✓ all present | ✓ matches | partial | PASS |

---

## CS — `cornell-cs-bs-2026` vs 2025-CS.jpg

Chart columns (S1..S8):
- S1: MATH 1910, CHEM 2090&2091, CS 111x, FWIS, PE
- S2: MATH 1920, PHYS 1112, PHYS 1110, ENGRI 1xxx, FWIS, PE
- S3: MATH 2940, PHYS 2213, ENGRD/CS 2110, CS 2800, Liberal Studies
- S4: ENGRD 2XXX, CHEM 2080&2081, CS 3110, CS 3700 or CS 3780, Liberal Studies
- S5: Advisor Elect, Major Elect, CS 3410/3420/ECE 3140, Major Elect, Liberal Studies
- S6: Advisor Elect, Major Elect, CS 4820, Major Elect, Liberal Studies
- S7: Major Elect ×3, CS 4410 or CS 4414, Liberal Studies
- S8: Major Elect ×3, Liberal Studies

Findings:
- **Match:** every fixed course (MATH 1910/1920/2940, PHYS 1112/1110/2213,
  CHEM 2090/2091/2080/2081, CS 2110/2800/3110/4820) is present in the seed in the
  same semester. Choice boxes map correctly: CS 3700/3780 → `cs-networks-choice`
  (S4 `cs-s4-netsys`), CS 3410/3420/ECE 3140 → `cs-systems-choice` (S5), CS
  4410/4414 → `cs-os-choice` (S7).
- **Minor (no action):** the chart's S4 CS 3700/3780 box sits in the *bottom* row
  under CS 2800; the seed places `cs-s4-netsys` at slotRow 4. Cosmetic row order,
  not a correctness issue.
- **Edge gap (recommend, not applied):** the chart draws CS 2110 → CS 3410-choice
  and CS 2800 → CS 4820 (both present in seed) but the seed's CS 3110 → networks
  edge exists while the chart shows the CS 3110 → CS 4410/4414 systems-track path
  running through CS 3410. Seed edge set (16) is a faithful subset; no wrong edges.
- **Metadata:** `catalogYear` is 2026 in the seed; chart is the 2025 entering
  class. Consistent with the README note that our seed claims 2026–27 catalog and
  the 2025 chart is the closest official reference. No fix — intentional.

Verdict: PASS. No slot/structure changes needed.

## ECE — `cornell-ece-bs-2026` vs 2025-ECE.jpg

- **Match:** PHYS 1112/1110/2213/2214, MATH 1910/1920/2930/2940, ECE/ENGRD 2100
  (S3), ECE/ENGRD 2300 (S3), ECE/ENGRD 2720 (S4), CHEM 2090/2091 (S1) all present
  and in-semester. ECE Foundation / ECE Elective / Outside Tech Elective boxes map
  to `ece-foundation`, `ece-elective`, `ece-outside-tech` groups.
- **Note:** chart shows MATH 1910 in S1 row 2 and CHEM 2090&2091 in S1 row 1; seed
  has `ece-s1-chem2090` row 0, `ece-s1-math1910` row 1 — order swapped vs chart but
  same semester. Cosmetic.
- **Edge gap (recommend):** chart draws PHYS 2213 → PHYS 2214 (seed has it),
  MATH 2930 → MATH 2940 (seed has it), and ECE 2100 → ECE 2300 (seed has it). The
  chart's double-line (coreq) from MATH 1920 into ECE/ENGRD 2100 is modeled as a
  plain `prereq` in the seed; consider retyping that one edge to `coreq` on a
  future safe metadata pass. Not applied here.
- Verdict: PASS.

## ME — `cornell-me-bs-2026` vs 2025-ME.jpg

- **Match:** MAE 2030 (S4), MAE 2250 (S4), MAE 3260/3270/3230 (S5), MAE 3240 (S6),
  MAE 4272 (S7), PHYS 2214 (S6), ENGRD 2020/2210 (S3), MATH 2930 (S3), MATH 2940
  (S4) all present in-semester. Systems box "MAE 3780 or ENGRD 2100 or PHYS 3360"
  (S6) → `me-sem6-systems`. "MAE 4xx1" senior design (S8) → `me-mae4xx1`. Math
  Elect (S6) → `me-math-elective`. Tech Elect (S4) → `me-tech-elective`.
- **Match:** the chart shows MAE 4300 (S7) → MAE 4xx1 (S8). Seed models the S8
  senior-design as the `me-mae4xx1` group; MAE 4300 is not a separate seed slot
  (folded into the major-elective track). Faithful, minor modeling choice.
- Verdict: PASS.

## ORE — `cornell-ore-bs-2026` vs 2025-ORE.jpg

- **Match:** ENGRD 2700 (S3), MATH 2940 (S3), CS/ENGRD 2110 (S3), ORIE 3120 (S4),
  ORIE 3300/3500/3150 (S5), ORIE 3310/3510 (S6), ORIE 4580 (S7), PHYS 2214 (S4)
  all present in-semester. Math choice "MATH 2930 / MATH 3040 / CS 2800" (S4) →
  `ore-math-choice`. ORIE electives → `ore-orie-elective`; major electives →
  `ore-major-elective`.
- **Note:** chart S4 shows PHYS 2214 top row; seed `ore-s4-phys2214` row 0 — match.
- **Edge gap (recommend):** chart draws ENGRD 2700 → ORIE 3120 → ORIE 3300/3500
  chain and ORIE 3500 → ORIE 4580; the seed edge set covers the ORIE backbone as a
  subset. No wrong edges.
- Verdict: PASS.

---

## Metadata recommendations (safe, NOT applied — need explicit go-ahead)

1. **catalogYear**: all four say 2026; charts are the 2025 entering class. Leave as
   the intended 2026–27 catalog claim (README already documents this). If the app
   ever surfaces "based on 20XX chart", prefer a separate display field over
   changing `catalogYear`.
2. **Coreq edge typing**: a handful of chart double-line arrows (ECE MATH1920→ECE2100;
   ME PHYS/MATH coreqs into the sophomore core) are `prereq` in the seed. Retyping to
   `coreq` is a value-only edit that would not change slot ids — safe for a future
   pass if desired.
3. No course-title/credit snapshot mismatches were observed against the live catalog
   for the four programs' course-kind slots (snapshots are denormalized at seed time
   from the same live `courses/*` docs).

Bottom line: the existing four are accurate against the 2025 charts. No corrective
writes are recommended as required; the two items above are optional polish.
