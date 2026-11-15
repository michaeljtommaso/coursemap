// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequirementItem, TriedProgress } from "@/hooks/useRequirementProgress";
import { ADVISE_COLLEGE, ADVISE_MAJOR, CORE, DIST, FWS, TRIED, item } from "./fixtures";
import { RequirementTable, type TableGroup } from "./RequirementTable";

// One requirement group as a table (spec 045 D1/D2/D11): one line per row,
// the note marker, the tried classes' blue +N, "—" for nothing counted, the
// fold line, the all-finished header, the selected row, the advisor group.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CODES: Record<string, string> = { p1: "HIST 1200", p2: "ARTH 1100", p3: "NS 1150", p4: "BIOG 1440" };
const done = (id: string, pid: string) =>
  item(`cals:${id}`, { label: `Done ${id}`, status: "satisfied", coveredBy: [pid] }, { engineStatus: "met" });
const NS = done("ns", "p3");
const BIO = done("bio", "p4");
const WAIVED = item("cals:e3", { label: "E3 milestone", status: "waived" }, { engineStatus: "waived" });
const UNCHECKED = item("cals:lang", { label: "Language", checkable: false }, { engineStatus: "unchecked" });
const NOTED = { ...CORE, dist: { ...CORE.dist!, note: "Confirm a cross-listed code with the college." } };

let root: Root;
let container: HTMLDivElement;
const onSelect = vi.fn();

function render(
  items: RequirementItem[],
  opts: { tried?: TriedProgress; selectedId?: string | null; variant?: "group" | "advisor" } = {}
) {
  const group: TableGroup = { key: "g", title: "Distribution", items };
  act(() =>
    root.render(
      <RequirementTable
        group={group}
        variant={opts.variant}
        tried={opts.tried}
        codeOfPlacement={(id) => CODES[id] ?? id}
        selectedId={opts.selectedId ?? null}
        panelId="requirement-panel"
        onSelect={onSelect}
      />
    )
  );
}
const $ = (sel: string, from: ParentNode = container) => from.querySelector<HTMLElement>(sel);
const $$ = (sel: string, from: ParentNode = container) => [...from.querySelectorAll<HTMLElement>(sel)];
const rowOf = (id: string) => $$("[data-requirement]").find((el) => el.dataset.requirement === id);
const ids = () => $$("[data-requirement]").map((el) => el.dataset.requirement);
const click = (el: HTMLElement | null | undefined) => {
  if (!el) throw new Error("missing element");
  act(() => el.click());
};

beforeEach(() => {
  onSelect.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("RequirementTable — rows", () => {
  it("one line per requirement: dot · label · progress · counting, in one select button", () => {
    render([FWS, CORE]);
    const row = rowOf(FWS.id)!;
    expect(row.dataset.status).toBe("partial");
    expect(row.dataset.engineStatus).toBe("partial");
    const buttons = $$("button", row);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].hasAttribute("data-row-select")).toBe(true);
    const cells = [...buttons[0].children];
    expect(cells).toHaveLength(4);
    expect(cells[1].textContent).toBe("First-Year Writing Seminars");
    // The label wraps instead of truncating (the codes tell rows apart).
    const label = cells[1].firstElementChild as HTMLElement;
    expect(label.className).toContain("break-words");
    expect(label.className).not.toContain("truncate");
    expect(cells[2].textContent).toBe("1 of 2");
    expect(cells[3].textContent).toBe("HIST 1200");
    // Nothing counted yet reads "—".
    expect([...$("[data-row-select]", rowOf(CORE.id)!)!.children][3].textContent).toBe("—");
  });

  it("a row with a note carries the 'i' marker; one without doesn't", () => {
    render([NOTED, FWS]);
    const marker = $("[data-note-marker]", rowOf(NOTED.id)!)!;
    expect(marker.getAttribute("aria-label")).toBe("Has a note");
    expect(marker.textContent).toBe("i");
    expect($("[data-note-marker]", rowOf(FWS.id)!)).toBeNull();
  });

  it("tried classes add a blue +N in Progress, never Done", () => {
    render([FWS, DIST], { tried: TRIED });
    const row = rowOf(DIST.id)!;
    expect($("[data-row-tried]", row)!.textContent).toContain("+1");
    expect(row.dataset.status).toBe("partial");
    expect(row.textContent).not.toContain("Done");
    expect($("[data-row-tried]", rowOf(FWS.id)!)).toBeNull();
    // A one-row group reads in the row's unit, with the same blue plus.
    render([DIST], { tried: TRIED });
    expect($("[data-group-tried]")!.textContent).toContain("+1");
  });

  it("selecting a row: aria-controls names the panel, aria-expanded and the drop tint mark it", () => {
    render([FWS, CORE], { selectedId: CORE.id });
    const sel = $("[data-row-select]", rowOf(CORE.id)!)!;
    expect(sel.getAttribute("aria-controls")).toBe("requirement-panel");
    expect(sel.getAttribute("aria-expanded")).toBe("true");
    expect(sel.className).toContain("bg-drop-tint");
    expect($("[data-row-select]", rowOf(FWS.id)!)!.getAttribute("aria-expanded")).toBe("false");
    click($("[data-row-select]", rowOf(FWS.id)!));
    expect(onSelect).toHaveBeenCalledWith(FWS);
  });

  it("keeps the group's DOM hooks for the outline", () => {
    render([FWS]);
    const root = $("section")!;
    expect(root.id).toBe("rq-card-g");
    expect(root.dataset.groupCard).toBe("g");
    expect(root.dataset.requirementGroup).toBe("g");
  });
});

