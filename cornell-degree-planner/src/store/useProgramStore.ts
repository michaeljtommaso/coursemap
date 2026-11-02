import { create } from "zustand";
import { persist } from "zustand/middleware";
import { canonicalProgramId } from "@/lib/planner/legacyPrograms";

export type CustomTemplate = { id: string; name: string };

interface ProgramStore {
  selectedProgramId: string | null;
  customTemplates: CustomTemplate[];
  setSelectedProgramId: (id: string | null) => void;
  addCustomTemplate: () => string;
  removeCustomTemplate: (id: string) => void;
}

export const useProgramStore = create<ProgramStore>()(
  persist(
    (set, get) => ({
      selectedProgramId: null,
      customTemplates: [],

      setSelectedProgramId: (id) => set({ selectedProgramId: id }),

      addCustomTemplate: () => {
        const id = `custom-${Date.now()}`;
        const count = get().customTemplates.length + 1;
        set((s) => ({
          customTemplates: [
            ...s.customTemplates,
            { id, name: `Custom Template ${count}` },
          ],
        }));
        return id;
      },

      removeCustomTemplate: (id) =>
        set((s) => ({
          customTemplates: s.customTemplates.filter((t) => t.id !== id),
          selectedProgramId:
            s.selectedProgramId === id ? null : s.selectedProgramId,
        })),
    }),
    {
      name: "cornell-program-v2",
      version: 1,
      migrate: (state) => {
        // v0 (unversioned) → v1: shape unchanged; placeholder for future bumps.
        return state as ProgramStore;
      },
      // Every rehydrate: a saved retired program id reads as its current id
      // (spec 019 D12), so the selection matches the plans list.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ProgramStore>;
        return {
          ...current,
          ...saved,
          selectedProgramId:
            typeof saved.selectedProgramId === "string"
              ? canonicalProgramId(saved.selectedProgramId)
              : (saved.selectedProgramId ?? current.selectedProgramId),
        };
      },
    }
  )
);
