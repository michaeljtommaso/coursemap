import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudentPrefs } from "@/services/profile";
import { startYearOptions } from "@/lib/planner/entryTerm";

// Static render (no DOM library in this repo): which question shows, its
// options, and what's pre-selected. Effects don't run, so a render must never
// write anything by itself.
const auth = {
  studentContext: { entryTerm: null, transfer: null, transferStanding: null, college: null, concentration: null } as StudentPrefs,
  enteringYear: null as number | null,
  setStudentContext: vi.fn(),
  setEnteringYear: vi.fn(),
};
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/usePrograms", () => ({ usePrograms: () => ({ programs: [] }) }));
const programData = vi.hoisted(() => ({ layers: undefined as unknown[] | undefined, loading: false }));
vi.mock("@/hooks/useProgramData", () => ({ useProgramData: () => programData }));
vi.mock("@/store/useProgramStore", () => ({
  useProgramStore: (sel: (s: { selectedProgramId: string | null }) => unknown) => sel({ selectedProgramId: null }),
}));

const { StudentContextQuestions } = await import("./StudentContextQuestions");

const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
const buttonTag = (html: string, label: string) =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].find((m) => m[2].replace(/<[^>]+>/g, "") === label)?.[1] ?? "";

beforeEach(() => {
  auth.studentContext = { entryTerm: null, transfer: null, transferStanding: null, college: null, concentration: null };
  auth.enteringYear = null;
  auth.setStudentContext.mockClear();
  auth.setEnteringYear.mockClear();
  programData.layers = undefined;
  programData.loading = false;
});

describe("StudentContextQuestions", () => {
  it("asks the start term first, fall selected, with a pill per start year", () => {
    const html = renderToStaticMarkup(<StudentContextQuestions family="engineering" />);
    expect(html).toContain("When did you start at Cornell?");
    expect(buttons(html)).toEqual(["Fall", "Spring", ...startYearOptions().map((y) => `Fall ${y}`)]);
    expect(buttonTag(html, "Fall")).toContain('aria-pressed="true"');
  });

  it("a returning student's start year is pre-selected, never saved by rendering", () => {
    auth.enteringYear = 2024;
    const html = renderToStaticMarkup(<StudentContextQuestions family="cas" />);
    expect(buttonTag(html, "Fall 2024")).toContain("border-drop bg-drop-tint");
    expect(buttonTag(html, "Fall 2025")).not.toContain("border-drop bg-drop-tint");
    expect(auth.setStudentContext).not.toHaveBeenCalled();
    expect(auth.setEnteringYear).not.toHaveBeenCalled();
  });

  it("the panel's inline transfer question", () => {
    const html = renderToStaticMarkup(<StudentContextQuestions need="transfer" compact />);
    expect(html).toContain("Did you transfer to Cornell?");
    expect(buttons(html)).toEqual(["No", "From another school", "From another Cornell college"]);
  });

  it("the panel's inline standing question", () => {
    const html = renderToStaticMarkup(<StudentContextQuestions need="transfer-standing" compact />);
    expect(html).toContain("What class standing did you arrive with?");
    expect(buttons(html)).toEqual(["First-year", "Sophomore", "Junior", "Senior"]);
  });

  it("Arts & Sciences with a start term on file goes straight to the transfer question", () => {
    auth.studentContext = { ...auth.studentContext, entryTerm: "SP25" };
    auth.enteringYear = 2024;
    const html = renderToStaticMarkup(<StudentContextQuestions family="cas" />);
    expect(html).toContain("Did you transfer to Cornell?");
  });

  it("Engineering with everything on file asks nothing", () => {
    auth.studentContext = { ...auth.studentContext, entryTerm: "FA25" };
    auth.enteringYear = 2025;
    expect(renderToStaticMarkup(<StudentContextQuestions family="engineering" />)).toBe("");
  });
});

describe("StudentContextQuestions — edit (review F4)", () => {
  it("re-asks an answered start term, with the current answer pre-selected and nothing saved", () => {
    auth.studentContext = { entryTerm: "FA24", transfer: "none", transferStanding: null, college: "cals", concentration: null };
    auth.enteringYear = 2024;
    expect(renderToStaticMarkup(<StudentContextQuestions family="cals" />)).toBe("");
    const html = renderToStaticMarkup(<StudentContextQuestions family="cals" edit />);
    expect(html).toContain("When did you start at Cornell?");
    expect(buttonTag(html, "Fall 2024")).toContain("border-drop bg-drop-tint");
    expect(auth.setStudentContext).not.toHaveBeenCalled();
  });
});

