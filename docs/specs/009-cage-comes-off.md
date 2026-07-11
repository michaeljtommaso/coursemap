# Spec 009 — The Cage Comes Off (template as suggestion, courses as truth)

STATUS: NOT BUILT (designed 2026-07-11, brainstorm session with Michael;
approved section-by-section)
Depends on: 007 §4 for the honest requirement readout (the single
satisfaction function); otherwise independent — can run parallel to 008.
Source: docs/audits/2026-07-11-vision-gap-and-graph-audit.md (#1, #5, #6,
C4, C5) and its editorial note: "the template is being treated as truth,
and the student's actual choices as exceptions to it. Invert that single
assumption and most of this log collapses."

One principle, five fixes: **the courses the student places are the
truth; the template is a hint.** This is the UI half of the thesis
inversion (spec 011 is the engine half).

## 0. Summary of decisions (made 2026-07-11)

| Decision | Choice |
|---|---|
| Drop into an occupied slot | Replace (incumbent unplaced, undo toast) — never silently divert |
| Drop onto a column | New slot exactly where dropped |
| Click-to-place on occupied slot | Same replace rule (no silent disarm) |
| Card identity after a drop | The card becomes the course; the slot's suggestion becomes a small hint line |
| Requirement honesty | The requirement reads unmet if the placed course doesn't satisfy it (via 007's `satisfies()`) |
| Empty-slot hover | "＋ Find a class" is primary and never disappears; mark-done-without-course lives in overflow |
| Switching majors | Placements always survive; templates re-map what they can |
| Placement persistence | Commit on drop; animation is decoration |

## 1. #1 — The card becomes the course

`SlotCard.tsx:194-208` currently keeps the slot's identity as the eyebrow
and demotes the placed course to the smallest text on the card. Inverted:

- When a real course is placed in ANY slot (course, elective, pattern,
  custom): eyebrow = `SUBJ NNNN`, title = course title, category chip +
  dot = **derived from the placed course** (via the spec 006 category
  taxonomy), credits = the course's credits.
- The slot's former identity renders as a small secondary hint line:
  "suggested: First-Year Writing Seminar" — visible, quiet, dismissable
  by simply not caring about it.
- The requirement question is a separate concern answered honestly by
  007's `satisfies()`: CS 2110 in the FWS slot → the FWS requirement
  reads **unmet** in both the card hint and the majors panel. C1's
  disagreement is impossible because both read the same function.
- `slotCategory` derivation moves from slot-only to placed-course-first
  (`SlotCard.tsx:775, 992` and wherever `slot.category` feeds chips).

## 2. #5 — Drops never lie

`AppShell.tsx:33, 79-85`, `SlotCard.tsx:583, 695`:

- **Replace on occupied:** dropping onto an occupied slot replaces the
  incumbent. The incumbent returns to unplaced (if it was a template
  slot's own suggestion, the slot reverts to its empty suggested state;
  if it was a student-placed course, it is removed from the plan) and an
  **undo toast** appears ("Replaced CS 2110 with CS 3110 — Undo"). No
  destructive surprise: undo restores the exact prior state.
- **Swap affordance (small, optional):** dragging a placed card onto
  another placed card offers swap (the two courses exchange slots) as
  the drop preview when both are placed courses. If this complicates the
  drag preview it may ship as replace-only first; the spec's hard
  requirement is replace + undo.
- **No silent diversion:** the `overColumnSem` fallback only applies when
  the drop is genuinely on column background. A drop on a slot goes in
  that slot — `isSlotAvailable` occupancy gating is removed.
- **Click-to-place:** an armed course clicking an occupied slot follows
  the same replace-with-undo rule; `canReceiveArmed` becomes
  unconditional.
- The "For my major" filter chip stays available but off by default
  (already true); no other gatekeeping remains anywhere in the drop
  path. There is no category validation on drop — free placement stays
  the policy, now without the three mechanisms that made it feel
  gatekept.

## 3. #6 — An empty slot's hover state is "help me fill this"

`SlotCard.tsx:822-881`:

- Empty slots: the hover affordance is **"＋ Find a class"** (primary)
  and it NEVER disappears — including when a status mark is set (the
  current inversion where marking done hides the one useful affordance
  is removed).
- `CornerActions` (mark complete / currently taking) leaves the empty
  card's primary hover; "Done — course not recorded" moves to the
  overflow ⋯ menu, consistent with the waive demotion and with Michael's
  framing (rare flow, kept, not promoted).

## 4. C4 — Switching majors never deletes placements

`PlanProvider.tsx:381` currently prunes `slotSelections` whose slot IDs
aren't in the new program. Replaced with an explicit re-mapping:

- On program switch: for each placed course, if the new template has a
  compatible unfilled slot (same course ID, or a pattern/elective slot
  the course satisfies per 007's `satisfies()`), the placement moves
  into it; otherwise the course lands in a **plan-owned custom slot in
  its same semester** (the `_plan` mechanism that already exists).
- Nothing is ever dropped. A quiet toast summarizes: "Kept all 12
  courses — 9 matched ORIE requirements."
- This is what makes major exploration safe — the exact behavior the
  discovery panel (spec 011) encourages must not be punished by data
  loss. Design decision made explicitly, not by accident.

## 5. C5 — Commit first, animate second

`DragGhost.tsx:136-184`: the placement mutation currently runs inside the
drop animation's `onComplete`. Inverted: state commits synchronously on
drop; the ghost animation plays after/independently. An interrupted
animation (fast second drag, tab blur, reduced-motion edge) can no longer
lose a placement. Same rule applies to the click-to-place path.

## 6. Testing

- Unit: program-switch re-mapping (matched, unmatched → custom slot,
  credit totals preserved); replace-with-undo state restoration.
- Browser (Sonnet subagent per house rule): the audit's exact
  reproduction cases — CS course into FWS slot shows CS identity + unmet
  FWS hint; drop onto occupied replaces with working undo; drop onto
  column creates slot at drop point; empty-slot hover shows Find a class
  always; switch CS → ORIE keeps every placement; interrupted-drag
  placement survives (start second drag mid-animation).

## 7. Out of scope

- Keyboard path to move an already-placed course (logged gap from spec
  006; needs its own small design — carried forward, not solved here).
- Drag-ghost preview scaling at zoom < 1 (same carry-forward).
- Any change to the template authoring format (spec 011's pipeline owns
  requirement semantics).
