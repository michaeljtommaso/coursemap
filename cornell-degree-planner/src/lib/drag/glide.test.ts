import { describe, expect, it } from "vitest";
import { planGlides } from "./glide";

describe("planGlides", () => {
  it("starts a moved element at its old painted spot (FLIP invert)", () => {
    // The outline opened above b: b now rests 114px lower.
    const prev = new Map([
      ["a", 0],
      ["b", 110],
    ]);
    expect(
      planGlides(prev, [
        { key: "a", rest: 0, translate: 0 },
        { key: "b", rest: 224, translate: 0 },
      ])
    ).toEqual([{ key: "b", from: -114 }]);
  });

  it("picks up an interrupted glide from where it is painted", () => {
    // b was gliding down (still painted 40px above its old slot at 224) when
    // the outline moved away again and b went back to 110.
    const prev = new Map([["b", 224]]);
    expect(planGlides(prev, [{ key: "b", rest: 110, translate: -40 }])).toEqual([
      { key: "b", from: 74 },
    ]);
  });

  it("skips new elements, the dragged card and sub-pixel moves", () => {
    const prev = new Map([
      ["moved", 0],
      ["still", 50],
    ]);
    expect(
      planGlides(
        prev,
        [
          { key: "fresh", rest: 10, translate: 0 },
          { key: "moved", rest: 300, translate: 0 },
          { key: "still", rest: 50.2, translate: 0 },
        ],
        "moved"
      )
    ).toEqual([]);
  });

  it("leaves an element alone when its painted spot already is its new rest", () => {
    // Two commits before a paint: the first started a glide (translate +114),
    // the second put b back where it was painted.
    const prev = new Map([["b", 110]]);
    expect(planGlides(prev, [{ key: "b", rest: 224, translate: 114 }])).toEqual([]);
  });
});
