import { expect, test, type Page } from "@playwright/test";
import { backToPlanner, column, expandFoldedRows, openAboutRequirements, openCatalog, openRequirements, selectRow } from "./helpers";

/**
 * Spec 019 Phase 3 — an Arts & Sciences major on the Distribution engine,
 * end to end on the emulator. Uses the FICTIONAL test major seeded by
 * `seed-emulator.ts` (scripts/seed-data/layers-test/test-cas-major.json) and
 * the CAS college layer fixture.
 *
 *   first run asks the start term AND whether the student transferred (CAS),
 *   the rail lists the requirement groups; the Requirements page names the
 *   catalog year (in its info popover) and shows college + major rows,
 *   a placed course fills its row, a confirm row reads as one,
 *   an unmet row's "Find a class" opens Classes scoped to that row, and the
 *   rail's group line opens the catalog scoped to it.
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

  // No invented schedule (D9): an empty board, a full requirement list.
  await expect(page.locator("[data-rail-group]").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("[data-placement]")).toHaveCount(0);
  await openRequirements(page);
  const about = await openAboutRequirements(page);
  await expect(about.locator("[data-catalog-year]")).toContainText("2026–27", { timeout: 45_000 });
  await page.getByRole("button", { name: "About these requirements" }).click();
  await expect(page.locator('[data-requirement^="cas-college:"]').first()).toBeAttached();
  await expect(req(page, "test-cas-major:intro")).toHaveAttribute("data-status", "unmet");

  // Confirm rows read as confirm rows; they sit in the collapsed advisor card.
  await page.locator("[data-advisor-card]").getByRole("button", { name: /Check with your advisor/ }).click();
  // Spec 045: the row's Progress cell reads "Ask your advisor" (the detail line moved to the panel).
  await expect(req(page, "test-cas-major:advisor")).toContainText("Ask your advisor");
  await expect(req(page, "test-cas-major:advisor")).toHaveAttribute("data-engine-status", "confirm");

  // Place PSYCH 1101 (the intro seat) from the catalog: arm, then click a column.
  await backToPlanner(page);
  await openCatalog(page);
  await page.getByPlaceholder(/CS 1110/).fill("PSYCH 1101");
  const row = page.locator('[data-catalog-course="PSYCH-1101"]').first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.focus();
  await page.keyboard.press("Enter");
  await column(page, 1).click();
  await expect(page.locator('[data-placement][data-course="PSYCH-1101"]')).toHaveCount(1, { timeout: 15_000 });
  await page.waitForTimeout(800); // a placement collapses the right panel; let it settle
  await openRequirements(page);
  // A finished row folds into its group's end line (spec 045 D2): show it.
  await expect(async () => {
    await expandFoldedRows(page);
    await expect(req(page, "test-cas-major:intro")).toHaveAttribute("data-status", "satisfied", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  // Find a class from an unmet distribution row's panel ("Search all classes for this"):
  // Classes opens with "Counts toward" set to it.
  const breadth = await selectRow(page, req(page, "test-cas-major:breadth"));
  await expect(breadth.locator("[data-category]").first()).toBeAttached();
  await breadth.locator("[data-find-class]").click();
  await expect(page).toHaveURL(/\/classes\?.*countsToward=/);
  await expect(page.getByLabel("Counts toward")).not.toHaveValue("", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: / — details$/ }).first()).toBeVisible({ timeout: 15_000 });

  // The rail's group line is the other way in: it opens the planner's catalog scoped to the row.
  await page.getByRole("link", { name: "Planner" }).click();
  await expect(page.locator("[data-rail-still-needed]")).toBeVisible({ timeout: 15_000 });
  const breadthLine = page.locator('[data-rail-group]:not([data-done])').first();
  await breadthLine.click();
  await expect(page.locator("[data-requirement-chip]")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Catalog" })).toBeInViewport();
  await expect(page.locator("[data-catalog-course]").first()).toBeVisible({ timeout: 15_000 });

  expect(errors.filter((e) => !/favicon|ResizeObserver/.test(e))).toEqual([]);
});

test("the start answers survive a reload and the page doesn't ask again", async ({ page }) => {
  await startOnTestMajor(page);
  await expect(page.locator("[data-rail-still-needed]")).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(3_000); // let the profile writes land
  await page.reload();
  await openRequirements(page);
  await expect(page.locator('[data-requirement^="cas-college:"]').first()).toBeAttached({ timeout: 45_000 });
  await expect(page.locator("[data-requirement-notice]")).toHaveCount(0);
  await expect(page.locator("[data-rail-notice]")).toHaveCount(0);
  const about = await openAboutRequirements(page);
  await expect(about.locator("[data-catalog-year]")).toBeVisible();
});
