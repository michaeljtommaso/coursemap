import { expect, test, type Locator, type Page } from "@playwright/test";
import { PROGRAM_NAME, allCards, column, waitForStableBoard } from "./helpers";

/**
 * Spec 017 — /classes defaults to the enrollment term (D1, D3, D4, D6, D7, D8).
 *
 * DATA PRECONDITIONS (emulator; never the live project):
 *   - catalog/meta.enrollmentTarget = "SP27" (Spring 2027);
 *   - the catalog index rebuilt with the spec 017 `roster` and `lead` fields
 *     (without them the switch is hidden — States table, "never filter on
 *     missing data");
 *   - catalog/professorRatings built from professorReviews (ratings + the
 *     well-rated chip);
 *   - courseInstructorHistory with one term per course (its own roster), so a
 *     fall-only course like CS 1112 has a FA26 entry ("Last fall (Fall 2026)").
 *   - CS 1112 is fall-only (roster FA26) in this data.
 *
 * The first `beforeAll` checks the precondition on a real /classes visit and
 * SKIPS THE WHOLE FILE, with the reason, when the switch is absent or names a
 * different term — so the suite stays green on an older seed but never
 * silently passes.
 */

const TARGET_SLUG = "SP27";
const TARGET_LABEL = "Spring 2027";
const STORAGE_KEY = "coursemap.classes.targetFilter";
const OFF_ROSTER = { code: "CS 1112", id: "CS-1112", termLabel: "Fall 2026" };
const WELL_RATED = "Well-rated professor (4+ ★, 5+ reviews)";

// ------------------------------------------------------------- precondition

let skipReason: string | null = null;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await page.goto("/classes");
    await expect(page).toHaveTitle(/Coursemap/, { timeout: 15_000 });
    const sw = termSwitch(page);
    await expect(sw.or(countLine(page)).first()).toBeVisible({ timeout: 45_000 });
    // The count line can land a beat before the target/meta; give the switch time.
    const hasSwitch = await sw
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!hasSwitch) {
      skipReason =
        "spec 017 data missing: no enrollment-term switch on /classes (catalog index lacks roster/lead fields, or no enrollmentTarget). Rebuild the emulator index and set catalog/meta.enrollmentTarget = SP27.";
      return;
    }
    const text = (await sw.textContent()) ?? "";
    if (!text.includes(TARGET_LABEL)) {
      skipReason = `spec 017 tests expect enrollmentTarget ${TARGET_SLUG} (${TARGET_LABEL}); the switch reads "${text.trim()}".`;
    }
  } finally {
    await page.close();
  }
});

test.beforeEach(() => {
  test.skip(skipReason !== null, skipReason ?? "");
});

// ------------------------------------------------------------------ helpers

/** The enrollment-term switch, in either state. */
function termSwitch(page: Page): Locator {
  return page.getByRole("button", { name: new RegExp(`${TARGET_LABEL} classes`) });
}

/** "4607 courses" / "12 courses match your filters". */
function countLine(page: Page): Locator {
  return page.locator("main p").filter({ hasText: /^\s*\d+\s+courses?\b/ }).first();
}

async function resultCount(page: Page): Promise<number> {
  const t = (await countLine(page).textContent()) ?? "";
  const m = /(\d+)/.exec(t);
  if (!m) throw new Error(`no result count in "${t}"`);
  return Number(m[1]);
}

function searchBox(page: Page): Locator {
  return page.getByPlaceholder(/Search by code or title/);
}

/** Directory rows (li) currently rendered. */
function rows(page: Page): Locator {
  return page.locator("main ul > li").filter({ has: page.getByRole("button", { name: / — details$/ }) });
}

/** "CS 1112" from a row button's aria-label "CS 1112 Intro… — details". */
async function listedCodes(page: Page): Promise<string[]> {
  const labels = await page
    .getByRole("button", { name: / — details$/ })
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  return labels.map((l) => l.split(" ").slice(0, 2).join(" "));
}

