import { expect, test } from "@playwright/test";
import { PROGRAM_NAME, allCards, columnSel } from "./helpers";

/**
 * First run, finished before the new profile exists. A brand-new anonymous
 * user's profile doc is created in the background on first boot; a start year
 * picked before that write lands must still label the semesters and survive a
 * reload. Firestore writes are slowed down so the race is deterministic.
 * Runs against the emulator dev server (see playwright.config.ts).
 */
test("a start year picked before the profile exists is kept", async ({ page }) => {
  const yearWriteFailures: string[] = [];
  page.on("console", (msg) => {
    if (msg.text().includes("enteringYear write failed")) yearWriteFailures.push(msg.text());
  });
  // Hold every Firestore write for 2.5s, so the profile doc is still being
  // created while the first-run steps are clicked through.
  let slowWrites = true;
  await page.route("**/google.firestore.v1.Firestore/Write/**", async (route) => {
    if (slowWrites) await new Promise((r) => setTimeout(r, 2_500));
    await route.continue().catch(() => {}); // the page may have moved on
  });

  await page.goto("/");
  await page.getByRole("button", { name: /I know my major/ }).click({ timeout: 45_000 });
  await page.getByRole("button", { name: new RegExp(PROGRAM_NAME.replace(/[.,]/g, "\\$&")) }).first().click();
  await page.getByRole("button", { name: "Fall 2025" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();

  const firstHeader = page.locator(`${columnSel(1)} .t-label`).first();
  await expect(allCards(page).first()).toBeVisible({ timeout: 45_000 });
  await expect(firstHeader).toContainText("2025", { timeout: 15_000 });

  // Let the delayed writes land, then prove the year was saved, not just shown.
  slowWrites = false;
  await page.waitForTimeout(4_000);
  await page.reload();
  await expect(allCards(page).first()).toBeVisible({ timeout: 45_000 });
  await expect(firstHeader).toContainText("2025");
  expect(yearWriteFailures).toEqual([]);
});
