import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PlanState } from "@/types/planner";

const defaultState: PlanState = {
  completed: ["math-1910"],
  planned: {
    "math-1920": "fall-2026",
    "phys-1112": "fall-2026",
  },
  plannedSlots: {
    "fall-2026:0": "math-1920",
    "fall-2026:1": "phys-1112",
  },
  waived: [],
};

interface PlannerStore extends PlanState {
  toggleCompleted: (nodeId: string) => void;
  toggleWaived: (nodeId: string) => void;
  planCourse: (nodeId: string, termId: string, slot: number) => void;
  unplanCourse: (nodeId: string) => void;
  resetPlan: () => void;
}

export const usePlannerStore = create<PlannerStore>()(
  persist(
    (set, get) => ({
      ...defaultState,

      toggleCompleted: (nodeId) => {
        const completed = get().completed;
        set({
          completed: completed.includes(nodeId)
            ? completed.filter((id) => id !== nodeId)
            : [...completed, nodeId],
        });
      },

      toggleWaived: (nodeId) => {
        const waived = get().waived;
        set({
          waived: waived.includes(nodeId)
            ? waived.filter((id) => id !== nodeId)
            : [...waived, nodeId],
        });
      },

      planCourse: (nodeId, termId, slot) => {
        const state = get();
        const targetKey = `${termId}:${slot}`;

        // Don't place if the target slot is occupied by a different course
        if (state.plannedSlots[targetKey] && state.plannedSlots[targetKey] !== nodeId) return;

        // Clear whatever slot the course was previously in
        const newSlots = Object.fromEntries(
          Object.entries(state.plannedSlots).filter(([, v]) => v !== nodeId)
        );
        newSlots[targetKey] = nodeId;

        set({
          planned: { ...state.planned, [nodeId]: termId },
          plannedSlots: newSlots,
        });
      },

      unplanCourse: (nodeId) => {
        const state = get();
        const newPlanned = { ...state.planned };
        delete newPlanned[nodeId];
        const newSlots = Object.fromEntries(
          Object.entries(state.plannedSlots).filter(([, v]) => v !== nodeId)
        );
        set({ planned: newPlanned, plannedSlots: newSlots });
      },

      resetPlan: () => set({ ...defaultState }),
    }),
    { name: "cornell-planner-state" }
  )
);
