import { describe, it, expect } from "vitest";
import { edgeGeometry, sameColumn, pairKey, BRACKET_OUT } from "./edgeGeometry";
import type { Rect } from "./zoom";

// Board-like layout: 204px-wide columns 40px apart (gap-10), cards ~70px tall
// stacked with a 10px gap (gap-2.5).
const COL_W = 204;
const COL_GAP = 40;
const CARD_H = 70;
const CARD_GAP = 10;
function card(col: number, row: number, h = CARD_H): Rect {
  return { x: 24 + col * (COL_W + COL_GAP), y: 40 + row * (CARD_H + CARD_GAP), w: COL_W, h };
}

/** The pre-D9 EdgeLayer formula, inlined so "unchanged" is asserted literally. */
function legacyCurve(from: Rect, to: Rect): string {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x - 2;
  const y2 = to.y + to.h / 2;
  const dx = Math.max(36, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

describe("sameColumn", () => {
  it("is true for cards in one column, false for neighbouring columns", () => {
    expect(sameColumn(card(0, 0), card(0, 3))).toBe(true);
    expect(sameColumn(card(0, 0), card(1, 0))).toBe(false);
  });

  it("tolerates sub-pixel measurement noise", () => {
    const a = card(2, 0);
    expect(sameColumn(a, { ...card(2, 1), x: a.x + 0.4 })).toBe(true);
  });
});

describe("edgeGeometry — corequisite connector (spec 014 §D9)", () => {
  it("same column, ADJACENT: straight connector, bottom-middle of upper → top-middle of lower, no arrow", () => {
    const upper = card(0, 0);
    const lower = card(0, 1);
    const g = edgeGeometry("concurrent", upper, lower, [upper, lower]);
    expect(g.shape).toBe("stack");
    expect(g.arrow).toBe(false);
    const midX = upper.x + COL_W / 2;
    expect(g.d).toBe(`M ${midX} ${upper.y + CARD_H} L ${midX} ${lower.y}`);
  });

  it("upper/lower follow POSITION, not edge direction (feeder below the dependent)", () => {
    const upper = card(3, 1);
    const lower = card(3, 2);
    const down = edgeGeometry("concurrent", upper, lower, [upper, lower]);
    const up = edgeGeometry("concurrent", lower, upper, [upper, lower]);
    expect(up).toEqual(down);
  });

  it("cards of different heights still connect bottom-of-upper to top-of-lower", () => {
    const upper = card(0, 0, 96);
    const lower: Rect = { ...card(0, 0), y: upper.y + 96 + CARD_GAP };
    const g = edgeGeometry("concurrent", upper, lower, [upper, lower]);
    expect(g.shape).toBe("stack");
    expect(g.d).toBe(`M ${upper.x + COL_W / 2} ${upper.y + 96} L ${lower.x + COL_W / 2} ${lower.y}`);
  });

  it("same column, NON-ADJACENT (a card between): a right-side bracket, never through the middle card", () => {
    const upper = card(1, 0);
    const middle = card(1, 1);
    const lower = card(1, 2);
    const g = edgeGeometry("concurrent", upper, lower, [upper, middle, lower]);
    expect(g.shape).toBe("bracket");
    expect(g.arrow).toBe(false);
    const right = upper.x + COL_W;
    const xr = right + BRACKET_OUT;
    // Leaves the upper card's right-middle, re-enters the lower card's right-middle.
    expect(g.d.startsWith(`M ${right} ${upper.y + CARD_H / 2} H `)).toBe(true);
    expect(g.d.endsWith(`H ${right}`)).toBe(true);
    expect(g.d).toContain(`V `);
    // Stays inside the 40px inter-column gap.
    expect(xr).toBeLessThan(right + COL_GAP);
    expect(g.d).toContain(`${xr} `);
  });

  it("a card in ANOTHER column at the same height does not count as 'between'", () => {
    const upper = card(0, 0);
    const lower = card(0, 1);
    const neighbour = card(1, 0);
    const g = edgeGeometry("concurrent", upper, lower, [upper, lower, neighbour]);
    expect(g.shape).toBe("stack");
  });

  it("the endpoints themselves are never 'between' (identity skip)", () => {
    const upper = card(0, 0);
    const lower = card(0, 1);
    expect(edgeGeometry("concurrent", upper, lower, [lower, upper]).shape).toBe("stack");
  });

  it("CROSS-column corequisite: the unchanged spec 008 curve with arrowhead", () => {
    const from = card(0, 0);
    const to = card(1, 2);
    const g = edgeGeometry("concurrent", from, to, [from, to]);
    expect(g).toEqual({ shape: "curve", d: legacyCurve(from, to), arrow: true });
  });
});

describe("edgeGeometry — non-corequisite edges are unchanged", () => {
  it("cross-column prereq: the spec 008 curve", () => {
    const from = card(0, 1);
    const to = card(2, 0);
    expect(edgeGeometry("prereq", from, to)).toEqual({
      shape: "curve",
      d: legacyCurve(from, to),
      arrow: true,
    });
  });

  it("same-column prereq (violated) keeps the curve — D9 changes corequisites only", () => {
    const from = card(0, 0);
    const to = card(0, 1);
    expect(edgeGeometry("prereq", from, to, [from, to]).shape).toBe("curve");
  });

  it("same-column advisory keeps the curve", () => {
    const from = card(0, 0);
    const to = card(0, 1);
    expect(edgeGeometry("advisory", from, to, [from, to]).shape).toBe("curve");
  });
});

describe("pairKey", () => {
  it("is order-insensitive (a mutual corequisite draws once)", () => {
    expect(pairKey("p-a", "p-b")).toBe(pairKey("p-b", "p-a"));
    expect(pairKey("p-a", "p-b")).not.toBe(pairKey("p-a", "p-c"));
  });
});
