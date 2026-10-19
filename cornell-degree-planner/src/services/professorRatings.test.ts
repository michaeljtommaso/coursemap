import { describe, it, expect, vi, beforeEach } from "vitest";

// The loader reads one doc through firebase/firestore; stub both the SDK calls
// and the app module so no Firebase app boots under test.
const getDoc = vi.fn();
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  getDoc: (ref: unknown) => getDoc(ref),
}));
vi.mock("@/lib/firebase", () => ({ db: {} }));

import {
  loadProfessorRatings,
  peekProfessorRatings,
  resetProfessorRatingsCache,
} from "./professorRatings";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 19);
const now = () => NOW;

function snap(data: unknown) {
  return { exists: () => data != null, data: () => data };
}

beforeEach(() => {
  resetProfessorRatingsCache();
  getDoc.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("loadProfessorRatings", () => {
  it("reads catalog/professorRatings once per page load and drops stale entries", async () => {
    getDoc.mockResolvedValue(
      snap({
        ratings: {
          df64: { r: 3.6, c: 20, t: "v", at: NOW - DAY },
          old1: { r: 4.5, c: 20, t: "v", at: NOW - 200 * DAY },
        },
        count: 2,
      })
    );
    const [a, b] = await Promise.all([loadProfessorRatings(true, now), loadProfessorRatings(true, now)]);
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(getDoc.mock.calls[0][0]).toEqual({ path: "catalog/professorRatings" });
    expect(a).toBe(b);
    expect([...a.keys()]).toEqual(["df64"]);
    await loadProfessorRatings(true, now);
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(peekProfessorRatings()).toBe(a);
  });

  it("with the feature off: no read, empty map", async () => {
    const m = await loadProfessorRatings(false, now);
    expect(m.size).toBe(0);
    expect(getDoc).not.toHaveBeenCalled();
  });

  it("a missing doc resolves to an empty map", async () => {
    getDoc.mockResolvedValue(snap(null));
    expect((await loadProfessorRatings(true, now)).size).toBe(0);
  });

  it("a failed read resolves to an empty map (no throw)", async () => {
    getDoc.mockRejectedValue(new Error("permission-denied"));
    await expect(loadProfessorRatings(true, now)).resolves.toHaveProperty("size", 0);
  });
});
