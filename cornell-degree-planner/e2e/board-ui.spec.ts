import { expect, test } from "@playwright/test";
import {
  allCards,
  card,
  menuItem,
  openActionsByMouse,
  openBoard,
} from "./helpers";

/**
 * Board UI polish (polish plan C2 / C3). Runs against the emulator dev server
 * like the drag suite (see playwright.config.ts).
 */

const cluster = "[data-unlocks-cluster]";

test.describe("board UI polish", () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
  });

  test("C2: the unlocks suggestion cluster closes on Esc and returns on a new hover", async ({ page }) => {
    // Find a card whose hover shows a cluster (one that unlocks something not yet placed).
    const n = await allCards(page).count();
    let anchor: string | null = null;
    for (let i = 0; i < n && !anchor; i++) {
      const c = allCards(page).nth(i);
      await c.hover();
      if (await page.locator(cluster).first().isVisible({ timeout: 1_200 }).catch(() => false)) {
        anchor = await c.getAttribute("data-placement");
      }
    }
    test.skip(!anchor, "no placed course on this board unlocks an unplaced course");

    await page.keyboard.press("Escape");
    await expect(page.locator(cluster)).toHaveCount(0);

    // Leaving the card and hovering it again shows the cluster again.
    await page.mouse.move(1, 1);
    await card(page, anchor!).hover();
    await expect(page.locator(cluster).first()).toBeVisible();
  });

  test("C2: the cluster closes when a card's menu opens elsewhere", async ({ page }) => {
    const n = await allCards(page).count();
    let anchor: string | null = null;
    for (let i = 0; i < n && !anchor; i++) {
      const c = allCards(page).nth(i);
      await c.hover();
      if (await page.locator(cluster).first().isVisible({ timeout: 1_200 }).catch(() => false)) {
        anchor = await c.getAttribute("data-placement");
      }
    }
    test.skip(!anchor, "no placed course on this board unlocks an unplaced course");
    const other = await allCards(page)
      .evaluateAll((els, a) => els.map((e) => e.getAttribute("data-placement")).find((id) => id && id !== a) ?? null, anchor);
    test.skip(!other, "need a second card");

    await openActionsByMouse(page, other!);
    await expect(page.locator(cluster)).toHaveCount(0);
  });

  test("C3: menu labels name what the item will do", async ({ page }) => {
    const id = await allCards(page).first().getAttribute("data-placement");
    expect(id).toBeTruthy();

    await openActionsByMouse(page, id!);
    await menuItem(page, "Mark complete").click();
    await openActionsByMouse(page, id!);
    await expect(menuItem(page, "Mark incomplete")).toBeVisible();
    await page.keyboard.press("Escape");

    await openActionsByMouse(page, id!);
    await menuItem(page, "Mark incomplete").click();
    await openActionsByMouse(page, id!);
    await expect(menuItem(page, "Mark complete")).toBeVisible();
    await menuItem(page, "In progress").click();
    await openActionsByMouse(page, id!);
    await expect(menuItem(page, "Stop in progress")).toBeVisible();
  });
});
