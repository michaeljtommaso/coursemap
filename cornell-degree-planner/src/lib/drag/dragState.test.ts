import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course } from "@/types/db";

// Node test env: stub the tiny slice of DOM dragState touches. No
// elementsFromPoint → hit-testing resolves "no target", which is all the
// lifecycle tests need.
const classes = new Set<string>();
beforeEach(() => {
  classes.clear();
  vi.stubGlobal("document", {
    body: {
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
      },
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  vi.stubGlobal("window", { getSelection: () => null });
  vi.useFakeTimers();
});
afterEach(async () => {
  const { dragState } = await import("./dragState");
  dragState.end();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const course = { id: "CS-2110", subject: "CS", number: "2110" } as unknown as Course;
const startCard = async () => {
  const { dragState } = await import("./dragState");
  return dragState.start({
    course,
    sourcePlacementId: "p1",
    home: { sem: 3, index: 0 },
    startX: 10,
    startY: 10,
  });
};

describe("dragState session lifecycle", () => {
  it("mints a unique session id per drag — the same card dragged twice (sweep D3)", async () => {
    const { dragState } = await import("./dragState");
    const first = await startCard();
    dragState.drop();
    dragState.end(first);
    const second = await startCard();
    expect(second).not.toBe(first);
    expect(dragState.get()?.sessionId).toBe(second);
  });

  it("drop with no hovered target resolves to a null drop (return home)", async () => {
    const { dragState } = await import("./dragState");
    await startCard();
    dragState.drop();
    expect(dragState.get()?.phase).toBe("dropping");
    expect(dragState.get()?.drop).toBeNull();
  });

  it("end() clears state and the dragging-active body class", async () => {
    const { dragState } = await import("./dragState");
    const id = await startCard();
    expect(classes.has("dragging-active")).toBe(true);
    dragState.drop();
    dragState.end(id);
    expect(dragState.get()).toBeNull();
    expect(classes.has("dragging-active")).toBe(false);
  });

  it("a stale session's end() can't kill the next drag", async () => {
    const { dragState } = await import("./dragState");
    const first = await startCard();
    dragState.drop();
    const second = await startCard();
    dragState.end(first); // late animation callback from the first drag
    expect(dragState.get()?.sessionId).toBe(second);
    expect(classes.has("dragging-active")).toBe(true);
  });

  it("cancel() (Esc / pointercancel) drops with no target", async () => {
    const { dragState } = await import("./dragState");
    await startCard();
    dragState.cancel();
    expect(dragState.get()?.phase).toBe("dropping");
    expect(dragState.get()?.drop).toBeNull();
  });

  it("forces end() if no animation callback ever arrives", async () => {
    const { dragState } = await import("./dragState");
    await startCard();
    dragState.drop();
    vi.advanceTimersByTime(5000);
    expect(dragState.get()).toBeNull();
    expect(classes.has("dragging-active")).toBe(false);
  });

  it("notifies subscribers on start, drop and end", async () => {
    const { dragState } = await import("./dragState");
    const fn = vi.fn();
    const unsub = dragState.subscribe(fn);
    const id = await startCard();
    dragState.drop();
    dragState.end(id);
    unsub();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("dragState pointer identity (fix pass D1)", () => {
  it("a drag started with a pointerId is owned by that pointer only", async () => {
    const { dragState } = await import("./dragState");
    dragState.start({ course, sourcePlacementId: "p1", startX: 0, startY: 0, pointerId: 7 });
    expect(dragState.ownsPointer(7)).toBe(true);
    expect(dragState.ownsPointer(8)).toBe(false);
  });

  it("bindPointer claims an unbound drag once; a later bind can't steal it", async () => {
    const { dragState } = await import("./dragState");
    await startCard(); // no pointerId (e.g. a caller that doesn't pass one)
    expect(dragState.ownsPointer(3)).toBe(true); // unbound: back-compat
    dragState.bindPointer(3);
    expect(dragState.get()?.pointerId).toBe(3);
    dragState.bindPointer(9);
    expect(dragState.get()?.pointerId).toBe(3);
    expect(dragState.ownsPointer(9)).toBe(false);
  });

  it("no drag → no pointer owns it, and bindPointer is a no-op", async () => {
    const { dragState } = await import("./dragState");
    dragState.bindPointer(1);
    expect(dragState.get()).toBeNull();
    expect(dragState.ownsPointer(1)).toBe(false);
  });
});

describe("measureLandedCard (fix pass D3)", () => {
  // A column of fake card elements in DOM order.
  // Columns are found by their time key (data-column-key, spec 042): semester
  // k is 2k, the short term before k is 2k − 1.
  const stubColumn = (ids: string[], sem = 3, shortTerm = false) => {
    const cards = ids.map((id, i) => ({
      dataset: { placement: id },
      getBoundingClientRect: () => ({ left: 100, top: 50 + i * 110, width: 216, height: 104 }),
    }));
    const col = { querySelectorAll: () => cards };
    const key = 2 * sem - (shortTerm ? 1 : 0);
    vi.stubGlobal("document", {
      body: { classList: { add: () => {}, remove: () => {} } },
      querySelector: (sel: string) => (sel === `[data-column-key="${key}"]` ? col : null),
      querySelectorAll: () => [],
    });
  };

  it("finds a short-term column by its own key, never its semester's (spec 042)", async () => {
    const { measureLandedCard } = await import("./dragState");
    stubColumn(["moved"], 3, true);
    expect(measureLandedCard("moved", { sem: 3, shortTerm: true, index: 0 })?.top).toBe(50);
    expect(measureLandedCard("moved", { sem: 3, index: 0 })).toBeNull();
  });

  it("returns the committed card's rect once it renders at the resolved index", async () => {
    const { measureLandedCard } = await import("./dragState");
    stubColumn(["a", "moved", "b"]);
    expect(measureLandedCard("moved", { sem: 3, index: 1 })).toEqual({
      left: 100,
      top: 160,
      width: 216,
      height: 104,
    });
  });

  it("an append index past the end matches the last card", async () => {
    const { measureLandedCard } = await import("./dragState");
    stubColumn(["a", "b", "moved"]);
    expect(measureLandedCard("moved", { sem: 3, index: 99 })?.top).toBe(270);
  });

  it("null while the DOM still shows the card at its old spot (commit not rendered yet)", async () => {
    const { measureLandedCard } = await import("./dragState");
    stubColumn(["moved", "a", "b"]);
    expect(measureLandedCard("moved", { sem: 3, index: 2 })).toBeNull();
    expect(measureLandedCard("missing", { sem: 3, index: 0 })).toBeNull();
    expect(measureLandedCard("moved", { sem: 5, index: 0 })).toBeNull();
  });
});

describe("hit-testing short-term columns (spec 042)", () => {
  // Fall (sem 1, key 2) at x 0..216 | Winter before sem 2 (key 3) at 256..472
  // | Spring (sem 2, key 4) at 512..728. Empty columns: index is always 0.
  class FakeEl {
    dataset: Record<string, string>;
    rect: { left: number; right: number; top: number; bottom: number };
    offsetWidth = 216;
    constructor(
      dataset: Record<string, string>,
      rect: { left: number; right: number; top: number; bottom: number }
    ) {
      this.dataset = dataset;
      this.rect = rect;
    }
    closest(sel: string) {
      return sel === "[data-canvas-scroll]" ? this : null;
    }
    getBoundingClientRect() {
      const r = this.rect;
      return { ...r, width: r.right - r.left, height: r.bottom - r.top };
    }
    querySelector() {
      return null;
    }
  }
  const stubBoard = () => {
    const box = (left: number) => ({ left, right: left + 216, top: 0, bottom: 600 });
    const cols = [
      new FakeEl({ columnKey: "2", column: "1" }, box(0)),
      new FakeEl({ columnKey: "3", shortTermBefore: "2" }, box(256)),
      new FakeEl({ columnKey: "4", column: "2" }, box(512)),
    ];
    const canvas = new FakeEl({}, { left: 0, right: 2000, top: 0, bottom: 600 });
    vi.stubGlobal("HTMLElement", FakeEl);
    vi.stubGlobal("document", {
      body: { classList: { add: () => {}, remove: () => {} } },
      querySelector: () => null,
      querySelectorAll: (sel: string) => (sel === "[data-column-key]" ? cols : []),
      elementsFromPoint: (x: number) => {
        const hit = cols.find((c) => {
          const r = c.getBoundingClientRect();
          return x >= r.left && x <= r.right;
        });
        return hit ? [hit, canvas] : [canvas];
      },
    });
  };
  const startAt = async (x: number) => {
    const { dragState } = await import("./dragState");
    dragState.start({ course, sourcePlacementId: null, startX: x, startY: 100 });
    return dragState.get()?.over ?? null;
  };

  it("a pointer over a short-term column targets that column, not its semester", async () => {
    stubBoard();
    expect(await startAt(300)).toEqual({ sem: 2, shortTerm: true, index: 0 });
  });

  it("regular columns stay regular targets", async () => {
    stubBoard();
    expect(await startAt(600)).toEqual({ sem: 2, shortTerm: false, index: 0 });
    const { dragState } = await import("./dragState");
    dragState.end();
    expect(await startAt(100)).toEqual({ sem: 1, shortTerm: false, index: 0 });
  });

  it("a pointer in the gap snaps to the nearest column, short term included", async () => {
    stubBoard();
    expect(await startAt(240)).toEqual({ sem: 2, shortTerm: true, index: 0 });
    const { dragState } = await import("./dragState");
    dragState.end();
    expect(await startAt(225)).toEqual({ sem: 1, shortTerm: false, index: 0 });
  });
});

describe("edgeScrollVelocity (fix pass D7)", () => {
  // Canvas spans x 0..1000, y 0..800; a drawer covers x ≥ 600.
  const inCanvas = (x: number, y: number) => x >= 0 && x < 600 && y >= 0 && y < 800;
  const EDGE = 56;
  const SPEED = 14;

  it("never scrolls while the pointer is over the drawer", async () => {
    const { edgeScrollVelocity, DISARMED_EDGES } = await import("./dragState");
    const v = edgeScrollVelocity(inCanvas, 700, 400, DISARMED_EDGES, EDGE, SPEED);
    expect([v.velX, v.velY]).toEqual([0, 0]);
  });

  it("a drag entering from the drawer doesn't scroll in the drawer-side zone until armed", async () => {
    const { edgeScrollVelocity, DISARMED_EDGES } = await import("./dragState");
    // First canvas sample is inside the right (drawer-side) zone: not armed.
    const first = edgeScrollVelocity(inCanvas, 580, 400, DISARMED_EDGES, EDGE, SPEED);
    expect(first.velX).toBe(0);
    // Into the interior: every edge arms.
    const mid = edgeScrollVelocity(inCanvas, 300, 400, first.armed, EDGE, SPEED);
    expect(mid.velX).toBe(0);
    expect(mid.armed.right).toBe(true);
    // Deliberately back to the drawer edge: now it scrolls right.
    const back = edgeScrollVelocity(inCanvas, 580, 400, mid.armed, EDGE, SPEED);
    expect(back.velX).toBe(SPEED);
  });

  it("an armed left / bottom edge scrolls toward that edge", async () => {
    const { edgeScrollVelocity, DISARMED_EDGES } = await import("./dragState");
    const armed = edgeScrollVelocity(inCanvas, 300, 400, DISARMED_EDGES, EDGE, SPEED).armed;
    const v = edgeScrollVelocity(inCanvas, 20, 780, armed, EDGE, SPEED);
    expect(v.velX).toBe(-SPEED);
    expect(v.velY).toBe(SPEED);
  });
});
