import { describe, expect, it } from "vitest";
import {
  isNoopMove,
  nearestColumn,
  resolveInsertionIndex,
  sameTarget,
  type MeasuredCard,
} from "./insertion";

// Three 100px cards with 10px gaps: mids at 50, 160, 270.
const col: MeasuredCard[] = [
  { id: "a", top: 0, height: 100 },
  { id: "b", top: 110, height: 100 },
  { id: "c", top: 220, height: 100 },
];

describe("resolveInsertionIndex", () => {
  it("top half of a card inserts before it, bottom half after it", () => {
    expect(resolveInsertionIndex(col, 120)).toBe(1); // b's top half → before b
    expect(resolveInsertionIndex(col, 200)).toBe(2); // b's bottom half → after b
  });

  it("above the first card is the top; below the last card appends", () => {
    expect(resolveInsertionIndex(col, -40)).toBe(0);
    expect(resolveInsertionIndex(col, 10)).toBe(0);
    expect(resolveInsertionIndex(col, 900)).toBe(3);
  });

  it("the gap between two cards resolves to the slot between them", () => {
    expect(resolveInsertionIndex(col, 105)).toBe(1);
  });

  it("an empty column always resolves to 0", () => {
    expect(resolveInsertionIndex([], 500)).toBe(0);
  });

  it("excludes the mover, so indices match movePlacement semantics", () => {
    // Dragging `a` down to b's bottom half: without `a`, that is after b → 1.
    expect(resolveInsertionIndex(col, 200, "a")).toBe(1);
    // Hovering the mover's own old spot resolves to its own index.
    expect(resolveInsertionIndex(col, 40, "a")).toBe(0);
  });

  it("ignores zero-height (hidden) cards", () => {
    const withHidden = [...col, { id: "x", top: 0, height: 0 }];
    expect(resolveInsertionIndex(withHidden, 900)).toBe(3);
  });

  it("is stable under the outline shift (hysteresis)", () => {
    // Outline (100px + 10px gap) inserted before b pushes b and c down 110px.
    const shifted: MeasuredCard[] = [
      { id: "a", top: 0, height: 100 },
      { id: "b", top: 220, height: 100 },
      { id: "c", top: 330, height: 100 },
    ];
    // Cursor at 120 chose index 1; over the outline it still reads 1.
    expect(resolveInsertionIndex(shifted, 120)).toBe(1);
    expect(resolveInsertionIndex(shifted, 260)).toBe(1); // b's (shifted) top half
  });
});

describe("nearestColumn", () => {
  const cols = [
    { sem: 1, left: 0, right: 216 },
    { sem: 2, left: 256, right: 472 },
  ];

  it("returns the column containing x", () => {
    expect(nearestColumn(cols, 100, 32)).toBe(1);
    expect(nearestColumn(cols, 300, 32)).toBe(2);
  });

  it("returns the nearer column for a point in the gap", () => {
    expect(nearestColumn(cols, 226, 32)).toBe(1);
    expect(nearestColumn(cols, 250, 32)).toBe(2);
  });

  it("returns null past maxGap or with no columns", () => {
    expect(nearestColumn(cols, 600, 32)).toBeNull();
    expect(nearestColumn([], 10, 32)).toBeNull();
  });
});

describe("sameTarget / isNoopMove", () => {
  it("compares positions", () => {
    expect(sameTarget({ sem: 2, index: 1 }, { sem: 2, index: 1 })).toBe(true);
    expect(sameTarget({ sem: 2, index: 1 }, { sem: 3, index: 1 })).toBe(false);
    expect(sameTarget(null, null)).toBe(true);
    expect(sameTarget(null, { sem: 1, index: 0 })).toBe(false);
  });

  it("a card dropped on its own position is a no-op; anywhere else is a move", () => {
    expect(isNoopMove({ sem: 3, index: 2 }, { sem: 3, index: 2 })).toBe(true);
    expect(isNoopMove({ sem: 3, index: 2 }, { sem: 3, index: 1 })).toBe(false);
    expect(isNoopMove({ sem: 3, index: 2 }, { sem: 4, index: 2 })).toBe(false);
    // Catalog drags have no home — never a no-op.
    expect(isNoopMove(null, { sem: 1, index: 0 })).toBe(false);
  });
});
