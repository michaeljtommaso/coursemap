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

  test("card density: Compact hides the detail rows, a click opens the detail, the choice survives reload", async ({ page }) => {
    const density = page.getByRole("group", { name: "Card detail" });
    await expect(density.getByRole("button", { name: "Detailed" })).toHaveAttribute("aria-pressed", "true");
    const id = (await allCards(page).first().getAttribute("data-placement"))!;
    await expect(card(page, id)).toContainText("PRE");
    const detailedHeight = (await card(page, id).boundingBox())!.height;

    await density.getByRole("button", { name: "Compact" }).click();
    const c = card(page, id);
    await expect(c).toHaveAttribute("data-density", "compact");
    await expect(c.locator("[data-attribution]")).toHaveCount(0);
    await expect(c).not.toContainText("PRE");
    expect((await c.boundingBox())!.height).toBeLessThan(detailedHeight);
    // Every compact card is short: one-line title and status, no extra rows.
    const heights = await allCards(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(Math.max(...heights)).toBeLessThanOrEqual(84);

    // Clicking the compact card opens the detail panel, which carries the rest.
    await c.click({ position: { x: 20, y: 20 } });
    await expect(page.getByRole("button", { name: "Close course details" })).toBeVisible();
    await expect(page.getByText("Prerequisites", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close course details" }).click();

    await page.reload();
    await expect(card(page, id)).toHaveAttribute("data-density", "compact");
    await page.getByRole("group", { name: "Card detail" }).getByRole("button", { name: "Detailed" }).click();
    await expect(card(page, id)).toHaveAttribute("data-density", "detailed");
  });

  test("top bar: the selected major's flowchart and Cornell page open in a new tab", async ({ page }) => {
    const flowchart = page.getByRole("link", { name: "Flowchart" });
    const majorPage = page.getByRole("link", { name: "Major page" });
    await expect(flowchart).toHaveAttribute("href", /duffield\.cornell\.edu\/.*Comp-Sci-CS\.jpg$/);
    await expect(flowchart).toHaveAttribute("target", "_blank");
    await expect(majorPage).toHaveAttribute("href", "https://www.cs.cornell.edu/bachelor-science-computer-science");

    // The links follow the switcher; a CALS major has a page but no flowchart.
    await page.locator("#program-select").selectOption({ label: "Communication, B.S." });
    await expect(majorPage).toHaveAttribute("href", /cals\.cornell\.edu\/communication/);
    await expect(flowchart).toHaveCount(0);
  });

  test("top bar: still fits a 1280px laptop with the major links (icons only)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("link", { name: "Flowchart" })).toBeVisible();
    const theme = (await page.getByRole("button", { name: "Toggle theme" }).boundingBox())!;
    expect(theme.x + theme.width).toBeLessThanOrEqual(1280);
    // The brand isn't overlapped by the controls, even for the longest major name.
    await page.locator("#program-select").selectOption({ label: "Information Science, Systems, and Technology, B.S." });
    const brand = (await page.locator("h1").first().boundingBox())!;
    const select = (await page.locator("#program-select").boundingBox())!;
    expect(brand.x + brand.width).toBeLessThanOrEqual(select.x);
  });

  test("corner pill: the in-progress button is a steady, full-size target", async ({ page }) => {
    const id = await allCards(page).first().getAttribute("data-placement");
    expect(id).toBeTruthy();
    const c = card(page, id!);
    await c.scrollIntoViewIfNeeded();
    const box = (await c.boundingBox())!;

    // Move to the bottom-right corner, where the resting "⋯" pill sits — the
    // way a student reaches for the actions.
    await page.mouse.move(box.x + box.width - 14, box.y + box.height - 12, { steps: 4 });
    const inProgress = c.getByRole("button", { name: "Mark as currently taking" });
    await expect(inProgress).toBeVisible();

    // The button must not slide while the pill widens: where it is shortly
    // after the hover is where it stays.
    await page.waitForTimeout(90);
    const early = (await inProgress.boundingBox())!;
    await page.waitForTimeout(400);
    const settled = (await inProgress.boundingBox())!;
    expect(Math.abs(settled.x - early.x), "in-progress button slides while the pill opens").toBeLessThan(1);

    // At least a 24×24 target (WCAG 2.5.8), and nothing else covers its centre.
    expect(settled.width).toBeGreaterThanOrEqual(24);
    expect(settled.height).toBeGreaterThanOrEqual(24);
    const cx = settled.x + settled.width / 2;
    const cy = settled.y + settled.height / 2;
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label") ?? null,
      [cx, cy]
    );
    expect(hit).toBe("Mark as currently taking");

    // Clicking near its edge (not dead centre) still lands.
    await page.mouse.click(settled.x + 3, settled.y + settled.height - 3);
    await expect(c).toHaveAttribute("aria-label", /in progress/);
  });
});