describe("RequirementTable — folding finished rows (D2)", () => {
  it("finished and waived rows fold into one line at the end; Show lists them greyed", () => {
    render([NS, CORE, BIO, WAIVED, UNCHECKED]);
    expect(ids()).toEqual([CORE.id, UNCHECKED.id]);
    const line = $("[data-fold-line]")!;
    expect(line.textContent).toBe("✓2 finished · NS 1150, BIOG 1440 · 1 waivedShow");
    expect(line.getAttribute("aria-expanded")).toBe("false");
    click(line);
    expect(ids()).toEqual([NS.id, CORE.id, BIO.id, WAIVED.id, UNCHECKED.id]);
    expect($("[data-fold-line]")!.textContent).toContain("Hide");
  });

  it("Show lists the finished rows greyed: muted label, progress and counting, a faded dot (QA: normal ink)", () => {
    render([NS, CORE, WAIVED]);
    click($("[data-fold-line]"));
    const parts = (id: string) => {
      const [dot, label, progress, counting] = [...$("[data-row-select]", rowOf(id)!)!.children] as HTMLElement[];
      return { dot, label: label.firstElementChild as HTMLElement, progress, counting: $(".truncate", counting) ?? counting };
    };
    for (const id of [NS.id, WAIVED.id]) {
      expect(rowOf(id)!.dataset.folded).toBe("true");
      const p = parts(id);
      expect(p.label.className).toContain("text-ink-4");
      expect(p.label.className).not.toContain("font-semibold");
      expect(p.progress.className).toContain("text-ink-4");
      expect(p.counting.className).toContain("text-ink-4");
      expect(p.counting.className).not.toContain("text-complete-text");
      expect(p.dot.className).toContain("opacity-50");
    }
    // An open row keeps full ink.
    expect(rowOf(CORE.id)!.dataset.folded).toBeUndefined();
    const core = parts(CORE.id);
    expect(core.label.className).toContain("font-semibold text-ink");
    expect(core.dot.className).not.toContain("opacity-50");
  });

  it("the dot's column holds the row padding too, so the dot keeps a gap from the label (QA: '○Earn at least…')", () => {
    render([CORE]);
    // Lines are subgrids with px-5, which comes out of the first track: it
    // must be wider than the 1.25rem padding plus the 0.75rem dot.
    const grid = $("ul")!.className;
    expect(grid).toContain("grid-cols-[2rem_");
    expect(grid).toContain("gap-x-3");
    expect($("[data-row-select]", rowOf(CORE.id)!)!.className).toContain("px-5");
  });

  it("no fold line when nothing is finished", () => {
    render([FWS, CORE]);
    expect($("[data-fold-line]")).toBeNull();
  });

  it("a group with nothing open shrinks to its header: '✓ All finished · Show'", () => {
    render([NS, BIO, WAIVED]);
    expect(ids()).toEqual([]);
    expect($("[data-fold-line]")).toBeNull();
    const toggle = $("[data-fold-toggle]")!;
    expect(toggle.textContent).toBe("✓ All finished · Show");
    click(toggle);
    expect(ids()).toEqual([NS.id, BIO.id, WAIVED.id]);
    expect($("[data-fold-toggle]")!.textContent).toBe("✓ All finished · Hide");
  });

  it("a selected finished row stays in the table, out of the fold line", () => {
    render([NS, CORE, BIO], { selectedId: BIO.id });
    expect(ids()).toEqual([CORE.id, BIO.id]);
    expect($("[data-fold-line]")!.textContent).toContain("1 finished · NS 1150");
  });
});

describe("RequirementTable — advisor group", () => {
  it("collapsed by default; opening lists its rows as table rows that open the panel", () => {
    render([ADVISE_COLLEGE, ADVISE_MAJOR], { variant: "advisor" });
    const card = $("[data-advisor-card]")!;
    expect(card.dataset.groupCard).toBe("advisor");
    expect(ids()).toEqual([]);
    const header = $$("button", card).find((b) => b.textContent?.includes("Check with your advisor (2)"))!;
    expect(header.getAttribute("aria-expanded")).toBe("false");
    // The toggle sits inside the heading, so the heading role survives, and
    // names the rows' container it opens.
    expect(header.parentElement?.tagName).toBe("H2");
    const controls = header.getAttribute("aria-controls")!;
    expect(controls).toBeTruthy();
    expect(card.querySelector(`#${controls}`)).not.toBeNull();
    click(header);
    expect(card.querySelector(`#${controls}`)!.querySelectorAll("[data-requirement]")).toHaveLength(2);
    expect(ids()).toEqual([ADVISE_COLLEGE.id, ADVISE_MAJOR.id]);
    expect($("[data-fold-line]")).toBeNull();
    click($("[data-row-select]", rowOf(ADVISE_MAJOR.id)!));
    expect(onSelect).toHaveBeenCalledWith(ADVISE_MAJOR);
  });
});
