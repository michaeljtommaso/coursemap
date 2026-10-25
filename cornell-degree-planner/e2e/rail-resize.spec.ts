import { expect, test, type Page } from "@playwright/test";
import { allCards, openBoard } from "./helpers";

/**
 * The left rail is resizable (its right edge, [data-rail-resize]): a real
 * mouse drag widens it, the width survives a reload, ←/→ and Home work from
 * the keyboard, and a double-click resets it to the default 224 px.
 */

const rail = (page: Page) => page.locator("aside").filter({ has: page.locator("[data-rail-resize]") });
const railWidth = async (page: Page) => Math.round((await rail(page).boundingBox())!.width);

test("the left rail resizes by drag and keyboard, persists, and resets", async ({ page }) => {
  await openBoard(page);
  const handle = page.locator("[data-rail-resize]");
  expect(await railWidth(page)).toBe(224);

  // Real stepped mouse drag, 120 px to the right.
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + i * 10, y);
  await page.mouse.up();
  expect(await railWidth(page)).toBe(344);
  await expect(handle).toHaveAttribute("aria-valuenow", "344");

  // Persists across a reload (a view preference, like zoom).
  await page.reload();
  await expect(allCards(page).first()).toBeVisible({ timeout: 45_000 });
  expect(await railWidth(page)).toBe(344);

  // Keyboard: ← takes 16 px; End and Home go to the bounds.
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  expect(await railWidth(page)).toBe(328);
  await page.keyboard.press("End");
  expect(await railWidth(page)).toBe(480);
  await page.screenshot({ path: "test-results/rail-resize-wide.png" });
  await page.keyboard.press("Home");
  expect(await railWidth(page)).toBe(224);

  // Double-click resets after a widen.
  await page.keyboard.press("End");
  await handle.dblclick();
  expect(await railWidth(page)).toBe(224);
});
