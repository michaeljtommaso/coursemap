import { expect, test, type Locator, type Page } from "@playwright/test";
import { backToPlanner, card, column, openBoard, openRequirements } from "./helpers";

/**
 * Spec 025 — exam / transfer credit and the Requirements page, end to end on
 * the emulator.
 *
 *   Credits editor: one click picks an AP score and shows its result, another
 *   clears it, Save keeps it, a transfer course is added by catalog search,
 *   and the Requirements page's credit card lists both.
 *   An Engineering board says "Covered by AP Calculus BC (5)" on MATH 1910.
 *   Requirements page: the outline scrolls to a group, "Find a class" lands on
 *   Classes with "Counts toward" set, "Show on board" lights the covering cards.
 *   Try flow: tried classes show in blue on the page, remind the student in the
 *   rail (two lines tall), Place arms a column, a reload keeps them, Clear
 *   empties the reminder.
 *
 * Arts & Sciences student: Economics (BA), entered Fall 2026 (a fresh guest per
 * test). Engineering student: the shared Computer Science board.
 */

const DIALOG_NAME = "Your AP, IB and transfer credit";
const AP_CALC_BC_5 = "AP Calculus BC, score 5";

async function startEconomics(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveTitle(/Coursemap/, { timeout: 15_000 });
  await page.getByRole("button", { name: /I know my major/ }).click({ timeout: 45_000 });
  await page.getByRole("button", { name: /Economics \(BA\)/ }).first().click();
  await page.getByRole("button", { name: "Fall 2026" }).click();
  await expect(page.getByText("Did you transfer to Cornell?")).toBeVisible();
  await page.getByRole("button", { name: "No", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.locator("[data-rail-group]").first()).toBeVisible({ timeout: 45_000 });
  // A change made within about a second of onboarding can lose to the new
  // plan's first snapshot; let the new plan settle.
  await page.waitForTimeout(3_000);
}

async function openCredits(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /My credits/ }).click();
  const dialog = page.getByRole("dialog", { name: DIALOG_NAME });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Search the dialog's exam list and return the score button, e.g. "AP Calculus BC, score 5". */
async function scoreButton(dialog: Locator, search: string, name: string): Promise<Locator> {
  await dialog.getByRole("searchbox", { name: "Search exams" }).fill(search);
  const btn = dialog.getByRole("button", { name, exact: true });
  await expect(btn).toBeVisible({ timeout: 10_000 });
  return btn;
}

async function saveCredits(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

test("credits: pick, clear, save and reopen an AP score, add a transfer course, see both on the Requirements page", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await startEconomics(page);

  // One click picks AP Calculus BC 5 and shows what it earns; the next clears it.
  let dialog = await openCredits(page);
  const bc5 = await scoreButton(dialog, "Calculus BC", AP_CALC_BC_5);
  const bcRow = dialog.locator("[data-exam]").filter({ has: page.getByRole("button", { name: AP_CALC_BC_5, exact: true }) });
  await expect(bc5).toHaveAttribute("aria-pressed", "false");
  await expect(bcRow.locator("[data-exam-result]")).toHaveCount(0);
  await bc5.click();
  await expect(bc5).toHaveAttribute("aria-pressed", "true");
  await expect(bcRow.locator("[data-exam-result]")).toBeVisible();
  await bc5.click();
  await expect(bc5).toHaveAttribute("aria-pressed", "false");
  await expect(bcRow.locator("[data-exam-result]")).toHaveCount(0);

  // Pick it again and Save.
  await bc5.click();
  await expect(bc5).toHaveAttribute("aria-pressed", "true");
  await saveCredits(page, dialog);

  // Reopen: still picked, from the saved profile.
  dialog = await openCredits(page);
  const again = await scoreButton(dialog, "Calculus BC", AP_CALC_BC_5);
  await expect(again).toHaveAttribute("aria-pressed", "true");
  await expect(
    dialog.locator("[data-exam]").filter({ has: page.getByRole("button", { name: AP_CALC_BC_5, exact: true }) }).locator("[data-exam-result]")
  ).toBeVisible();

  // Add a transfer course by searching the catalog for MATH 1920.
  await dialog.getByRole("button", { name: "Add a transfer course" }).click();
  const form = dialog.getByRole("form", { name: "Add a transfer course" });
  await form.getByRole("searchbox", { name: "Search Cornell courses" }).fill("MATH 1920");
  await form.getByRole("button", { name: /^MATH 1920/ }).first().click({ timeout: 15_000 });
  await form.getByRole("button", { name: "Add course" }).click();
  await expect(dialog.locator("[data-transfer]")).toHaveCount(1);
  await expect(dialog.locator("[data-transfer]")).toContainText("MATH 1920");
  await saveCredits(page, dialog);
  await page.waitForTimeout(2_000); // let the profile write land

  // The Requirements page's credit card lists both.
  await openRequirements(page);
  const creditCard = page.locator("[data-credit-card]");
  await expect(creditCard.locator("[data-credit-entry]")).toHaveCount(2, { timeout: 15_000 });
  await expect(creditCard.locator("[data-credit-entry]").filter({ hasText: "AP Calculus BC" })).toHaveCount(1);
  await expect(creditCard.locator("[data-credit-entry]").filter({ hasText: "MATH 1920" })).toHaveCount(1);

  // Where the AP score counts, the requirement row names it ("AP Calculus BC (5)").
  // If no Economics row takes it, the CS board test below asserts the same on MATH 1910.
  const named = page.locator("[data-requirement]").filter({ hasText: "AP Calculus BC (5)" });
  console.log(`[credits] Economics rows naming AP Calculus BC (5): ${await named.count()}`);
  if ((await named.count()) === 0) {
    await expect(creditCard.locator("[data-credit-entry]").filter({ hasText: "AP Calculus BC" })).toContainText(/credit|cr/i);
  }

  // The credits survive a reload.
  await page.reload();
  await expect(page.locator("[data-credit-card] [data-credit-entry]")).toHaveCount(2, { timeout: 45_000 });

  expect(errors.filter((e) => !/favicon|ResizeObserver/.test(e))).toEqual([]);
});

