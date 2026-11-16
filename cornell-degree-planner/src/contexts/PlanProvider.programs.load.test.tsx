// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgramSlotWithData } from "@/types/db";
import type { LoadedPlan } from "@/services/plans";

// Spec 047 plan state rendered for real against a mocked plans service: the
// extra programs persist through the debounced save (with the strict check's
// primary), a removal's Undo restores them, countsFor and orphan pruning
// save once, and copy paths (what-if, major switch) carry the list.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Fictional programs: two CAS majors and one CALS major.
const ECON = { id: "cas-econ-ba", name: "Economics, B.A.", short_name: "Economics", college: "", collegeId: "cas" };
const MATH = { id: "cas-math-ba", name: "Mathematics, B.A.", short_name: "Mathematics", college: "", collegeId: "cas" };
const AEM = { id: "cals-aem-bs", name: "AEM, B.S.", short_name: "AEM", college: "", collegeId: "cals" };
const CS = { id: "cas-cs-ba", name: "Computer Science, B.A.", short_name: "Computer Science", college: "", collegeId: "cas" };
const NO_SLOTS = { slots: [] as ProgramSlotWithData[] };

const auth = {
  uid: "u1",
  profile: { activePlanId: null as string | null },
  loading: false,
  setActivePlanId: vi.fn(async () => {}),
};
const programCtx = {
  programs: [ECON, MATH, AEM, CS],
  getProgramData: () => NO_SLOTS,
  loadProgramData: async () => NO_SLOTS,
};
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/contexts/ProgramProvider", () => ({ useProgramContext: () => programCtx }));
const catalogCtx = { aliases: {} as Record<string, string> };
vi.mock("@/contexts/CatalogProvider", () => ({ useCatalogContext: () => catalogCtx }));

type SnapshotCb = (r: { plan: LoadedPlan | null; error: boolean }) => void;
const plans = vi.hoisted(() => ({
  listPlans: vi.fn(),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
  subscribePlan: vi.fn(),
  deletePlan: vi.fn(),
}));
vi.mock("@/services/plans", () => plans);

const { PlanProvider, usePlanContext } = await import("./PlanProvider");
const { useProgramStore } = await import("@/store/useProgramStore");
const { usePlannerStore } = await import("@/store/usePlannerStore");
const { rememberMinorIndex } = await import("@/services/minorIndexCache");

// The session's minor index (spec 047 D12): the CS minor is closed to CS
// majors, the Math minor to Math majors; the Quant minor is only open to
// Math majors.
const minorEntry = (id: string, shortName: string, notOpenTo?: string[], onlyOpenTo?: string[]) => ({
  id,
  name: shortName,
  shortName,
  offeredBy: "Arts & Sciences",
  catalogYear: "2026-27",
  ...(notOpenTo ? { notOpenTo } : {}),
  ...(onlyOpenTo ? { onlyOpenTo } : {}),
});
const MINOR_INDEX = [
  minorEntry("minor-cs", "CS minor", [CS.id]),
  minorEntry("minor-math", "Math minor", [MATH.id]),
  minorEntry("minor-ds", "DS minor"),
  minorEntry("minor-quant", "Quant minor", undefined, [MATH.id]),
];

type Ctx = ReturnType<typeof usePlanContext>;
let ctx: Ctx;
function Probe() {
  const value = usePlanContext();
  useEffect(() => {
    ctx = value;
  });
  return null;
}

let root: Root;
const snapshots = new Map<string, SnapshotCb>();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  snapshots.clear();
  plans.listPlans.mockReset().mockResolvedValue([{ id: "plan-1", name: "Econ", programId: ECON.id }]);
  plans.createPlan.mockReset().mockResolvedValue(undefined);
  plans.updatePlan.mockReset().mockResolvedValue(undefined);
  plans.subscribePlan.mockReset().mockImplementation((_uid: string, planId: string, cb: SnapshotCb) => {
    snapshots.set(planId, cb);
    return () => {};
  });
  auth.profile = { activePlanId: "plan-1" };
  useProgramStore.setState({ selectedProgramId: ECON.id });
  usePlannerStore.setState({ toast: null, toastAction: null });
  rememberMinorIndex(null);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const flush = () => act(async () => {});
