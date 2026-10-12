import { expect, test, type CDPSession, type Page } from "@playwright/test";
import {
  card,
  cardAt,
  columnPlacements,
  expectCardAt,
  expectDragCleared,
  gripPoint,
  insertionPoint,
  locate,
  observe,
  openBoard,
  type DragObservation,
  type Point,
} from "./helpers";

/**
 * Course board TOUCH regression suite (spec 014 §D3, known issue U-4).
 *
 * Runs at iPad-landscape size with touch enabled. Gestures are driven through
 * CDP `Input.dispatchTouchEvent`, so they enter Chromium's real input pipeline:
 * the browser hit-tests touch-action and touch-listener regions at touchstart,
 * may claim the gesture for native panning, and synthesizes touch pointer
 * events — exactly the path a finger takes. (page.touchscreen.tap only taps,
 * and synthetic dispatchEvent touches skip the input pipeline entirely.)
 *
 * The bug this guards: a long-press drag "stuck inside its own column" on an
 * iPad. The hold started the drag, but the first real movement became a
 * native pan: the browser fired pointercancel and the ghost sprang back home.
 * The touchmoves that should have been cancelled went to the node the finger
 * first landed on, which the card's placeholder face had just detached, so
 * they never reached the document-level blocker (see useDragSource's pan
 * guard). Chromium reproduces this; iOS Safari additionally needs the guard
 * registered before the touch begins.
 */

test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });

/** Longer than useDragSource's LONG_PRESS_MS (250ms), with margin. */
const HOLD_MS = 450;
/** Max px per touchmove step — a finger reports small increments. */
const STEP_PX = 8;
const STEP_DELAY_MS = 16;

type TouchGesture = {
  /** Snapshots taken during the move (every few steps) and after settling. */
  samples: DragObservation[];
  final: DragObservation;
  canvasScrollDelta: Point;
};

async function canvasScroll(page: Page): Promise<Point> {
  return page.evaluate(() => {
    const el = document.querySelector("[data-canvas-scroll]");
    return { x: el?.scrollLeft ?? 0, y: el?.scrollTop ?? 0 };
  });
}

async function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  p: Point
): Promise<void> {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(p.x), y: Math.round(p.y), id: 1 }],
  });
}

/**
 * One finger: press at `from`, optionally hold still for `holdMs`, slide to
 * `to` in small steps, settle, lift. Returns what was seen along the way.
 */
async function touchGesture(
  page: Page,
  from: Point,
  to: Point,
  { holdMs }: { holdMs: number }
): Promise<TouchGesture> {
  const cdp = await page.context().newCDPSession(page);
  const scroll0 = await canvasScroll(page);
  const samples: DragObservation[] = [];

  await touch(cdp, "touchStart", from);
  if (holdMs > 0) await page.waitForTimeout(holdMs);

  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / STEP_PX));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await touch(cdp, "touchMove", { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    await page.waitForTimeout(STEP_DELAY_MS);
    if (i % 10 === 0) samples.push(await observe(page));
  }
  await page.waitForTimeout(150);
  const final = await observe(page);
  samples.push(final);

  await touch(cdp, "touchEnd", to);
  const scroll1 = await canvasScroll(page);
  await cdp.detach();
  return { samples, final, canvasScrollDelta: { x: scroll1.x - scroll0.x, y: scroll1.y - scroll0.y } };
}

test.describe("course board — touch (iPad landscape)", () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
  });

  test("long-press drag carries a card two columns to the right", async ({ page }) => {
    const source = await cardAt(page, 1, 0);
    const targetSem = 3;
    const n = (await columnPlacements(page, targetSem)).length;

    // Measure both points before the gesture (measuring may scroll).
    const from = await gripPoint(card(page, source.placementId));
    const to = await insertionPoint(page, targetSem, n);
    expect(to.x - from.x, "the target column is to the right of the source").toBeGreaterThan(300);

    const drag = await touchGesture(page, from, to, { holdMs: HOLD_MS });

    expect(
      drag.samples.some((s) => s.ghostPresent && s.draggingActive),
      "the hold starts a drag (ghost + body.dragging-active)"
    ).toBe(true);
    expect(drag.final.outlineSem, "the insertion outline follows the finger to the target column").toBe(
      String(targetSem)
    );
    expect(drag.canvasScrollDelta.x, "the canvas does not pan under a held drag").toBe(0);

    await expectCardAt(page, source.placementId, targetSem, -1);
    await expectDragCleared(page);
  });

  test("a quick swipe on a card scrolls the canvas instead of dragging", async ({ page }) => {
    const source = await cardAt(page, 2, 0);
    const from = await gripPoint(card(page, source.placementId));
    // Finger moves left → the content scrolls right (scrollLeft grows).
    const to = { x: from.x - 320, y: from.y };

    const swipe = await touchGesture(page, from, to, { holdMs: 0 });

    expect(swipe.samples.some((s) => s.ghostPresent || s.draggingActive), "no drag starts").toBe(false);
    expect(swipe.canvasScrollDelta.x, "the canvas scrolls horizontally").toBeGreaterThan(100);
    expect(await locate(page, source.placementId), "the card stays where it was").toEqual({
      sem: 2,
      index: 0,
    });
  });
});
