import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub the SDK calls and the app module so no Firebase app boots under test.
// The batch records what it was asked to write; commit is the mock to steer.
type Write = { path: string; data: Record<string, unknown> };
const { commit, sets, updates, authState } = vi.hoisted(() => ({
  commit: vi.fn(),
  sets: [] as Write[],
  updates: [] as Write[],
  authState: { currentUser: { uid: "u1" } } as { currentUser: { uid: string } | null },
}));

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  serverTimestamp: () => "SERVER_TIME",
  writeBatch: () => ({
    set: (ref: { path: string }, data: Record<string, unknown>) => sets.push({ path: ref.path, data }),
    update: (ref: { path: string }, data: Record<string, unknown>) =>
      updates.push({ path: ref.path, data }),
    commit: () => commit(),
  }),
}));
vi.mock("@/lib/firebase", () => ({ db: {}, auth: authState }));

import { submitRequirementReport, resetReportRateLimit, REPORT_COOLDOWN_MS } from "./reports";

const INPUT = { programId: "cas-english-ba", layer: "cas-college-2025", rowId: "fws" };
const T0 = Date.UTC(2026, 9, 25, 12);

function denied() {
  return Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  resetReportRateLimit();
  commit.mockReset();
  commit.mockResolvedValue(undefined);
  sets.length = 0;
  updates.length = 0;
  authState.currentUser = { uid: "u1" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("submitRequirementReport", () => {
  it("writes the report and the lastReportAt stamp in one batch", async () => {
    await expect(submitRequirementReport({ ...INPUT, note: "  FWS should count  " })).resolves.toBe("sent");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(sets).toHaveLength(1);
    expect(sets[0].path).toMatch(/^requirementReports\/.+/);
    expect(sets[0].data).toEqual({
      uid: "u1",
      programId: "cas-english-ba",
      layer: "cas-college-2025",
      rowId: "fws",
      note: "FWS should count",
      createdAt: "SERVER_TIME",
    });
    expect(updates).toEqual([{ path: "users/u1", data: { lastReportAt: "SERVER_TIME" } }]);
  });

  it("drops a blank note instead of writing an empty string", async () => {
    await submitRequirementReport({ ...INPUT, note: "   " });
    expect(sets[0].data).not.toHaveProperty("note");
  });

  it("returns rate-limited without writing inside the 10 s window", async () => {
    await submitRequirementReport(INPUT);
    vi.setSystemTime(T0 + REPORT_COOLDOWN_MS - 1);
    await expect(submitRequirementReport(INPUT)).resolves.toBe("rate-limited");
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("sends again once the window has passed", async () => {
    await submitRequirementReport(INPUT);
    vi.setSystemTime(T0 + REPORT_COOLDOWN_MS);
    await expect(submitRequirementReport(INPUT)).resolves.toBe("sent");
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("maps a server permission-denied right after a recent send to rate-limited", async () => {
    await submitRequirementReport(INPUT);
    vi.setSystemTime(T0 + REPORT_COOLDOWN_MS + 500);
    commit.mockRejectedValueOnce(denied());
    await expect(submitRequirementReport(INPUT)).resolves.toBe("rate-limited");
  });

  it("throws a permission-denied when nothing was sent recently", async () => {
    commit.mockRejectedValueOnce(denied());
    await expect(submitRequirementReport(INPUT)).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("throws any other failure, and a failed send does not start the cooldown", async () => {
    commit.mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "unavailable" }));
    await expect(submitRequirementReport(INPUT)).rejects.toThrow("offline");
    await expect(submitRequirementReport(INPUT)).resolves.toBe("sent");
  });

  it("rejects a report the schema refuses, before writing", async () => {
    await expect(submitRequirementReport({ ...INPUT, note: "n".repeat(501) })).rejects.toThrow();
    await expect(submitRequirementReport({ ...INPUT, rowId: "" })).rejects.toThrow();
    await expect(submitRequirementReport({ ...INPUT, programId: "p".repeat(81) })).rejects.toThrow();
    expect(commit).not.toHaveBeenCalled();
  });

  it("throws when no one is signed in", async () => {
    authState.currentUser = null;
    await expect(submitRequirementReport(INPUT)).rejects.toThrow(/signed-in/);
    expect(commit).not.toHaveBeenCalled();
  });
});
