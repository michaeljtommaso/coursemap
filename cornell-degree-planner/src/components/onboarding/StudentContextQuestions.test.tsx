import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudentPrefs } from "@/services/profile";

// Static render (no DOM library in this repo): which question shows, its
// options, and what's pre-selected. Effects don't run, so a render must never
// write anything by itself.
const auth = {
  studentContext: { entryTerm: null, transfer: null, transferStanding: null, college: null } as StudentPrefs,
  enteringYear: null as number | null,
  setStudentContext: vi.fn(),
  setEnteringYear: vi.fn(),
};
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/usePrograms", () => ({ usePrograms: () => ({ programs: [] }) }));
vi.mock("@/store/useProgramStore", () => ({
  useProgramStore: (sel: (s: { selectedProgramId: string | null }) => unknown) => sel({ selectedProgramId: null }),
}));

const { StudentContextQuestions } = await import("./StudentContextQuestions");

const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
const buttonTag = (html: string, label: string) =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].find((m) => m[2].replace(/<[^>]+>/g, "") === label)?.[1] ?? "";

beforeEach(() => {
  auth.studentContext = { entryTerm: null, transfer: null, transferStanding: null, college: null };
  auth.enteringYear = null;
  auth.setStudentContext.mockClear();
  auth.setEnteringYear.mockClear();
});

describe("StudentContextQuestions", () => {
  it("asks the start term first, fall selected, with a pill per start year", () => {
    const html = renderToStaticMarkup(<StudentContextQuestions family="engineering" />);
    expect(html).toContain("When did you start at Cornell?");
    expect(buttons(html)).toEqual(["Fall", "Spring", "Fall 2023", "Fall 2024", "Fall 2025", "Fall 2026"]);
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
