import { expect, test, type Page } from "@playwright/test";
import {
  allCards,
  box,
  card,
  cardAt,
  clearSelection,
  column,
  columnCourses,
  columnPlacements,
  expectCardAt,
  expectDragCleared,
  findCatalogCourseNotOnBoard,
  firstCardIn,
  gripPoint,
  insertionPoint,
  menuItem,
  moveToItem,
  observe,
  openActionsByKeyboard,
  openActionsByMouse,
  openBoard,
  openCatalog,
  realDrag,
  setZoom,
  type CardRef,
  type DragResult,
} from "./helpers";

/**
 * Course board real-mouse regression suite — spec 014 "Testing" (items 1–8),
 * plus Remove → Undo (D8). Every test opens a fresh anonymous context and the
 * Computer Science, B.S. starting board, so tests are independent.
 *
 * Drags are stepped page.mouse gestures (see helpers.realDrag); the sweep
 * (docs/audits/2026-10-09-bug-sweep.md) showed these reproduce the real bugs.
 */

/** Pause between two consecutive drags — a human never re-grabs in < 300ms,
 *  and it lets the snap spring finish so the second drag is a fresh gesture. */
const BETWEEN_DRAGS_MS = 350;

/**
 * Pick the column to drop into "between two cards": prefer `preferred`, else
 * the first other column with at least `minCards` cards. Returns the sem and
 * the insertion index (1 = between card 0 and card 1; append when the
 * board has no column with two cards).
 */
async function pickBetweenTarget(page: Page, preferred: number, excludeSems: number[]) {
  const candidates = [preferred, 4, 5, 2, 6, 7, 8].filter((s) => !excludeSems.includes(s));
  for (const sem of candidates) {
    if ((await columnPlacements(page, sem)).length >= 2) return { sem, index: 1, between: true };
  }
  const n = (await columnPlacements(page, preferred)).length;
  return { sem: preferred, index: n, between: false };
}

// ------------------------------------------------------------- scenarios

/** a) card in column 1 → column 3 (or the nearest column with two cards), between two cards. */
async function cardToPosition(page: Page): Promise<{ source: CardRef; drag: DragResult; cardWidth: number }> {
  const source = await cardAt(page, 1, 0);
  const target = await pickBetweenTarget(page, 3, [1]);
  if (target.sem !== 3 || !target.between) {
    test.info().annotations.push({
      type: "board-shape",
      description: `column 3 had < 2 cards; dropping into column ${target.sem} at index ${target.index}`,
    });
  }

  const cardWidth = (await box(card(page, source.placementId), true)).width;
  const to = await insertionPoint(page, target.sem, target.index);
  const drag = await realDrag(page, card(page, source.placementId), to);

  expect(drag.everGhost, "ghost [data-drag-ghost] appears mid-drag").toBe(true);
  expect(drag.everDraggingActive, "body.dragging-active mid-drag").toBe(true);
  expect(drag.final.outlineSem, "insertion outline in the target column").toBe(String(target.sem));
  expect(drag.final.outlineIndex, "insertion outline at the target index").toBe(String(target.index));

  await expectCardAt(page, source.placementId, target.sem, target.index);
  await expect(column(page, 1).locator(`[data-placement="${source.placementId}"]`)).toHaveCount(0);
  await expectDragCleared(page);
  return { source, drag, cardWidth };
}

/** c) the SAME card moved twice in a row (sweep D3 "works once then locked"). */
async function sameCardTwice(page: Page): Promise<CardRef> {
  const x = await cardAt(page, 1, 0);

  const n3 = (await columnPlacements(page, 3)).length;
  const drag1 = await realDrag(page, card(page, x.placementId), await insertionPoint(page, 3, n3));
  expect(drag1.everGhost, "first drag shows the ghost").toBe(true);
  expect(drag1.final.outlineSem).toBe("3");
  await expectCardAt(page, x.placementId, 3, n3);
  await expectDragCleared(page);

  await page.waitForTimeout(BETWEEN_DRAGS_MS);

  const n4 = (await columnPlacements(page, 4)).length;
  const drag2 = await realDrag(page, card(page, x.placementId), await insertionPoint(page, 4, n4));
  expect(drag2.everGhost, "second drag of the same card shows the ghost").toBe(true);
  expect(drag2.final.outlineSem).toBe("4");
  await expectCardAt(page, x.placementId, 4, n4);
  await expect(column(page, 3).locator(`[data-placement="${x.placementId}"]`)).toHaveCount(0);
  await expectDragCleared(page);
  return x;
}

