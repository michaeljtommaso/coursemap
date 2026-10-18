import { expect, test } from "@playwright/test";
import { allCards, menuItem, openActionsByMouse, openBoard } from "./helpers";

/**
 * /classes "My plan" filter (taken / in progress / planning to take,
 * multi-select) under the Prerequisites section. Runs against the emulator dev
 * server like the board suite (see playwright.config.ts).
 */

/** The course codes the directory currently lists ("MATH 1910", …). */
async function listedCodes(page: import("@playwright/test").Page): Promise<string[]> {
  const labels = await page
    .getByRole("button", { name: / — details$/ })
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  return labels.map((l) => l.split(" ").slice(0, 2).join(" "));
}

test("My plan filter: taken, in progress and planned, alone and combined", async ({ page }) => {
  await openBoard(page);

  // Mark the first board card complete and the second in progress.
  const [a, b] = await allCards(page).evaluateAll((els) =>
    els.slice(0, 2).map((e) => ({
      id: e.getAttribute("data-placement")!,
      code: (e.getAttribute("data-course") ?? "").replace("-", " "),
    }))
  );
  await openActionsByMouse(page, a.id);
  await menuItem(page, "Mark complete").click();
  await openActionsByMouse(page, b.id);
  await menuItem(page, "In progress").click();
  const boardCodes = await allCards(page).evaluateAll((els) =>
    els.map((e) => (e.getAttribute("data-course") ?? "").replace("-", " "))
  );

  await page.getByRole("link", { name: "Classes" }).click();
  const myPlan = page.getByRole("group", { name: "My plan" });
  await expect(myPlan).toBeVisible();

  await myPlan.getByRole("button", { name: "Taken" }).click();
  await expect.poll(() => listedCodes(page)).toEqual([a.code]);

  // Multi-select: add In progress.
  await myPlan.getByRole("button", { name: "In progress" }).click();
  await expect.poll(async () => (await listedCodes(page)).sort()).toEqual([a.code, b.code].sort());

  // Only Planning to take: every other board course, none of the two above.
  await myPlan.getByRole("button", { name: "Taken" }).click();
  await myPlan.getByRole("button", { name: "In progress" }).click();
  await myPlan.getByRole("button", { name: "Planning to take" }).click();
  const planned = new Set(boardCodes.filter((c) => c !== a.code && c !== b.code));
  await expect
    .poll(async () => (await listedCodes(page)).filter((c) => !planned.has(c)))
    .toEqual([]);
  expect((await listedCodes(page)).length).toBeGreaterThan(0);

  // Deselecting the last status clears the axis (the full directory returns).
  await myPlan.getByRole("button", { name: "Planning to take" }).click();
  await expect.poll(async () => (await listedCodes(page)).length).toBeGreaterThan(planned.size + 2);
});
