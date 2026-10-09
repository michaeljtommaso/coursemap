import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Helpers for the real-mouse board suite (spec 014 "Testing").
 *
 * Everything here targets the spec 014 DOM contract:
 *   card            [data-placement="<placementId>"][data-course="<courseId>"]
 *   column          [data-column="<sem>"]
 *   drop outline    [data-drop-outline][data-drop-sem][data-drop-index]
 *   ghost           [data-drag-ghost]; body.dragging-active while dragging
 *   catalog row     [data-catalog-course="<courseId>"]
 *   card menu       button "Course actions" → "Mark complete" / "In progress" /
 *                   "Move to…" / "Remove from board"; options [data-move-sem]
 *
 * Drags are REAL stepped page.mouse gestures: mouse.down → many small
 * mouse.move calls with short waits → mouse.up. Per the July drag audit
 * (docs/audits/2026-07-12-drag-system-audit.md) this reproduces real drags in
 * this app; synthetic dispatchEvent drags do not, so never use them here.
 */

export const PROGRAM_NAME = "Computer Science, B.S.";

export type Point = { x: number; y: number };

export type DragObservation = {
  ghostPresent: boolean;
  /** Rendered (post-transform) width of [data-drag-ghost], or null. */
  ghostWidth: number | null;
  draggingActive: boolean;
  outlineSem: string | null;
  outlineIndex: string | null;
  selection: string;
};

export type DragResult = {
  start: Point;
  end: Point;
  /** Observations sampled during the drag (every few steps). */
  samples: DragObservation[];
  /** Observation taken after the pointer settled at `end`, just before mouse.up. */
  final: DragObservation;
  everGhost: boolean;
  everDraggingActive: boolean;
  /** Longest non-empty text selection seen at any sample ("" if none). */
  anySelection: string;
};

export type CardRef = { placementId: string; courseId: string; sem: number; index: number };

// ---------------------------------------------------------------- locators

export const cardSel = (placementId: string) => `[data-placement="${placementId}"]`;
export const columnSel = (sem: number) => `[data-column="${sem}"]`;

export function card(page: Page, placementId: string): Locator {
  return page.locator(cardSel(placementId));
}

export function column(page: Page, sem: number): Locator {
  return page.locator(columnSel(sem));
}

export function allCards(page: Page): Locator {
  return page.locator("[data-placement][data-course]");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ------------------------------------------------------------------- setup

/**
 * Open the app as a fresh anonymous user and land on the Computer Science
 * board. Handles the first-run picker (FirstRun.tsx: "I know my major" →
 * program card → year step → credit step) and, when a program is already
 * selected, the top-bar Program dropdown (#program-select).
 */
export async function openBoard(page: Page): Promise<void> {
  await page.goto("/");
  // Fail fast and legibly when E2E_BASE_URL points at some other dev server
  // (5173 is a busy port on this machine).
  await expect(page, "E2E_BASE_URL must serve Coursemap (index.html <title> starts with \"Coursemap\")").toHaveTitle(
    /Coursemap/,
    { timeout: 15_000 }
  );

  const knownDoor = page.getByRole("button", { name: /I know my major/ });
  const programSelect = page.locator("#program-select");
  const anyCard = allCards(page).first();

  await expect(knownDoor.or(programSelect).or(anyCard).first()).toBeVisible({ timeout: 45_000 });

  if (await knownDoor.isVisible()) {
    await knownDoor.click();
    await page
      .getByRole("button", { name: new RegExp(escapeRegExp(PROGRAM_NAME)) })
      .first()
      .click();

    // Year step and credit step only show for a brand-new user; both are
    // skippable. Either may be absent, so wait for "whatever comes next".
    const later = page.getByRole("button", { name: "I'll add this later" });
    const skip = page.getByRole("button", { name: "Skip for now" });
    await expect(later.or(skip).or(anyCard).first()).toBeVisible({ timeout: 20_000 });
    if (await later.isVisible()) await later.click();
    await expect(skip.or(anyCard).first()).toBeVisible({ timeout: 20_000 });
    if (await skip.isVisible()) await skip.click();
  } else if (await programSelect.isVisible()) {
    const current = await programSelect.evaluate(
      (el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? ""
    );
    if (current !== PROGRAM_NAME) await programSelect.selectOption({ label: PROGRAM_NAME });
  }

  await expect(anyCard).toBeVisible({ timeout: 45_000 });
  await waitForStableBoard(page);
}

/** Wait until the set of placements stops changing (plan load + first save). */
export async function waitForStableBoard(page: Page, quietMs = 600, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = await boardSignature(page);
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await page.waitForTimeout(150);
    const next = await boardSignature(page);
    if (next !== last) {
      last = next;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= quietMs) {
      return;
    }
  }
}

async function boardSignature(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-column]"))
      .map(
        (col) =>
          `${col.getAttribute("data-column")}:` +
          Array.from(col.querySelectorAll("[data-placement][data-course]"))
            .map((c) => c.getAttribute("data-placement"))
            .join(",")
      )
      .join("|")
  );
}