const settle = () => act(async () => vi.advanceTimersByTime(1_000));

function loaded(content: Partial<LoadedPlan>): LoadedPlan {
  return {
    name: "Econ",
    programId: ECON.id,
    placements: [],
    courseSnapshots: {},
    completedIds: [],
    inProgressIds: [],
    waivedRequirementIds: [],
    schemaVersion: 3,
    legacy: false,
    courseMarks: {},
    triedCourseIds: [],
    shortTerms: [],
    additionalPrograms: [],
    ...content,
  };
}

async function mountLoaded(content: Partial<LoadedPlan> = {}) {
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<PlanProvider><Probe /></PlanProvider>));
  await flush();
  await act(async () => snapshots.get("plan-1")!({ plan: loaded(content), error: false }));
}

const lastWrite = () => plans.updatePlan.mock.calls[plans.updatePlan.mock.calls.length - 1];

describe("PlanProvider — spec 047 extra programs", () => {
  it("loads the plan's programs and saves an added one with the plan's primary for the strict check", async () => {
    await mountLoaded({ additionalPrograms: [{ programId: "minor-cs", kind: "minor" }] });
    expect(ctx.additionalPrograms).toEqual([{ programId: "minor-cs", kind: "minor" }]);

    let result: string | undefined;
    await act(async () => void (result = ctx.addProgram({ programId: MATH.id, kind: "major" })));
    expect(result).toBe("added");
    await settle();
    const [, planId, payload, options] = lastWrite();
    expect(planId).toBe("plan-1");
    expect(payload.additionalPrograms).toEqual([
      { programId: "minor-cs", kind: "minor" },
      { programId: MATH.id, kind: "major" },
    ]);
    expect(options).toEqual({ primaryProgramId: ECON.id });
  });

  it("refuses with a toast: the primary, a repeat, another college's major", async () => {
    await mountLoaded({ additionalPrograms: [{ programId: "minor-cs", kind: "minor" }] });
    let r: string | undefined;
    await act(async () => void (r = ctx.addProgram({ programId: ECON.id, kind: "major" })));
    expect(r).toBe("primary");
    expect(usePlannerStore.getState().toast?.message).toBe("Economics is already this plan's major.");
    await act(async () => void (r = ctx.addProgram({ programId: "minor-cs", kind: "minor" })));
    expect(r).toBe("duplicate");
    await act(async () => void (r = ctx.addProgram({ programId: AEM.id, kind: "major" })));
    expect(r).toBe("invalid");
    expect(usePlannerStore.getState().toast?.message).toBe(
      "A second major has to be in the same college as your major."
    );
    await settle();
    expect(plans.updatePlan).not.toHaveBeenCalled();
  });

  it("a saved echo of the list is not re-applied, and an old tab's snapshot without the field reads as none", async () => {
    await mountLoaded();
    await act(async () => void ctx.addProgram({ programId: "minor-cs", kind: "minor" }));
    await settle();
    const [, , payload] = lastWrite();
    // The echo of our own write: ignored (state unchanged, no new write).
    await act(async () => snapshots.get("plan-1")!({ plan: loaded({ additionalPrograms: payload.additionalPrograms }), error: false }));
    expect(ctx.additionalPrograms).toEqual([{ programId: "minor-cs", kind: "minor" }]);
    expect(plans.updatePlan).toHaveBeenCalledTimes(1);
  });

  it("removeProgram drops it and its tried-only classes, keeps waivers and marks; Undo brings both back", async () => {
    await mountLoaded({
      additionalPrograms: [
        { programId: MATH.id, kind: "major" },
        { programId: "minor-cs", kind: "minor" },
      ],
      triedCourseIds: ["CS-1110", "MATH-2210"],
      waivedRequirementIds: ["minor-cs:core"],
      courseMarks: { "countsFor:minor-cs@CS-2110": "yes" },
    });
    await act(async () => ctx.removeProgram("minor-cs", ["CS-1110"]));
    expect(ctx.additionalPrograms).toEqual([{ programId: MATH.id, kind: "major" }]);
    expect(ctx.triedCourseIds).toEqual(["MATH-2210"]);
    expect(ctx.waivedRequirementIds).toEqual(["minor-cs:core"]);
    expect(ctx.courseMarks).toEqual({ "countsFor:minor-cs@CS-2110": "yes" });
    const toast = usePlannerStore.getState().toast!;
    expect(toast.message).toBe("Removed the minor");
    expect(toast.actionLabel).toBe("Undo");
    await settle();
    expect(lastWrite()[2].additionalPrograms).toEqual([{ programId: MATH.id, kind: "major" }]);

    await act(async () => usePlannerStore.getState().toastAction!());
    expect(ctx.additionalPrograms).toEqual([
      { programId: MATH.id, kind: "major" },
      { programId: "minor-cs", kind: "minor" },
    ]);
    expect(ctx.triedCourseIds).toEqual(["MATH-2210", "CS-1110"]);
    await settle();
    expect(lastWrite()[2].additionalPrograms).toHaveLength(2);
  });

  it("removing the last program saves an empty list (the service deletes the field)", async () => {
    await mountLoaded({ additionalPrograms: [{ programId: MATH.id, kind: "major" }] });
    await act(async () => ctx.removeProgram(MATH.id, []));
    expect(usePlannerStore.getState().toast?.message).toBe("Removed Mathematics");
    await settle();
    expect(lastWrite()[2].additionalPrograms).toEqual([]);
  });

  it("setProgramConcentrations, addTriedCourses and setCountsFor save through the plan", async () => {
    await mountLoaded({
      additionalPrograms: [{ programId: MATH.id, kind: "major" }],
      triedCourseIds: ["MATH-2210"],
      placements: [{ id: "p1", courseId: "MATH-1910", sem: 1, order: 0 }],
    });
    await act(async () => ctx.setProgramConcentrations(MATH.id, ["stats"]));
    let added: { added: string[]; skipped: number } | undefined;
    await act(async () => void (added = ctx.addTriedCourses(["MATH-1910", "MATH-2210", "MATH-3110"])));
    expect(added).toEqual({ added: ["MATH-3110"], skipped: 0 });
    await act(async () => ctx.setCountsFor("ECON-3110", MATH.id));
    await settle();
    expect(plans.updatePlan).toHaveBeenCalledTimes(1);
    const [, , payload] = lastWrite();
    expect(payload.additionalPrograms).toEqual([{ programId: MATH.id, kind: "major", concentrationIds: ["stats"] }]);
    expect(payload.triedCourseIds).toEqual(["MATH-2210", "MATH-3110"]);
    expect(payload.courseMarks).toEqual({ [`countsFor:${MATH.id}@ECON-3110`]: "yes" });
  });

  it("setProgramConcentrations on a minor is refused with a toast", async () => {
    await mountLoaded({ additionalPrograms: [{ programId: "minor-cs", kind: "minor" }] });
    await act(async () => ctx.setProgramConcentrations("minor-cs", ["x"]));
    expect(usePlannerStore.getState().toast?.message).toBe("Couldn't save those concentrations.");
    await settle();
    expect(plans.updatePlan).not.toHaveBeenCalled();
  });

  it("pruneOrphans drops orphaned waivers and marks in one save and says how many", async () => {
    await mountLoaded({
      waivedRequirementIds: [`${ECON.id}:core`, "minor-old:core", "eng-slot-1"],
      courseMarks: { "countsFor:minor-old@CS-2110": "yes", "creditsTaken:BIO-1000": 3 },
    });
    let n = 0;
    await act(async () => void (n = ctx.pruneOrphans(["cas-college", ECON.id])));
    expect(n).toBe(2);
    await settle();
    expect(plans.updatePlan).toHaveBeenCalledTimes(1);
    const [, , payload] = lastWrite();
    expect(payload.waivedRequirementIds).toEqual([`${ECON.id}:core`, "eng-slot-1"]);
    expect(payload.courseMarks).toEqual({ "creditsTaken:BIO-1000": 3 });
    expect(ctx.pruneOrphans(["cas-college", ECON.id])).toBe(0);
  });

  it("a what-if plan for the same program is created with the plan's programs", async () => {
    await mountLoaded({ additionalPrograms: [{ programId: "minor-cs", kind: "minor" }] });
    await act(async () => ctx.createNewPlan(ECON.id, "Econ what-if"));
    const [, , input] = plans.createPlan.mock.calls[0];
    expect(input).toMatchObject({
      programId: ECON.id,
      additionalPrograms: [{ programId: "minor-cs", kind: "minor" }],
    });
  });

  it("a major switch to an empty plan carries minors and a same-college second major, never the new primary", async () => {
    await mountLoaded({
      additionalPrograms: [
        { programId: MATH.id, kind: "major" },
        { programId: "minor-cs", kind: "minor" },
      ],
      triedCourseIds: ["CS-1110"],
    });
    // Switch to Mathematics, whose plan exists and is empty.
    plans.listPlans.mockResolvedValue([
      { id: "plan-1", name: "Econ", programId: ECON.id },
      { id: "plan-2", name: "Math", programId: MATH.id },
    ]);
    await act(async () => useProgramStore.setState({ selectedProgramId: MATH.id }));
    await flush();
    await act(async () => snapshots.get("plan-2")!({ plan: loaded({ name: "Math", programId: MATH.id }), error: false }));
    expect(ctx.additionalPrograms).toEqual([{ programId: "minor-cs", kind: "minor" }]);
    await settle();
    const [, planId, payload, options] = lastWrite();
    expect(planId).toBe("plan-2");
    expect(payload.additionalPrograms).toEqual([{ programId: "minor-cs", kind: "minor" }]);
    expect(options).toEqual({ primaryProgramId: MATH.id });
  });

  /** Switch the loaded Econ plan to `to`, whose plan exists and is empty. */
  async function switchToEmpty(to: { id: string; name: string }) {
    plans.listPlans.mockResolvedValue([
      { id: "plan-1", name: "Econ", programId: ECON.id },
      { id: "plan-2", name: to.name, programId: to.id },
    ]);
    await act(async () => useProgramStore.setState({ selectedProgramId: to.id }));
    await flush();
    await act(async () => snapshots.get("plan-2")!({ plan: loaded({ name: to.name, programId: to.id }), error: false }));
  }

  it("audit #3: a major switch drops a carried minor closed to the new major and says so", async () => {
    rememberMinorIndex(MINOR_INDEX);
    await mountLoaded({
      placements: [{ id: "p1", courseId: "MATH-1910", sem: 1, order: 0 }],
      additionalPrograms: [{ programId: "minor-cs", kind: "minor" }, { programId: "minor-ds", kind: "minor" }],
    });
    await switchToEmpty(CS);
    expect(ctx.additionalPrograms).toEqual([{ programId: "minor-ds", kind: "minor" }]);
    expect(usePlannerStore.getState().toast?.message).toBe(
      "Kept your course on your new board; the CS minor isn't open to Computer Science majors, so it was removed."
    );
    await settle();
    expect(lastWrite()[2].additionalPrograms).toEqual([{ programId: "minor-ds", kind: "minor" }]);
  });

  it("audit #3: ... and one closed to the carried second major, with nothing else kept", async () => {
    rememberMinorIndex(MINOR_INDEX);
    await mountLoaded({
      additionalPrograms: [{ programId: MATH.id, kind: "major" }, { programId: "minor-math", kind: "minor" }],
    });
    await switchToEmpty(CS);
    expect(ctx.additionalPrograms).toEqual([{ programId: MATH.id, kind: "major" }]);
    expect(usePlannerStore.getState().toast?.message).toBe(
      "The Math minor isn't open to Mathematics majors, so it was removed."
    );
  });

  it("audit #3: without the minor index the minor is carried (the panel warns)", async () => {
    await mountLoaded({ additionalPrograms: [{ programId: "minor-cs", kind: "minor" }] });
    await switchToEmpty(CS);
    expect(ctx.additionalPrograms).toEqual([{ programId: "minor-cs", kind: "minor" }]);
  });

  it("audit #11: switching to the current second major says it was the second major", async () => {
    await mountLoaded({
      additionalPrograms: [{ programId: MATH.id, kind: "major" }, { programId: "minor-ds", kind: "minor" }],
    });
    await switchToEmpty(MATH);
    expect(ctx.additionalPrograms).toEqual([{ programId: "minor-ds", kind: "minor" }]);
    expect(usePlannerStore.getState().toast?.message).toBe("Mathematics is now your major; it was your second major.");
  });

  it("audit #3: addProgram refuses a second major a minor on the plan is closed to, and the reverse", async () => {
    rememberMinorIndex(MINOR_INDEX);
    await mountLoaded({ additionalPrograms: [{ programId: "minor-cs", kind: "minor" }] });
    let r: string | undefined;
    await act(async () => void (r = ctx.addProgram({ programId: CS.id, kind: "major" })));
    expect(r).toBe("invalid");
    expect(usePlannerStore.getState().toast?.message).toBe(
      "Can't add Computer Science: the CS minor isn't open to Computer Science majors. Remove the minor first."
    );
    await act(async () => void (r = ctx.addProgram({ programId: MATH.id, kind: "major" })));
    expect(r).toBe("added");
    await act(async () => void (r = ctx.addProgram({ programId: "minor-math", kind: "minor" })));
    expect(r).toBe("invalid");
    expect(usePlannerStore.getState().toast?.message).toBe("The Math minor isn't open to Mathematics majors.");
    expect(ctx.additionalPrograms).toEqual([
      { programId: "minor-cs", kind: "minor" },
      { programId: MATH.id, kind: "major" },
    ]);
  });

  it("audit #3: without the minor index addProgram adds it (unknown, not refused)", async () => {
    await mountLoaded({ additionalPrograms: [{ programId: "minor-cs", kind: "minor" }] });
    let r: string | undefined;
    await act(async () => void (r = ctx.addProgram({ programId: CS.id, kind: "major" })));
    expect(r).toBe("added");
  });

  it("onlyOpenTo: addProgram refuses the minor until a major on the plan opens it", async () => {
    rememberMinorIndex(MINOR_INDEX);
    await mountLoaded();
    let r: string | undefined;
    await act(async () => void (r = ctx.addProgram({ programId: "minor-quant", kind: "minor" })));
    expect(r).toBe("invalid");
    expect(usePlannerStore.getState().toast?.message).toBe("The Quant minor is only open to Mathematics majors.");
    await act(async () => void (r = ctx.addProgram({ programId: MATH.id, kind: "major" })));
    expect(r).toBe("added");
    await act(async () => void (r = ctx.addProgram({ programId: "minor-quant", kind: "minor" })));
    expect(r).toBe("added");
    expect(ctx.additionalPrograms).toEqual([
      { programId: MATH.id, kind: "major" },
      { programId: "minor-quant", kind: "minor" },
    ]);
  });

  it("onlyOpenTo: removing the second major that opens a minor on the plan is refused", async () => {
    rememberMinorIndex(MINOR_INDEX);
    const list = [
      { programId: MATH.id, kind: "major" as const },
      { programId: "minor-quant", kind: "minor" as const },
    ];
    await mountLoaded({ additionalPrograms: list });
    await act(async () => ctx.removeProgram(MATH.id, []));
    expect(ctx.additionalPrograms).toEqual(list);
    expect(usePlannerStore.getState().toast?.message).toBe(
      "Can't remove Mathematics: the Quant minor is only open to Mathematics majors. Remove the minor first."
    );
    // The minor first, then the major: both go.
    await act(async () => ctx.removeProgram("minor-quant", []));
    await act(async () => ctx.removeProgram(MATH.id, []));
    expect(ctx.additionalPrograms).toEqual([]);
  });

  it("onlyOpenTo: a major switch drops a carried minor the new majors don't open, and says so", async () => {
    rememberMinorIndex(MINOR_INDEX);
    await mountLoaded({ additionalPrograms: [{ programId: "minor-quant", kind: "minor" }] });
    await switchToEmpty(CS);
    expect(ctx.additionalPrograms).toEqual([]);
    expect(usePlannerStore.getState().toast?.message).toBe(
      "The Quant minor is only open to Mathematics majors, so it was removed."
    );
  });

  it("onlyOpenTo: Undo refuses to bring back a minor once the major that opened it is gone", async () => {
    rememberMinorIndex(MINOR_INDEX);
    await mountLoaded({
      additionalPrograms: [{ programId: MATH.id, kind: "major" }, { programId: "minor-quant", kind: "minor" }],
    });
    await act(async () => ctx.removeProgram("minor-quant", []));
    const undo = usePlannerStore.getState().toastAction!;
    await act(async () => ctx.removeProgram(MATH.id, []));
    await act(async () => undo());
    expect(ctx.additionalPrograms).toEqual([]);
    expect(usePlannerStore.getState().toast?.message).toBe(
      "Can't bring back Quant minor: the Quant minor is only open to Mathematics majors."
    );
  });

  it("audit #3: Undo refuses to bring back a minor closed to a second major added meanwhile", async () => {
    rememberMinorIndex(MINOR_INDEX);
    await mountLoaded({ additionalPrograms: [{ programId: "minor-cs", kind: "minor" }] });
    await act(async () => ctx.removeProgram("minor-cs", []));
    const undo = usePlannerStore.getState().toastAction!;
    await act(async () => void ctx.addProgram({ programId: CS.id, kind: "major" }));
    await act(async () => undo());
    expect(ctx.additionalPrograms).toEqual([{ programId: CS.id, kind: "major" }]);
    expect(usePlannerStore.getState().toast?.message).toBe(
      "Can't bring back CS minor: the CS minor isn't open to Computer Science majors."
    );
  });

  it("audit #6: pruneOrphans keeps a removed program's waivers while its Undo is open, then prunes", async () => {
    await mountLoaded({
      additionalPrograms: [{ programId: MATH.id, kind: "major", concentrationIds: ["x"] }],
      waivedRequirementIds: [`${MATH.id}:core`, `${MATH.id}--x:r1`, "minor-old:core"],
    });
    await act(async () => ctx.removeProgram(MATH.id, []));
    let n = 0;
    await act(async () => void (n = ctx.pruneOrphans(["cas-college", ECON.id])));
    expect(n).toBe(1); // only the long-gone minor's
    expect(ctx.waivedRequirementIds).toEqual([`${MATH.id}:core`, `${MATH.id}--x:r1`]);
    // Undo brings the program back with its waivers intact.
    await act(async () => usePlannerStore.getState().toastAction!());
    expect(ctx.additionalPrograms).toEqual([{ programId: MATH.id, kind: "major", concentrationIds: ["x"] }]);
    expect(ctx.waivedRequirementIds).toEqual([`${MATH.id}:core`, `${MATH.id}--x:r1`]);
    // Removed again and the Undo toast gone: now they are orphans.
    await act(async () => ctx.removeProgram(MATH.id, []));
    await act(async () => usePlannerStore.getState().dismissToast());
    await act(async () => void (n = ctx.pruneOrphans(["cas-college", ECON.id])));
    expect(n).toBe(2);
    expect(ctx.waivedRequirementIds).toEqual([]);
  });
});
