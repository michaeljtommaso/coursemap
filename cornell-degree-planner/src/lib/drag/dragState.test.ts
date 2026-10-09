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
