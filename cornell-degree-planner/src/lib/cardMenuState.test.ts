import { describe, it, expect, vi } from "vitest";
import { cardMenuState } from "./cardMenuState";

describe("cardMenuState", () => {
  it("is open while any menu holds it and closed once all release", () => {
    expect(cardMenuState.isOpen()).toBe(false);
    const releaseA = cardMenuState.hold();
    const releaseB = cardMenuState.hold();
    expect(cardMenuState.isOpen()).toBe(true);
    releaseA();
    expect(cardMenuState.isOpen()).toBe(true);
    releaseB();
    expect(cardMenuState.isOpen()).toBe(false);
  });

  it("a repeated release is a no-op and does not notify", () => {
    const listener = vi.fn();
    const unsubscribe = cardMenuState.subscribe(listener);
    const release = cardMenuState.hold();
    release();
    release();
    expect(listener).toHaveBeenCalledTimes(2); // one open, one close
    expect(cardMenuState.isOpen()).toBe(false);
    unsubscribe();
  });
});
