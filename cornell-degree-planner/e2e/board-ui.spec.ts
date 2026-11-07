import { expect, test } from "@playwright/test";
import {
  allCards,
  card,
  menuItem,
  openActionsByMouse,
  openBoard,
  openMenu,
  closeMenu,
  topBarControls,
  closeTopBarControls,
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
    test.skip(true, "Unlock suggestions are switched off (src/config/features.ts: unlockSuggestions); re-enable with the feature.");
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
    test.skip(true, "Unlock suggestions are switched off (src/config/features.ts: unlockSuggestions); re-enable with the feature.");
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
    let controls = await topBarControls(page);
    await expect(controls.getByRole("link", { name: "Flowchart" })).toHaveAttribute(
      "href",
      /duffield\.cornell\.edu\/.*Comp-Sci-CS\.jpg$/
    );
    await expect(controls.getByRole("link", { name: "Flowchart" })).toHaveAttribute("target", "_blank");
    await expect(controls.getByRole("link", { name: "Major page" })).toHaveAttribute(
      "href",
      "https://www.cs.cornell.edu/bachelor-science-computer-science"
    );

    // The links follow the switcher; a CAS/CALS major takes its page from the
    // program index and has no flowchart (the emulator's test major).
    await closeTopBarControls(page);
    await page.locator("#program-select").selectOption({ label: "Test Major (Arts & Sciences)" });
    controls = await topBarControls(page);
    await expect(controls.getByRole("link", { name: "Major page" })).toHaveAttribute(
      "href",
      "https://www.cs.cornell.edu/bachelor-science-computer-science"
    );
    await expect(controls.getByRole("link", { name: "Flowchart" })).toHaveCount(0);
  });

  test("top bar: steps from spread out to compact to the menu as the window narrows", async ({ page }) => {
    const bar = page.locator("[data-topbar-tier]");
    const rank = { full: 0, compact: 1, menu: 2 } as const;
    // Nothing covers the plan name, and nothing runs off the right edge.
    const clear = async (width: number) => {
      const plan = (await page.getByTitle("Rename your plan").boundingBox())!;
      const picker = (await page.locator("#program-select").boundingBox())!;
      expect(plan.x + plan.width, `plan name clear of the picker at ${width}px`).toBeLessThanOrEqual(picker.x);
      expect(plan.width, `plan name readable at ${width}px`).toBeGreaterThan(30);
      const controls = (await bar.locator(":scope > div").last().boundingBox())!;
      expect(controls.x + controls.width, `controls inside the window at ${width}px`).toBeLessThanOrEqual(width);
    };
    const settle = async (width: number) => {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400);
      return (await bar.getAttribute("data-topbar-tier")) as keyof typeof rank;
    };

    const widths = [2560, 1920, 1600, 1440, 1280, 1180, 1100, 1024];
    const seen: (keyof typeof rank)[] = [];
    for (const w of widths) {
      seen.push(await settle(w));
      await clear(w);
    }
    expect(seen[0]).toBe("full");
    expect(seen[seen.length - 1]).toBe("menu");
    for (let i = 1; i < seen.length; i++) expect(rank[seen[i]]).toBeGreaterThanOrEqual(rank[seen[i - 1]]);
    // The menu button only exists in the menu stage, and it holds everything.
    const menu = await openMenu(page);
    await expect(menu.getByRole("link", { name: "Flowchart" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Share" })).toBeVisible();
    await closeMenu(page);

    // Wide again: back to spread out, no menu button.
    expect(await settle(2560)).toBe("full");
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toHaveCount(0);
    await clear(2560);

    // The longest major name still leaves the brand alone.
    await settle(1280);
    await page.locator("#program-select").selectOption({ label: "Information Science, Systems, and Technology, B.S." });
    await page.waitForTimeout(400);
    await clear(1280);
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
