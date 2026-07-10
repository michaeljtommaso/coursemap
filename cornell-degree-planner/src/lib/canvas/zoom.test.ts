import { describe, it, expect } from "vitest";
import {
  ZOOM_PRESETS,
  DEFAULT_ZOOM,
  normalizeZoom,
  unscaleRect,
  scaledExtent,
} from "./zoom";

describe("zoom presets", () => {
  it("exposes the four spec presets with 100% first", () => {
    expect(ZOOM_PRESETS).toEqual([1, 0.85, 0.7, 0.55]);
    expect(DEFAULT_ZOOM).toBe(1);
  });
});

describe("normalizeZoom", () => {
  it("passes an exact preset through", () => {
    for (const p of ZOOM_PRESETS) expect(normalizeZoom(p)).toBe(p);
  });
  it("snaps an off-preset value to the nearest preset", () => {
    expect(normalizeZoom(0.9)).toBe(0.85); // 0.05 vs 0.15 to 1.0
    expect(normalizeZoom(0.5)).toBe(0.55);
    expect(normalizeZoom(0.72)).toBe(0.7);
  });
  it("falls back to the default for junk", () => {
    expect(normalizeZoom(undefined)).toBe(DEFAULT_ZOOM);
    expect(normalizeZoom(null)).toBe(DEFAULT_ZOOM);
    expect(normalizeZoom(NaN)).toBe(DEFAULT_ZOOM);
    expect(normalizeZoom(Infinity)).toBe(DEFAULT_ZOOM);
  });
});

describe("unscaleRect", () => {
  const base = { left: 100, top: 50 };

  it("is an identity pass-through at scale 1", () => {
    const el = { left: 340, top: 210, width: 200, height: 84 };
    expect(unscaleRect(el, base, 1)).toEqual({ x: 240, y: 160, w: 200, h: 84 });
  });

  it("divides both the delta and the size by the scale factor", () => {
    // A card whose unscaled content-space rect is (x=240, y=160, w=200, h=84)
    // renders, under scale 0.5 with origin at `base`, at half the on-screen
    // delta and half the on-screen size. unscaleRect must recover the original.
    const z = 0.5;
    const el = {
      left: base.left + 240 * z, // 220
      top: base.top + 160 * z, // 130
      width: 200 * z, // 100
      height: 84 * z, // 42
    };
    expect(unscaleRect(el, base, z)).toEqual({ x: 240, y: 160, w: 200, h: 84 });
  });

  it("recovers content-space geometry at 0.7 and 0.85 too", () => {
    for (const z of [0.7, 0.85]) {
      const want = { x: 120, y: 300, w: 216, h: 90 };
      const el = {
        left: base.left + want.x * z,
        top: base.top + want.y * z,
        width: want.w * z,
        height: want.h * z,
      };
      const got = unscaleRect(el, base, z);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
      expect(got.w).toBeCloseTo(want.w, 6);
      expect(got.h).toBeCloseTo(want.h, 6);
    }
  });

  it("treats a zero/falsy scale as identity (no divide-by-zero)", () => {
    const el = { left: 100, top: 50, width: 10, height: 10 };
    expect(unscaleRect(el, base, 0)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });
});

describe("scaledExtent", () => {
  it("multiplies both dimensions by the scale", () => {
    const { width, height } = scaledExtent(1000, 800, 0.55);
    expect(width).toBeCloseTo(550, 6);
    expect(height).toBeCloseTo(440, 6);
  });
  it("is identity at scale 1", () => {
    expect(scaledExtent(1000, 800, 1)).toEqual({ width: 1000, height: 800 });
  });
});
