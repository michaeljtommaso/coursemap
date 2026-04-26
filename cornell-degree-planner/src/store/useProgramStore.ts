import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ProgramStore {
  selectedNodeId: string | null;
  isPlannerOpen: boolean;
  selectedProgramId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  setPlannerOpen: (open: boolean) => void;
  setSelectedProgramId: (id: string | null) => void;
}

export const useProgramStore = create<ProgramStore>()(
  persist(
    (set) => ({
      selectedNodeId: null,
      isPlannerOpen: true,
      selectedProgramId: null,
      setSelectedNodeId: (id) => set({ selectedNodeId: id }),
      setPlannerOpen: (open) => set({ isPlannerOpen: open }),
      setSelectedProgramId: (id) => set({ selectedProgramId: id, selectedNodeId: null }),
    }),
    { name: "cornell-program-state" }
  )
);
