import { expect, test } from "@playwright/test";
import { PROGRAM_NAME, allCards, closeTopBarControls, primarySegment, topBarControls } from "./helpers";

/**
 * First Google sign-in from an anonymous session. Linking keeps the same uid,
 * so the top bar must swap "Sign in" for the account control without a reload
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

  let controls = await topBarControls(page);
  await controls.getByRole("button", { name: "Sign in", exact: true }).click();

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
  // The account control carries the Google name, not the "Your account"
  // fallback (a linked guest's name lives only on the Google entry).
  controls = await topBarControls(page);
  await expect(controls.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0, { timeout: 5_000 });
  await expect(controls.locator("[data-account]")).toHaveAttribute("data-account", displayName);
  await closeTopBarControls(page);

  // A reload keeps the Google session (it used to be replaced by a fresh guest
  // because the app signed in anonymously before the saved session loaded).
  await page.reload();
  await expect(allCards(page).first()).toBeVisible({ timeout: 45_000 });
  controls = await topBarControls(page);
  await expect(controls.locator("[data-account]")).toHaveAttribute("data-account", displayName, { timeout: 15_000 });
  await expect(controls.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
  await closeTopBarControls(page);

  // A new browser, device or address (cucoursemap.app) has no saved major in
  // local storage, but the account has plans: the board comes back from the
  // account instead of first run asking for a major again.
  const cards = await allCards(page).count();
  await page.evaluate(() => localStorage.removeItem("cornell-program-v2"));
  await page.reload();
  await expect(allCards(page).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: /I know my major/ })).toHaveCount(0);
  await expect(primarySegment(page)).toHaveAttribute("data-program-id", /cornell-cs-bs/);
  expect(await allCards(page).count()).toBe(cards);
});