/** Click a zoom preset ("100%" / "85%" / "70%" / "55%") in the bottom-right control. */
export async function setZoom(page: Page, label: "100%" | "85%" | "70%" | "55%"): Promise<void> {
  const btn = page.getByRole("button", { name: label, exact: true });
  try {
    await btn.click({ timeout: 4_000 });
  } catch {
    // Sweep bug Z1: the collapsed right panel's invisible container can sit
    // over the 55%/70% buttons, so a centre click is intercepted. Click the
    // button's left edge instead (the sweep's documented workaround) so the
    // drag tests still run; the zoom assertion below still has to hold.
    const box = await btn.boundingBox();
    if (!box) throw new Error(`zoom button ${label} has no box`);
    await page.mouse.click(box.x + 3, box.y + box.height / 2);
  }
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  // Let the zoomed layout settle before measuring anything.
  await page.waitForTimeout(250);
}

// ------------------------------------------------------------- board reads

/** Placement ids in a column, top to bottom (DOM order). */
export async function columnPlacements(page: Page, sem: number): Promise<string[]> {
  return page.evaluate(
    (s) =>
      Array.from(
        document.querySelectorAll(`[data-column="${s}"] [data-placement][data-course]`)
      ).map((el) => el.getAttribute("data-placement") ?? ""),
    sem
  );
}

/** Course ids in a column, top to bottom (DOM order). */
export async function columnCourses(page: Page, sem: number): Promise<string[]> {
  return page.evaluate(
    (s) =>
      Array.from(
        document.querySelectorAll(`[data-column="${s}"] [data-placement][data-course]`)
      ).map((el) => el.getAttribute("data-course") ?? ""),
    sem
  );
}

/** Every semester number that has a [data-column] on the board. */
export async function boardSems(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-column]"))
      .map((el) => Number(el.getAttribute("data-column")))
      .filter((n) => Number.isFinite(n))
  );
}

