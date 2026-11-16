import { create } from "zustand";

/**
 * The program a student just added (spec 047 D3): the Requirements page opens
 * at its section the next time it shows that program, then clears this. Kept
 * in memory only: a reload forgets it, which is fine for a "just added" hint.
 */
type RevealProgramState = {
  programId: string | null;
  reveal: (programId: string) => void;
  clear: () => void;
};

export const useRevealProgram = create<RevealProgramState>((set) => ({
  programId: null,
  reveal: (programId) => set({ programId }),
  clear: () => set({ programId: null }),
}));
