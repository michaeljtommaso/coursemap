import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * usePlannerStore — UI-only planner state (docs/specs/002 §6).
 *
 * SHRUNK in Phase 2 stage 2: all PLAN DATA (slotSelections, selectedCourses,
 * completedSlotIds, waivedSlotIds) and its mutations moved to PlanProvider, which
 * owns the authoritative cloud plan. Plan data is no longer persisted to
 * localStorage — the cloud plan doc is the source of truth.
 *
 * What remains here is UI-only session state (the reserved home for spec 004's
 * click-to-place selection etc.). Currently minimal: drag-hover lives in
 * lib/drag/dragState.ts and the catalog panel's open flag is local to
 * RightSidebar, so there is no live field yet — but the store is kept (rather
 * than deleted) so its persist migrate can STRIP the fat pre-Firebase plan blob
 * out of every returning user's `cornell-planner-v2` localStorage.
 *
 * IMPORTANT: the pre-Firebase plan payload under this same key is captured for
 * one-time cloud import (spec 002 §7) at app entry in main.tsx —
 * captureLocalPlanSnapshot() runs BEFORE this store rehydrates and this migrate
 * strips the key, so the import source is preserved.
 */

interface PlannerUiStore {
  /** Reserved for UI-only state (e.g. spec 004 click-to-place selection). */
  activeSelectionSlotId: string | null;
  setActiveSelectionSlotId: (slotId: string | null) => void;
}

export const usePlannerStore = create<PlannerUiStore>()(
  persist(
    (set) => ({
      activeSelectionSlotId: null,
      setActiveSelectionSlotId: (slotId) => set({ activeSelectionSlotId: slotId }),
    }),
    {
      name: "cornell-planner-v2",
      version: 2,
      // Keep only UI-only keys. v1 (and v0) persisted plan data
      // (slotSelections/selectedCourses/completedSlotIds/waivedSlotIds); dropping
      // it here cleans stale blobs out of returning users' localStorage. The plan
      // data itself lives in the cloud now (imported once via spec 002 §7).
      migrate: () => ({ activeSelectionSlotId: null } as Partial<PlannerUiStore>),
      // Only the UI field is persisted — never plan data.
      partialize: (s) => ({ activeSelectionSlotId: s.activeSelectionSlotId }),
    }
  )
);
