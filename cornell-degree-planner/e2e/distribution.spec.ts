import { expect, test, type Page } from "@playwright/test";
import { column, openCatalog } from "./helpers";

/**
 * Spec 019 Phase 3 — an Arts & Sciences major on the Distribution engine,
 * end to end on the emulator. Uses the FICTIONAL test major seeded by
 * `seed-emulator.ts` (scripts/seed-data/layers-test/test-cas-major.json) and
 * the CAS college layer fixture.
 *
 *   first run asks the start term AND whether the student transferred (CAS),
 *   the panel names the catalog year and shows college + major rows,
 *   a placed course fills its row, a confirm row reads as one,
 *   an unmet row's "Find a class" opens the catalog scoped to that row.
 */

const TEST_MAJOR = "Test Major (Arts & Sciences)";
const req = (page: Page, id: string) => page.locator(`[data-requirement="${id}"]`);

async function startOnTestMajor(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveTitle(/Coursemap/, { timeout: 15_000 });
  await page.getByRole("button", { name: /I know my major/ }).click({ timeout: 45_000 });
  await page.getByRole("button", { name: new RegExp(TEST_MAJOR.replace(/[()&]/g, "\\$&")) }).first().click();

  // Start term, then (CAS only) the transfer question; never guessed.
  await page.getByRole("button", { name: "Fall 2025" }).click();
  await expect(page.getByText("Did you transfer to Cornell?")).toBeVisible();
  await page.getByRole("button", { name: "No", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
}

test("a CAS major asks the start term and transfer, then fills its rows from the board", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await startOnTestMajor(page);

  // No invented schedule (D9): an empty board, a full Requirements panel.
  await expect(page.locator("[data-catalog-year]")).toContainText("2026–27", { timeout: 45_000 });
  await expect(page.locator("[data-placement]")).toHaveCount(0);
  await expect(page.locator('[data-requirement^="cas-college:"]').first()).toBeAttached();
  await expect(req(page, "test-cas-major:intro")).toHaveAttribute("data-status", "unmet");
  await expect(req(page, "test-cas-major:advisor")).toContainText("Confirm with your advisor");
  await expect(req(page, "test-cas-major:advisor")).toHaveAttribute("data-engine-status", "confirm");

  // Place PSYCH 1101 (the intro seat) from the catalog: arm, then click a column.
  await openCatalog(page);
  await page.getByPlaceholder(/CS 1110/).fill("PSYCH 1101");
  const row = page.locator('[data-catalog-course="PSYCH-1101"]').first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.focus();
  await page.keyboard.press("Enter");
  await column(page, 1).click();
  await expect(page.locator('[data-placement][data-course="PSYCH-1101"]')).toHaveCount(1, { timeout: 15_000 });
  // Satisfied rows move under the collapsed "Satisfied (n)" list.
  await page.getByRole("button", { name: /^Satisfied \(/ }).click({ timeout: 15_000 });
  await expect(req(page, "test-cas-major:intro")).toHaveAttribute("data-status", "satisfied", { timeout: 15_000 });

  // Find a class from an unmet distribution row: the catalog opens scoped to it.
  const breadth = req(page, "test-cas-major:breadth");
  await expect(breadth.locator("[data-category]").first()).toBeAttached();
  await breadth.getByRole("button").first().click();
  await expect(page.getByText("Three courses across three breadth areas").last()).toBeVisible();
  await expect(page.locator("[data-catalog-course]").first()).toBeVisible({ timeout: 15_000 });

  expect(errors.filter((e) => !/favicon|ResizeObserver/.test(e))).toEqual([]);
});

test("the start answers survive a reload and the panel doesn't ask again", async ({ page }) => {
  await startOnTestMajor(page);
  await expect(page.locator("[data-catalog-year]")).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(3_000); // let the profile writes land
  await page.reload();
  await expect(page.locator("[data-catalog-year]")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("[data-requirement-notice]")).toHaveCount(0);
});
