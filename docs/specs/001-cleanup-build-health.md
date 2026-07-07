# Spec 001 — Cleanup & Build Health (Phase 0)

STATUS: IMPLEMENTED
Depends on: nothing. Blocks: everything (CI-able build is the floor).
Source: code audit 2026-07-07.

---

## Goal
`npm run build` passes. The repo contains exactly one data model (the Supabase-era one,
soon Firebase). Guard rails installed so Phase 2+ can't silently corrupt persisted state.

## 1. Delete the dead cluster (19 of 20 build errors)

Two parallel data models coexist in `src/`; only the DB-backed one is wired from
`main.tsx`. Delete the entire pre-Supabase prototype cluster — verified transitively dead
by import trace (grep before deleting anything, in case of drift since audit):

Components / hooks (orphan roots):
- `src/components/details/NodeDetailDrawer.tsx`
- `src/components/planner/PlannerPanel.tsx`
- `src/components/planner/PlannerSlot.tsx`
- `src/components/progress/ProgressPanel.tsx`
- `src/components/roadmap/RoadmapLegend.tsx`
- `src/components/selector/ProgramSelector.tsx`
- `src/hooks/useNodeStatus.ts`

Reachable ONLY from the above (delete too — the handoff's dead list missed these):
- `src/hooks/usePlannerWarnings.ts`
- `src/hooks/useProgramMap.ts`
- `src/store/selectors.ts`
- `src/lib/graph/evaluateNodeStatus.ts`
- `src/lib/planner/plannerUtils.ts`
- `src/lib/planner/progressUtils.ts`
- `src/data/programs/` (index.ts, cornell-cs-2026.ts, cornell-me-2026.ts)
- `src/data/terms.ts`
- `src/types/curriculum.ts`, `src/types/planner.ts`, `src/types/graph.ts`
- `src/components/ui/badge.tsx`, `src/components/ui/progress.tsx` (imported only by dead
  files; keep `button.tsx`, `card.tsx` — used by TopBar)
- Unused assets: `src/assets/react.svg`, `public/vite.svg`, `hero.png` if grep confirms
  no references.

Also delete `src/components/canvas/TrashBin.tsx` and the trash branches in
`DragGhost.tsx` / `AppShell.tsx` / `lib/drag/dragState.ts` (`overTrashBin`, `startTrashDrop`,
`"trashing"` phase) — per direction doc, the trash subsystem is cut. Do this here, not in
Phase 3, so the drag code that Phase 2/3 touch is already its final shape.

Acceptance: `npx tsc -b` errors drop to exactly 1 (DragGhost, next section);
`npx vite build` still succeeds; app boots (`npm run dev`), drag from catalog → slot still
works, ✕ clear still works.

## 2. Fix the one real type error

`src/components/drag/DragGhost.tsx:14/61` — the hand-written ref type doesn't match
anime.js v4's `AnimatableObject`. Fix by typing the ref as the library type:

```ts
import { createAnimatable, type AnimatableObject } from "animejs";
const animatableRef = useRef<AnimatableObject | null>(null);
```

(While in the file: the `duration: 220` passed alongside `ease: spring(...)` at the
snap-to-slot call is dead — springs compute their own duration. Delete the dead param.)

## 3. Persist versioning on all three stores

No store declares `version`/`migrate`; the `-v2` key suffixes are evidence of a previous
rename-and-lose-data migration. Add to each `persist()` config:

```ts
{
  name: "cornell-planner-v2",
  version: 1,
  migrate: (state, fromVersion) => {
    // v0 (unversioned) → v1: shape unchanged, this exists so future
    // bumps have a place to land.
    return state as PlannerState;
  },
}
```

Stores: `usePlannerStore` (`cornell-planner-v2`), `useProgramStore`
(`cornell-program-v2`), `useThemeStore` (`cornell-theme`). Spec 002 will bump
`usePlannerStore` when the plan model changes; this makes that bump safe.

## 4. Small correctness guards (from audit findings S4/S9/S10)

- `src/lib/db/courses.ts` — `return data ?? []` (supabase types `data` as `T[] | null`).
  Carry this convention into the Firebase services.
- `src/hooks/usePrograms.ts`, `src/hooks/useCourseSearch.ts` — thread an `error` state
  out of both hooks instead of `.catch(console.error)`. UI consumption lands in spec
  003's error-honesty work; this spec just stops swallowing.
- `src/store/useProgramStore.ts` — `selectedSlotId` is written but never read by active
  code. Delete the field and its action.
- `src/components/layout/LeftSidebar.tsx:81` — "Cornell Engineering · 2026 Catalog" is
  hardcoded; derive from the selected program's `college`/`catalog_year` (or drop the
  line until Firebase lands).

## 5. Dependency identity check

`lucide-react@1.7.0` is suspicious — the real package publishes `0.x` versions. Verify
what's actually installed (`npm ls lucide-react`, inspect
`node_modules/lucide-react/package.json` repository field). If it's not the genuine
`lucide/lucide` package, replace with the current real release and re-verify all icon
imports (GraduationCap, Trash2 → being deleted anyway, Search, ChevronDown, BarChart3,
Sun, Moon, X, Check).

## 6. Repo hygiene

- Remove the stale duplicate note: HANDOFF.md describes the dead prototype architecture —
  add a one-line banner at its top: `> HISTORICAL — describes the pre-Supabase prototype.
  See handoff-2026-05-17*.md for the current architecture.`
- `docs/DEPLOY.md` is empty boilerplate; leave until Phase 2 chooses hosting (spec 002 §9
  fills it).
- Add `"typecheck": "tsc -b --noEmit"` (sic — `tsc -b` ignores `--noEmit`, use
  `tsc --noEmit -p tsconfig.app.json`) and keep `build` = typecheck + vite build, so CI
  can run both.

## Acceptance checklist
- [ ] `npm run build` fully green (tsc + vite)
- [ ] `npm run dev`: program dropdown renders (empty + surfaced error is OK — DB is dead),
      theme toggle works, no console errors on boot
- [ ] Zero references to deleted files (grep for each deleted module name)
- [ ] All three stores have `version` + `migrate`
- [ ] lucide-react identity confirmed or replaced
- [ ] Committed on a branch, pushed
