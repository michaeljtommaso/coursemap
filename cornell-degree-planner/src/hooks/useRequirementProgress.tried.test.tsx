// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, ElectiveGroup, ProgramSlotWithData } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { RequirementProgress } from "./useRequirementProgress";

// useRequirementProgress rendered for real (Engineering path) with its
// contexts stubbed: the spec 028 tried state is attached, keeps its identity
// across callers and re-renders while inputs are unchanged, and never alters
// the real groups. Credit comes from useCreditProfile().resolved.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const course = (id: string, credits = 3) =>
  ({
    id,
    subject: id.split("-")[0],
    number: id.split("-")[1],
    title: id,
    credits_min: credits,
    credits_max: credits,
    attrs: [],
  }) as unknown as Course;

const GROUP: ElectiveGroup = {
  id: "g-cs",
  program_id: "prog-e",
  name: "CS electives",
  description: null,
  qualifying_rule: { type: "level", subject: "CS", min_number: 3000 },
  min_credits: 3,
  advisor_approval: false,
  notes: null,
};
const SLOTS = [
  { id: "s-math", kind: "course", course_id: "MATH-1910", courses: course("MATH-1910"), suggested_semester: 1, slot_row: 0, category: "math", elective_groups: null },
  { id: "s-el", kind: "elective", elective_group_id: "g-cs", elective_groups: GROUP, suggested_semester: 5, slot_row: 0, category: "elective", courses: null },
] as unknown as ProgramSlotWithData[];

const BOARD: Placement[] = [{ id: "p1", courseId: "MATH-1910", sem: 1, order: 0 }];
const plan = {
  placements: BOARD,
  placedCourses: { "MATH-1910": course("MATH-1910") } as Record<string, Course>,
  waivedRequirementIds: [] as string[],
  planProgramId: "prog-e",
  triedCourseIds: [] as string[],
  courseMarks: {},
};
const programData = { slots: SLOTS, layers: undefined, layerErrors: undefined, loading: false };
const programsValue = { programs: [{ id: "prog-e", name: "Prog E" }], loading: false };
const auth = { studentContext: { answers: {}, entryTerm: null, transfer: null, transferStanding: null, concentration: null } };
const INDEX = [
  { id: "CS-4410", subject: "CS", number: "4410", title: "OS", creditsMin: 4, creditsMax: 4 },
] as unknown as CatalogIndexRecord[];
const catalogValue = {
  aliases: {},
  courseDetails: {} as Record<string, Course>,
  ensureCourseDetails: vi.fn(),
  index: INDEX,
  loading: false,
  error: null,
};
const NO_CREDIT: unknown[] = [];
const creditView = { resolved: NO_CREDIT, raw: NO_CREDIT, college: null };
const extraPrograms = { programs: [] as unknown[], allLoaded: true };

vi.mock("@/hooks/usePlan", () => ({ usePlan: () => plan }));
vi.mock("@/hooks/useProgramData", () => ({ useProgramData: () => programData }));
vi.mock("@/hooks/usePrograms", () => ({ usePrograms: () => programsValue }));
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/contexts/CatalogProvider", () => ({ useCatalogContext: () => catalogValue }));
vi.mock("@/hooks/useCreditProfile", () => ({ useCreditProfile: () => creditView }));
// Spec 047: no extra programs (the real loader reads Firestore).
vi.mock("@/hooks/useAdditionalProgramData", () => ({ useAdditionalProgramData: () => extraPrograms }));

const { useRequirementProgress } = await import("./useRequirementProgress");

const seen: { a: RequirementProgress[]; b: RequirementProgress[] } = { a: [], b: [] };
function Probe({ name }: { name: "a" | "b" }) {
  const value = useRequirementProgress();
  useEffect(() => {
    seen[name].push(value);
  });
  return null;
}

let root: Root;
async function render() {
  await act(async () =>
    root.render(
      <>
        <Probe name="a" />
        <Probe name="b" />
      </>
    )
  );
}

beforeEach(() => {
  seen.a = [];
  seen.b = [];
  plan.triedCourseIds = [];
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
});

describe("useRequirementProgress — tried classes (spec 028 D11)", () => {
  it("has no tried state when nothing is tried", async () => {
    await render();
    const p = seen.a.at(-1)!;
    expect(p.tried).toBeUndefined();
    expect(p.groups.length).toBeGreaterThan(0);
  });

  it("attaches the tried result; the real items stay as the board has them", async () => {
    plan.triedCourseIds = ["CS-4410", "CS-9999"];
    await render();
    const p = seen.a.at(-1)!;
    expect(p.tried?.notOnBoard).toEqual(["CS-4410", "CS-9999"]);
    expect(p.tried?.missing).toEqual(["CS-9999"]);
    expect(p.tried?.items["g-cs"].status).toBe("satisfied");
    expect(p.tried?.fills["CS-4410"]).toEqual(["CS electives"]);
    const real = p.groups.flatMap((g) => g.items).find((i) => i.id === "g-cs")!;
    expect(real.status).toBe("unmet");
    // The tried classes' full docs are asked for alongside the board's.
    expect(catalogValue.ensureCourseDetails).toHaveBeenCalledWith(["MATH-1910", "CS-4410", "CS-9999"]);
  });

  it("every caller gets the same object, and a re-render with unchanged inputs keeps it", async () => {
    plan.triedCourseIds = ["CS-4410"];
    await render();
    const first = seen.a.at(-1)!;
    expect(seen.b.at(-1)).toBe(first);
    plan.triedCourseIds = [...plan.triedCourseIds]; // new array, same content
    await render();
    expect(seen.a.at(-1)).toBe(first);
    expect(seen.a.at(-1)!.tried).toBe(first.tried);
  });
});