/** Where a placement sits now: {sem, index}, or null when it isn't on the board. */
export async function locate(page: Page, placementId: string): Promise<{ sem: number; index: number } | null> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-placement="${id}"]`);
    const col = el?.closest("[data-column]");
    if (!el || !col) return null;
    const cards = Array.from(col.querySelectorAll("[data-placement][data-course]"));
    return { sem: Number(col.getAttribute("data-column")), index: cards.indexOf(el) };
  }, placementId);
}

/** The card at `index` of column `sem` (index -1 = last). */
export async function cardAt(page: Page, sem: number, index = 0): Promise<CardRef> {
  const ids = await columnPlacements(page, sem);
  const i = index < 0 ? ids.length + index : index;
  const placementId = ids[i];
  if (!placementId) throw new Error(`column ${sem} has no card at index ${index} (has ${ids.length})`);
  const courseId = (await card(page, placementId).getAttribute("data-course")) ?? "";
  return { placementId, courseId, sem, index: i };
}

/** First card found scanning the given columns in order, skipping `exclude` placement ids. */
export async function firstCardIn(page: Page, sems: number[], exclude: string[] = []): Promise<CardRef> {
  for (const sem of sems) {
    const ids = await columnPlacements(page, sem);
    const i = ids.findIndex((id) => !exclude.includes(id));
    if (i >= 0) return cardAt(page, sem, i);
  }
  throw new Error(`no card in columns ${sems.join(",")} (excluding ${exclude.join(",") || "none"})`);
}

/** Assert (polling) that a placement sits in column `sem` at `index` (-1 = last). */
export async function expectCardAt(page: Page, placementId: string, sem: number, index: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const at = await locate(page, placementId);
        if (!at) return "missing";
        if (index === -1) {
          const n = (await columnPlacements(page, sem)).length;
          return at.sem === sem && at.index === n - 1 ? "ok" : `sem ${at.sem} index ${at.index}/${n}`;
        }
        return at.sem === sem && at.index === index ? "ok" : `sem ${at.sem} index ${at.index}`;
      },
      { message: `card ${placementId} should be in column ${sem} at index ${index}`, timeout: 7_000 }
    )
    .toBe("ok");
}

// ---------------------------------------------------------------- geometry

export type Box = { x: number; y: number; width: number; height: number };

/** Rendered box of an element. Scrolls it into view first only when asked
 *  (scrolling between measuring two points would invalidate the first). */
export async function box(locator: Locator, scroll = false): Promise<Box> {
  if (scroll) await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no bounding box (not rendered?)");
  return b;
}

/**
 * The point to PRESS on a card: in its upper-left text area (course code /
 * title), clear of the bottom-right corner pill that holds the "Course
 * actions" trigger and the status buttons.
 */
export async function gripPoint(locator: Locator): Promise<Point> {
  const b = await box(locator, true);
  return { x: b.x + b.width * 0.35, y: b.y + Math.min(b.height * 0.35, 22) };
}

/**
 * The pointer position that should make column `sem` show its insertion
 * outline at `index`:
 *   - 0 < index < n: midway through the gap between card index-1 and card index;
 *   - index 0 (non-empty column): upper quarter of the first card;
 *   - index n (append): just below the last card (the column's empty space);
 *   - empty column: a fifth of the way down the column body.
 * Measured live, so it works at any zoom.
 *
 * Index semantics (lane A): the outline's data-drop-index is the index AFTER
 * the dragged card is removed from its own column (same as movePlacement).
 * For a cross-column move that equals the visual index used here; a
 * same-column reorder below the card's own position needs index - 1.
 */
export async function insertionPoint(page: Page, sem: number, index: number): Promise<Point> {
  const col = column(page, sem);
  let colBox = await box(col);
  const vp = page.viewportSize();
  if (vp && (colBox.x < 0 || colBox.x + colBox.width > vp.width)) {
    await col.scrollIntoViewIfNeeded();
    colBox = await box(col);
  }
  const cards = col.locator("[data-placement][data-course]");
  const n = await cards.count();
  const x = colBox.x + colBox.width / 2;
  if (n === 0) return { x, y: colBox.y + Math.max(40, colBox.height * 0.2) };
  if (index <= 0) {
    const first = await box(cards.nth(0));
    return { x, y: first.y + first.height * 0.25 };
  }
  if (index >= n) {
    const last = await box(cards.nth(n - 1));
    return { x, y: last.y + last.height + Math.max(8, last.height * 0.3) };
  }
  const above = await box(cards.nth(index - 1));
  const below = await box(cards.nth(index));
  return { x, y: (above.y + above.height + below.y) / 2 };
}

// -------------------------------------------------------------------- drag

/** One snapshot of the drag-relevant DOM state. */
export async function observe(page: Page): Promise<DragObservation> {
  return page.evaluate(() => {
    const ghost = document.querySelector("[data-drag-ghost]");
    const outline = document.querySelector("[data-drop-outline]");
    return {
      ghostPresent: !!ghost,
      ghostWidth: ghost ? ghost.getBoundingClientRect().width : null,
      draggingActive: document.body.classList.contains("dragging-active"),
      outlineSem: outline?.getAttribute("data-drop-sem") ?? null,
      outlineIndex: outline?.getAttribute("data-drop-index") ?? null,
      selection: window.getSelection()?.toString() ?? "",
    };
  });
}

export async function clearSelection(page: Page): Promise<void> {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
}

export type RealDragOptions = {
  /** Number of mouse.move steps between start and end (default 20). */
  steps?: number;
  /** Pause after each step, ms (default 16 — about one frame). */
  stepDelayMs?: number;
  /** Sample the DOM every N steps (default 5; the last step is always sampled). */
  sampleEvery?: number;
  /** Pause at the end point before observing + releasing (default 150ms). */
  settleMs?: number;
  /** Override the press point (default: gripPoint of the locator). */
  startAt?: Point;
};

/**
 * A real, stepped mouse drag: move to the start, press, walk to `to` in small
 * steps with tiny waits, settle, observe, release. Returns what was seen
 * mid-drag (ghost present, body.dragging-active, outline sem/index) so tests
 * can assert on the in-flight state as well as the result.
 */
export async function realDrag(
  page: Page,
  from: Locator | Point,
  to: Point,
  { steps = 20, stepDelayMs = 16, sampleEvery = 5, settleMs = 150, startAt }: RealDragOptions = {}
): Promise<DragResult> {
  const start: Point = startAt ?? ("x" in from ? from : await gripPoint(from));
  const samples: DragObservation[] = [];

  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(30);
  await page.mouse.down();
  await page.waitForTimeout(30);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(start.x + (to.x - start.x) * t, start.y + (to.y - start.y) * t);
    await page.waitForTimeout(stepDelayMs);
    if (i % sampleEvery === 0 || i === steps) samples.push(await observe(page));
  }

  // Hold still at the target so the outline / spring settle, then a final
  // nudge of 1px and back so a "hover resolves on move" engine sees the end
  // point twice.
  await page.waitForTimeout(settleMs);
  await page.mouse.move(to.x + 1, to.y);
  await page.mouse.move(to.x, to.y);
  await page.waitForTimeout(60);
  const final = await observe(page);
  samples.push(final);

  await page.mouse.up();

  return {
    start,
    end: to,
    samples,
    final,
    everGhost: samples.some((s) => s.ghostPresent),
    everDraggingActive: samples.some((s) => s.draggingActive),
    anySelection: samples.reduce((acc, s) => (s.selection.length > acc.length ? s.selection : acc), ""),
  };
}

/** After a drop: the ghost and dragging-active must clear (no stuck state).
 *  body.dragging-active deliberately stays on through the drop animation
 *  (~260–360ms, max 1.2s per lane A), so this polls rather than checks once. */
export async function expectDragCleared(page: Page): Promise<void> {
  await expect(page.locator("body")).not.toHaveClass(/(^|\s)dragging-active(\s|$)/, { timeout: 5_000 });
  await expect(page.locator("[data-drag-ghost]")).toHaveCount(0, { timeout: 5_000 });
}

// -------------------------------------------------------------- card menu

/**
 * Card menu (lane A): role="menuitem", named exactly "Mark complete",
 * "In progress", "Move to…" (real ellipsis), "Remove from board" — names do
 * not change when toggled on. The Move-to view then shows "Back", "Top of
 * this column", and one option per semester ([data-move-sem]); a semester
 * option puts the card at the BOTTOM of that column.
 */
export type MenuItemName = "Mark complete" | "In progress" | "Move to…" | "Remove from board";

export function menuItem(page: Page, name: MenuItemName): Locator {
  return page.getByRole("menuitem", { name, exact: true });
}

export function moveToItem(page: Page): Locator {
  return menuItem(page, "Move to…");
}

/** The card's "Course actions" trigger. It lives in the bottom-right corner
 *  pill and is invisible/unclickable until the card is hovered or focused. */
export function actionsTrigger(page: Page, placementId: string): Locator {
  return card(page, placementId).getByRole("button", { name: "Course actions" });
}

/** Mouse path: hover the card so the corner pill shows, then click the trigger. */
export async function openActionsByMouse(page: Page, placementId: string): Promise<void> {
  const c = card(page, placementId);
  await c.scrollIntoViewIfNeeded();
  await c.hover();
  const trigger = actionsTrigger(page, placementId);
  await expect(trigger).toBeVisible();
  await trigger.click();
}

/**
 * Keyboard path: focus the card (which reveals the pill), move focus to the
 * trigger — directly if it is focusable, else by Tab from the card — then
 * press Enter. Throws if the trigger can't be reached within a few Tabs.
 */
export async function openActionsByKeyboard(page: Page, placementId: string): Promise<void> {
  const c = card(page, placementId);
  const trigger = actionsTrigger(page, placementId);
  await c.scrollIntoViewIfNeeded();
  await c.focus();
  const isFocused = () => trigger.evaluate((el) => el === document.activeElement).catch(() => false);
  if (!(await isFocused())) await trigger.focus().catch(() => undefined);
  for (let i = 0; i < 6 && !(await isFocused()); i++) await page.keyboard.press("Tab");
  expect(await isFocused(), "keyboard focus reaches the Course actions trigger").toBe(true);
  await page.keyboard.press("Enter");
}

// ---------------------------------------------------------------- catalog

/** Open the right panel on its Catalog tab. */
export async function openCatalog(page: Page): Promise<void> {
  const tab = page.getByRole("tab", { name: "Catalog" });
  if (!(await tab.isVisible())) {
    await page.getByRole("button", { name: "Open the catalog and majors panel" }).click();
  }
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/**
 * Search the catalog and return the first visible row whose course is not on
 * the board. Tries each query in turn.
 */
export async function findCatalogCourseNotOnBoard(
  page: Page,
  queries: string[]
): Promise<{ courseId: string; row: Locator }> {
  const onBoard = new Set(
    await allCards(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-course") ?? ""))
  );
  // The catalog search box (CourseCatalog.tsx) — not part of the 014 contract.
  const search = page.getByPlaceholder(/CS 1110/);
  for (const q of queries) {
    await search.fill(q);
    await page.waitForTimeout(400);
    const rows = page.locator("[data-catalog-course]");
    await rows.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    const ids = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-catalog-course") ?? ""));
    const pick = ids.find((id) => id && !onBoard.has(id));
    if (pick) {
      const row = page.locator(`[data-catalog-course="${pick}"]`).first();
      await row.scrollIntoViewIfNeeded();
      return { courseId: pick, row };
    }
  }
  throw new Error(`no catalog course off the board for queries: ${queries.join(", ")}`);
}
