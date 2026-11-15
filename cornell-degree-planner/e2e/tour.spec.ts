import { expect, test, type Page } from "@playwright/test";
import { openBoard, openMenu } from "./helpers";

/** Replay from the top bar: the legend popover on a wide bar, the menu on a narrow one. */
async function replayFromTopBar(page: Page) {
  const bar = page.locator("[data-topbar-tier]");
  if ((await bar.getAttribute("data-topbar-tier")) === "menu") {
    const menu = await openMenu(page);
    await menu.getByRole("button", { name: "Take the tour" }).click();
  } else {
    await page.getByRole("button", { name: "Legend" }).click();
    await page.getByRole("dialog", { name: "Legend" }).getByRole("button", { name: "Take the tour" }).click();
  }
}

/**
 * First-run tours (spec 039). Automated browsers don't get tours started on
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
  await expect(tour(page)).toContainText("Every requirement, one line each");
  await tour(page).getByRole("button", { name: "Show me around" }).click();
  await expect(tour(page)).toContainText("Details, actions and classes to try");
  await tour(page).getByRole("button", { name: "Done" }).click();
  await expect(tour(page)).toBeHidden();
  await page.waitForTimeout(2_000);
  await page.reload();
  await expect(page.locator("[data-requirement]").first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(4_000);
  await expect(tour(page)).toBeHidden();

  // …and the header link replays it on demand.
  await page.getByRole("button", { name: "Take the tour" }).click();
  await expect(tour(page)).toContainText("Every requirement, one line each");
});

test("the top bar replays the planner tour, wide or narrow", async ({ page }) => {
  await openBoard(page); // no opt-in: nothing starts by itself
  await page.waitForTimeout(3_000);
  await expect(tour(page)).toBeHidden();

  await replayFromTopBar(page);
  await expect(tour(page)).toBeVisible();
  await expect(tour(page)).toContainText("Welcome to your roadmap");

  // The page underneath takes no clicks while the tour is open.
  const card = await page.locator("[data-placement]").first().boundingBox();
  expect(card).not.toBeNull();
  await page.mouse.click(card!.x + card!.width / 2, card!.y + card!.height / 2);
  // The detail panel is always mounted, parked off-screen as "Course details";
  // a card click would retitle it "<CODE> <NUMBER> details".
  await expect(page.getByRole("dialog", { name: /^[A-Z]+ \d+ details$/ })).toHaveCount(0);
  await expect(tour(page)).toBeVisible();

  await tour(page).getByRole("button", { name: "Close the tour" }).click();
  await expect(tour(page)).toBeHidden();
});

test("on a narrow window the tour opens the top-bar menu to show Share and Sign in", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await openBoard(page);
  await expect(page.locator("[data-topbar-tier]")).toHaveAttribute("data-topbar-tier", "menu");
  await replayFromTopBar(page);
  await expect(tour(page)).toBeVisible();
  const menu = page.getByRole("menu", { name: "Menu" });
  // Walk to "Your major": it opens the menu to show the major's links.
  for (let i = 0; i < 12; i++) {
    if ((await tour(page).textContent())?.includes("Switch majors here")) break;
    await page.keyboard.press("ArrowRight");
  }
  await expect(tour(page)).toContainText("Your major");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: "Flowchart" })).toBeVisible();

  // The menu stays open into the last step, which points at Share and Sign in.
  await page.keyboard.press("ArrowRight");
  await expect(tour(page)).toContainText("It saves as you go");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Share" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

  // Back to Saved plans closes it; forward again reopens it.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(tour(page)).toContainText("Your saved plans");
  await expect(menu).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(tour(page)).toContainText("It saves as you go");
  await expect(menu).toBeVisible();
  // Closing the tour closes the menu it opened.
  await page.keyboard.press("Escape");
  await expect(tour(page)).toBeHidden();
  await expect(menu).toBeHidden();
});
