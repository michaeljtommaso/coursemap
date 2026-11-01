import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the SDK and the app module so no Firebase app boots under test.
type Write = { path: string; data: Record<string, unknown> };
const { updates } = vi.hoisted(() => ({ updates: [] as Write[] }));

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  getDoc: async () => ({ exists: () => false }),
  setDoc: async () => {},
  updateDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    updates.push({ path: ref.path, data });
  },
  serverTimestamp: () => "SERVER_TIME",
  arrayUnion: (...v: unknown[]) => v,
  arrayRemove: (...v: unknown[]) => v,
}));
vi.mock("@/lib/firebase", () => ({ db: {} }));

import { nextFactAnswers, updatePrefs } from "./profile";

const HONORS = "studentFact:honorsProgram:cas-linguistics";
const AEM = "studentFact:acceptedToProgram:cals-aem";
const many = (n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`studentFact:honorsProgram:p${i}`, "yes" as const]));

beforeEach(() => {
  updates.length = 0;
});

describe("updatePrefs — spec 020 student facts", () => {
  it("writes the whole answers map as one prefs.answers field (keys never become field paths)", async () => {
    await updatePrefs("u1", { answers: { [HONORS]: "yes", [AEM]: "no" } });
    expect(updates).toEqual([{ path: "users/u1", data: { "prefs.answers": { [HONORS]: "yes", [AEM]: "no" } } }]);
  });

  it("an empty map clears every answer", async () => {
    await updatePrefs("u1", { answers: {} });
    expect(updates[0].data).toEqual({ "prefs.answers": {} });
  });

  it("refuses more than 30 answers, or a malformed one, before writing", async () => {
    await expect(updatePrefs("u1", { answers: many(31) })).rejects.toThrow();
    await expect(updatePrefs("u1", { answers: { "bad.key": "yes" } })).rejects.toThrow();
    expect(updates).toHaveLength(0);
  });

  it("leaves answers alone when the patch doesn't name them", async () => {
    await updatePrefs("u1", { college: "cas" });
    expect(updates[0].data).toEqual({ "prefs.college": "cas" });
  });
});

describe("nextFactAnswers", () => {
  it("adds, changes and clears (a cleared answer is deleted, not null)", () => {
    expect(nextFactAnswers({}, HONORS, "yes")).toEqual({ [HONORS]: "yes" });
    expect(nextFactAnswers({ [HONORS]: "yes" }, HONORS, "no")).toEqual({ [HONORS]: "no" });
    expect(nextFactAnswers({ [HONORS]: "yes", [AEM]: "yes" }, HONORS, null)).toEqual({ [AEM]: "yes" });
  });

  it("is 'same' when nothing changes", () => {
    expect(nextFactAnswers({ [HONORS]: "yes" }, HONORS, "yes")).toBe("same");
    expect(nextFactAnswers({}, HONORS, null)).toBe("same");
  });

  it("refuses a new answer at the 30 cap but still changes or clears one there", () => {
    const full = many(30);
    expect(nextFactAnswers(full, AEM, "yes")).toBe("cap");
    expect(nextFactAnswers(full, "studentFact:honorsProgram:p0", "no")).not.toBe("cap");
    expect(Object.keys(nextFactAnswers(full, "studentFact:honorsProgram:p0", null) as object)).toHaveLength(29);
  });

  it("refuses a malformed key", () => {
    expect(nextFactAnswers({}, "has space", "yes")).toBe("invalid");
  });
});
