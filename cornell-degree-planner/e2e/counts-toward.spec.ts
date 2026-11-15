import { expect, test, type Locator, type Page } from "@playwright/test";
import { backToPlanner, expandFoldedRows, openRequirements, selectRow, topBarControls } from "./helpers";

/**
 * Spec 046 — a "No Cornell equivalent" transfer the student says counts
 * toward a requirement, end to end on the emulator. Uses the FICTIONAL test
 * major seeded by `seed-emulator.ts` (scripts/seed-data/layers-test/
 * test-cas-major.json): its "Introductory course" seat takes PSYCH 1101 only.
 *
 *   the transfer form offers "Counts toward" (Just credits, A&S areas, the
 *   plan's requirements), the choice is saved, the list row says "(you said)",
 *   the chosen seat turns satisfied on Requirements and names the credit, and
 *   the choice can be changed in place back to Just credits.
 */

const TEST_MAJOR = "Test Major (Arts & Sciences)";
const DIALOG_NAME = "Your AP, IB and transfer credit";
const req = (page: Page, id: string) => page.locator(`[data-requirement="${id}"]`);

async function startOnTestMajor(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveTitle(/Coursemap/, { timeout: 15_000 });
  await page.getByRole("button", { name: /I know my major/ }).click({ timeout: 45_000 });
  await page.getByRole("button", { name: new RegExp(TEST_MAJOR.replace(/[()&]/g, "\\$&")) }).first().click();
  await page.getByRole("button", { name: "Fall 2025" }).click();
  await expect(page.getByText("Did you transfer to Cornell?")).toBeVisible();
  await page.getByRole("button", { name: "No", exact: true }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.locator("[data-rail-group]").first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(3_000); // let the new plan's first snapshot land
}

async function openCredits(page: Page): Promise<Locator> {
  const controls = await topBarControls(page);
  await controls.getByRole("button", { name: "My credits" }).click();
  const dialog = page.getByRole("dialog", { name: DIALOG_NAME });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("a no-equivalent transfer placed on a requirement fills it, marked 'you said'", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await startOnTestMajor(page);
  await openRequirements(page);
  await expect(req(page, "test-cas-major:intro")).toHaveAttribute("data-status", "unmet", { timeout: 45_000 });
  await backToPlanner(page);

  let dialog = await openCredits(page);
  await dialog.getByRole("tab", { name: /Transfer courses/ }).click();
  await dialog.getByRole("button", { name: "Add a transfer course" }).click();
  const form = dialog.getByRole("form", { name: "Add a transfer course" });
  await form.getByRole("button", { name: "No Cornell equivalent" }).click();
  await form.getByLabel("Course name").fill("Intro to Psychology, Tompkins Cortland CC");
  await form.getByLabel("Credits", { exact: true }).fill("3");

  const toward = form.getByLabel("Counts toward", { exact: true });
  const options = await toward.locator("option").allTextContents();
  expect(options[0]).toBe("Just credits");
  expect(options).toContain("ALC — Arts, Literature, and Culture");
  expect(options).toContain("Introductory course");
  expect(options).not.toContain("Meet with a major advisor"); // confirm rows are left out
  await toward.selectOption({ label: "Introductory course" });
  await expect(form).toContainText("search for it instead so prerequisites count too");
  await form.getByRole("button", { name: "Add course" }).click();

  const row = dialog.locator("[data-transfer]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("counts toward Introductory course (you said)");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await page.waitForTimeout(2_000); // let the profile write land

  // The seat is filled by the credit, and the row names it as the student's word.
  await openRequirements(page);
  await expect(async () => {
    await expandFoldedRows(page);
    await expect(req(page, "test-cas-major:intro")).toHaveAttribute("data-status", "satisfied", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const panel = await selectRow(page, req(page, "test-cas-major:intro"));
  await expect(panel).toContainText("Intro to Psychology, Tompkins Cortland CC (you said)");

  // Changed in place back to Just credits: the seat is open again.
  await backToPlanner(page);
  dialog = await openCredits(page);
  await dialog.getByRole("tab", { name: /Transfer courses/ }).click();
  await dialog
    .getByLabel("Counts toward, Intro to Psychology, Tompkins Cortland CC")
    .selectOption({ label: "Just credits" });
  await expect(dialog.locator("[data-transfer]")).toContainText("counts toward total credits");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await openRequirements(page);
  await expect(async () => {
    await expect(req(page, "test-cas-major:intro")).toHaveAttribute("data-status", "unmet", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  expect(errors.filter((e) => !/favicon|ResizeObserver/.test(e))).toEqual([]);
});
