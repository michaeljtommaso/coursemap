import { describe, expect, it } from "vitest";
import {
  DIST_TAGS,
  DIST_TAG_GROUPS,
  distTagCounts,
  distTagLabel,
  requirementOptions,
  type PickerGroup,
} from "./requirementFilter";

const groups: PickerGroup[] = [
  {
    key: "core",
    label: "Core",
    items: [
      { id: "s1", label: "CS 2110", status: "satisfied", checkable: true },
      { id: "s2", label: "CS 3110", status: "unmet", checkable: true },
    ],
  },
  {
    key: "elective",
    label: "CS electives",
    items: [{ id: "g-cs", label: "CS Major Elective", status: "partial", checkable: true }],
  },
  {
    key: "liberal",
    label: "Liberal studies",
    items: [{ id: "liberal-studies", label: "Liberal Studies", status: "unmet", checkable: false }],
  },
  { key: "math", label: "Math", items: [{ id: "m1", label: "MATH 1910", status: "waived", checkable: true }] },
];

describe("requirementOptions", () => {
  it("offers only what's still open, grouped, dropping empty groups", () => {
    expect(requirementOptions(groups)).toEqual([
      { key: "core", label: "Core", options: [{ id: "s2", label: "CS 3110", disabled: false }] },
      {
        key: "elective",
        label: "CS electives",
        options: [{ id: "g-cs", label: "CS Major Elective", disabled: false }],
      },
      {
        key: "liberal",
        label: "Liberal studies",
        options: [{ id: "liberal-studies", label: "Liberal Studies (can't check automatically)", disabled: true }],
      },
    ]);
  });

  it("collapses same-label seats into one option with how many are left", () => {
    const fws: PickerGroup[] = [
      {
        key: "fws",
        label: "Writing seminars",
        items: [
          { id: "fws-1", label: "First-Year Writing Seminar", status: "unmet", checkable: true },
          { id: "fws-2", label: "First-Year Writing Seminar", status: "unmet", checkable: true },
        ],
      },
      {
        key: "pe",
        label: "Phys ed",
        items: [
          { id: "pe-1", label: "Physical Education", status: "satisfied", checkable: true },
          { id: "pe-2", label: "Physical Education", status: "unmet", checkable: true },
        ],
      },
    ];
    expect(requirementOptions(fws)).toEqual([
      {
        key: "fws",
        label: "Writing seminars",
        options: [{ id: "fws-1", label: "First-Year Writing Seminar (2 still needed)", disabled: false }],
      },
      { key: "pe", label: "Phys ed", options: [{ id: "pe-2", label: "Physical Education", disabled: false }] },
    ]);
  });

  it("no program → nothing to offer", () => {
    expect(requirementOptions([])).toEqual([]);
  });
});

describe("distribution tags", () => {
  it("codes are unique and suffixed by their college", () => {
    const codes = DIST_TAGS.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const g of DIST_TAG_GROUPS) for (const t of g.tags) expect(t.code.endsWith(`-${g.key}`)).toBe(true);
  });

  it("counts records per offered tag, once per record, ignoring others", () => {
    expect(
      distTagCounts([
        { attrs: ["LA-AG", "ALC-AS"] },
        { attrs: ["LA-AG", "LA-AG"] },
        { attrs: ["CU-SBY"] },
        { attrs: [] },
      ])
    ).toEqual({ "LA-AG": 2, "ALC-AS": 1 });
  });

  it("labels a tag with its short code, name and college", () => {
    expect(distTagLabel("LA-AG")).toBe("LA — Literature and the Arts (CALS)");
    expect(distTagLabel("ALC-AS")).toBe("ALC — Arts, Literature, and Culture (Arts & Sciences)");
    expect(distTagLabel("XYZ-AS")).toBe("XYZ-AS");
  });
});
