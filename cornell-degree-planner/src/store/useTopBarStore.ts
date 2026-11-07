import { create } from "zustand";

/**
 * The planner top bar's layout stage and its menu (spec 033 D8):
 *   full    — every control inline, spaced out;
 *   compact — the same controls packed tighter, the link buttons icon-only;
 *   menu    — they no longer fit: everything behind the menu button.
 * Shared so the tour can open the menu when the bar has collapsed into it.
 */
export type TopBarTier = "full" | "compact" | "menu";

interface TopBarState {
  tier: TopBarTier;
  menuOpen: boolean;
  setTier: (tier: TopBarTier) => void;
  setMenuOpen: (open: boolean) => void;
}

export const useTopBarStore = create<TopBarState>((set) => ({
  tier: "full",
  menuOpen: false,
  setTier: (tier) => set({ tier }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
}));
