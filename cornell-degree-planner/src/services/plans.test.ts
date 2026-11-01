import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the SDK and the app module so no Firebase app boots under test. Writes
// are recorded; the snapshot listener is captured so a test can feed it a doc.
type Write = { path: string; data: Record<string, unknown> };
const { sets, updates, listeners, docsForGet } = vi.hoisted(() => ({
  sets: [] as Write[],
  updates: [] as Write[],
  listeners: [] as ((snap: unknown) => void)[],
  docsForGet: [] as { id: string; data: () => Record<string, unknown> }[],
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  getDocs: async () => ({ docs: docsForGet }),
  onSnapshot: (_ref: unknown, next: (snap: unknown) => void) => {
    listeners.push(next);
    return () => {};
  },
  setDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    sets.push({ path: ref.path, data });
  },
  updateDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    updates.push({ path: ref.path, data });
  },
  deleteDoc: async () => {},
  deleteField: () => "DELETE_FIELD",
  serverTimestamp: () => "SERVER_TIME",
}));
vi.mock("@/lib/firebase", () => ({ db: {} }));

import { createPlan, updatePlan, subscribePlan, readPlansForCarryOver, type LoadedPlan } from "./plans";

const FWS = "usedAs:cas-college/fws@ENGL-2880";
const many = (n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`creditsTaken:BIOMI-${4000 + i}`, 3]));

function planDoc(extra: Record<string, unknown> = {}) {
  return {
    name: "English",
    programId: "cas-english-ba",
    placements: [{ id: "p1", courseId: "ENGL-2880", sem: 1, order: 0 }],
    courseSnapshots: {},
    completedIds: [],
    inProgressIds: [],
    waivedRequirementIds: [],
    schemaVersion: 3,
    ...extra,
  };
}

beforeEach(() => {
  sets.length = 0;
  updates.length = 0;
  listeners.length = 0;
  docsForGet.length = 0;
});

describe("plans service — spec 020 course marks", () => {
  it("createPlan writes marks when there are some, and no field when there are none", async () => {
    await createPlan("u1", "a", { name: "A", programId: "x", courseMarks: { [FWS]: "yes" } });
    await createPlan("u1", "b", { name: "B", programId: "x", courseMarks: {} });
    await createPlan("u1", "c", { name: "C", programId: "x" });
    expect(sets[0].data.courseMarks).toEqual({ [FWS]: "yes" });
    expect(sets[1].data).not.toHaveProperty("courseMarks");
    expect(sets[2].data).not.toHaveProperty("courseMarks");
  });

  it("createPlan refuses more than 80 marks before writing", async () => {
    await expect(createPlan("u1", "a", { name: "A", programId: "x", courseMarks: many(81) })).rejects.toThrow();
    expect(sets).toHaveLength(0);
  });

  it("updatePlan writes the whole marks map, and deletes the field when no marks are left", async () => {
    await updatePlan("u1", "a", { courseMarks: { [FWS]: "no" } });
    await updatePlan("u1", "a", { courseMarks: {} });
    await updatePlan("u1", "a", { name: "Renamed" });
    expect(updates[0].data.courseMarks).toEqual({ [FWS]: "no" });
    expect(updates[1].data.courseMarks).toBe("DELETE_FIELD");
    expect(updates[2].data).not.toHaveProperty("courseMarks");
  });

  it("updatePlan refuses a malformed or oversized marks map before writing", async () => {
    await expect(updatePlan("u1", "a", { courseMarks: many(81) })).rejects.toThrow();
    await expect(updatePlan("u1", "a", { courseMarks: { "bad.key": "yes" } })).rejects.toThrow();
    await expect(updatePlan("u1", "a", { courseMarks: { [FWS]: 99 } })).rejects.toThrow();
    expect(updates).toHaveLength(0);
  });

  it("subscribePlan hands over the stored marks (malformed entries dropped), {} without any", () => {
    const seen: (LoadedPlan | null)[] = [];
    subscribePlan("u1", "a", ({ plan }) => seen.push(plan));
    const snap = (data: Record<string, unknown>) => ({ exists: () => true, data: () => data });
    listeners[0](snap(planDoc({ courseMarks: { [FWS]: "yes", "bad.key": "yes" } })));
    listeners[0](snap(planDoc()));
    listeners[0](snap({ name: "Old", programId: "x", schemaVersion: 2, slotSelections: {} }));
    expect(seen.map((p) => p?.courseMarks)).toEqual([{ [FWS]: "yes" }, {}, {}]);
  });

  it("readPlansForCarryOver includes each plan's marks", async () => {
    docsForGet.push({ id: "g1", data: () => planDoc({ courseMarks: { [FWS]: "yes" } }) });
    docsForGet.push({ id: "g2", data: () => planDoc() });
    const plans = await readPlansForCarryOver("guest");
    expect(plans.map((p) => p.content.courseMarks)).toEqual([{ [FWS]: "yes" }, {}]);
  });
});
