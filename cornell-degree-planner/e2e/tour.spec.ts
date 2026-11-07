import { expect, test, type Page } from "@playwright/test";
import { openBoard } from "./helpers";

/**
 * First-run tours (spec 033). Automated browsers don't get tours started on
 * them unless a test opts in, so the rest of the suite never clicks into the
 * overlay; these tests opt in.
 */
const optIn = (page: Page) =>
  page.addInitScript(() => {
    try {
      localStorage.setItem("coursemap.e2eTours", "1");
    } catch {
      /* storage blocked: the test will fail on the missing tour */
    }
  });

const tour = (page: Page) => page.getByRole("dialog", { name: "Planner tour" });

test("a student who finishes first run gets each tour once", async ({ page }) => {
  await optIn(page);
  await openBoard(page);

  // The planner tour starts by itself and walks forward and back.
  await expect(tour(page)).toBeVisible({ timeout: 15_000 });
  await expect(tour(page)).toContainText("Welcome to your roadmap");
  await tour(page).getByRole("button", { name: "Show me around" }).click();
  await expect(tour(page)).toContainText("Reading a course card");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(tour(page)).toContainText("Reading a course card");

  // Skipping counts as seen: a reload doesn't bring it back.
  await page.keyboard.press("Escape");
  await expect(tour(page)).toBeHidden();
  await page.waitForTimeout(2_000); // let the seen mark save
  await page.reload();
  await expect(page.locator("[data-column]").first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(4_000);
  await expect(tour(page)).toBeHidden();

  // Requirements has its own tour, owed from first run, shown once.
  await page.goto("/requirements");
  await expect(tour(page)).toBeVisible({ timeout: 20_000 });
  await expect(tour(page)).toContainText("Every requirement, one row each");
  await tour(page).getByRole("button", { name: "Show me around" }).click();
  await expect(tour(page)).toContainText("Try a class before you commit");
  await tour(page).getByRole("button", { name: "Done" }).click();
  await expect(tour(page)).toBeHidden();
  await page.waitForTimeout(2_000);
  await page.reload();
  await expect(page.locator("[data-requirement]").first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(4_000);
  await expect(tour(page)).toBeHidden();

  // …and the header link replays it on demand.
  await page.getByRole("button", { name: "Take the tour" }).click();
  await expect(tour(page)).toContainText("Every requirement, one row each");
});

test("the ? menu replays the planner tour", async ({ page }) => {
  await openBoard(page); // no opt-in: nothing starts by itself
  await page.waitForTimeout(3_000);
  await expect(tour(page)).toBeHidden();

  await page.getByRole("button", { name: "Legend" }).click();
  await page.getByRole("button", { name: "Take the tour" }).click();
  await expect(tour(page)).toBeVisible();
  await expect(tour(page)).toContainText("Welcome to your roadmap");

  // The page underneath takes no clicks while the tour is open.
  const card = await page.locator("[data-placement]").first().boundingBox();
  expect(card).not.toBeNull();
  await page.mouse.click(card!.x + card!.width / 2, card!.y + card!.height / 2);
  await expect(page.getByRole("dialog", { name: / details$/ })).toBeHidden();
  await expect(tour(page)).toBeVisible();

  await tour(page).getByRole("button", { name: "Close the tour" }).click();
  await expect(tour(page)).toBeHidden();
});