function row(page: Page, code: string): Locator {
  return rows(page).filter({
    has: page.getByRole("button", { name: new RegExp(`^${code.replace(" ", "\\s")}\\s.* — details$`) }),
  });
}

/** Text of every rendered lead-lecturer line, in row order. */
async function leadLines(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="lead-line"]')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()));
}

const TERM_LABEL_RE = /^(Fall|Spring|Summer|Winter) \d{4}:/;

async function openClasses(page: Page): Promise<void> {
  await page.goto("/classes");
  await expect(termSwitch(page)).toBeVisible({ timeout: 45_000 });
  await expect(countLine(page)).toBeVisible();
}

/**
 * Fresh first run on the CS board with a known entering year (Fall 2026), so
 * columns map to terms: sem 1 = Fall 2026 (past), sem 2 = Spring 2027 (the
 * enrollment term), sem 3 = Fall 2027 (after it). helpers.openBoard skips the
 * year step, and without an entering year the board can't name a target column.
 */
async function openBoardEnteringFall2026(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveTitle(/Coursemap/, { timeout: 15_000 });
  await page.getByRole("button", { name: /I know my major/ }).click({ timeout: 45_000 });
  await page
    .getByRole("button", { name: new RegExp(PROGRAM_NAME.replace(/[.,]/g, ".")) })
    .first()
    .click();
  await page.getByRole("button", { name: "Fall 2026" }).click();
  const skip = page.getByRole("button", { name: "Skip for now" });
  await expect(skip.or(allCards(page).first()).first()).toBeVisible({ timeout: 20_000 });
  if (await skip.isVisible()) await skip.click();
  await expect(allCards(page).first()).toBeVisible({ timeout: 45_000 });
  await waitForStableBoard(page);
  // Sanity: the entering year took — sem 2 is labelled Spring 2027.
  await expect(column(page, 2)).toContainText(/Spring\s+2027/);
}

