import { expect, test, type Page } from "@playwright/test";
import { menuItem, openActionsByMouse, openBoard } from "./helpers";

/**
 * /classes "Prereqs met by" filter (Taken / In progress / Planning to take,
 * multi-select) in the Prerequisites section. A course shows only when its
 * prerequisites are covered by the plan's courses with the chosen statuses;
 * courses with no prerequisites always show. Runs against the emulator dev
 * server like the board suite (see playwright.config.ts).
 *
 * The fresh CS board plans CS 2110 (not started) with CS 3110 after it, the
 * same shape as "an ORIE 4000-level class that needs ORIE 3300, which I plan
 * to take": CS 3110 must stay hidden until Planning to take is counted.
 */

async function listedCodes(page: Page): Promise<string[]> {
  const labels = await page
    .getByRole("button", { name: / — details$/ })
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  return labels.map((l) => l.split(" ").slice(0, 2).join(" "));
}

test("Prereqs met by: a course needing a planned class shows only when Planning to take is counted", async ({ page }) => {
  await openBoard(page);
  const cs2110 = page.locator('[data-course="CS-2110"]').first();
  await expect(cs2110).toBeVisible();

  // MATH 1910 taken; CS 2110 stays planned.
  const math = await page.locator('[data-course="MATH-1910"]').first().getAttribute("data-placement");
  await openActionsByMouse(page, math!);
  await menuItem(page, "Mark complete").click();

  await page.getByRole("link", { name: "Classes" }).click();
  const metBy = page.getByRole("group", { name: "Prereqs met by" });
  await expect(metBy).toBeVisible();
  await page.getByPlaceholder(/Search by code or title/).fill("CS 3110");
  await expect.poll(() => listedCodes(page)).toContain("CS 3110");

  // Counting only taken courses: CS 2110 isn't taken, so CS 3110 is hidden.
  await metBy.getByRole("button", { name: "Taken" }).click();
  await expect.poll(() => listedCodes(page)).not.toContain("CS 3110");

  // Add Planning to take: CS 2110 now counts, CS 3110 comes back.
  await metBy.getByRole("button", { name: "Planning to take" }).click();
  await expect.poll(() => listedCodes(page), { timeout: 15_000 }).toContain("CS 3110");

  // A course whose prerequisite IS taken shows with Taken alone.
  await metBy.getByRole("button", { name: "Planning to take" }).click();
  await page.getByPlaceholder(/Search by code or title/).fill("MATH 1920");
  await expect.poll(() => listedCodes(page), { timeout: 15_000 }).toContain("MATH 1920");

  // Turning every status off clears the filter.
  await metBy.getByRole("button", { name: "Taken" }).click();
  await page.getByPlaceholder(/Search by code or title/).fill("CS 3110");
  await expect.poll(() => listedCodes(page)).toContain("CS 3110");
});
