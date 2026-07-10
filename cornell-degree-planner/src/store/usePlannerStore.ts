import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Course } from "@/types/db";

/**
 * usePlannerStore — UI-only planner state (docs/specs/002 §6, 004 §4).
 *
 * Plan DATA lives in PlanProvider (cloud). This store holds transient
 * interaction state only:
 *
 *  - Click-to-place "arming" (spec 004 §4): a course armed from the catalog
 *    (sourceSlotId null) or picked up from a filled slot (sourceSlotId set).
 *    Eligible slots highlight; clicking one places the course; Esc disarms.
 *    NEVER persisted — arming is in-progress interaction, not view config.
 *
 *  - Right panel open/tab state (spec 004 §5), lifted out of RightSidebar so
 *    the left-rail Major Match teaser can open the Majors tab directly.
 *
 * The persist wrapper is kept ONLY so its migrate strips the fat pre-Firebase
 * plan blob out of returning users' `cornell-planner-v2` localStorage. The
 * import source is captured before rehydration (main.tsx) — see spec 002 §7.
 */

export type PanelTab = "catalog" | "majors";

interface PlannerUiStore {
  /** Click-to-place: the armed course, or null. */
  armedCourse: Course | null;
  /** When arming a course already placed in a slot (move flow), its source. */
  armedSourceSlotId: string | null;
  armCourse: (course: Course, sourceSlotId?: string | null) => void;
  disarm: () => void;

  /** Right panel state (Catalog | Majors). */
  panelOpen: boolean;
  panelTab: PanelTab;
  setPanelOpen: (open: boolean) => void;
  openPanel: (tab: PanelTab) => void;
  setPanelTab: (tab: PanelTab) => void;

  /** SignInDialog open state (spec 006 §C1). Lifted here — like panelOpen —
   *  so any trigger (TopBar "Save your plan", the LeftSidebar account row, or a
   *  future auth-gated action) can open the one modal rendered in AppShell.
   *  UI-only, never persisted. */
  signInOpen: boolean;
  setSignInOpen: (open: boolean) => void;
}

export const usePlannerStore = create<PlannerUiStore>()(
  persist(
    (set) => ({
      armedCourse: null,
      armedSourceSlotId: null,
      armCourse: (course, sourceSlotId = null) =>
        set({ armedCourse: course, armedSourceSlotId: sourceSlotId }),
      disarm: () => set({ armedCourse: null, armedSourceSlotId: null }),

      panelOpen: false,
      panelTab: "catalog",
      setPanelOpen: (open) => set({ panelOpen: open }),
      openPanel: (tab) => set({ panelOpen: true, panelTab: tab }),
      setPanelTab: (tab) => set({ panelTab: tab }),

      signInOpen: false,
      setSignInOpen: (open) => set({ signInOpen: open }),
    }),
    {
      name: "cornell-planner-v2",
      version: 2,
      // v0/v1 persisted plan data; dropping it cleans stale blobs out of
      // returning users' localStorage (plan data lives in the cloud now).
      migrate: () => ({}) as Partial<PlannerUiStore>,
      // Nothing is persisted — every field here is transient interaction state.
      partialize: () => ({}),
    }
  )
);
