import { expect, test, type Page } from "@playwright/test";
import { allCards, cardAt, menuItem, openActionsByMouse, openBoard, waitForStableBoard } from "./helpers";

/**
 * Spec 018: a guest who signs into a Google account that already exists keeps
 * the plans they edited. Browser A creates the account (its starter plan is the
 * account's plan). Browser B, a fresh guest on the same major, edits its plan
 * and signs into that same account. B must see its own board, both plans in
 * the switcher (B's labeled "(from guest)"), and the dialog's note, after ONE
 * Google popup. Runs against the emulator dev server, whose Auth emulator
 * serves a stand-in Google sign-in page (see playwright.config.ts).
 */

const EMAIL = `carryover-${Date.now()}@example.com`;

/** Open the sign-in dialog and its Google popup; return the popup. */
async function openGooglePopup(page: Page) {
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  return popup;
}

test("signing into an existing account brings the guest's edited plan over", async ({ browser }) => {
  // ── A: create the Google account (a new account: the guest is upgraded in place).
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await openBoard(a);
  const popupA = await openGooglePopup(a);
  await popupA.getByRole("button", { name: /Add new account/i }).click();
  await popupA.getByLabel(/Email/i).fill(EMAIL);
  await popupA.getByRole("button", { name: /Sign in with Google\.com/i }).click();
  await expect(a.getByText("Your plan is saved")).toBeVisible({ timeout: 15_000 });
  const accountPlanName = (await a.getByTitle("Rename your plan").innerText()).trim();
  await ctxA.close();

  // ── B: a fresh guest on the same major edits its plan.
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await openBoard(b);
  const { placementId } = await cardAt(b, 1, 0);
  await openActionsByMouse(b, placementId);
  await menuItem(b, "Mark complete").click();
  // Let the debounced save land, so the plan counts as edited.
  await b.waitForTimeout(3_000);
  const cardCount = await allCards(b).count();

  let popups = 0;
  b.on("popup", () => popups++);
  const popupB = await openGooglePopup(b);
  // The emulator lists the account A made; pick it.
  await popupB.getByText(EMAIL).click();

  await expect(b.getByText(/Brought over 1 plan from this device/)).toBeVisible({ timeout: 20_000 });
  expect(popups).toBe(1);
  await expect(b.getByRole("button", { name: "Sign in", exact: true })).toBeHidden({ timeout: 5_000 });

  // B's own board stays on screen, as the labeled copy.
  await expect(b.getByTitle("Rename your plan")).toHaveText(`${accountPlanName} (from guest)`, {
    timeout: 20_000,
  });
  await waitForStableBoard(b);
  expect(await allCards(b).count()).toBe(cardCount);
  await expect(b.locator(`[data-placement="${placementId}"]`)).toBeVisible();

  // Both plans are in the switcher (each row's delete button names its plan
  // exactly; the row text also carries the major's tag, which can equal the
  // plan name).
  await b.getByRole("button", { name: "Switch plans" }).click();
  const deleteButton = (name: string) =>
    b.getByRole("button", { name: `Delete plan ${name}`, exact: true });
  await expect(deleteButton(accountPlanName)).toBeVisible();
  await expect(deleteButton(`${accountPlanName} (from guest)`)).toBeVisible();
  await ctxB.close();
});
