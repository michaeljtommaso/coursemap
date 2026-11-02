import { afterEach, describe, expect, it, vi } from "vitest";

// The suite runs in node (no window.localStorage): load a fresh copy of the
// store over an in-memory storage holding what an earlier session saved.
async function rehydrated(saved: Record<string, unknown> | null) {
  const mem = new Map<string, string>();
  if (saved) mem.set("cornell-program-v2", JSON.stringify({ state: saved, version: 1 }));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
    },
  });
  vi.resetModules();
  const { useProgramStore } = await import("./useProgramStore");
  return useProgramStore.getState();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useProgramStore — retired program ids (spec 019 D12)", () => {
  it("reads a saved retired program id as its current id", async () => {
    const custom = [{ id: "custom-1", name: "Custom Template 1" }];
    const state = await rehydrated({ selectedProgramId: "cornell-infosci-bs-2025", customTemplates: custom });
    expect(state.selectedProgramId).toBe("cornell-information-science-bs-2026");
    expect(state.customTemplates).toEqual(custom);
  });

  it("leaves any other saved selection alone", async () => {
    expect((await rehydrated({ selectedProgramId: "cornell-cs-bs-2026" })).selectedProgramId).toBe("cornell-cs-bs-2026");
    expect((await rehydrated({ selectedProgramId: null })).selectedProgramId).toBeNull();
    expect((await rehydrated(null)).selectedProgramId).toBeNull();
  });
});
