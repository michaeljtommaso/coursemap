import { create } from "zustand";
import type { TourId } from "@/components/tour/tourSteps";

/**
 * Which tour is running, and on which step (spec 033). Session-only: whether a
 * tour has been SEEN lives on the profile (`prefs.tours`), not here.
 */
interface TourState {
  tour: TourId | null;
  step: number;
  start: (tour: TourId) => void;
  goTo: (step: number) => void;
  close: () => void;
}

export const useTourStore = create<TourState>((set) => ({
  tour: null,
  step: 0,
  start: (tour) => set({ tour, step: 0 }),
  goTo: (step) => set({ step }),
  close: () => set({ tour: null, step: 0 }),
}));
