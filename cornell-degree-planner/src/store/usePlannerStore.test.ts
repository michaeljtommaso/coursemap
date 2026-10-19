import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCardDensity, usePlannerStore } from "./usePlannerStore";
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

  it("is never persisted — only zoom and card density are saved", async () => {
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
      expect(Object.keys(saved.state ?? {}).sort()).toEqual(["cardDensity", "zoom"]);
      expect(JSON.stringify(saved)).not.toContain("armedHighlightSem");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
