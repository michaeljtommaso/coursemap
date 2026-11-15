import { expect, test, type Page } from "@playwright/test";
import { column, expandFoldedRows, openAboutRequirements, openCatalog, openRequirements, selectRow } from "./helpers";

/**
 * Spec 020 — ask the student, end to end on the emulator. Uses the fictional
 * CAS test major and the CAS college layer fixture, whose writing-seminar row
 * counts ENGL 2860 / 2880 only when the student says they are using it as a
 * seminar (Cornell: instructor permission and a letter grade).
 *
 *   one FWS + ENGL 2880 on the board → the FWS row on the Requirements page shows one question,
 *   answering Yes fills the row and leaves a "Counted because you said …" line,
 *   the answer survives a reload,
 *   clearing it from "Your answers" brings the question back.
 */

const TEST_MAJOR = "Test Major (Arts & Sciences)";
const FWS_ROW = "cas-college:fws";
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
  await expect(page.locator("[data-rail-still-needed]")).toBeVisible({ timeout: 45_000 });
  // A placement made within about a second of onboarding can be overwritten
  // by the new plan's first snapshot (logged as a separate race); let the
  // new plan settle first.
  await page.waitForTimeout(3_000);
}

async function place(page: Page, code: string, sem: number): Promise<void> {
  await openCatalog(page);
  await page.getByPlaceholder(/CS 1110/).fill(code);
  const id = code.replace(" ", "-");
  const row = page.locator(`[data-catalog-course="${id}"]`).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.focus();
  await page.keyboard.press("Enter");
  await column(page, sem).click();
  await expect(page.locator(`[data-placement][data-course="${id}"]`)).toHaveCount(1, { timeout: 15_000 });
  // A placement collapses the right panel; let that settle so the next
  // openCatalog() click isn't undone by the closing animation.
  await expect(page.getByRole("button", { name: "Open the catalog and majors panel" })).toBeVisible();
  await page.waitForTimeout(800);
}

/** The FWS row on the Requirements page (every row is listed there, met or not). */
async function fwsRow(page: Page) {
  const row = req(page, FWS_ROW);
  await expect(row).toBeVisible({ timeout: 15_000 });
  return row;
}

test("a writing-seminar question appears, a Yes fills the row, survives a reload, and clears from Your answers", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await startOnTestMajor(page);
  await place(page, "ANTHR 1101", 1);
  await place(page, "ENGL 2880", 2);

  // The rail only shows a line per group; the rows live on the Requirements page.
  await openRequirements(page);

  // Strict until answered: one seminar of two, and one question on the row
  // (in its side panel, spec 045 D3).
  const row = await fwsRow(page);
  await expect(row).toHaveAttribute("data-status", "partial", { timeout: 15_000 });
  const panel = await selectRow(page, row);
  const line = panel.locator("[data-row-question]");
  await expect(line).toContainText("ENGL 2880", { timeout: 15_000 });
  await expect(page.locator("[data-question-count]")).toBeVisible();

  // Answer Yes in the panel's form.
  await line.click();
  const form = panel.locator("[data-question-form]");
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Yes", exact: true }).click();

  // The row is met (it stays in the table while selected) and its panel says why; the header count is gone.
  const met = await fwsRow(page);
  await expect(met).toHaveAttribute("data-status", "satisfied", { timeout: 15_000 });
  await expect(panel.locator("[data-answer-line]")).toContainText("ENGL 2880");
  await expect(page.locator("[data-question-count]")).toHaveCount(0);

  // The answer is saved with the plan.
  await page.waitForTimeout(3_000);
  await page.reload();
  await expect(page.locator("[data-requirements-page]")).toBeVisible({ timeout: 45_000 });
  // A finished row folds into its group's end line (spec 045 D2): show it.
  await expect(async () => {
    await expandFoldedRows(page);
    await expect(req(page, FWS_ROW)).toHaveAttribute("data-status", "satisfied", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  // Clear it from "Your answers": the question comes back.
  const about = await openAboutRequirements(page);
  await about.getByRole("button", { name: /^Your answers/ }).click();
  const editor = page.locator("[data-answers-editor]");
  await expect(editor.locator("[data-answer-entry]")).toHaveCount(1);
  await editor.getByRole("button", { name: /Clear/ }).first().click();
  await expect(await fwsRow(page)).toHaveAttribute("data-status", "partial", { timeout: 15_000 });
  await expect((await selectRow(page, await fwsRow(page))).locator("[data-row-question]")).toBeVisible({ timeout: 15_000 });

  expect(errors.filter((e) => !/favicon|ResizeObserver/.test(e))).toEqual([]);
});
