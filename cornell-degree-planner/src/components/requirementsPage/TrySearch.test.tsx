// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogIndexRecord } from "@/lib/schemas";
import type { GroupTargets } from "./suggestions";
import type { TryActions } from "./tryCourse";
import type { TrySearchProps } from "./TrySearch";

// The header's "Try a class" search (spec 045 D10), rendered for real: what
// each result fills across the page, Try / untry and the cap, the tried
// chips, the no-longer-offered line, and the compact icon.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INDEX = [
  { id: "PHIL-1440", subject: "PHIL", number: "1440", title: "Ethics and Society", roster: "SP27", offered: [] },
  { id: "HIST-1530", subject: "HIST", number: "1530", title: "Intro to American History", roster: "SP27", offered: [] },
  { id: "MUSIC-1101", subject: "MUSIC", number: "1101", title: "Music Theory", roster: "SP27", offered: [] },
  { id: "BIOG-1440", subject: "BIOG", number: "1440", title: "Comparative Physiology", roster: "SP27", offered: [] },
] as unknown as CatalogIndexRecord[];
const recordById = (id: string) => INDEX.find((r) => r.id === id);

vi.mock("@/hooks/useCourseSearch", () => ({
  useCourseSearch: (q: string) => ({
    results: q.trim()
      ? INDEX.filter((r) => `${r.subject} ${r.number} ${r.title}`.toLowerCase().includes(q.toLowerCase())).map((r) => ({
          id: r.id,
          subject: r.subject,
          number: r.number,
          title: r.title,
        }))
      : [],
    loading: false,
    error: null,
    refetch: () => {},
  }),
}));

const { TrySearch } = await import("./TrySearch");

const GROUPS: GroupTargets[] = [
  {
    key: "college",
    title: "College requirements",
    targets: [
      { label: "One ethics course", test: (r) => r.subject === "PHIL" },
      { label: "Historical analysis", test: (r) => r.subject === "PHIL" || r.subject === "HIST" },
    ],
  },
  {
    key: "major",
    title: "Major",
    targets: [{ label: "Historical analysis", test: (r) => r.subject === "HIST" }],
  },
];

let root: Root;
let container: HTMLDivElement;
let triedIds: string[];
let actions: TryActions;
let onClearTried: ReturnType<typeof vi.fn<() => void>>;

function makeActions(atCap = false): TryActions {
  return {
    triedIds,
    atCap,
    onTry: vi.fn((id: string) => {
      if (atCap) return false;
      triedIds = [...triedIds, id];
      return true;
    }),
    onUntry: vi.fn(),
    onAdd: vi.fn(),
    addLabel: "+ Spring 2027",
  };
}

function render(props: Partial<TrySearchProps> = {}) {
  act(() =>
    root.render(
      <TrySearch
        groupTargets={GROUPS}
        recordById={recordById}
        enrollmentTarget="SP27"
        termLabel="Spring 2027"
        isOnBoard={(id) => id === "BIOG-1440"}
        actions={actions}
        codeOf={(id) => id.replace("-", " ")}
        onClearTried={onClearTried}
        missingTried={[]}
        {...props}
      />
    )
  );
}

const $ = <T extends Element = HTMLElement>(sel: string, from: ParentNode = document) => from.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, from: ParentNode = document) => [
  ...from.querySelectorAll<T>(sel),
];
const input = () => $<HTMLInputElement>('[data-try-search] input[type="search"]')!;

