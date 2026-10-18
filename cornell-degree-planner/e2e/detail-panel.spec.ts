import { expect, test } from "@playwright/test";
import { PROGRAM_NAME, allCards } from "./helpers";

/**
 * Course detail panel layout. Uses its own first run (start year Fall 2026) so
 * the first column is the enrollment term and its courses carry sections.
 */
test("detail panel: Sections sits below Prerequisites", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /I know my major/ }).click();
  await page.getByRole("button", { name: new RegExp(PROGRAM_NAME.replace(/[.,]/g, ".")) }).first().click();
  await page.getByRole("button", { name: "Fall 2026" }).click();
  const skip = page.getByRole("button", { name: "Skip for now" });
  await expect(skip.or(allCards(page).first()).first()).toBeVisible({ timeout: 20_000 });
  if (await skip.isVisible()) await skip.click();

  const math = page.locator('[data-course="MATH-1910"]').first();
  await expect(math).toBeVisible({ timeout: 45_000 });
  await math.click({ position: { x: 20, y: 20 } });

  const prereqs = page.getByText("Prerequisites", { exact: true });
  const sections = page.getByText("Sections", { exact: true });
  await expect(prereqs).toBeVisible();
  await expect(sections).toBeVisible({ timeout: 15_000 });
  const p = (await prereqs.boundingBox())!;
  const s = (await sections.boundingBox())!;
  expect(s.y).toBeGreaterThan(p.y);
});

test("detail panel: status buttons name the action and close the panel", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /I know my major/ }).click();
  await page.getByRole("button", { name: new RegExp(PROGRAM_NAME.replace(/[.,]/g, ".")) }).first().click();
  const later = page.getByRole("button", { name: "I'll add this later" });
  const skip = page.getByRole("button", { name: "Skip for now" });
  await expect(later.or(skip).or(allCards(page).first()).first()).toBeVisible({ timeout: 20_000 });
  if (await later.isVisible()) await later.click();
  await expect(skip.or(allCards(page).first()).first()).toBeVisible({ timeout: 20_000 });
  if (await skip.isVisible()) await skip.click();

  const math = page.locator('[data-course="MATH-1910"]').first();
  await expect(math).toBeVisible({ timeout: 45_000 });
  const panel = page.getByRole("dialog", { name: "MATH 1910 details" });
  // The panel stays mounted and slides off the right edge when it closes.
  const panelClosed = () =>
    expect
      .poll(async () => {
        const b = await panel.boundingBox();
        return !b || b.x >= page.viewportSize()!.width - 1;
      })
      .toBe(true);

  await math.click({ position: { x: 20, y: 20 } });
  await panel.getByRole("button", { name: "Mark complete" }).click();
  await panelClosed();
  await expect(math).toHaveAttribute("aria-label", /completed/);

  // Reopened: the buttons offer the opposite actions, never two states at once.
  await math.click({ position: { x: 20, y: 20 } });
  await expect(panel.getByRole("button", { name: "Mark incomplete" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Mark in progress" })).toBeVisible();
  await panel.getByRole("button", { name: "Mark in progress" }).click();
  await panelClosed();
  await expect(math).toHaveAttribute("aria-label", /in progress/);
  await math.click({ position: { x: 20, y: 20 } });
  await expect(panel.getByRole("button", { name: "Stop in progress" })).toBeVisible();
});
