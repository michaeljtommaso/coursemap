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

// `search.behind`: the hook is still on an earlier query (its results trail
// the typed one for a render), as the real hook's deferred query can.
const search = { behind: null as string | null };
const matches = (q: string) =>
  q.trim()
    ? INDEX.filter((r) => `${r.subject} ${r.number} ${r.title}`.toLowerCase().includes(q.toLowerCase())).map((r) => ({
        id: r.id,
        subject: r.subject,
        number: r.number,
        title: r.title,
      }))
    : [];
vi.mock("@/hooks/useCourseSearch", () => ({
  useCourseSearch: (q: string) => {
    const resultsFor = search.behind ?? q;
    return { results: matches(resultsFor), query: resultsFor, loading: false, error: null, refetch: () => {} };
  },
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
  search.behind = null;
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
    // A combobox (aria-expanded is only valid with a role), naming its list
    // only while it is open.
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-autocomplete")).toBe("list");
    expect(input().hasAttribute("aria-controls")).toBe(false);
    await type("ethics");
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(input().getAttribute("aria-controls")!)).not.toBeNull();
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

  it("a tried class shows as a chip with ×; no +N or Clear for one", () => {
    triedIds = ["HIST-1530"];
    actions = makeActions();
    render();
    expect($$("[data-tried-chip]").map((c) => c.textContent)).toEqual(["HIST 1530"]);
    expect($("[data-tried-more]")).toBeNull();
    expect($("[data-tried-clear-all]")).toBeNull();
    click($('button[aria-label="Stop trying HIST 1530"]'));
    expect(actions.onUntry).toHaveBeenCalledWith("HIST-1530");
  });

  it("from two, the line keeps one chip and '+N'; +N lists the rest with × and Clear all (QA: the header wrapped)", () => {
    triedIds = ["HIST-1530", "PHIL-1440", "MUSIC-1101"];
    actions = makeActions();
    render();
    const line = $("[data-tried-line]")!;
    // Every tried chip stays in the line's DOM; only the first is on show.
    expect($$("[data-tried-chip]", line)).toHaveLength(3);
    const more = $<HTMLButtonElement>("[data-tried-more]")!;
    expect(more.textContent).toBe("+2");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    const list = document.getElementById(more.getAttribute("aria-controls")!)!;
    expect(list.hidden).toBe(true);
    expect($$("[data-tried-chip]", list).map((c) => c.dataset.triedChip)).toEqual(["PHIL-1440", "MUSIC-1101"]);
    expect(list.contains($("[data-tried-clear-all]"))).toBe(true);
    const shown = $$("[data-tried-chip]", line).filter((c) => !c.closest("[hidden]"));
    expect(shown.map((c) => c.dataset.triedChip)).toEqual(["HIST-1530"]);

    click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(list.hidden).toBe(false);
    click($('button[aria-label="Stop trying PHIL 1440"]'));
    expect(actions.onUntry).toHaveBeenCalledWith("PHIL-1440");

    // Esc closes the list, back on +N.
    key($('button[aria-label="Stop trying MUSIC 1101"]')!, "Escape");
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(more);

    click(more);
    click($("[data-tried-clear-all]"));
    expect(onClearTried).toHaveBeenCalled();
    expect(list.hidden).toBe(true);

    // A click outside closes it too.
    click(more);
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(list.hidden).toBe(true);
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

  it("never shows another query's results while the search catches up (QA: 'ANSC' listed AAP, AAS)", async () => {
    render();
    search.behind = "ethics";
    await type("history");
    // The hook is still on "ethics": nothing from it shows under "history",
    // and no "No class matches" either.
    expect($('[data-try-course="PHIL-1440"]')).toBeNull();
    expect($("[data-try-search]")!.textContent).not.toContain("No class matches that.");
    search.behind = null;
    render();
    expect($$("[data-try-course]").map((r) => r.dataset.tryCourse)).toEqual(["HIST-1530"]);
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

  it("the results anchor right in compact mode (inside a narrow window), left otherwise", async () => {
    render({ compact: true });
    click($<HTMLButtonElement>('[data-try-search] button[aria-label="Try a class"]'));
    await type("ethics");
    const compactList = $("[data-try-results]")!;
    expect(compactList.className).toContain("right-0");
    expect(compactList.className).not.toContain("left-0");
    expect(compactList.className).toContain("max-w-[calc(100vw-2rem)]");
    key(input(), "Escape");
    act(() => root.unmount());
    root = createRoot(container);
    render();
    await type("ethics");
    expect($("[data-try-results]")!.className).toContain("left-0");
  });
});
