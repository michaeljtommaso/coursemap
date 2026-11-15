import { describe, expect, it } from "vitest";
import { areaOptions, isStale, requirementOptions, toCountsToward, towardGroups, towardLine, valueOf } from "./countsToward";

describe("countsToward options (spec 046)", () => {
  it("Engineering areas are the cohort's liberal studies groups", () => {
    const fa24 = areaOptions("engineering", "fa2024");
    expect(fa24).toHaveLength(7);
    expect(fa24[6]).toEqual({ value: "area:LS:g7", label: "Liberal studies: Race & Equity" });
    expect(areaOptions("engineering", "fa2020")[6].label).toBe("Liberal studies: Diversity");
    expect(areaOptions(null, "fa2024")).toEqual([]);
  });

  it("Engineering requirements: seats carry the search hint, liberal studies is left to areas", () => {
    const groups = requirementOptions([
      {
        label: "Engineering core",
        items: [
          { id: "cs-s4-cs3110", label: "CS 3110", status: "unmet", checkable: true, requirement: { kind: "course", courseId: "CS-3110" } },
          { id: "liberal-studies", label: "Liberal studies", status: "partial", checkable: true, requirement: null, poolProgress: {} },
          { id: "cs-technical-elective", label: "Technical elective", status: "satisfied", checkable: true, requirement: null, poolProgress: {} },
          { id: "cs-practicum", label: "Practicum", status: "unmet", checkable: false, requirement: null, poolProgress: {} },
          { id: "cs-pe", label: "PE", status: "waived", checkable: true, requirement: null, poolProgress: {} },
        ],
      },
    ]);
    expect(groups).toEqual([
      {
        label: "Engineering core",
        options: [
          { value: "row:cs-s4-cs3110", label: "CS 3110", seat: true },
          { value: "row:cs-technical-elective", label: "Technical elective (done)" },
        ],
      },
    ]);
  });

  it("round-trips a choice and drops '(done)' from the saved label", () => {
    const groups = towardGroups("engineering", "fa2024", [
      {
        label: "Electives",
        items: [{ id: "cs-technical-elective", label: "Technical elective", status: "satisfied", checkable: true, poolProgress: {} }],
      },
    ]);
    const ct = toCountsToward(groups, "row:cs-technical-elective");
    expect(ct).toEqual({ row: "cs-technical-elective", label: "Technical elective" });
    expect(valueOf(ct)).toBe("row:cs-technical-elective");
    expect(toCountsToward(groups, "none")).toBeUndefined();
    expect(toCountsToward(groups, "area:LS:g2", ["LS:g4"])).toEqual({
      areas: ["LS:g2", "LS:g4"],
      label: "Liberal studies: History and Liberal studies: Social Science",
    });
  });

  it("a row choice is stale only once the plan's rows are known", () => {
    const areasOnly = towardGroups("cas", "fa2024", null);
    const ct = { row: "econ:econ-4000", label: "ECON electives" };
    expect(isStale(areasOnly, ct, false)).toBe(false);
    expect(isStale(areasOnly, ct, true)).toBe(true);
    expect(towardLine(ct, false)).toBe("counts toward ECON electives (you said)");
    expect(towardLine(undefined, false)).toBe("counts toward total credits");
  });
});
