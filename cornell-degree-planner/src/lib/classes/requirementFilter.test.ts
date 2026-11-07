import { describe, expect, it } from "vitest";
import {
  DIST_TAGS,
  DIST_TAG_GROUPS,
  distTagCounts,
  distTagLabel,
  liberalStudiesOptionId,
  parseLiberalStudiesOptionId,
  requirementOptions,
  type PickerGroup,
  type PickerItem,
} from "./requirementFilter";

// Spec 037 D10 — Engineering liberal studies: the item, then its seven groups.
const LS_CATS = [
  { id: "g1", label: "Arts & Culture", filled: true, missing: false },
  { id: "g2", label: "History", filled: false, missing: false },
  { id: "g3", label: "Ethics & Mind", filled: false, missing: false },
  { id: "g4", label: "Social Science", filled: true, missing: false },
  { id: "g5", label: "Language", filled: false, missing: false },
  { id: "g6", label: "Communications", filled: false, missing: false },
  { id: "g7", label: "Race & Equity", filled: false, missing: true },
];
const lsItem = (over: Partial<PickerItem> = {}): PickerItem => ({
  id: "liberal-studies",
  label: "Liberal Studies",
  status: "partial",
  checkable: true,
  dist: { categories: LS_CATS },
  ...over,
});
const lsGroups = (it: PickerItem): PickerGroup[] => [{ key: "liberal", label: "Liberal studies", items: [it] }];

describe("requirementOptions — Engineering liberal studies (spec 037 D10)", () => {
  it("offers Liberal Studies and all seven groups, marked covered / still needed", () => {
    expect(requirementOptions(lsGroups(lsItem()))).toEqual([
      {
        key: "liberal",
        label: "Liberal studies",
        options: [
          { id: "liberal-studies", label: "Liberal Studies", disabled: false },
          { id: "liberal-studies#g1", label: "Arts & Culture (covered)", disabled: false },
          { id: "liberal-studies#g2", label: "History", disabled: false },
          { id: "liberal-studies#g3", label: "Ethics & Mind", disabled: false },
          { id: "liberal-studies#g4", label: "Social Science (covered)", disabled: false },
          { id: "liberal-studies#g5", label: "Language", disabled: false },
          { id: "liberal-studies#g6", label: "Communications", disabled: false },
          { id: "liberal-studies#g7", label: "Race & Equity (still needed)", disabled: false },
        ],
      },
    ]);
  });

  it("nothing on the board yet: every group still needed, none disabled", () => {
    const empty = LS_CATS.map((c) => ({ ...c, filled: false, missing: true }));
    const [g] = requirementOptions(lsGroups(lsItem({ status: "unmet", dist: { categories: empty } })));
    expect(g.options).toHaveLength(8);
    expect(g.options.slice(1).every((o) => o.label.endsWith("(still needed)") && !o.disabled)).toBe(true);
  });

  it("met or waived: nothing left to find, so no option at all", () => {
    expect(requirementOptions(lsGroups(lsItem({ status: "satisfied" })))).toEqual([]);
    expect(requirementOptions(lsGroups(lsItem({ status: "waived" })))).toEqual([]);
  });

  it("an older app's uncheckable item stays one disabled option with no groups", () => {
    expect(requirementOptions(lsGroups(lsItem({ checkable: false, dist: undefined })))).toEqual([
      {
        key: "liberal",
        label: "Liberal studies",
        options: [{ id: "liberal-studies", label: "Liberal Studies (can't check automatically)", disabled: true }],
      },
    ]);
  });

  it("a Distribution row with categories is not expanded (Arts & Sciences / CALS unchanged)", () => {
    const cas: PickerGroup[] = [
      {
        key: "cas-college:Distribution",
        label: "College · Distribution",
        items: [{ ...lsItem(), id: "cas-college:dist", label: "Distribution" }],
      },
    ];
    expect(requirementOptions(cas)[0].options).toEqual([
      { id: "cas-college:dist", label: "Distribution", disabled: false },
    ]);
  });

  it("option ids round-trip; other ids are not liberal studies", () => {
    expect(liberalStudiesOptionId("g7")).toBe("liberal-studies#g7");
    expect(parseLiberalStudiesOptionId("liberal-studies#g7")).toEqual({ group: "g7" });
    expect(parseLiberalStudiesOptionId("liberal-studies")).toEqual({ group: null });
    expect(parseLiberalStudiesOptionId("liberal-studies#")).toBeNull();
    expect(parseLiberalStudiesOptionId("cas-college:dist")).toBeNull();
    expect(parseLiberalStudiesOptionId("liberal-studies-2")).toBeNull();
  });
});

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
    key: "technical",
    label: "Technical electives",
    items: [{ id: "g-list", label: "Approved technical electives", status: "unmet", checkable: false }],
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
        key: "technical",
        label: "Technical electives",
        options: [{ id: "g-list", label: "Approved technical electives (can't check automatically)", disabled: true }],
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
