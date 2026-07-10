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

  /** Pending catalog search seed (spec 006 §D3): an empty pattern/elective slot's
   *  "＋ Find a class" opens the catalog drawer pre-seeded to the slot's rule.
   *  CourseCatalog consumes + clears it. Null when nothing is pending. */
  catalogSeed: string | null;
  /** Open the catalog tab pre-filtered to `query` (empty string = just open). */
  requestCatalogSearch: (query: string) => void;
  clearCatalogSeed: () => void;

  /** CourseDetailPanel (spec 006 §D4) — the course whose side-peek is open, or
   *  null. `detailOverDrawer` is true when it was opened from a catalog chip
   *  (layers over the drawer, shows a back affordance) vs from a canvas card.
   *  Planner call sites omit `opts` and derive it from panelOpen; drawerless
   *  surfaces (/classes) pass `overDrawer: false` explicitly. */
  detailCourse: Course | null;
  detailOverDrawer: boolean;
  openCourseDetail: (course: Course, opts?: { overDrawer?: boolean }) => void;
  closeCourseDetail: () => void;
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

      catalogSeed: null,
      requestCatalogSearch: (query) =>
        set({ panelOpen: true, panelTab: "catalog", catalogSeed: query }),
      clearCatalogSeed: () => set({ catalogSeed: null }),

      detailCourse: null,
      detailOverDrawer: false,
      openCourseDetail: (course, opts) =>
        set((s) => ({ detailCourse: course, detailOverDrawer: opts?.overDrawer ?? s.panelOpen })),
      closeCourseDetail: () => set({ detailCourse: null }),
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
