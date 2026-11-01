import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RequirementProgress } from "@/hooks/useRequirementProgress";

// Static render (no DOM library in this repo): the spec 020 header pieces.
const state = vi.hoisted(() => ({ progress: null as unknown as RequirementProgress }));
vi.mock("@/hooks/useRequirementProgress", () => ({ useRequirementProgress: () => state.progress }));
vi.mock("@/hooks/usePlan", () => ({
  usePlan: () => ({ placements: [], placedCourses: {}, toggleWaivedRequirement: vi.fn(), planProgramId: "history" }),
}));
vi.mock("@/store/usePlannerStore", () => ({
  usePlannerStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ highlightedPlacementIds: [], setHighlightedPlacementIds: vi.fn(), requestCatalogSearch: vi.fn() }),
}));
vi.mock("@/store/useProgramStore", () => ({
  useProgramStore: (sel: (s: { selectedProgramId: string | null }) => unknown) => sel({ selectedProgramId: "history" }),
}));
vi.mock("@/components/onboarding/StudentContextQuestions", () => ({ StudentContextQuestions: () => null }));
vi.mock("@/services/reports", () => ({ submitRequirementReport: vi.fn() }));
vi.mock("./useAnswerActions", () => ({ useAnswerActions: () => vi.fn(async () => {}) }));

const { StillNeededPanel } = await import("./StillNeededPanel");

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

function progress(over: Partial<RequirementProgress> = {}): RequirementProgress {
  return {
    engine: "distribution",
    collegeVersion: "Arts & Sciences",
    satisfiedCount: 0,
    total: 1,
    attribution: {},
    groups: [
      {
        key: "cas-college:core",
        label: "College · Core",
        satisfiedCount: 0,
        total: 1,
        items: [
          {
            id: "cas-college:fws",
            label: "First-Year Writing Seminars",
            category: null,
            suggestedSem: null,
            status: "partial",
            coveredBy: [],
            checkable: true,
            requirement: null,
            dist: {
              layerId: "cas-college",
              rowId: "fws",
              layerKind: "college",
              rowKind: "pool",
              engineStatus: "partial",
              countedCodes: [],
              questions: [
                {
                  key: "usedAs:cas-college/fws@ENGL-2880",
                  scope: "mark",
                  prompt: "Are you using ENGL 2880 as First-Year Writing Seminars?",
                  detail: "",
                  input: { kind: "yesno" },
                  courseCode: "ENGL 2880",
                },
              ],
            },
          },
        ],
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  state.progress = progress();
});

describe("StillNeededPanel — spec 020 header", () => {
  it("counts the open questions and names the answers link with its count", () => {
    state.progress = progress({
      openQuestionCount: 1,
      answers: [
        {
          key: "studentFact:honorsProgram:HIST",
          scope: "fact",
          prompt: "Are you in the History honors program?",
          valueLabel: "No",
          value: "no",
          input: { kind: "yesno" },
          state: "active",
        },
      ],
    });
    const html = renderToStaticMarkup(<StillNeededPanel />);
    expect(html).toMatch(/data-question-count="1"[^>]*>.*1.*question</);
    expect(text(html)).toContain("Your answers (1)");
    expect(text(html)).not.toContain("Change your start answers");
    expect(text(html)).toContain("1 question · ENGL 2880 could count here");
  });

  it("no open questions → no count; no answers → plain Your answers", () => {
    const html = renderToStaticMarkup(<StillNeededPanel />);
    expect(html).not.toContain("data-question-count");
    expect(text(html)).toContain("Your answers");
    expect(text(html)).not.toContain("Your answers (");
  });
});
