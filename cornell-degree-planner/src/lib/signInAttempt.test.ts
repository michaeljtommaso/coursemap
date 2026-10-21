import { describe, it, expect } from "vitest";
import {
  POPUP_FOCUS_GRACE_MS,
  canDismiss,
  canResetOnFocus,
  statusAfterAttempt,
} from "./signInAttempt";

describe("statusAfterAttempt", () => {
  it("the current attempt: cancel → ready, failure → error, success → linked", () => {
    expect(statusAfterAttempt("cancelled", true)).toBe("idle");
    expect(statusAfterAttempt("error", true)).toBe("error");
    expect(statusAfterAttempt("linked", true)).toBe("linked");
  });

  it("a success that arrives after Cancel or the focus reset still shows", () => {
    expect(statusAfterAttempt("linked", false)).toBe("linked");
  });

  it("a detached attempt's cancel or failure leaves the dialog alone", () => {
    expect(statusAfterAttempt("cancelled", false)).toBeNull();
    expect(statusAfterAttempt("error", false)).toBeNull();
  });
});

describe("canResetOnFocus", () => {
  it("only while the popup is pending", () => {
    expect(canResetOnFocus("loading")).toBe(true);
    for (const s of ["idle", "finishing", "linked", "error"] as const) {
      expect(canResetOnFocus(s)).toBe(false);
    }
  });
});

describe("canDismiss", () => {
  it("not while the popup is open or the sign-in is finishing", () => {
    expect(canDismiss("loading")).toBe(false);
    expect(canDismiss("finishing")).toBe(false);
    expect(canDismiss("idle")).toBe(true);
    expect(canDismiss("error")).toBe(true);
    expect(canDismiss("linked")).toBe(true);
  });
});

describe("POPUP_FOCUS_GRACE_MS", () => {
  it("is a short grace, well under Firebase's own popup-closed detection", () => {
    expect(POPUP_FOCUS_GRACE_MS).toBeGreaterThanOrEqual(1000);
    expect(POPUP_FOCUS_GRACE_MS).toBeLessThanOrEqual(3000);
  });
});