// ----------------------------------------------------------------- tests

test.describe("course board — real-mouse drag (spec 014)", () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
  });

  test("a) card moves to a different column at a specific position", async ({ page }) => {
    await cardToPosition(page);
  });

  test("b) catalog row drops into a column position", async ({ page }) => {
    await openCatalog(page);
    const { courseId, row } = await findCatalogCourseNotOnBoard(page, ["CS 47", "CS 48", "AEM 1", "PHIL 1"]);
    const sem = 2;
    const before = (await columnPlacements(page, sem)).length;
    await expect(column(page, sem).locator(`[data-course="${courseId}"]`)).toHaveCount(0);

    const to = await insertionPoint(page, sem, 0);
    const drag = await realDrag(page, row, to, { steps: 30 });

    expect(drag.everGhost, "catalog drag shows the ghost (sweep D4)").toBe(true);
    expect(drag.everDraggingActive).toBe(true);
    expect(drag.final.outlineSem).toBe(String(sem));
    expect(drag.final.outlineIndex).toBe("0");

    await expect(column(page, sem).locator(`[data-placement][data-course="${courseId}"]`)).toHaveCount(1);
    await expect.poll(async () => (await columnCourses(page, sem))[0]).toBe(courseId);
    await expect.poll(async () => (await columnPlacements(page, sem)).length).toBe(before + 1);
    await expectDragCleared(page);
  });

  test("c) the same card moves twice in a row (sweep D3)", async ({ page }) => {
    await sameCardTwice(page);
  });

  test("d) a different card still moves after a repeated move", async ({ page }) => {
    const x = await sameCardTwice(page);
    await page.waitForTimeout(BETWEEN_DRAGS_MS);

    const y = await firstCardIn(page, [1, 2, 3], [x.placementId]);
    const targetSem = y.sem === 5 ? 6 : 5;
    const n = (await columnPlacements(page, targetSem)).length;
    const drag = await realDrag(page, card(page, y.placementId), await insertionPoint(page, targetSem, n));
    expect(drag.everGhost).toBe(true);
    expect(drag.final.outlineSem).toBe(String(targetSem));
    await expectCardAt(page, y.placementId, targetSem, n);
    await expectDragCleared(page);
  });

  test("e) a sub-threshold press opens course details and does not move the card", async ({ page }) => {
    const c = await cardAt(page, 1, 0);
    const p = await gripPoint(card(page, c.placementId));

    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 1, p.y + 1);
    await page.waitForTimeout(16);
    await page.mouse.move(p.x + 2.5, p.y + 1.5); // total travel < 4px
    await page.waitForTimeout(16);
    const mid = await observe(page);
    await page.mouse.up();

    expect(mid.draggingActive, "no drag below the threshold").toBe(false);
    // Course detail panel (CourseDetailPanel.tsx: role="dialog", "<SUBJ> <NUM> details")
    // — not part of the 014 contract; see the suite notes.
    await expect(page.getByRole("dialog", { name: /details$/i })).toBeVisible();
    await expectCardAt(page, c.placementId, 1, 0);
    await expectDragCleared(page);
  });

  test("f) pressing and dragging never selects text (canvas space and card title)", async ({ page }) => {
    // 1. Empty canvas space: the 40px gap between columns 1 and 2.
    const c1 = await box(column(page, 1), true);
    const c2 = await box(column(page, 2));
    const gap = { x: (c1.x + c1.width + c2.x) / 2, y: c1.y + Math.min(c1.height * 0.3, 260) };
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return { onCard: !!el?.closest("[data-placement]"), onControl: !!el?.closest("button,a,input,select") };
    }, gap);
    expect(hit.onCard || hit.onControl, "gap press point must be empty canvas").toBe(false);

    await clearSelection(page);
    const canvasDrag = await realDrag(page, gap, { x: gap.x + 380, y: gap.y + 140 }, { steps: 25, stepDelayMs: 25 });
    expect(canvasDrag.anySelection, "no selection while dragging across the canvas").toBe("");
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

    // 2. Press on a card title (upper-left text area of the card) and drag.
    await clearSelection(page);
    const c = await cardAt(page, 1, 0);
    const start = await gripPoint(card(page, c.placementId));
    const titleDrag = await realDrag(page, card(page, c.placementId), { x: start.x + 70, y: start.y + 10 }, {
      steps: 20,
      stepDelayMs: 25,
      startAt: start,
    });
    expect(titleDrag.anySelection, "no selection while dragging from a card title").toBe("");
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    await expectDragCleared(page);
  });

  test.describe("at 55% zoom", () => {
    test.beforeEach(async ({ page }) => {
      await setZoom(page, "55%");
    });

    test("g1) card → column position at 55%, ghost rendered at card scale", async ({ page }) => {
      const { drag, cardWidth } = await cardToPosition(page);
      const ghostWidths = drag.samples.map((s) => s.ghostWidth).filter((w): w is number => w !== null && w > 0);
      expect(ghostWidths.length, "ghost measured mid-drag").toBeGreaterThan(0);
      // Use the settled (final) width when present — the velocity tilt can widen
      // the box mid-flight; fall back to the last sample.
      const ghostWidth = drag.final.ghostWidth ?? ghostWidths[ghostWidths.length - 1];
      expect(ghostWidth, `ghost ${ghostWidth}px vs card ${cardWidth}px`).toBeGreaterThanOrEqual(cardWidth * 0.85);
      expect(ghostWidth, `ghost ${ghostWidth}px vs card ${cardWidth}px`).toBeLessThanOrEqual(cardWidth * 1.15);
    });

    test("g2) the same card moves twice in a row at 55%", async ({ page }) => {
      await sameCardTwice(page);
    });
  });

  test("h) keyboard: Course actions → Move to… → semester puts the card at the bottom", async ({ page }) => {
    const c = await cardAt(page, 1, 0);
    const targetSem = 5;

    await openActionsByKeyboard(page, c.placementId);

    const moveTo = moveToItem(page);
    await expect(moveTo).toBeVisible();
    await moveTo.focus();
    await page.keyboard.press("Enter");

    // Move-to view: "Back", "Top of this column", then [data-move-sem] options;
    // a semester option moves the card to the BOTTOM of that column.
    await expect(page.getByRole("menuitem", { name: "Top of this column" })).toBeVisible();
    const option = page.locator(`[data-move-sem="${targetSem}"]`);
    await expect(option).toBeVisible();
    await option.focus();
    await page.keyboard.press("Enter");

    await expectCardAt(page, c.placementId, targetSem, -1);
    await expect(column(page, 1).locator(`[data-placement="${c.placementId}"]`)).toHaveCount(0);
  });

  test("i) Remove from board → Undo restores the card in the same column and position", async ({ page }) => {
    // Prefer a middle card so "same position" is a real check.
    let sem = 1;
    for (const s of [1, 2, 3, 4]) {
      if ((await columnPlacements(page, s)).length >= 2) {
        sem = s;
        break;
      }
    }
    const before = await columnCourses(page, sem);
    const index = before.length >= 2 ? 1 : 0;
    const c = await cardAt(page, sem, index);

    await openActionsByMouse(page, c.placementId);
    await menuItem(page, "Remove from board").click();

    await expect(card(page, c.placementId)).toHaveCount(0);
    await expect.poll(async () => (await columnCourses(page, sem)).length).toBe(before.length - 1);

    // Undo lives in the toast (PlanProvider removePlacement → actionLabel "Undo").
    await page.getByRole("button", { name: "Undo", exact: true }).click();

    // Undo may restore the same placement id or a new one; assert by course + position.
    await expect.poll(async () => columnCourses(page, sem)).toEqual(before);
  });
});

test.describe("board chrome — spec 014 contract smoke (lane B)", () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
  });

  test("Still-needed panel, its sort toggles, and the Legend button render", async ({ page }) => {
    const panel = page.locator("[data-still-needed]");
    await expect(panel).toBeVisible();
    const items = panel.locator("[data-requirement][data-status]");
    await expect.poll(async () => items.count()).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "By category" })).toBeVisible();
    await expect(page.getByRole("button", { name: "By semester" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Legend" })).toBeVisible();
    // Sanity: the board itself rendered alongside.
    expect(await allCards(page).count()).toBeGreaterThan(0);
  });
});