test("credits: an Engineering board says 'Covered by AP Calculus BC (5)' on MATH 1910", async ({ page }) => {
  await openBoard(page);
  const math = page.locator('[data-placement][data-course="MATH-1910"]').first();
  await expect(math).toBeVisible();
  await expect(math).not.toContainText("Covered by AP Calculus BC (5)");

  const dialog = await openCredits(page);
  const bc5 = await scoreButton(dialog, "Calculus BC", AP_CALC_BC_5);
  await bc5.click();
  await expect(bc5).toHaveAttribute("aria-pressed", "true");
  await saveCredits(page, dialog);

  const placementId = (await math.getAttribute("data-placement")) ?? "";
  await expect(card(page, placementId)).toContainText("Covered by AP Calculus BC (5)", { timeout: 15_000 });
});

test("requirements page: outline scrolls to a group, Find a class opens Classes scoped to the row", async ({ page }) => {
  await startEconomics(page);
  await openRequirements(page);

  // The outline jumps to a group below the fold and marks it as the one in view.
  const groups = page.locator("[data-outline-group]");
  await expect.poll(async () => groups.count(), { timeout: 30_000 }).toBeGreaterThan(3);
  const target = groups.nth(4); // a group well below the fold, one the page can scroll to the top
  const key = (await target.getAttribute("data-outline-group")) ?? "";
  const targetCard = page.locator(`[data-group-card="${key}"]`).first();
  await target.click();
  await expect(targetCard).toBeInViewport({ timeout: 10_000 });

  // "Find a class" on an unmet row → Classes with "Counts toward" preselected.
  const findClass = page.locator('[data-requirement][data-status="unmet"] [data-find-class]').first();
  await findClass.scrollIntoViewIfNeeded();
  await findClass.click();
  await expect(page).toHaveURL(/\/classes\?.*countsToward=/);
  await expect(page.getByLabel("Counts toward")).not.toHaveValue("", { timeout: 15_000 });
});

test("requirements page: the outline marks the group you jumped to as the one in view", async ({ page }) => {
  await startEconomics(page);
  await openRequirements(page);
  const groups = page.locator("[data-outline-group]");
  await expect.poll(async () => groups.count(), { timeout: 30_000 }).toBeGreaterThan(5);
  // Let the cards finish growing (each fills in its suggestions) so the jump lands where it will stay.
  await expect(page.getByText("Finding classes…")).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1_000);
  for (const i of [4, 2]) {
    const target = groups.nth(i);
    await target.click();
    // The click marks it at once; the page's own scroll tracking has the last word once the scroll settles.
    await page.waitForTimeout(1_500);
    await expect(target, `outline entry ${i} is current after the jump settles`).toHaveAttribute("aria-current", "location", {
      timeout: 5_000,
    });
  }
});

