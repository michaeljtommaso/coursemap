import { expect, test, type Page } from "@playwright/test";
import { menuItem, moveToItem, openActionsByMouse, openBoard } from "./helpers";

/**
 * Prerequisite ordering on the Computer Science board. Some prerequisites are
 * "soft" (Cornell's "or equivalent": MATH 1920 ← MATH 1910, CS 3110 ← CS 2110)
 * and never block on their own, since the student may hold credit or an
 * equivalent. Once the prerequisite itself is on the board in a later
 * semester, though, the order is simply wrong and the dependent card must go
 * red, exactly as a hard prerequisite does. Runs against the emulator dev
 * server (see playwright.config.ts).
 */

const cardOf = (page: Page, courseId: string) => page.locator(`[data-placement][data-course="${courseId}"]`).first();

async function moveCourse(page: Page, courseId: string, sem: number): Promise<void> {
  const placementId = await cardOf(page, courseId).getAttribute("data-placement");
  expect(placementId, `${courseId} is on the board`).toBeTruthy();
  await openActionsByMouse(page, placementId!);
  await moveToItem(page).click();
  await page.locator(`[data-move-sem="${sem}"]`).click();
  await expect(page.locator(`[data-column="${sem}"] [data-course="${courseId}"]`)).toHaveCount(1);
}

async function expectBlocked(page: Page, courseId: string, needs: string): Promise<void> {
  const label = cardOf(page, courseId);
  await expect(label).toHaveAttribute("aria-label", /blocked/);
  await expect(label).toContainText(needs);
}

test.describe("prerequisite placed after the course that needs it", () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
  });

  test("soft prereq: MATH 1910 moved after MATH 1920 blocks MATH 1920", async ({ page }) => {
    await expect(cardOf(page, "MATH-1920")).not.toHaveAttribute("aria-label", /blocked/);
    await moveCourse(page, "MATH-1910", 3);
    await expectBlocked(page, "MATH-1920", "MATH 1910");
    // The wire between them turns red too.
    await expect(page.locator('[data-edge-shape] path[stroke="var(--destructive)"]').first()).toBeAttached();
  });

  test("soft prereq: CS 2110 moved after CS 3110 blocks CS 3110", async ({ page }) => {
    await moveCourse(page, "CS-2110", 8);
    await expectBlocked(page, "CS-3110", "CS 2110");
  });

  test("hard prereq (control): MATH 1920 moved after MATH 2940 blocks MATH 2940", async ({ page }) => {
    await moveCourse(page, "MATH-1920", 6);
    await expectBlocked(page, "MATH-2940", "MATH 1920");
  });

  test("a soft prereq that isn't on the board stays a soft note, not red", async ({ page }) => {
    const placementId = await cardOf(page, "MATH-1910").getAttribute("data-placement");
    await openActionsByMouse(page, placementId!);
    await menuItem(page, "Remove from board").click();
    await expect(page.locator('[data-course="MATH-1910"]')).toHaveCount(0);
    await expect(cardOf(page, "MATH-1920")).not.toHaveAttribute("aria-label", /blocked/);
  });
});
