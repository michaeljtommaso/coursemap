// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, ProgramSlotWithData } from "@/types/db";
import type { LoadedPlan } from "@/services/plans";

// PlanProvider rendered for real against a mocked plans service (U-13): a
// board edit made before the active plan's first snapshot is applied — right
// after first run, while the plan is still being created, or while the first
// snapshot is in flight — must survive the load and be saved on top of it.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const course = (id: string) =>
  ({ id, subject: id.split("-")[0], number: id.split("-")[1], title: id, credits_min: 4 }) as unknown as Course;

// One fixed course in the template, so a new plan starts with one placement.
const FIXED = course("MATH-1910");
const PROGRAM = { id: "prog-a", name: "Program A", short_name: "Prog A" };
const PROGRAM_DATA = {
  slots: [
    { id: "s1", kind: "course", courses: FIXED, suggested_semester: 1, slot_row: 0, elective_groups: null },
  ] as unknown as ProgramSlotWithData[],
};

// Stable mock values: the provider's effects key on these identities.
const auth = {
  uid: "u1",
  profile: { activePlanId: null as string | null },
  loading: false,
  setActivePlanId: vi.fn(async () => {}),
};
const programCtx = {
  programs: [PROGRAM],
  getProgramData: () => PROGRAM_DATA,
  loadProgramData: async () => PROGRAM_DATA,
};
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/contexts/ProgramProvider", () => ({ useProgramContext: () => programCtx }));
// Cross-listing map (fictional): ENGRD-2110 is CS-2110 under another code.
const catalogCtx = { aliases: { "ENGRD-2110": "CS-2110" } as Record<string, string> };
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
let snapshot: SnapshotCb | null;
let subscribedPlanId: string | null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  snapshot = null;
  subscribedPlanId = null;
  plans.listPlans.mockReset().mockResolvedValue([]);
  plans.createPlan.mockReset();
  plans.updatePlan.mockReset().mockResolvedValue(undefined);
  plans.subscribePlan.mockReset().mockImplementation((_uid: string, planId: string, cb: SnapshotCb) => {
    subscribedPlanId = planId;
    snapshot = cb;
    return () => {};
  });
  auth.profile = { activePlanId: null };
  useProgramStore.setState({ selectedProgramId: PROGRAM.id });
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const flush = () => act(async () => {});

async function mount() {
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<PlanProvider><Probe /></PlanProvider>));
}

/** A loaded plan doc as subscribePlan hands it over. */
function loaded(content: Partial<LoadedPlan>): LoadedPlan {
  return {
    name: "Prog A",
    programId: PROGRAM.id,
    placements: [],
    courseSnapshots: {},
    completedIds: [],
    inProgressIds: [],
    waivedRequirementIds: [],
    schemaVersion: 3,
    legacy: false,
    courseMarks: {},
    triedCourseIds: [],
    ...content,
  };
}

const courseIds = () => ctx.placements.map((p) => p.courseId).sort();

describe("PlanProvider — edits before the plan loads (U-13)", () => {
  it("keeps a course placed while first run's plan is still being created", async () => {
    let finishCreate!: () => void;
    plans.createPlan.mockImplementation(() => new Promise<void>((r) => (finishCreate = r)));

    await mount();
    expect(plans.createPlan).toHaveBeenCalledTimes(1);
    expect(ctx.planId).toBeNull(); // create in flight

    // The board is up; the student places a course right away.
    await act(async () => void ctx.addPlacement(course("PSYCH-1101"), 1));
    expect(courseIds()).toEqual(["PSYCH-1101"]);

    // The create lands, the provider subscribes, the first snapshot arrives.
    await act(async () => finishCreate());
    const [, newId, input] = plans.createPlan.mock.calls[0];
    expect(subscribedPlanId).toBe(newId);
    expect(courseIds()).toEqual(["PSYCH-1101"]); // no blink while the snapshot is in flight
    expect(plans.updatePlan).not.toHaveBeenCalled(); // nothing written before the plan loads
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(plans.updatePlan).not.toHaveBeenCalled();
    await act(async () =>
      snapshot!({ plan: loaded({ placements: input.placements, courseSnapshots: input.courseSnapshots }), error: false })
    );

    // Still there, on top of the starting board…
    expect(courseIds()).toEqual(["MATH-1910", "PSYCH-1101"]);
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(courseIds()).toEqual(["MATH-1910", "PSYCH-1101"]);
    // …and saved to the new plan.
    expect(plans.updatePlan).toHaveBeenCalledTimes(1);
    const [, writtenId, payload] = plans.updatePlan.mock.calls[0];
    expect(writtenId).toBe(newId);
    expect(payload.placements.map((p: { courseId: string }) => p.courseId).sort()).toEqual([
      "MATH-1910",
      "PSYCH-1101",
    ]);
  });

  it("an edit before the first snapshot is applied doesn't overwrite the saved plan", async () => {
    plans.listPlans.mockResolvedValue([{ id: "plan-1", name: "Prog A", programId: PROGRAM.id }]);
    auth.profile = { activePlanId: "plan-1" };

    await mount();
    await flush();
    expect(subscribedPlanId).toBe("plan-1");

    // Subscribed, first snapshot still in flight: the student places a course.
    await act(async () => void ctx.addPlacement(course("PSYCH-1101"), 2));

    // The saved plan arrives with work the student already has.
    const saved = { id: "p-old", courseId: "CS-2110", sem: 3, order: 0 };
    await act(async () =>
      snapshot!({
        plan: loaded({ placements: [saved], courseSnapshots: { "CS-2110": courseToSnap("CS-2110") } }),
        error: false,
      })
    );
    await act(async () => vi.advanceTimersByTime(1_000));

    expect(courseIds()).toEqual(["CS-2110", "PSYCH-1101"]);
    expect(plans.updatePlan).toHaveBeenCalledTimes(1);
    const [, , payload] = plans.updatePlan.mock.calls[0];
    expect(payload.placements.map((p: { courseId: string }) => p.courseId).sort()).toEqual([
      "CS-2110",
      "PSYCH-1101",
    ]);
  });

  it("writes straight through once the plan has loaded", async () => {
    plans.listPlans.mockResolvedValue([{ id: "plan-1", name: "Prog A", programId: PROGRAM.id }]);
    auth.profile = { activePlanId: "plan-1" };

    await mount();
    await flush();
    await act(async () => snapshot!({ plan: loaded({}), error: false }));
    await act(async () => void ctx.addPlacement(course("PSYCH-1101"), 1));
    await act(async () => vi.advanceTimersByTime(1_000));

    expect(courseIds()).toEqual(["PSYCH-1101"]);
    expect(plans.updatePlan).toHaveBeenCalledTimes(1);
  });
});

