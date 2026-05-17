import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CustomTemplate = { id: string; name: string };

interface ProgramStore {
  selectedProgramId: string | null;
  selectedSlotId: string | null;
  customTemplates: CustomTemplate[];
  setSelectedProgramId: (id: string | null) => void;
  setSelectedSlotId: (id: string | null) => void;
  addCustomTemplate: () => string;
  removeCustomTemplate: (id: string) => void;
}

export const useProgramStore = create<ProgramStore>()(
  persist(
    (set, get) => ({
      selectedProgramId: null,
      selectedSlotId: null,
      customTemplates: [],

      setSelectedProgramId: (id) =>
        set({ selectedProgramId: id, selectedSlotId: null }),

      setSelectedSlotId: (id) => set({ selectedSlotId: id }),

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
    { name: "cornell-program-v2" }
  )
);
