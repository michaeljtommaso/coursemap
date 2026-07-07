import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Course } from "@/types/db";

interface PlannerStore {
  // Elective/pattern slot assignments: slotId → courseId
  slotSelections: Record<string, string>;
  // Full course data for any course that's been assigned (for display in grid nodes)
  selectedCourses: Record<string, Course>;
  // Completion / waiver tracking by slot ID
  completedSlotIds: string[];
  waivedSlotIds: string[];

  assignSlot: (slotId: string, course: Course) => void;
  clearSlot: (slotId: string) => void;
  toggleCompleted: (slotId: string) => void;
  toggleWaived: (slotId: string) => void;
  resetPlan: () => void;
}

const defaultState = {
  slotSelections: {} as Record<string, string>,
  selectedCourses: {} as Record<string, Course>,
  completedSlotIds: [] as string[],
  waivedSlotIds: [] as string[],
};

export const usePlannerStore = create<PlannerStore>()(
  persist(
    (set) => ({
      ...defaultState,

      assignSlot: (slotId, course) =>
        set((s) => {
          // Remove this course from any previous slot (a course can fill only one slot)
          const newSelections = Object.fromEntries(
            Object.entries(s.slotSelections).filter(([, cId]) => cId !== course.id)
          );
          newSelections[slotId] = course.id;
          return {
            slotSelections: newSelections,
            selectedCourses: { ...s.selectedCourses, [course.id]: course },
          };
        }),

      clearSlot: (slotId) =>
        set((s) => {
          const next = { ...s.slotSelections };
          delete next[slotId];
          return { slotSelections: next };
        }),

      toggleCompleted: (slotId) =>
        set((s) => ({
          completedSlotIds: s.completedSlotIds.includes(slotId)
            ? s.completedSlotIds.filter((id) => id !== slotId)
            : [...s.completedSlotIds, slotId],
          // Completing removes waiver
          waivedSlotIds: s.waivedSlotIds.filter((id) => id !== slotId),
        })),

      toggleWaived: (slotId) =>
        set((s) => ({
          waivedSlotIds: s.waivedSlotIds.includes(slotId)
            ? s.waivedSlotIds.filter((id) => id !== slotId)
            : [...s.waivedSlotIds, slotId],
          // Waiving removes completion
          completedSlotIds: s.completedSlotIds.filter((id) => id !== slotId),
        })),

      resetPlan: () => set(defaultState),
    }),
    {
      name: "cornell-planner-v2",
      version: 1,
      migrate: (state) => {
        // v0 (unversioned) → v1: shape unchanged; this exists so future
        // bumps (spec 002 plan-model change) have a place to land.
        return state as PlannerStore;
      },
    }
  )
);