async function type(text: string) {
  const el = input();
  act(() => el.focus());
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const key = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
const buttonIn = (row: Element, text: string) =>
  $$<HTMLButtonElement>("button", row).find((b) => b.textContent?.includes(text)) ?? null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  triedIds = [];
  actions = makeActions();
  onClearTried = vi.fn<() => void>();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TrySearch (spec 045 D10)", () => {
  it("each result names everything it fills across the page", async () => {
    render();
    expect($("[data-try-search]")).not.toBeNull();
    expect(input().getAttribute("aria-label")).toBe("Try a class");
    await type("ethics");
    const row = $('[data-try-course="PHIL-1440"]')!;
    // A label two groups share is told apart by its group.
    expect(row.textContent).toContain(
      "Fills: One ethics course, Historical analysis (College requirements)"
    );
    await type("history");
    expect($('[data-try-course="HIST-1530"]')!.textContent).toContain(
      "Fills: Historical analysis (College requirements), Historical analysis (Major)"
    );
    await type("music");
    expect($('[data-try-course="MUSIC-1101"]')!.textContent).toContain("Doesn't fill anything still open here");
  });

  it("a result already on the board says so, with no buttons", async () => {
    render();
    await type("physiology");
    const row = $('[data-try-course="BIOG-1440"]')!;
    expect($("[data-on-board]", row)!.textContent).toBe("On your board");
    expect($$("button", row)).toHaveLength(0);
  });

  it("Try tries the class; Trying ✓ untries it", async () => {
    render();
    await type("ethics");
    click(buttonIn($('[data-try-course="PHIL-1440"]')!, "Try"));
    expect(actions.onTry).toHaveBeenCalledWith("PHIL-1440");
    actions = { ...actions, triedIds };
    render();
    const btn = buttonIn($('[data-try-course="PHIL-1440"]')!, "Trying");
    expect(btn!.getAttribute("aria-pressed")).toBe("true");
    click(btn);
    expect(actions.onUntry).toHaveBeenCalledWith("PHIL-1440");
  });

  it("at the cap: Try is disabled and the cap text shows", async () => {
    actions = makeActions(true);
    render();
    expect($("[data-try-cap]")!.textContent).toBe("Up to 20 classes at a time");
    await type("ethics");
    expect(buttonIn($('[data-try-course="PHIL-1440"]')!, "Try")!.disabled).toBe(true);
  });

  it("tried classes show as chips with ×; Clear appears from two", () => {
    triedIds = ["HIST-1530"];
    actions = makeActions();
    render();
    expect($$("[data-tried-chip]").map((c) => c.textContent)).toEqual(["HIST 1530"]);
    expect($("[data-tried-clear-all]")).toBeNull();
    click($('button[aria-label="Stop trying HIST 1530"]'));
    expect(actions.onUntry).toHaveBeenCalledWith("HIST-1530");

    triedIds = ["HIST-1530", "PHIL-1440"];
    actions = makeActions();
    render();
    expect($$("[data-tried-line] [data-tried-chip]")).toHaveLength(2);
    click($("[data-tried-clear-all]"));
    expect(onClearTried).toHaveBeenCalled();
  });

  it("a tried class no longer offered: '<code> is no longer offered · Remove'", () => {
    triedIds = ["OLD-1000"];
    actions = makeActions();
    render({ missingTried: ["OLD-1000"] });
    const line = $('[data-tried-missing="OLD-1000"]')!;
    expect(line.textContent).toBe("OLD 1000 is no longer offered · Remove");
    click(buttonIn(line, "Remove"));
    expect(actions.onUntry).toHaveBeenCalledWith("OLD-1000");
  });

  it("Esc and a click outside close the results; arrows move through them", async () => {
    render();
    await type("i"); // matches several classes
    expect($$("[data-try-course]").length).toBeGreaterThan(1);
    key(input(), "ArrowDown");
    const first = $$("[data-try-course]")[0];
    expect(document.activeElement).toBe($("button", first));
    key(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe($("button", $$("[data-try-course]")[1]));
    key(document.activeElement!, "ArrowUp");
    key(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(input());

    key(input(), "Escape");
    expect($("[data-try-course]")).toBeNull();
    await type("ethics");
    expect($("[data-try-course]")).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect($("[data-try-course]")).toBeNull();
  });

  it("no match: says so", async () => {
    render();
    await type("zzzz");
    expect($("[data-try-search]")!.textContent).toContain("No class matches that.");
  });

  it("compact: an icon button that expands into the search in place", () => {
    render({ compact: true });
    expect($('[data-try-search] input[type="search"]')).toBeNull();
    const btn = $<HTMLButtonElement>('[data-try-search] button[aria-label="Try a class"]')!;
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    click(btn);
    expect(input()).not.toBeNull();
    expect(document.activeElement).toBe(input());
    key(input(), "Escape");
    expect($('[data-try-search] input[type="search"]')).toBeNull();
    expect($('[data-try-search] button[aria-label="Try a class"]')).not.toBeNull();
  });
});
