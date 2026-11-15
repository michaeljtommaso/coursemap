// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course } from "@/types/db";
import type { Placement } from "@/types/plan";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { DistributionProgressInput } from "@/lib/planner/distributionProgress";
import type { RequirementProgress } from "./useRequirementProgress";

// useRequirementProgress on the Distribution path, with the engine stubbed:
// the tried classes' second solve skips the open-question search (its
// questions are never shown), while the real solve keeps it (audit P1).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const course = (id: string) =>
  ({ id, subject: id.split("-")[0], number: id.split("-")[1], title: id, credits_min: 3, credits_max: 3, attrs: [] }) as unknown as Course;

const BOARD: Placement[] = [{ id: "p1", courseId: "HIST-1200", sem: 1, order: 0 }];
const plan = {
  placements: BOARD,
  placedCourses: { "HIST-1200": course("HIST-1200") } as Record<string, Course>,
  waivedRequirementIds: [] as string[],
  planProgramId: "test-major",
  triedCourseIds: [] as string[],
  courseMarks: {},
};
const NO_LAYERS: unknown[] = [];
const programData = { slots: [], layers: NO_LAYERS, layerErrors: undefined, loading: false };
const programsValue = { programs: [{ id: "test-major", name: "Test Major", family: "cas" }], loading: false };
const auth = {
  studentContext: { answers: {}, entryTerm: "FA25", transfer: "none", transferStanding: null, concentration: null },
};
const INDEX = [
  { id: "PHIL-1100", subject: "PHIL", number: "1100", title: "Intro", creditsMin: 3, creditsMax: 3 },
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

const engine = vi.hoisted(() => ({
  calls: [] as DistributionProgressInput[],
}));
vi.mock("@/lib/planner/distributionProgress", () => ({
  computeDistributionProgress: (input: DistributionProgressInput): RequirementProgress => {
    engine.calls.push(input);
    const tried = input.placements.some((p) => p.id.startsWith("tried:"));
    return {
      engine: "distribution",
      groups: [
        {
          key: "m:Core",
          label: "Major · Core",
          items: [
            {
              id: "m:core",
              label: "Core",
              category: null,
              suggestedSem: null,
              status: tried ? "satisfied" : "unmet",
              coveredBy: [],
              checkable: true,
              requirement: null,
            },
          ],
          satisfiedCount: tried ? 1 : 0,
          total: 1,
        },
      ],
      attribution: {},
      satisfiedCount: tried ? 1 : 0,
      total: 1,
    };
  },
}));
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => plan }));
vi.mock("@/hooks/useProgramData", () => ({ useProgramData: () => programData }));
vi.mock("@/hooks/usePrograms", () => ({ usePrograms: () => programsValue }));
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/contexts/CatalogProvider", () => ({ useCatalogContext: () => catalogValue }));
vi.mock("@/hooks/useCreditProfile", () => ({ useCreditProfile: () => creditView }));
// Spec 047: no extra programs (the real loader reads Firestore).
vi.mock("@/hooks/useAdditionalProgramData", () => ({ useAdditionalProgramData: () => extraPrograms }));

const { useRequirementProgress } = await import("./useRequirementProgress");

let last: RequirementProgress | null = null;
function Probe() {
  const value = useRequirementProgress();
  useEffect(() => {
    last = value;
  });
  return null;
}

let root: Root;
beforeEach(() => {
  engine.calls = [];
  last = null;
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
});

describe("useRequirementProgress — the tried solve skips open questions (audit P1)", () => {
  it("solves the board with open questions, and the board plus tried classes without", async () => {
    plan.triedCourseIds = ["PHIL-1100"];
    await act(async () => root.render(<Probe />));
    const real = engine.calls.filter((c) => !c.placements.some((p) => p.id.startsWith("tried:")));
    const tried = engine.calls.filter((c) => c.placements.some((p) => p.id.startsWith("tried:")));
    expect(real.length).toBeGreaterThan(0);
    expect(tried.length).toBeGreaterThan(0);
    expect(real.every((c) => !c.skipOpenQuestions)).toBe(true);
    expect(tried.every((c) => c.skipOpenQuestions === true)).toBe(true);
    expect(last?.tried?.items["m:core"].status).toBe("satisfied");
  });
});
