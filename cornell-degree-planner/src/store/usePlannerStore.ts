import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Course } from "@/types/db";
import { DEFAULT_ZOOM, normalizeZoom, type ZoomLevel } from "@/lib/canvas/zoom";

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

  /** CreditsDialog open state (spec 007 §2b/§5, Unit 7C2) — mirrors signInOpen
   *  exactly: any trigger (AccountButton's "My credits", a card/panel "Add AP
   *  credit" deep-link) can open the one dialog rendered in AppShell. UI-only,
   *  never persisted. */
  creditsOpen: boolean;
  setCreditsOpen: (open: boolean) => void;

  /** Canvas zoom preset (spec 006 §F2). PERSISTED (unlike everything else here)
   *  — it's a durable view preference, so it survives reload via the persist
   *  partialize below. */
  zoom: ZoomLevel;
  setZoom: (zoom: ZoomLevel) => void;

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

      signInOpen: false,
      setSignInOpen: (open) => set({ signInOpen: open }),

      creditsOpen: false,
      setCreditsOpen: (open) => set({ creditsOpen: open }),

      zoom: DEFAULT_ZOOM,
      setZoom: (zoom) => set({ zoom }),

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
      // returning users' localStorage (plan data lives in the cloud now). The
      // zoom preference (normalized back onto a preset) is the one field we
      // rehydrate — everything else here is transient interaction state.
      migrate: (persisted) => ({
        zoom: normalizeZoom((persisted as Partial<PlannerUiStore> | undefined)?.zoom),
      }),
      partialize: (s) => ({ zoom: s.zoom }),
    }
  )
);
