import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the SDK and the app module so no Firebase app boots under test.
type Write = { path: string; data: Record<string, unknown> };
/** A one-field write: updateDoc(ref, new FieldPath(...segments), value). */
type FieldWrite = { path: string; field: string[]; value: unknown };
const { updates, fieldWrites, FakeFieldPath } = vi.hoisted(() => ({
  updates: [] as Write[],
  fieldWrites: [] as FieldWrite[],
  FakeFieldPath: class {
    segments: string[];
    constructor(...segments: string[]) {
      this.segments = segments;
    }
  },
}));

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  getDoc: async () => ({ exists: () => false }),
  setDoc: async () => {},
  updateDoc: async (ref: { path: string }, data: unknown, value?: unknown) => {
    if (data instanceof FakeFieldPath) fieldWrites.push({ path: ref.path, field: data.segments, value });
    else updates.push({ path: ref.path, data: data as Record<string, unknown> });
  },
  FieldPath: FakeFieldPath,
  deleteField: () => "DELETE_FIELD",
  serverTimestamp: () => "SERVER_TIME",
  arrayUnion: (...v: unknown[]) => v,
  arrayRemove: (...v: unknown[]) => v,
}));
vi.mock("@/lib/firebase", () => ({ db: {} }));

import { createFactAnswerSetter, nextFactAnswers, updatePrefs, writeFactAnswer } from "./profile";
import type { FactValue } from "@/lib/planner/distribution/types";

const HONORS = "studentFact:honorsProgram:cas-linguistics";
const AEM = "studentFact:acceptedToProgram:cals-aem";
const many = (n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`studentFact:honorsProgram:p${i}`, "yes" as const]));

beforeEach(() => {
  updates.length = 0;
  fieldWrites.length = 0;
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

describe("updatePrefs — spec 033 tours", () => {
  it("writes one dot path per tour, so marking one never erases another", async () => {
    await updatePrefs("u1", { tours: { planner: 1 } });
    expect(updates[0].data).toEqual({ "prefs.tours.planner": 1 });
  });

  it("first run's owed write names all three", async () => {
    await updatePrefs("u1", { tours: { planner: 0, requirements: 0, classes: 0 } });
    expect(updates[0].data).toEqual({
      "prefs.tours.planner": 0,
      "prefs.tours.requirements": 0,
      "prefs.tours.classes": 0,
    });
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

describe("writeFactAnswer — one key per write (spec 020 D2)", () => {
  it("sets prefs.answers.<key> through a FieldPath, the key kept whole (\":\" \"/\" \"@\" unescaped)", async () => {
    const key = "studentFact:writingSeminar:cas-college/fws@ENGL-2880";
    await writeFactAnswer("u1", key, "yes");
    expect(fieldWrites).toEqual([{ path: "users/u1", field: ["prefs", "answers", key], value: "yes" }]);
    expect(updates).toHaveLength(0);
  });

  it("clears with deleteField, never by writing null or the whole map", async () => {
    await writeFactAnswer("u1", HONORS, null);
    expect(fieldWrites).toEqual([{ path: "users/u1", field: ["prefs", "answers", HONORS], value: "DELETE_FIELD" }]);
  });

  it("refuses a malformed key or value before writing", async () => {
    await expect(writeFactAnswer("u1", "has space", "yes")).rejects.toThrow();
    await expect(writeFactAnswer("u1", HONORS, "maybe" as FactValue)).rejects.toThrow();
    expect(fieldWrites).toHaveLength(0);
  });
});

describe("createFactAnswerSetter — optimistic, per-key student facts (spec 020 D2, D8)", () => {
  /** A host with a local facts map and a write the test settles by hand. */
  function host(initial: Record<string, FactValue> = {}) {
    let answers = { ...initial };
    const pending: { key: string; value: FactValue | null; resolve: () => void; reject: (e: unknown) => void }[] = [];
    const failures: unknown[] = [];
    const set = createFactAnswerSetter({
      ready: async () => {},
      uid: () => "u1",
      getAnswers: () => answers,
      setAnswers: (update) => {
        answers = update(answers);
      },
      onWriteFailed: (err) => failures.push(err),
      write: (_uid, key, value) =>
        new Promise<void>((resolve, reject) => pending.push({ key, value, resolve, reject })),
    });
    return { set, pending, failures, answers: () => answers };
  }

  it("resolves before the server acknowledges (offline never leaves the form saving)", async () => {
    const h = host();
    // The write below never settles (offline); the setter still resolves.
    await expect(h.set(HONORS, "yes")).resolves.toBeUndefined();
    expect(h.answers()).toEqual({ [HONORS]: "yes" });
    expect(h.pending).toHaveLength(1);
  });

  it("writes only the answered key — a stale tab never erases answers saved elsewhere", async () => {
    // This tab's copy predates an answer made in another tab; only HONORS goes out.
    const h = host({ [AEM]: "no" });
    await h.set(HONORS, "yes");
    expect(h.pending.map(({ key, value }) => ({ key, value }))).toEqual([{ key: HONORS, value: "yes" }]);
    await h.set(AEM, null);
    expect(h.pending[1]).toMatchObject({ key: AEM, value: null });
  });

  it("a refused write (the rules' cap) reverts only that answer and reports it", async () => {
    const h = host({ [AEM]: "yes" });
    await h.set(HONORS, "yes");
    await h.set(AEM, "no");
    h.pending[0].reject(Object.assign(new Error("denied"), { code: "permission-denied" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.answers()).toEqual({ [AEM]: "no" });
    expect(h.failures).toHaveLength(1);
    // A failed change puts the previous answer back, not nothing.
    h.pending[1].reject(new Error("offline"));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.answers()).toEqual({ [AEM]: "yes" });
  });

  it("the cap and malformed checks reject synchronously, before anything is applied or written", async () => {
    const h = host(many(30));
    await expect(h.set(HONORS, "yes")).rejects.toThrow(/up to 30 answers/);
    expect(h.pending).toHaveLength(0);
    expect(Object.keys(h.answers())).toHaveLength(30);
    const empty = host();
    await expect(empty.set("has space", "yes")).rejects.toThrow(/couldn't be saved/);
    expect(empty.pending).toHaveLength(0);
    expect(empty.answers()).toEqual({});
  });

  it("does nothing for an unchanged answer or with no signed-in user", async () => {
    const h = host({ [HONORS]: "yes" });
    await h.set(HONORS, "yes");
    expect(h.pending).toHaveLength(0);
    const writes: string[] = [];
    const noUser = createFactAnswerSetter({
      ready: async () => {},
      uid: () => null,
      getAnswers: () => ({}),
      setAnswers: () => writes.push("set"),
      onWriteFailed: () => {},
      write: async () => {
        writes.push("write");
      },
    });
    await noUser(HONORS, "yes");
    expect(writes).toEqual([]);
  });
});
