import { expect, test } from "@playwright/test";
import { PROGRAM_NAME, allCards } from "./helpers";

/**
 * First Google sign-in from an anonymous session. Linking keeps the same uid,
 * so the top bar must swap "Sign in" for the account menu without a reload
 * (it used to keep showing "Sign in" until the page was refreshed). Runs
 * against the emulator dev server, whose Auth emulator serves a stand-in
 * Google sign-in page in the popup (see playwright.config.ts).
 */
test("signing in with Google for the first time shows the account, no reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /I know my major/ }).click({ timeout: 45_000 });
  await page.getByRole("button", { name: new RegExp(PROGRAM_NAME.replace(/[.,]/g, "\\$&")) }).first().click();
  await page.getByRole("button", { name: "Fall 2025" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(allCards(page).first()).toBeVisible({ timeout: 45_000 });

  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await signIn.click();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  // The Auth emulator's stand-in Google page: add a new account, let it
  // generate the details, then sign in with it.
  await popup.getByRole("button", { name: /Add new account/i }).click();
  await popup.getByRole("button", { name: /Auto-generate user information/i }).click();
  const displayName = (await popup.getByLabel(/Display name/i).inputValue()).trim();
  expect(displayName).not.toBe("");
  await popup.getByRole("button", { name: /Sign in with Google\.com/i }).click();
  await popup.waitForEvent("close", { timeout: 15_000 }).catch(() => {});

  await expect(page.getByText("Your plan is saved")).toBeVisible({ timeout: 15_000 });
  await expect(signIn).toBeHidden({ timeout: 5_000 });
  // The account menu shows the Google name, not the "Your account" fallback
  // (a linked guest's name lives only on the Google entry).
  await expect(page.getByRole("button", { name: `Account: ${displayName}` })).toBeVisible();
});