describe("PlanProvider — tried classes (spec 025 D12)", () => {
  async function loadPlan(content: Partial<LoadedPlan>) {
    plans.listPlans.mockResolvedValue([{ id: "plan-1", name: "Prog A", programId: PROGRAM.id }]);
    auth.profile = { activePlanId: "plan-1" };
    await mount();
    await flush();
    await act(async () => snapshot!({ plan: loaded(content), error: false }));
  }
  const lastPayload = () => plans.updatePlan.mock.calls.at(-1)![2];

  it("loads the saved list, and try / untry / clear save the whole list through the plan save", async () => {
    await loadPlan({ triedCourseIds: ["CS-2110"] });
    expect(ctx.triedCourseIds).toEqual(["CS-2110"]);

    let ok = false;
    await act(async () => void (ok = ctx.tryCourse("PSYCH-1101")));
    expect(ok).toBe(true);
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(ctx.triedCourseIds).toEqual(["CS-2110", "PSYCH-1101"]);
    expect(lastPayload().triedCourseIds).toEqual(["CS-2110", "PSYCH-1101"]);

    await act(async () => ctx.untryCourse("CS-2110"));
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(lastPayload().triedCourseIds).toEqual(["PSYCH-1101"]);

    await act(async () => ctx.clearTried());
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(ctx.triedCourseIds).toEqual([]);
    // An empty list is sent; the service turns it into a field delete.
    expect(lastPayload().triedCourseIds).toEqual([]);
  });

  it("refuses a class already tried, past the cap of 20, or a malformed id — and writes nothing", async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `CS-${4000 + i}`);
    await loadPlan({ triedCourseIds: ["CS-2110"] });

    let ok = true;
    await act(async () => void (ok = ctx.tryCourse("CS-2110")));
    expect(ok).toBe(false);
    await act(async () => void (ok = ctx.tryCourse("")));
    expect(ok).toBe(false);
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(plans.updatePlan).not.toHaveBeenCalled();

    act(() => root.unmount());
    plans.updatePlan.mockClear();
    await loadPlan({ triedCourseIds: twenty });
    await act(async () => void (ok = ctx.tryCourse("MATH-2930")));
    expect(ok).toBe(false);
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(ctx.triedCourseIds).toEqual(twenty);
    expect(plans.updatePlan).not.toHaveBeenCalled();
  });

  it("placing a tried class removes it from tried in the same save (audit F2)", async () => {
    await loadPlan({ triedCourseIds: ["PSYCH-1101", "HIST-1530"] });
    await act(async () => void ctx.addPlacement(course("PSYCH-1101"), 2));
    expect(ctx.triedCourseIds).toEqual(["HIST-1530"]);
    await act(async () => vi.advanceTimersByTime(1_000));
    // One write carries both the placement and the shorter tried list.
    expect(plans.updatePlan).toHaveBeenCalledTimes(1);
    expect(lastPayload().triedCourseIds).toEqual(["HIST-1530"]);
    expect(courseIds()).toContain("PSYCH-1101");
  });

  it("a tried class placed under a cross-listed code leaves the list too", async () => {
    await loadPlan({ triedCourseIds: ["CS-2110"] });
    await act(async () => void ctx.addPlacement(course("ENGRD-2110"), 3));
    expect(ctx.triedCourseIds).toEqual([]);
  });

  it("the cap counts only what is tried: placing one frees a slot", async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `CS-${4000 + i}`);
    await loadPlan({ triedCourseIds: twenty });
    let ok = true;
    await act(async () => void (ok = ctx.tryCourse("MATH-2930")));
    expect(ok).toBe(false);
    await act(async () => void ctx.addPlacement(course("CS-4000"), 4));
    expect(ctx.triedCourseIds).toHaveLength(19);
    await act(async () => void (ok = ctx.tryCourse("MATH-2930")));
    expect(ok).toBe(true);
    expect(ctx.triedCourseIds).toHaveLength(20);
    expect(ctx.triedCourseIds).not.toContain("CS-4000");
  });

  it("placing a class nobody is trying leaves the list alone; a reset keeps the list", async () => {
    await loadPlan({ triedCourseIds: ["PSYCH-1101"] });
    await act(async () => void ctx.addPlacement(course("ECON-1110"), 2));
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(ctx.triedCourseIds).toEqual(["PSYCH-1101"]);

    await act(async () => ctx.resetPlan());
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(courseIds()).toEqual(["MATH-1910"]);
    expect(ctx.triedCourseIds).toEqual(["PSYCH-1101"]);
    expect(lastPayload().triedCourseIds).toEqual(["PSYCH-1101"]);
  });
});

function courseToSnap(id: string) {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: id, creditsMin: 4, creditsMax: 4 };
}
