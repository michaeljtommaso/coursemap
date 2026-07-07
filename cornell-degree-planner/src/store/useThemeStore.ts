import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ThemeStore {
  theme: "light" | "dark";
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: "light",
      toggleTheme: () => set({ theme: get().theme === "light" ? "dark" : "light" }),
    }),
    {
      name: "cornell-theme",
      version: 1,
      migrate: (state) => {
        // v0 (unversioned) → v1: shape unchanged; placeholder for future bumps.
        return state as ThemeStore;
      },
    }
  )
);
