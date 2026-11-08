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

import { createPlan, updatePlan, subscribePlan, readPlansForCarryOver, listPlans, type LoadedPlan } from "./plans";

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

describe("plans service — retired program ids (spec 019 D12)", () => {
  const OLD = "cornell-infosci-bs-2025";
  const NEW = "cornell-information-science-bs-2026";
  const snap = (data: Record<string, unknown>) => ({ exists: () => true, data: () => data });

  it("listPlans hands over the current id, so the switcher matches the selected program", async () => {
    docsForGet.push({ id: "a", data: () => planDoc({ name: "InfoSci", programId: OLD }) });
    docsForGet.push({ id: "b", data: () => planDoc({ name: "Comm", programId: "cornell-comm-bs-2025" }) });
    docsForGet.push({ id: "c", data: () => planDoc() });
    expect(await listPlans("u1")).toEqual([
      { id: "a", name: "InfoSci", programId: NEW },
      { id: "b", name: "Comm", programId: "cornell-communication-bs-2026" },
      { id: "c", name: "English", programId: "cas-english-ba" },
    ]);
  });

  it("subscribePlan reads an old-id doc as the current program with translated waivers", () => {
    const seen: (LoadedPlan | null)[] = [];
    subscribePlan("u1", "a", ({ plan }) => seen.push(plan));
    listeners[0](snap(planDoc({ programId: OLD, waivedRequirementIds: ["infosci-math-calc", "infosci-s1-pe"] })));
    listeners[0](snap({ name: "Old", programId: OLD, schemaVersion: 2, slotSelections: {} }));
    expect(seen[0]).toMatchObject({ programId: NEW, waivedRequirementIds: [`${NEW}:calculus`] });
    expect(seen[1]).toMatchObject({ programId: NEW, legacy: true });
  });

  it("readPlansForCarryOver copies an old-id plan under the current id with translated waivers", async () => {
    docsForGet.push({
      id: "g1",
      data: () => planDoc({ programId: OLD, waivedRequirementIds: ["infosci-s3-info2950", "free-elective"] }),
    });
    docsForGet.push({ id: "g2", data: () => planDoc({ waivedRequirementIds: ["cas-english-ba:intro"] }) });
    const [old, other] = await readPlansForCarryOver("guest");
    expect(old.content).toMatchObject({ programId: NEW, waivedRequirementIds: [`${NEW}:core-data-science`] });
    expect(other.content).toMatchObject({
      programId: "cas-english-ba",
      waivedRequirementIds: ["cas-english-ba:intro"],
    });
  });
});

