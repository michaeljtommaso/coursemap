// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProgramSection } from "@/hooks/useRequirementProgress";
import { useProgramStore } from "@/store/useProgramStore";
import { ProgramSectionHeader } from "./ProgramSectionHeader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHARING = "Courses can count toward both majors here — confirm with both majors' advisors before relying on it.";
const NOTE = `Both majors' undergraduate coordinators must approve this pair, and your plan must show distinct thrusts in the two areas. ${SHARING}`;

const section = (id: string, kind: ProgramSection["kind"]): ProgramSection => ({
  id,
  kind,
  name: id,
  shortName: id,
  color: kind === "primary" ? null : 1,
  pct: 40,
  satisfiedCount: 4,
  total: 10,
  status: "ok",
});

let root: Root;
let host: HTMLElement;
const render = (s: ProgramSection, forbiddenText: string | null = null) =>
  act(() =>
    root.render(
      <ProgramSectionHeader section={s} domId="h" open onToggle={() => {}} overlapLines={[]} forbiddenText={forbiddenText}>
        <p>rows</p>
      </ProgramSectionHeader>
    )
  );
const note = () => host.querySelector("[data-program-note]");

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ProgramSectionHeader: an Engineering pair's note (spec 047 D15)", () => {
  it("an EnvE plan's CE second major shows the coordinators' note, then the sharing note", () => {
    useProgramStore.setState({ selectedProgramId: "cornell-enve-bs" });
    render(section("cornell-ce-bs", "secondMajor"));
    expect(note()!.textContent).toBe(NOTE);
  });

  it("every other Engineering second major shows the sharing note", () => {
    useProgramStore.setState({ selectedProgramId: "cornell-me-bs" });
    render(section("cornell-cs-bs", "secondMajor"));
    expect(note()!.textContent).toBe(SHARING);
  });

  it("no note for an A&S second major or a minor, the primary's own section, or over a can't-combine warning", () => {
    useProgramStore.setState({ selectedProgramId: "cornell-econ-ba" });
    render(section("cornell-math-ba", "secondMajor"));
    expect(note()).toBeNull();

    useProgramStore.setState({ selectedProgramId: "cornell-me-bs" });
    render(section("cs-minor", "minor"));
    expect(note()).toBeNull();

    useProgramStore.setState({ selectedProgramId: "cornell-enve-bs" });
    render(section("cornell-enve-bs", "primary"));
    expect(note()).toBeNull();

    render(section("cornell-ce-bs", "secondMajor"), "Can't be combined.");
    expect(note()).toBeNull();
  });
});
