// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useProgramStore } from "@/store/useProgramStore";
import { useTopBarStore } from "@/store/useTopBarStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * The bar's stage cascade (spec 039 D8, spec 047 D5) over a simulated layout:
 * happy-dom has no layout, so each mocked control reports the width it has in
 * the real app at that stage (measured at 1600 px on the emulator), the
 * controls row is their sum, and the brand group gets what is left. The stack
 * must fold only when the packed row with names doesn't fit — never just for
 * the number of programs on the plan.
 */

const W = {
  pad: 32 + 16, // bar padding + the gap between brand and controls
  gap: 8, // between controls
  logo: 135,
  primary: 152,
  extra: 170,
  plus: 32,
  foldedStack: 128 + 51 + 32,
  inlineFull: 787,
  inlineCompact: 505,
  menu: 45,
};

const state = { extras: 0, barWidth: 1600 };

vi.mock("@/hooks/usePrograms", () => ({
  usePrograms: () => ({ programs: [], loading: false, error: null, refetch: () => {} }),
}));
vi.mock("@/hooks/usePlan", () => ({
  usePlan: () => ({
    planId: "plan-1",
    planName: null,
    additionalPrograms: Array.from({ length: state.extras }, (_, i) => ({ programId: `p${i}`, kind: "minor" })),
  }),
}));
vi.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ isAnonymous: true }) }));
vi.mock("@/components/brand/LogoMark", () => ({ LogoMark: () => <span>Coursemap</span> }));
vi.mock("@/components/layout/CatalogRetryButton", () => ({ CatalogRetryButton: () => null }));
vi.mock("@/components/layout/TopBarMenu", () => ({ TopBarMenu: () => <div data-sim-width={W.menu} /> }));
vi.mock("@/components/layout/TopBarInline", () => ({
  TopBarInline: ({ compact }: { compact: boolean }) => (
    <div data-sim-width={compact ? W.inlineCompact : W.inlineFull} data-inline={compact ? "compact" : "full"} />
  ),
}));
vi.mock("@/components/programs/ProgramStack", () => ({
  ProgramStack: ({ folded }: { folded: boolean }) => (
    <div
      id="program-stack"
      data-folded={folded}
      data-sim-width={folded ? W.foldedStack : W.primary + state.extras * W.extra + W.plus}
    />
  ),
}));

const { TopBar } = await import("./TopBar");

// ─── Simulated layout ───────────────────────────────────────────────────────

const isBar = (el: Element) => el.hasAttribute("data-topbar-tier");
function simWidth(el: Element): number {
  const own = el.getAttribute("data-sim-width");
  if (own !== null) return Number(own);
  if (isBar(el)) return state.barWidth;
  if (el.tagName === "H1") return W.logo;
  const parent = el.parentElement;
  if (parent && isBar(parent)) {
    const controls = parent.lastElementChild!;
    const controlsWidth =
      [...controls.children].reduce((sum, c) => sum + simWidth(c), 0) + W.gap * Math.max(0, controls.children.length - 1);
    return el === controls ? controlsWidth : state.barWidth - W.pad - controlsWidth;
  }
  return 0;
}

const observers: (() => void)[] = [];
const saved = {
  rect: HTMLElement.prototype.getBoundingClientRect,
  clientWidth: Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth"),
  ro: globalThis.ResizeObserver,
};
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const width = simWidth(this);
    return { width, height: 34, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 34, toJSON: () => ({}) } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return simWidth(this);
    },
  });
  globalThis.ResizeObserver = class {
    constructor(cb: () => void) {
      observers.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = saved.rect;
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  globalThis.ResizeObserver = saved.ro;
});

let root: Root;
let host: HTMLElement;
const render = () => act(() => root.render(<TopBar />));
/** The window resizes: every observer re-checks, as the real ResizeObserver would. */
const resize = (width: number) => {
  state.barWidth = width;
  act(() => observers.forEach((cb) => cb()));
};
const bar = () => host.querySelector<HTMLElement>("[data-topbar-tier]")!;
const stackFolded = () => host.querySelector("#program-stack")!.getAttribute("data-folded") === "true";

beforeEach(() => {
  state.extras = 0;
  state.barWidth = 1600;
  observers.length = 0;
  useProgramStore.setState({ selectedProgramId: "cornell-econ-ba" });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("TopBar stages", () => {
  it("one program at 1600 px: everything spread out, the stack with its labels", () => {
    render();
    expect(bar().dataset.topbarTier).toBe("full");
    expect(stackFolded()).toBe(false);
    expect(useTopBarStore.getState().tier).toBe("full");
  });

  it.each([3, 4])("%i programs at 1600 px: the other controls pack tighter, the stack keeps its labels", (n) => {
    state.extras = n - 1;
    render();
    expect(bar().dataset.topbarStage).toBe("compact");
    expect(bar().dataset.topbarTier).toBe("compact");
    expect(host.querySelector("[data-inline]")!.getAttribute("data-inline")).toBe("compact");
    expect(stackFolded()).toBe(false);
  });

  it("4 programs at a wide desktop: fully spread out, never folded for the count alone", () => {
    state.extras = 3;
    state.barWidth = 2560;
    render();
    expect(bar().dataset.topbarTier).toBe("full");
    expect(stackFolded()).toBe(false);
  });

  it("the stack folds only when the packed row with names doesn't fit, then the menu takes over", () => {
    state.extras = 2;
    render();
    expect(stackFolded()).toBe(false);
    resize(1180);
    expect(bar().dataset.topbarStage).toBe("folded");
    expect(bar().dataset.topbarTier).toBe("compact");
    expect(stackFolded()).toBe(true);
    resize(1024);
    expect(bar().dataset.topbarTier).toBe("menu");
    expect(stackFolded()).toBe(true);
    // Widening again steps back up to the labels.
    resize(1600);
    expect(bar().dataset.topbarStage).toBe("compact");
    expect(stackFolded()).toBe(false);
  });
});
