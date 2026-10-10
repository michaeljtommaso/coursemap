import { describe, expect, it } from "vitest";
import {
  isNoopMove,
  nearestColumn,
  resolveInsertionIndex,
  restingLayout,
  sameTarget,
  type ColumnItem,
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
});

describe("restingLayout", () => {
  const GAP = 10;
  const OUTLINE = 104;
  /** The live column with the outline drawn before card `at` (cards shift down). */
  const withOutline = (at: number): ColumnItem[] => {
    const items: ColumnItem[] = [];
    let y = 0;
    col.forEach((c, i) => {
      if (i === at) {
        items.push({ kind: "outline", height: OUTLINE });
        y += OUTLINE + GAP;
      }
      items.push({ kind: "card", id: c.id, top: y, height: c.height });
      y += c.height + GAP;
    });
    if (at >= col.length) items.push({ kind: "outline", height: OUTLINE });
    return items;
  };

  it("removes the outline's displacement wherever it is drawn", () => {
    for (let at = 0; at <= col.length; at++) {
      expect(restingLayout(withOutline(at), GAP)).toEqual(col);
    }
  });

  it("makes the index a function of the pointer alone (O-10 regression)", () => {
    // The end-of-column flake: on its way down the pointer passed between b's
    // and c's midpoints, so the outline was drawn before c, pushing c down
    // 114px. The pointer then settled just below c's ORIGINAL bottom (320) —
    // the spot it aimed at before the drag. Against the live layout c's
    // midpoint (384) is still below the pointer, so the drop stayed at index
    // 2, one slot early.
    const live = withOutline(2);
    const liveCards = live.filter((i): i is Extract<ColumnItem, { kind: "card" }> => i.kind === "card");
    expect(resolveInsertionIndex(liveCards, 340)).toBe(2);
    // Against the resting layout it appends, whatever was hovered before.
    for (let at = 0; at <= col.length; at++) {
      expect(resolveInsertionIndex(restingLayout(withOutline(at), GAP), 340)).toBe(3);
    }
  });

  it("restores a hidden mover's home slot at its original height", () => {
    // `a` (100px) is being dragged and hidden (display:none → 0 height); b
    // and c moved up into its slot. The outline is drawn before c.
    const live: ColumnItem[] = [
      { kind: "card", id: "a", top: 0, height: 0 },
      { kind: "card", id: "b", top: 0, height: 100 },
      { kind: "outline", height: OUTLINE },
      { kind: "card", id: "c", top: 224, height: 100 },
    ];
    expect(restingLayout(live, GAP, { id: "a", height: 100 })).toEqual([
      { id: "b", top: 110, height: 100 },
      { id: "c", top: 220, height: 100 },
    ]);
  });

  it("corrects for a mover shown as a shorter placeholder", () => {
    // `a` was 130px tall; its in-flight placeholder face is 104px.
    const live: ColumnItem[] = [
      { kind: "card", id: "a", top: 0, height: 104 },
      { kind: "card", id: "b", top: 114, height: 100 },
    ];
    expect(restingLayout(live, GAP, { id: "a", height: 130 })).toEqual([
      { id: "b", top: 140, height: 100 },
    ]);
  });

  it("pre-drag aims resolve to mover-excluded indices in the source column", () => {
    // Dragging `a` down: its home space is kept, so the pre-drag gap between
    // b and c (y = 215) is index 1 once `a` is taken out — movePlacement's
    // semantics — whether `a` is currently hidden or not.
    const hidden: ColumnItem[] = [
      { kind: "card", id: "a", top: 0, height: 0 },
      { kind: "outline", height: OUTLINE },
      { kind: "card", id: "b", top: 114, height: 100 },
      { kind: "card", id: "c", top: 224, height: 100 },
    ];
    const cards = restingLayout(hidden, GAP, { id: "a", height: 100 });
    expect(resolveInsertionIndex(cards, 215, "a")).toBe(1);
    expect(resolveInsertionIndex(cards, 40, "a")).toBe(0); // its own slot → home
  });

  it("drops zero-height cards that aren't the mover", () => {
    const live: ColumnItem[] = [
      { kind: "card", id: "x", top: 0, height: 0 },
      { kind: "card", id: "b", top: 0, height: 100 },
    ];
    expect(restingLayout(live, GAP)).toEqual([{ id: "b", top: 0, height: 100 }]);
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