async function boardCourseIds(page: Page): Promise<Set<string>> {
  return new Set(await allCards(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-course") ?? "")));
}

/** Open a directory row's detail panel and wait for the full course doc
 *  (its description), which carries the roster "Place on board" reads. */
async function openRowPanel(page: Page, code: string): Promise<Locator> {
  await row(page, code).getByRole("button", { name: / — details$/ }).click();
  const panel = page.getByRole("dialog", { name: `${code} details` });
  await expect(panel).toBeInViewport();
  await expect(panel.locator("p.leading-relaxed").first()).toBeVisible({ timeout: 15_000 });
  return panel;
}

// -------------------------------------------------------------------- tests

test.describe("/classes enrollment-term filter (spec 017)", () => {
  test("D1: /classes opens filtered to the enrollment term, with no off-roster term labels", async ({ page }) => {
    await openClasses(page);
    const sw = termSwitch(page);
    await expect(sw).toHaveAttribute("aria-pressed", "true");
    await expect(sw).toContainText(`Showing ${TARGET_LABEL} classes`);
    await expect(sw).toContainText("Show all");

    await expect(rows(page).first()).toBeVisible();
    const lines = await leadLines(page);
    expect(lines.length, "some rows carry a lead-lecturer line").toBeGreaterThan(0);
    const labelled = lines.filter((l) => TERM_LABEL_RE.test(l));
    expect(labelled, "no row on the enrollment-term list names another term").toEqual([]);
  });

  test("D1: Show all lists the whole catalog; an off-roster course carries its term label", async ({ page }) => {
    await openClasses(page);
    const onCount = await resultCount(page);

    await termSwitch(page).click();
    await expect(termSwitch(page)).toHaveAttribute("aria-pressed", "false");
    await expect(termSwitch(page)).toContainText(`Show only ${TARGET_LABEL} classes`);
    await expect.poll(() => resultCount(page), { message: "Show all widens the list" }).toBeGreaterThan(onCount);

    await searchBox(page).fill(OFF_ROSTER.code);
    await expect.poll(() => listedCodes(page)).toContain(OFF_ROSTER.code);
    const line = row(page, OFF_ROSTER.code).locator('[data-testid="lead-line"]');
    await expect(line).toHaveText(new RegExp(`^${OFF_ROSTER.termLabel}:\\s*\\S`));
    // Off the enrollment term, the list carries no "not offered" note.
    await expect(page.getByText(`Not offered ${TARGET_LABEL}`)).toHaveCount(0);
  });

  test("D3: the off choice is remembered for this target only", async ({ page }) => {
    await openClasses(page);
    await termSwitch(page).click();
    await expect(termSwitch(page)).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBe(
      JSON.stringify({ target: TARGET_SLUG, on: false })
    );

    await page.reload();
    await expect(termSwitch(page)).toBeVisible({ timeout: 45_000 });
    await expect(termSwitch(page), "remembered off across a reload").toHaveAttribute("aria-pressed", "false");

    // Back on: nothing to remember (on is the default), and a reload opens on.
    await termSwitch(page).click();
    await expect(termSwitch(page)).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBeNull();
    await page.reload();
    await expect(termSwitch(page)).toBeVisible({ timeout: 45_000 });
    await expect(termSwitch(page)).toHaveAttribute("aria-pressed", "true");

    // A stored "off" for an older target no longer applies.
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ target: "FA26", on: false })), STORAGE_KEY);
    await page.reload();
    await expect(termSwitch(page)).toBeVisible({ timeout: 45_000 });
    await expect(termSwitch(page), "a stale target's off is ignored").toHaveAttribute("aria-pressed", "true");
  });

  test("D1: with the switch on, a search with no enrollment-term match falls back with a note", async ({ page }) => {
    await openClasses(page);
    await expect(termSwitch(page)).toHaveAttribute("aria-pressed", "true");
    // The compact code: "CS 1112" with a space also matches the Spring 2027
    // title "Physics 1112 Supplement" ("physi-cs 1112"), so that query HAS an
    // enrollment-term match and correctly shows no fallback.
    await searchBox(page).fill(OFF_ROSTER.code.replace(" ", ""));

    await expect(page.getByRole("status").filter({ hasText: `Not offered ${TARGET_LABEL}` })).toBeVisible();
    await expect.poll(() => listedCodes(page)).toContain(OFF_ROSTER.code);
    await expect(page.getByText(/Nothing matches — try a broader search/)).toHaveCount(0);
    // The switch itself stays on — the fallback is a note, not a toggle.
    await expect(termSwitch(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("D4: an enrollment-term row shows its lead lecturer and rating", async ({ page }) => {
    await openClasses(page);
    // Find a rated, unlabelled line among the rendered rows (loading more if needed).
    let rated: string | undefined;
    for (let i = 0; i < 5 && !rated; i++) {
      rated = (await leadLines(page)).find((l) => !TERM_LABEL_RE.test(l) && l.includes("★") && !l.includes("0.0 ★"));
      if (rated) break;
      const more = page.getByRole("button", { name: /^Load more/ });
      if (!(await more.isVisible())) break;
      await more.click();
    }
    expect(rated, "some enrollment-term row has a rated lead lecturer").toBeTruthy();
    // "Daisy Fan · 3.6 ★ +1": name, middle dot, optional ≈, one-decimal rating, optional +N.
    expect(rated!).toMatch(/^[^:·]+ · ≈?\d\.\d ★( \+\d+)?$/);
  });

  test("D4: a professor with no reviews shows the name only, never 0.0 ★", async ({ page }) => {
    // KNOWN APP BUG (found 2026-10-19, see report): catalog/professorRatings
    // keeps entries with r = 0, c = 0 (RMP's "no ratings yet"; 190 of 1,371 in
    // the emulator), and ratingsFromDoc (src/lib/classes/professorRatings.ts)
    // passes them through, so rows read "Jim Baker · 0.0 ★". The panel path
    // (lib/planner/reviews.ts, `unrated = !doc.count`) already shows the name
    // only. Marked expected-to-fail so the suite stays green; when the bug is
    // fixed this test reports an unexpected pass — then delete this line.
    test.fail(true, "row join shows 0.0 ★ for professors with zero reviews");
    await openClasses(page);
    await searchBox(page).fill("PHYS 1012");
    const line = row(page, "PHYS 1012").locator('[data-testid="lead-line"]');
    await expect(line).toContainText("Jim Baker");
    await expect(line).not.toContainText("★");
  });

  test("D7: the well-rated chip narrows to rows rated 4.0+ (never probable)", async ({ page }) => {
    await openClasses(page);
    const chip = page.getByRole("button", { name: WELL_RATED });
    await expect(chip, "chip shows once ratings load").toBeVisible({ timeout: 20_000 });
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    const before = await resultCount(page);

    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => resultCount(page), { message: "the chip narrows the list" }).toBeLessThan(before);
    const after = await resultCount(page);
    expect(after, "at least one well-rated course").toBeGreaterThan(0);

    const perRow = await rows(page).evaluateAll((lis) =>
      lis.map((li) => (li.querySelector('[data-testid="lead-line"]')?.textContent ?? "").replace(/\s+/g, " ").trim())
    );
    expect(perRow.length).toBeGreaterThan(0);
    for (const line of perRow) {
      expect(line, "every well-rated row shows its lead's rating").toMatch(/ · \d\.\d ★/);
      expect(line, "probable matches never pass").not.toContain("≈");
      const r = Number(/ · (\d\.\d) ★/.exec(line)![1]);
      expect(r, `rating in "${line}"`).toBeGreaterThanOrEqual(4.0);
    }

    // Off again: the list comes back.
    await chip.click();
    await expect.poll(() => resultCount(page)).toBe(before);
  });
});

test.describe("Place on board and future columns (spec 017 D6, D8)", () => {
  test("D6: Place on board highlights the Spring 2027 column; another column still takes the course", async ({ page }) => {
    await openBoardEnteringFall2026(page);
    const onBoard = await boardCourseIds(page);

    await page.getByRole("link", { name: "Classes" }).click();
    await expect(termSwitch(page)).toHaveAttribute("aria-pressed", "true", { timeout: 45_000 });
    await searchBox(page).fill("CS 4");
    await expect.poll(async () => (await listedCodes(page)).length).toBeGreaterThan(0);
    const code = (await listedCodes(page)).find((c) => c.startsWith("CS ") && !onBoard.has(c.replace(" ", "-")));
    expect(code, "an enrollment-term CS course not on the default board").toBeTruthy();
    const id = code!.replace(" ", "-");

    const panel = await openRowPanel(page, code!);
    await panel.getByRole("button", { name: "Place on board" }).click();

    await expect(page).toHaveURL(/\/$/);
    const suggested = page.locator('[data-suggested-target="true"]');
    await expect(suggested).toHaveCount(1);
    await expect(suggested).toHaveAttribute("data-column", "2");
    await expect(suggested).toContainText(/Spring\s+2027/);
    await expect(suggested.locator("[data-suggested-label]")).toHaveText(`Suggested: on the ${TARGET_LABEL} roster`);
    await expect(page.locator("[data-suggested-label]")).toHaveCount(1);
    await expect(suggested).toBeInViewport();

    // Signal, never block: Fall 2027 (sem 3) takes it.
    const add = column(page, 3).getByRole("button", { name: new RegExp(`^Add ${code} to this semester$`) });
    await add.scrollIntoViewIfNeeded();
    await add.click();
    await expect(column(page, 3).locator(`[data-course="${id}"]`)).toHaveCount(1);
    await expect(column(page, 2).locator(`[data-course="${id}"]`)).toHaveCount(0);
    await expect(page.locator("[data-suggested-target]")).toHaveCount(0);
    await expect(page.locator("[data-suggested-label]")).toHaveCount(0);
  });

  test("D6: Place on board for an off-roster course highlights no column", async ({ page }) => {
    await openBoardEnteringFall2026(page);
    expect((await boardCourseIds(page)).has(OFF_ROSTER.id), `${OFF_ROSTER.code} is not on the default board`).toBe(false);

    await page.getByRole("link", { name: "Classes" }).click();
    await expect(termSwitch(page)).toBeVisible({ timeout: 45_000 });
    await termSwitch(page).click();
    await expect(termSwitch(page)).toHaveAttribute("aria-pressed", "false");
    await searchBox(page).fill(OFF_ROSTER.code);
    await expect.poll(() => listedCodes(page)).toContain(OFF_ROSTER.code);

    const panel = await openRowPanel(page, OFF_ROSTER.code);
    await panel.getByRole("button", { name: "Place on board" }).click();

    await expect(page).toHaveURL(/\/$/);
    // Armed (every column offers it) but nothing is suggested.
    await expect(column(page, 2).getByRole("button", { name: `Add ${OFF_ROSTER.code} to this semester`, exact: true })).toBeVisible();
    await expect(page.locator("[data-suggested-target]")).toHaveCount(0);
    await expect(page.locator("[data-suggested-label]")).toHaveCount(0);
  });

  test("D8: a fall-only course in Fall 2027 shows a labelled last-time line (Detailed only)", async ({ page }) => {
    await openBoardEnteringFall2026(page);
    await page.getByRole("button", { name: "Detailed", exact: true }).click();

    // Place CS 1112 into Fall 2027 via /classes (Show all → Place on board → column 3).
    await page.getByRole("link", { name: "Classes" }).click();
    await expect(termSwitch(page)).toBeVisible({ timeout: 45_000 });
    await termSwitch(page).click();
    await searchBox(page).fill(OFF_ROSTER.code);
    await expect.poll(() => listedCodes(page)).toContain(OFF_ROSTER.code);
    const panel = await openRowPanel(page, OFF_ROSTER.code);
    await panel.getByRole("button", { name: "Place on board" }).click();
    await expect(page).toHaveURL(/\/$/);
    const add = column(page, 3).getByRole("button", { name: `Add ${OFF_ROSTER.code} to this semester`, exact: true });
    await add.scrollIntoViewIfNeeded();
    await add.click();

    const placed = column(page, 3).locator(`[data-course="${OFF_ROSTER.id}"]`);
    await expect(placed).toHaveCount(1);
    const line = placed.locator("[data-last-time]");
    await expect(line).toHaveText(/^Last fall \(Fall 2026\): \S/, { timeout: 15_000 });

    // The detail panel repeats it beside the far-column line.
    await waitForStableBoard(page);
    await placed.scrollIntoViewIfNeeded();
    await placed.click({ position: { x: 20, y: 20 } });
    const cardPanel = page.getByRole("dialog", { name: `${OFF_ROSTER.code} details` });
    await expect(cardPanel).toBeInViewport();
    await expect(cardPanel.locator("[data-last-time]")).toHaveText(/^Last fall \(Fall 2026\): \S/, { timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => {
        const b = await cardPanel.boundingBox();
        return !b || b.x >= page.viewportSize()!.width - 1;
      })
      .toBe(true);

    // Compact density drops the line; Detailed brings it back.
    await page.getByRole("button", { name: "Compact", exact: true }).click();
    await expect(page.getByRole("button", { name: "Compact", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(placed.locator("[data-last-time]")).toHaveCount(0);
    await page.getByRole("button", { name: "Detailed", exact: true }).click();
    await expect(placed.locator("[data-last-time]")).toHaveText(/^Last fall \(Fall 2026\): \S/);
  });
});
