import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course } from "@/types/db";

/** Minimal EventTarget (Node's own mishandles removeEventListener(type, fn,
 *  true) for capture listeners). Capture flag is part of a listener's key. */
class FakeTarget {
  private ls: { type: string; fn: (e: Event) => void; capture: boolean }[] = [];
  addEventListener(type: string, fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions) {
    const capture = typeof opts === "boolean" ? opts : !!opts?.capture;
    if (!this.ls.some((l) => l.type === type && l.fn === fn && l.capture === capture)) {
      this.ls.push({ type, fn, capture });
    }
  }
  removeEventListener(type: string, fn: (e: Event) => void, opts?: boolean | EventListenerOptions) {
    const capture = typeof opts === "boolean" ? opts : !!opts?.capture;
    this.ls = this.ls.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture));
  }
  dispatchEvent(e: Event) {
    for (const l of this.ls.filter((x) => x.type === e.type)) l.fn(e);
    return !e.defaultPrevented;
  }
}

// Node test env: fake EventTargets stand in for document / window, so the
// post-drag listeners are exercised by actually dispatching events.
let doc: FakeTarget;
let win: FakeTarget;
beforeEach(() => {
  doc = Object.assign(new FakeTarget(), {
    body: { classList: { add: () => {}, remove: () => {} } },
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  win = Object.assign(new FakeTarget(), { getSelection: () => null });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
});
afterEach(async () => {
  const { dragState } = await import("@/lib/drag/dragState");
  dragState.end();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const course = { id: "CS-2110", subject: "CS", number: "2110" } as unknown as Course;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const pointer = (type: string, pointerId: number) =>
  Object.assign(new Event(type, { cancelable: true }), { pointerId });
/** Dispatch a click on window; true = it was swallowed. */
const clickSwallowed = () => {
  const ev = new Event("click", { cancelable: true });
  win.dispatchEvent(ev);
  return ev.defaultPrevented;
};
/** Dispatch a cancelable touchmove (on document by default); true = blocked. */
const touchmoveBlocked = (target: FakeTarget = doc) => {
  const ev = new Event("touchmove", { cancelable: true });
  target.dispatchEvent(ev);
  return ev.defaultPrevented;
};
const startDrag = async (pointerId = 1) => {
  const { dragState } = await import("@/lib/drag/dragState");
  return dragState.start({ course, sourcePlacementId: "p1", startX: 0, startY: 0, pointerId });
};

describe("suppressNextClick teardown (fix pass D1/D2)", () => {
  it("swallows the click after the drag's own release", async () => {
    const { suppressNextClick } = await import("./useDragSource");
    await startDrag(1);
    suppressNextClick(1);
    doc.dispatchEvent(pointer("pointerup", 1));
    expect(clickSwallowed()).toBe(true);
    expect(clickSwallowed()).toBe(false); // one-shot
  });

  it("a second finger lifting doesn't start the teardown", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { suppressNextClick } = await import("./useDragSource");
    await startDrag(1);
    suppressNextClick(1);
    doc.dispatchEvent(pointer("pointerup", 2));
    vi.advanceTimersByTime(100);
    expect(clickSwallowed()).toBe(true); // still armed for the real release
  });

  it("window blur tears it down — the next real click goes through (Alt-Tab mid-drag)", async () => {
    const { suppressNextClick } = await import("./useDragSource");
    await startDrag(1);
    suppressNextClick(1);
    win.dispatchEvent(new Event("blur"));
    expect(clickSwallowed()).toBe(false);
  });

  it("Esc-cancel while still pressed: the eventual release's click is still swallowed", async () => {
    const { dragState } = await import("@/lib/drag/dragState");
    const { suppressNextClick } = await import("./useDragSource");
    const id = await startDrag(1);
    suppressNextClick(1);
    dragState.cancel(); // Esc
    dragState.end(id); // ghost animation finished; the button is still held
    doc.dispatchEvent(pointer("pointerup", 1));
    expect(clickSwallowed()).toBe(true);
  });

  it("…but never past the backstop when no release ever comes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { dragState } = await import("@/lib/drag/dragState");
    const { suppressNextClick, POST_DRAG_MAX_MS } = await import("./useDragSource");
    const id = await startDrag(1);
    suppressNextClick(1);
    dragState.cancel();
    dragState.end(id);
    vi.advanceTimersByTime(POST_DRAG_MAX_MS);
    expect(clickSwallowed()).toBe(false);
  });

  it("backstop: removed POST_DRAG_MAX_MS after the drag stops dragging, even if it never ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { dragState } = await import("@/lib/drag/dragState");
    const { suppressNextClick, POST_DRAG_MAX_MS } = await import("./useDragSource");
    await startDrag(1);
    suppressNextClick(1);
    vi.advanceTimersByTime(10_000); // a long drag keeps it armed
    expect(clickSwallowed()).toBe(true); // still armed mid-drag (one-shot: re-arm below)
    suppressNextClick(1);
    // Simulate a session stuck in "dropping" (end() never observed).
    const real = dragState.get();
    const stuck = vi.spyOn(dragState, "get").mockReturnValue({ ...real!, phase: "dropping" });
    dragState.cancel(); // notifies → the watcher sees "dropping" → backstop armed
    vi.advanceTimersByTime(POST_DRAG_MAX_MS - 1);
    expect(stuck).toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(clickSwallowed()).toBe(false);
    stuck.mockRestore();
  });

  it("touch hold with no active drag releases right away", async () => {
    const { holdTouchGesture } = await import("./useDragSource");
    const target = new FakeTarget();
    holdTouchGesture(1, target as unknown as EventTarget);
    await flush();
    expect(touchmoveBlocked()).toBe(false);
    expect(touchmoveBlocked(target)).toBe(false);
  });
});

describe("holdTouchGesture teardown (fix pass D1/D2)", () => {
  it("blocks native scrolling until the drag's OWN finger lifts", async () => {
    const { holdTouchGesture } = await import("./useDragSource");
    await startDrag(5);
    holdTouchGesture(5);
    expect(touchmoveBlocked()).toBe(true);
    doc.dispatchEvent(pointer("pointerup", 6)); // a second finger
    expect(touchmoveBlocked()).toBe(true);
    doc.dispatchEvent(pointer("pointerup", 5));
    expect(touchmoveBlocked()).toBe(false);
  });

  it("releases on window blur", async () => {
    const { holdTouchGesture } = await import("./useDragSource");
    await startDrag(5);
    holdTouchGesture(5);
    win.dispatchEvent(new Event("blur"));
    expect(touchmoveBlocked()).toBe(false);
  });

  it("releases as soon as the drag stops dragging (e.g. cancelled) — scrolling can't stay frozen", async () => {
    const { dragState } = await import("@/lib/drag/dragState");
    const { holdTouchGesture } = await import("./useDragSource");
    await startDrag(5);
    holdTouchGesture(5);
    dragState.cancel();
    expect(touchmoveBlocked()).toBe(false);
  });
});

describe("pan guard (known issue U-4: touch drag stuck in its own column)", () => {
  it("blocks touchmoves on the touched node itself — it is detached mid-drag, so they never reach document", async () => {
    const { holdTouchGesture } = await import("./useDragSource");
    await startDrag(5);
    // A detached node: its events never propagate to `doc`.
    const touched = new FakeTarget();
    holdTouchGesture(5, touched as unknown as EventTarget);
    expect(touchmoveBlocked(touched)).toBe(true);
    doc.dispatchEvent(pointer("pointerup", 5));
    expect(touchmoveBlocked(touched)).toBe(false);
  });

  it("is registered before any touch starts, and inert until a press is held into a drag", async () => {
    const { holdTouchGesture, retainPanGuard } = await import("./useDragSource");
    const release = retainPanGuard();
    // Registered, non-passive, but a plain swipe is left to scroll natively.
    expect(touchmoveBlocked()).toBe(false);
    await startDrag(5);
    holdTouchGesture(5);
    expect(touchmoveBlocked()).toBe(true);
    doc.dispatchEvent(pointer("pointerup", 5));
    expect(touchmoveBlocked()).toBe(false);
    release();
  });

  it("is reference-counted: it stays registered until the last holder releases", async () => {
    const { retainPanGuard } = await import("./useDragSource");
    const add = vi.spyOn(doc, "addEventListener");
    const remove = vi.spyOn(doc, "removeEventListener");
    const a = retainPanGuard();
    const b = retainPanGuard();
    expect(add.mock.calls.filter(([type]) => type === "touchmove")).toHaveLength(1);
    expect(add.mock.calls.find(([type]) => type === "touchmove")?.[2]).toEqual({ passive: false });
    a();
    a(); // idempotent
    expect(remove.mock.calls.filter(([type]) => type === "touchmove")).toHaveLength(0);
    b();
    expect(remove.mock.calls.filter(([type]) => type === "touchmove")).toHaveLength(1);
  });
});
