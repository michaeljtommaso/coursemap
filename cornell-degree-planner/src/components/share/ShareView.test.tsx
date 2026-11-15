// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareDoc } from "@/lib/schemas";

// The read-only share view (spec 005 §5), rendered for real against a mocked
// shares service: winter / summer columns (spec 042) render in time order
// with their term as the label, and an old share reads exactly as before.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchShare = vi.fn();
vi.mock("@/services/shares", () => ({ fetchShare: (id: string) => fetchShare(id) }));
const fetchProgramIndex = vi.fn(async () => [] as { id: string; name: string; short_name: string }[]);
const fetchMinorIndex = vi.fn(async () => [] as { id: string; name: string; shortName: string }[]);
vi.mock("@/services/programs", () => ({
  fetchProgram: vi.fn(async () => null),
  fetchProgramIndex: () => fetchProgramIndex(),
}));
const fetchLayer = vi.fn(async (_id: string): Promise<unknown> => null);
vi.mock("@/services/layers", () => ({ fetchLayer: (id: string) => fetchLayer(id), fetchMinorIndex: () => fetchMinorIndex() }));

const { ShareView } = await import("./ShareView");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchShare.mockReset();
  fetchProgramIndex.mockClear();
  fetchMinorIndex.mockClear();
  fetchLayer.mockReset();
  fetchLayer.mockImplementation(async () => null);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const snap = (id: string) => {
  const [subject, number] = id.split("-");
  return { id, subject, number, title: `${subject} ${number} title`, creditsMin: 3, creditsMax: 3 };
};

function share(extra: Partial<ShareDoc> = {}): ShareDoc {
  return {
    createdBy: "u1",
    planName: "My plan",
    programId: "cas-psychology-ba",
    programName: "Psychology",
    enteringYear: 2025,
    placements: [
      { id: "f", courseId: "PSYCH-1101", sem: 1, order: 0 },
      { id: "s", courseId: "PSYCH-2050", sem: 2, order: 0 },
    ],
    courseSnapshots: {
      "PSYCH-1101": snap("PSYCH-1101"),
      "PSYCH-2050": snap("PSYCH-2050"),
      "CS-1110": snap("CS-1110"),
      "MATH-1110": snap("MATH-1110"),
    },
    completedIds: [],
    inProgressIds: [],
    waivedRequirementIds: [],
    schemaVersion: 3,
    ...extra,
  };
}

async function render(doc: ShareDoc) {
  fetchShare.mockResolvedValue(doc);
  await act(async () => root.render(<ShareView shareId="share-1" />));
  await act(async () => {});
}

const columnHeads = () =>
  [...container.querySelectorAll("[data-share-column]")].map((el) => ({
    key: el.getAttribute("data-share-column"),
    short: el.hasAttribute("data-short-term"),
    label: el.firstElementChild?.textContent ?? "",
  }));

describe("ShareView — short-term columns (spec 042)", () => {
  it("an old share (no short terms) renders its semesters exactly as before", async () => {
    await render(share());
    const heads = columnHeads();
    expect(heads.map((h) => h.key)).toEqual(["2", "4"]);
    expect(heads.every((h) => !h.short)).toBe(true);
    expect(heads[0].label.startsWith("Fall 2025")).toBe(true);
    expect(heads[1].label.startsWith("Spring 2026")).toBe(true);
  });

  it("interleaves winter / summer columns by time, keyed apart from the semester after them", async () => {
    await render(
      share({
        placements: [
          { id: "f", courseId: "PSYCH-1101", sem: 1, order: 0 },
          { id: "w", courseId: "CS-1110", sem: 2, order: 0, shortTerm: true },
          { id: "s", courseId: "PSYCH-2050", sem: 2, order: 0 },
          { id: "u", courseId: "MATH-1110", sem: 3, order: 0, shortTerm: true },
        ],
        shortTerms: [2, 3],
      })
    );
    const heads = columnHeads();
    // Fall 2025 (key 2), Winter 2026 (3), Spring 2026 (4), Summer 2026 (5).
    expect(heads.map((h) => h.key)).toEqual(["2", "3", "4", "5"]);
    expect(heads.map((h) => h.short)).toEqual([false, true, false, true]);
    // A short term reads as its term — no "Sem N", no class-year word.
    expect(heads[1].label).toBe("Winter 2026");
    expect(heads[3].label).toBe("Summer 2026");
    const cards = [...container.querySelectorAll("[data-share-column]")].map((el) => el.textContent ?? "");
    expect(cards[1]).toContain("CS 1110");
    expect(cards[2]).toContain("PSYCH 2050");
    expect(cards[2]).not.toContain("CS 1110");
  });

  it("an added short term with no classes stays out of the document, like an empty semester", async () => {
    await render(share({ shortTerms: [1] }));
    expect(columnHeads().map((h) => h.key)).toEqual(["2", "4"]);
  });
});

describe("ShareView — several programs (spec 047 D13)", () => {
  const programs = () => container.querySelector("[data-share-programs]")!.textContent;

  it("names every program in the header", async () => {
    fetchProgramIndex.mockResolvedValueOnce([{ id: "cas-mathematics-ba", name: "Mathematics (BA)", short_name: "Mathematics" }]);
    fetchMinorIndex.mockResolvedValueOnce([{ id: "cs-minor", name: "Computer Science", shortName: "CS minor" }]);
    await render(
      share({
        additionalPrograms: [
          { programId: "cas-mathematics-ba", kind: "major" },
          { programId: "cs-minor", kind: "minor" },
        ],
      })
    );
    expect(programs()).toBe("Psychology + Mathematics (second major) + CS minor");
    expect(container.textContent).toContain("Psychology + Mathematics (second major) + CS minor · shared plan");
  });

  it("a share without extra programs reads no index and shows the program alone", async () => {
    await render(share());
    expect(programs()).toBe("Psychology");
    expect(fetchProgramIndex).not.toHaveBeenCalled();
    expect(fetchMinorIndex).not.toHaveBeenCalled();
  });

  it("reads an extra program's layer, so an answer on it names its requirement (audit #9)", async () => {
    const csMinor = { id: "cs-minor", kind: "minor", name: "CS minor", rows: [{ id: "intro", label: "Intro programming" }] };
    fetchLayer.mockImplementation(async (id: string) => (id === "cs-minor" ? { ok: true, layer: csMinor } : null));
    await render(
      share({
        placements: [{ id: "f", courseId: "CS-1110", sem: 1, order: 0 }],
        courseMarks: { "usedAs:cs-minor/intro@CS-1110": "yes" },
        additionalPrograms: [{ programId: "cs-minor", kind: "minor" }],
      })
    );
    expect(fetchLayer).toHaveBeenCalledWith("cs-minor");
    const lines = [...container.querySelectorAll("[data-share-mark]")].map((el) => el.textContent);
    expect(lines).toEqual(["Used as Intro programming · the student's answer"]);
  });

  it("a share without extra programs reads only its own layers", async () => {
    await render(share({ courseMarks: { "usedAs:cas-psychology-ba/r@PSYCH-1101": "yes" } }));
    expect(fetchLayer.mock.calls.map((c) => c[0])).toEqual(["cas-psychology-ba"]);
  });

  it("names it from its id when the index can't be read", async () => {
    fetchMinorIndex.mockRejectedValueOnce(new Error("offline"));
    await render(share({ additionalPrograms: [{ programId: "music", kind: "minor" }] }));
    expect(programs()).toBe("Psychology + Music minor");
    expect(fetchProgramIndex).not.toHaveBeenCalled();
  });
});
