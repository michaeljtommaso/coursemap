// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSharePlan, type SharePlanApi } from "./useSharePlan";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createShare = vi.hoisted(() => vi.fn());
vi.mock("@/services/shares", () => ({ createShare }));
vi.mock("@/hooks/usePlan", () => ({
  usePlan: () => ({
    planId: "p1", planName: "My plan", placements: [], placedCourses: {}, completedIds: [],
    inProgressIds: [], waivedRequirementIds: [], planProgramId: "econ",
  }),
}));
vi.mock("@/hooks/usePrograms", () => ({
  usePrograms: () => ({ programs: [{ id: "econ", name: "Economics (BA)" }] }),
}));
vi.mock("@/store/useProgramStore", () => ({
  useProgramStore: (sel: (s: { selectedProgramId: string }) => unknown) => sel({ selectedProgramId: "econ" }),
}));
vi.mock("@/contexts/AuthProvider", () => ({
  useAuth: () => ({ uid: "u1", enteringYear: 2025, studentContext: { entryTerm: null } }),
}));
vi.mock("@/hooks/useRequirementProgress", () => ({
  useStudentAnswers: () => ({ marks: {} }),
  useRequirementProgress: () => ({ engine: "other" }),
}));
vi.mock("@/hooks/useProgramData", () => ({ useProgramData: () => ({ layers: [] }) }));
vi.mock("@/lib/planner/shareContext", () => ({
  shareAnswerFields: () => ({}),
  shareCollegeRuleSet: () => undefined,
}));
vi.mock("@/lib/planner/colleges", () => ({
  isDistributionFamily: () => false,
  programFamily: () => "other",
}));

const held = { api: null as unknown as SharePlanApi };
function Probe() {
  const value = useSharePlan();
  useEffect(() => {
    held.api = value;
  });
  return null;
}
const api = new Proxy({} as SharePlanApi, {
  get: (_t, key) => held.api[key as keyof SharePlanApi],
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  createShare.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  act(() => root.render(<Probe />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});

function setClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

describe("useSharePlan", () => {
  it("copies the link and reports copied when the clipboard works", async () => {
    createShare.mockResolvedValue("abc");
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    await act(async () => api.share());
    expect(api.status).toBe("copied");
    expect(api.url).toBeNull();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/abc`);
  });

  it("shows the link, not a failure, when the clipboard write is refused", async () => {
    createShare.mockResolvedValue("abc");
    setClipboard(vi.fn().mockRejectedValue(new Error("NotAllowedError")));
    await act(async () => api.share());
    expect(api.status).toBe("link");
    expect(api.url).toBe(`${window.location.origin}/s/abc`);
    // The link stays up (no auto-revert) until it is closed.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(api.status).toBe("link");
    act(() => api.dismissLink());
    expect(api.status).toBe("idle");
    expect(api.url).toBeNull();
  });

  it("goes straight to the link when there is no clipboard API", async () => {
    createShare.mockResolvedValue("abc");
    setClipboard(undefined);
    await act(async () => api.share());
    expect(api.status).toBe("link");
    expect(api.url).toContain("/s/abc");
  });

  it("copyLink retries the clipboard and reports the outcome", async () => {
    createShare.mockResolvedValue("abc");
    setClipboard(vi.fn().mockRejectedValue(new Error("no")));
    await act(async () => api.share());
    let ok = true;
    await act(async () => {
      ok = await api.copyLink();
    });
    expect(ok).toBe(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    await act(async () => {
      ok = await api.copyLink();
    });
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/abc`);
  });

  it("still reports failed when creating the share fails", async () => {
    createShare.mockRejectedValue(new Error("network"));
    setClipboard(vi.fn().mockResolvedValue(undefined));
    await act(async () => api.share());
    expect(api.status).toBe("failed");
    expect(api.url).toBeNull();
  });

  it("reports the cooldown when the rules refuse the create", async () => {
    createShare.mockRejectedValue(Object.assign(new Error("denied"), { code: "permission-denied" }));
    await act(async () => api.share());
    expect(api.status).toBe("cooldown");
  });
});
