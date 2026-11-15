import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEFT_RAIL_DEFAULT,
  LEFT_RAIL_MAX,
  LEFT_RAIL_MIN,
  normalizeCardDensity,
  normalizeLeftRailWidth,
  normalizeReqPanelWidth,
  REQ_PANEL_MAX,
  REQ_PANEL_MIN,
  usePlannerStore,
} from "./usePlannerStore";
import type { Course } from "@/types/db";

describe("normalizeCardDensity", () => {
  it("keeps the two known densities", () => {
    expect(normalizeCardDensity("compact")).toBe("compact");
    expect(normalizeCardDensity("detailed")).toBe("detailed");
  });
  it("falls back to detailed for anything else (missing or stale storage)", () => {
    expect(normalizeCardDensity(undefined)).toBe("detailed");
    expect(normalizeCardDensity("dense")).toBe("detailed");
    expect(normalizeCardDensity(1)).toBe("detailed");
  });
});

describe("requirements panel width (resizable side panel)", () => {
  it("clamps to the panel's bounds and rounds", () => {
    expect(normalizeReqPanelWidth(500.6)).toBe(501);
    expect(normalizeReqPanelWidth(10)).toBe(REQ_PANEL_MIN);
    expect(normalizeReqPanelWidth(5000)).toBe(REQ_PANEL_MAX);
  });
  it("null (never dragged, or reset) and stale storage mean the built-in width", () => {
    expect(normalizeReqPanelWidth(null)).toBeNull();
    expect(normalizeReqPanelWidth("wide")).toBeNull();
    expect(normalizeReqPanelWidth(NaN)).toBeNull();
    usePlannerStore.getState().setReqPanelWidth(9999);
    expect(usePlannerStore.getState().reqPanelWidth).toBe(REQ_PANEL_MAX);
    usePlannerStore.getState().setReqPanelWidth(null);
    expect(usePlannerStore.getState().reqPanelWidth).toBeNull();
  });
});

describe("left rail width (resizable rail)", () => {
  it("clamps to the rail's bounds and rounds", () => {
    expect(normalizeLeftRailWidth(300.4)).toBe(300);
    expect(normalizeLeftRailWidth(10)).toBe(LEFT_RAIL_MIN);
    expect(normalizeLeftRailWidth(5000)).toBe(LEFT_RAIL_MAX);
  });
  it("falls back to the old fixed width for missing or stale storage", () => {
    expect(normalizeLeftRailWidth(undefined)).toBe(LEFT_RAIL_DEFAULT);
    expect(normalizeLeftRailWidth("wide")).toBe(LEFT_RAIL_DEFAULT);
    expect(normalizeLeftRailWidth(NaN)).toBe(LEFT_RAIL_DEFAULT);
    expect(LEFT_RAIL_DEFAULT).toBe(224);
  });
  it("setLeftRailWidth stores the clamped width", () => {
    usePlannerStore.getState().setLeftRailWidth(9999);
    expect(usePlannerStore.getState().leftRailWidth).toBe(LEFT_RAIL_MAX);
    usePlannerStore.getState().setLeftRailWidth(320);
    expect(usePlannerStore.getState().leftRailWidth).toBe(320);
    usePlannerStore.getState().setLeftRailWidth(LEFT_RAIL_DEFAULT);
  });
});

describe("armedHighlightSem (spec 017 D6) — the suggested target column", () => {
  const course = { id: "CS-2110", subject: "CS", number: "2110" } as unknown as Course;
  const other = { id: "CS-3110", subject: "CS", number: "3110" } as unknown as Course;

  beforeEach(() => usePlannerStore.getState().disarm());

  it("is set only when an arm passes highlightSem", () => {
    usePlannerStore.getState().armCourse(course, null, { highlightSem: 4 });
    expect(usePlannerStore.getState().armedHighlightSem).toBe(4);
    expect(usePlannerStore.getState().armedCourse).toBe(course);
  });

  it("a plain arm (the catalog drawer's two-argument call) leaves it null", () => {
    usePlannerStore.getState().armCourse(course, null);
    expect(usePlannerStore.getState().armedHighlightSem).toBeNull();
  });

  it("disarm (Esc, cancel, and every placement path) clears it", () => {
    usePlannerStore.getState().armCourse(course, null, { highlightSem: 4 });
    usePlannerStore.getState().disarm();
    expect(usePlannerStore.getState().armedHighlightSem).toBeNull();
    expect(usePlannerStore.getState().armedCourse).toBeNull();
  });

  it("arming a different course replaces it", () => {
    usePlannerStore.getState().armCourse(course, null, { highlightSem: 4 });
    usePlannerStore.getState().armCourse(other, null);
    expect(usePlannerStore.getState().armedHighlightSem).toBeNull();
    expect(usePlannerStore.getState().armedCourse).toBe(other);
  });

  it("is never persisted — only the view preferences (zoom, density, rail and panel widths) are saved", async () => {
    // The suite runs in node (no window.localStorage), so load a fresh copy of
    // the store over an in-memory storage and read back what persist writes.
    const mem = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, String(v)),
        removeItem: (k: string) => void mem.delete(k),
      },
    });
    try {
      vi.resetModules();
      const { usePlannerStore: fresh } = await import("./usePlannerStore");
      fresh.getState().armCourse(course, null, { highlightSem: 4 });
      const saved = JSON.parse(mem.get("cornell-planner-v2") ?? "{}");
      expect(Object.keys(saved.state ?? {}).sort()).toEqual(["cardDensity", "leftRailWidth", "reqPanelWidth", "zoom"]);
      expect(JSON.stringify(saved)).not.toContain("armedHighlightSem");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