describe("plans service — spec 028 tried classes", () => {
  const snap = (data: Record<string, unknown>) => ({ exists: () => true, data: () => data });
  const twentyOne = Array.from({ length: 21 }, (_, i) => `CS-${4000 + i}`);

  it("createPlan writes the list when there is one, and no field when there is none", async () => {
    await createPlan("u1", "a", { name: "A", programId: "x", triedCourseIds: ["CS-2110", "CS-2110", "MATH-2930"] });
    await createPlan("u1", "b", { name: "B", programId: "x", triedCourseIds: [] });
    await createPlan("u1", "c", { name: "C", programId: "x" });
    expect(sets[0].data.triedCourseIds).toEqual(["CS-2110", "MATH-2930"]);
    expect(sets[1].data).not.toHaveProperty("triedCourseIds");
    expect(sets[2].data).not.toHaveProperty("triedCourseIds");
  });

  it("updatePlan writes the whole list, and deletes the field when none are left", async () => {
    await updatePlan("u1", "a", { triedCourseIds: ["CS-2110"] });
    await updatePlan("u1", "a", { triedCourseIds: [] });
    await updatePlan("u1", "a", { name: "Renamed" });
    expect(updates[0].data.triedCourseIds).toEqual(["CS-2110"]);
    expect(updates[1].data.triedCourseIds).toBe("DELETE_FIELD");
    expect(updates[2].data).not.toHaveProperty("triedCourseIds");
  });

  it("refuses more than 20 classes or a malformed id before writing", async () => {
    await expect(updatePlan("u1", "a", { triedCourseIds: twentyOne })).rejects.toThrow();
    await expect(updatePlan("u1", "a", { triedCourseIds: [""] })).rejects.toThrow();
    await expect(createPlan("u1", "a", { name: "A", programId: "x", triedCourseIds: twentyOne })).rejects.toThrow();
    expect(sets).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("subscribePlan hands over the stored list (bad entries dropped), [] without one", () => {
    const seen: (LoadedPlan | null)[] = [];
    subscribePlan("u1", "a", ({ plan }) => seen.push(plan));
    listeners[0](snap(planDoc({ triedCourseIds: ["CS-2110", 7, "CS-2110", "MATH-2930"] })));
    listeners[0](snap(planDoc()));
    listeners[0](snap(planDoc({ triedCourseIds: "CS-2110" })));
    listeners[0](snap({ name: "Old", programId: "x", schemaVersion: 2, slotSelections: {} }));
    expect(seen.map((p) => p?.triedCourseIds)).toEqual([["CS-2110", "MATH-2930"], [], [], []]);
  });

  it("readPlansForCarryOver includes each plan's list, also under a retired program id", async () => {
    docsForGet.push({ id: "g1", data: () => planDoc({ triedCourseIds: ["CS-2110"] }) });
    docsForGet.push({
      id: "g2",
      data: () => planDoc({ programId: "cornell-infosci-bs-2025", triedCourseIds: ["INFO-2950"] }),
    });
    docsForGet.push({ id: "g3", data: () => planDoc() });
    const plans = await readPlansForCarryOver("guest");
    expect(plans.map((p) => p.content.triedCourseIds)).toEqual([["CS-2110"], ["INFO-2950"], []]);
    expect(plans[1].content.programId).toBe("cornell-information-science-bs-2026");
  });
});

describe("plans service — spec 042 short terms", () => {
  const snap = (data: Record<string, unknown>) => ({ exists: () => true, data: () => data });
  const winter = { id: "w1", courseId: "PSYCH-1101", sem: 2, order: 0, shortTerm: true as const };

  it("createPlan writes the list (sorted, deduped) when there is one, and no field when there is none", async () => {
    await createPlan("u1", "a", { name: "A", programId: "x", shortTerms: [3, 1, 3] });
    await createPlan("u1", "b", { name: "B", programId: "x", shortTerms: [] });
    await createPlan("u1", "c", { name: "C", programId: "x" });
    expect(sets[0].data.shortTerms).toEqual([1, 3]);
    expect(sets[1].data).not.toHaveProperty("shortTerms");
    expect(sets[2].data).not.toHaveProperty("shortTerms");
  });

  it("createPlan keeps a short-term class's flag on its placement", async () => {
    await createPlan("u1", "a", { name: "A", programId: "x", placements: [winter], shortTerms: [2] });
    expect(sets[0].data.placements).toEqual([winter]);
  });

  it("updatePlan writes the whole list, and deletes the field when none are left", async () => {
    await updatePlan("u1", "a", { shortTerms: [2] });
    await updatePlan("u1", "a", { shortTerms: [] });
    await updatePlan("u1", "a", { name: "Renamed" });
    expect(updates[0].data.shortTerms).toEqual([2]);
    expect(updates[1].data.shortTerms).toBe("DELETE_FIELD");
    expect(updates[2].data).not.toHaveProperty("shortTerms");
  });

  it("refuses a malformed short term before writing", async () => {
    await expect(updatePlan("u1", "a", { shortTerms: [0] })).rejects.toThrow();
    await expect(updatePlan("u1", "a", { shortTerms: [11] })).rejects.toThrow();
    await expect(updatePlan("u1", "a", { shortTerms: [1.5] })).rejects.toThrow();
    await expect(createPlan("u1", "a", { name: "A", programId: "x", shortTerms: [12] })).rejects.toThrow();
    expect(sets).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("round-trips: what createPlan writes, subscribePlan hands back (list + placement flag)", async () => {
    await createPlan("u1", "a", { name: "A", programId: "x", placements: [winter], shortTerms: [2, 1] });
    const written = { ...sets[0].data, createdAt: null, updatedAt: null };
    const seen: (LoadedPlan | null)[] = [];
    subscribePlan("u1", "a", ({ plan }) => seen.push(plan));
    listeners[0](snap(written));
    expect(seen[0]?.shortTerms).toEqual([1, 2]);
    expect(seen[0]?.placements).toEqual([winter]);
  });

  it("subscribePlan hands over [] for a doc without the field, and for a legacy doc", () => {
    const seen: (LoadedPlan | null)[] = [];
    subscribePlan("u1", "a", ({ plan }) => seen.push(plan));
    listeners[0](snap(planDoc()));
    listeners[0](snap({ name: "Old", programId: "x", schemaVersion: 2, slotSelections: {} }));
    expect(seen.map((p) => p?.shortTerms)).toEqual([[], []]);
    // An old doc's placements carry no flag and read exactly as before.
    expect(seen[0]?.placements).toEqual([{ id: "p1", courseId: "ENGL-2880", sem: 1, order: 0 }]);
  });

  it("readPlansForCarryOver includes each plan's short terms", async () => {
    docsForGet.push({ id: "g1", data: () => planDoc({ placements: [winter], shortTerms: [2, 5] }) });
    docsForGet.push({ id: "g2", data: () => planDoc() });
    const plans = await readPlansForCarryOver("guest");
    expect(plans.map((p) => p.content.shortTerms)).toEqual([[2, 5], []]);
    expect(plans[0].content.placements[0]).toMatchObject({ shortTerm: true });
  });
});
