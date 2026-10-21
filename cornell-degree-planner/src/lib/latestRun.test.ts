import { describe, it, expect } from "vitest";
import { createRunCounter } from "./latestRun";

describe("createRunCounter", () => {
  it("the only run is current", () => {
    const runs = createRunCounter();
    const a = runs.start();
    expect(runs.isCurrent(a)).toBe(true);
  });

  it("a newer run supersedes an older one", () => {
    const runs = createRunCounter();
    const a = runs.start();
    const b = runs.start();
    expect(runs.isCurrent(a)).toBe(false);
    expect(runs.isCurrent(b)).toBe(true);
  });

  it("checking without starting new work never orphans the run in flight", () => {
    // The AuthProvider case: an unrelated re-render (a theme change) re-ran
    // the profile effect, which returned early without starting a resolution.
    // The resolution already in flight must still be the one that settles
    // `loading`.
    const runs = createRunCounter();
    const a = runs.start();
    runs.isCurrent(a);
    runs.isCurrent(a);
    expect(runs.isCurrent(a)).toBe(true);
  });

  it("counters are independent", () => {
    const x = createRunCounter();
    const y = createRunCounter();
    const a = x.start();
    y.start();
    y.start();
    expect(x.isCurrent(a)).toBe(true);
  });
});