describe("StudentContextQuestions — concentration", () => {
  const major = (concentrations?: { min: number; max: number }) => ({
    id: "maj",
    kind: "major",
    programId: "maj",
    name: "Major",
    ...(concentrations ? { concentrations } : {}),
  });
  const conc = (id: string, name: string) => ({ id: `maj--${id}`, kind: "concentration", programId: "maj", concentrationId: id, name });
  const known = () => {
    auth.studentContext = { ...auth.studentContext, entryTerm: "FA25", transfer: "none" };
    auth.enteringYear = 2025;
  };

  it("a single-choice major lists each concentration by name, in a labelled group", () => {
    known();
    programData.layers = [major({ min: 1, max: 1 }), conc("a", "Alpha track"), conc("b", "Beta track")];
    const html = renderToStaticMarkup(<StudentContextQuestions family="cals" programId="maj" />);
    expect(html).toContain("Which concentration are you in?");
    expect(html).toContain('aria-label="Concentration"');
    expect(buttons(html)).toEqual(["Alpha track", "Beta track"]);
  });

  it("an optional single-choice major also offers 'No concentration'", () => {
    known();
    programData.layers = [major(), conc("a", "Alpha track")];
    const html = renderToStaticMarkup(<StudentContextQuestions family="cals" programId="maj" />);
    expect(buttons(html)).toEqual(["Alpha track", "No concentration"]);
  });

  it("a multi-choice major toggles options and needs Done, disabled until min is met", () => {
    known();
    programData.layers = [major({ min: 1, max: 2 }), conc("a", "Alpha track"), conc("b", "Beta track")];
    const html = renderToStaticMarkup(<StudentContextQuestions family="cals" programId="maj" />);
    expect(html).toContain("Which concentrations are you in?");
    expect(buttons(html)).toEqual(["Alpha track", "Beta track", "Done"]);
    expect(buttonTag(html, "Alpha track")).toContain('aria-pressed="false"');
    expect(buttonTag(html, "Done")).toContain("disabled");
  });

  it("a current choice for this major is pre-selected, never saved by rendering", () => {
    known();
    auth.studentContext = { ...auth.studentContext, concentration: { programId: "maj", ids: ["b"] } };
    programData.layers = [major({ min: 1, max: 2 }), conc("a", "Alpha track"), conc("b", "Beta track")];
    const html = renderToStaticMarkup(<StudentContextQuestions need="concentration" edit compact family="cals" programId="maj" />);
    expect(buttonTag(html, "Beta track")).toContain('aria-pressed="true"');
    expect(buttonTag(html, "Alpha track")).toContain('aria-pressed="false"');
    expect(buttonTag(html, "Done")).not.toContain("disabled");
    expect(auth.setStudentContext).not.toHaveBeenCalled();
  });

  it("a valid choice on file is not asked again", () => {
    known();
    auth.studentContext = { ...auth.studentContext, concentration: { programId: "maj", ids: ["a"] } };
    programData.layers = [major({ min: 1, max: 1 }), conc("a", "Alpha track")];
    expect(renderToStaticMarkup(<StudentContextQuestions family="cals" programId="maj" />)).toBe("");
  });

  it("a choice made for another major is asked again", () => {
    known();
    auth.studentContext = { ...auth.studentContext, concentration: { programId: "old", ids: ["a"] } };
    programData.layers = [major({ min: 1, max: 1 }), conc("a", "Alpha track")];
    expect(renderToStaticMarkup(<StudentContextQuestions family="cals" programId="maj" />)).toContain(
      "Which concentration are you in?"
    );
  });

  it("the start-answers edit does not re-ask the concentration", () => {
    known();
    programData.layers = [major({ min: 1, max: 1 }), conc("a", "Alpha track")];
    const html = renderToStaticMarkup(<StudentContextQuestions family="cals" programId="maj" edit />);
    expect(html).toContain("When did you start at Cornell?");
    expect(html).not.toContain("Alpha track");
  });

  it("while the major's layers load it shows nothing", () => {
    known();
    programData.loading = true;
    expect(renderToStaticMarkup(<StudentContextQuestions family="cals" programId="maj" />)).toBe("");
  });

  it("a major without concentration layers asks nothing extra", () => {
    known();
    programData.layers = [major()];
    expect(renderToStaticMarkup(<StudentContextQuestions family="cals" programId="maj" />)).toBe("");
  });

  it("Engineering never asks", () => {
    known();
    programData.layers = [major({ min: 1, max: 1 }), conc("a", "Alpha track")];
    expect(renderToStaticMarkup(<StudentContextQuestions family="engineering" programId="maj" />)).toBe("");
  });
});