test("try flow: tried classes show on the page and in the rail, Place arms a column, a reload keeps them, Clear empties the reminder", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await startEconomics(page);
  await expect(page.locator("[data-tried-reminder]")).toHaveCount(0);
  await openRequirements(page);

  // Try three suggested classes (the suggestions land a beat after the page).
  const tryButtons = page.locator("[data-try-course]").getByRole("button", { name: "Try", exact: true });
  const trying = page.locator("[data-try-course]").getByRole("button", { name: "Trying ✓" });
  await expect(tryButtons.first()).toBeVisible({ timeout: 45_000 });
  for (let n = 1; n <= 3; n++) {
    await tryButtons.first().click(); // scrolls itself into view; re-resolves if the list re-renders
    await expect.poll(async () => trying.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(n);
  }
  // Blue, dashed: the row says what the tried class would do, and the page's header counts them.
  await expect(page.locator("[data-tried-delta], [data-tried-course]:not([data-try-course])").first()).toBeAttached({
    timeout: 15_000,
  });
  await expect(page.locator("[data-requirements-done]")).toContainText("trying 3 classes");
  await expect(page.locator("[data-tried-line] [data-tried-chip]")).toHaveCount(3);

  // Back on the planner, the rail reminds the student; three lines scroll inside two.
  await backToPlanner(page);
  const reminder = page.locator("[data-tried-reminder]");
  await expect(reminder).toBeVisible({ timeout: 15_000 });
  const items = reminder.locator("[data-tried-item]");
  await expect(items).toHaveCount(3);
  const list = reminder.locator("[data-tried-list]");
  const { clientHeight, scrollHeight } = await list.evaluate((el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
  }));
  expect(clientHeight, "the reminder list stays two lines tall").toBeLessThanOrEqual(50);
  expect(scrollHeight, "the third line scrolls inside the list").toBeGreaterThan(clientHeight);

  // Place: the course is armed and a column is suggested; clicking that column puts the card on the board.
  const first = items.first();
  const courseId = (await first.getAttribute("data-tried-item")) ?? "";
  expect(courseId).not.toBe("");
  await first.getByRole("button", { name: /^Place / }).click();
  const target = page.locator('[data-column][data-suggested-target="true"]');
  await expect(target).toHaveCount(1, { timeout: 10_000 });
  const sem = Number(await target.getAttribute("data-column"));
  await column(page, sem).click();
  await expect(page.locator(`[data-placement][data-course="${courseId}"]`)).toHaveCount(1, { timeout: 15_000 });
  await expect(reminder.locator(`[data-tried-item="${courseId}"]`)).toHaveCount(0);
  await expect(items).toHaveCount(2);
  // Placed on the board, it is no longer "tried" (the page's tried line agrees).
  await page.locator("[data-rail-all-requirements]").click();
  await expect(page.locator("[data-tried-line] [data-tried-chip]")).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator(`[data-tried-chip="${courseId}"]`)).toHaveCount(0);
  await backToPlanner(page);

  // Tried classes are saved on the plan: a reload keeps the other two.
  await page.waitForTimeout(3_000);
  await page.reload();
  await expect(page.locator("[data-tried-reminder] [data-tried-item]")).toHaveCount(2, { timeout: 45_000 });
  await expect(page.locator(`[data-placement][data-course="${courseId}"]`)).toHaveCount(1);

  // Clear empties the reminder, and the page forgets them too.
  await page.locator("[data-tried-clear]").click();
  await expect(page.locator("[data-tried-reminder]")).toHaveCount(0);
  await page.waitForTimeout(2_000);
  await page.reload();
  await expect(page.locator("[data-rail-still-needed]")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("[data-tried-reminder]")).toHaveCount(0);

  expect(errors.filter((e) => !/favicon|ResizeObserver/.test(e))).toEqual([]);
});

test("requirements page: Show on board lands on the planner with the covering cards highlighted", async ({ page }) => {
  await openBoard(page);
  await openRequirements(page);
  const show = page.locator("[data-show-on-board]").first();
  await expect(show).toBeAttached({ timeout: 30_000 });
  await show.scrollIntoViewIfNeeded();
  await show.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-rail-still-needed]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-placement][data-highlighted="true"]').first()).toBeVisible({ timeout: 15_000 });
  // Esc clears the highlight.
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-placement][data-highlighted="true"]')).toHaveCount(0);
});
