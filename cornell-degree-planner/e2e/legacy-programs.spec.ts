import { expect, test, type Page } from "@playwright/test";

/**
 * Spec 019 D12 — retired program ids read as their current programs.
 *
 * Information Science and Communication moved from Engineering-format program
 * files to CALS layer programs. A saved plan keeps the OLD program id and old
 * waiver ids; the app translates them on read (lib/planner/legacyPrograms.ts).
 * Each test seeds such a plan through the Firestore EMULATOR with admin
 * privileges (the shape a pre-migration student has), points the profile and
 * the persisted program selection at the old id, reloads, and checks:
 *
 *   as seeded (both majors are "hidden" in the program index) the panel shows
 *   the "being reviewed" notice and no rows, and never "Program not found";
 *   with the major made visible in the emulator's program index, the panel
 *   shows the NEW program's layer rows, the mapped waivers are waived, the
 *   unmapped ones are not, and the console stays clean.
 *
 * Emulator only: every write goes to 127.0.0.1:8080 (Firestore emulator REST,
 * `Authorization: Bearer owner`). The program index is restored afterwards.
 */

const FIRESTORE = "http://127.0.0.1:8080/v1/projects/degree-planner-app/databases/(default)/documents";
const ADMIN = { Authorization: "Bearer owner", "Content-Type": "application/json" };

type FsValue = Record<string, unknown>;

function toValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  const fields: Record<string, FsValue> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) fields[k] = toValue(x);
  return { mapValue: { fields } };
}

function toFields(o: Record<string, unknown>): Record<string, FsValue> {
  return (toValue(o) as { mapValue: { fields: Record<string, FsValue> } }).mapValue.fields;
}

async function patchDoc(path: string, data: Record<string, unknown>, maskPaths: string[]): Promise<void> {
  const mask = maskPaths.map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join("&");
  const res = await fetch(`${FIRESTORE}/${path}?${mask}`, {
    method: "PATCH",
    headers: ADMIN,
    body: JSON.stringify({ fields: toFields(data) }),
  });
  if (!res.ok) throw new Error(`emulator write ${path} failed: ${res.status} ${await res.text()}`);
}

async function docExists(path: string): Promise<boolean> {
  const res = await fetch(`${FIRESTORE}/${path}`, { headers: ADMIN });
  return res.ok;
}

/** The signed-in anonymous user's uid, read from the Firebase auth store. */
async function currentUid(page: Page): Promise<string> {
  return await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open("firebaseLocalStorageDb");
        open.onerror = () => reject(new Error("cannot open the auth store"));
        open.onsuccess = () => {
          const all = open.result.transaction("firebaseLocalStorage").objectStore("firebaseLocalStorage").getAll();
          all.onerror = () => reject(new Error("cannot read the auth store"));
          all.onsuccess = () => {
            const row = (all.result as { value?: { uid?: string } }[]).find((r) => r.value?.uid);
            if (row?.value?.uid) resolve(row.value.uid);
            else reject(new Error("no signed-in user in the auth store"));
          };
        };
      }),
  );
}

/** Set one program's `status` in the emulator's catalog/programIndex; returns the previous value. */
async function setIndexStatus(programId: string, status: "visible" | "hidden"): Promise<string> {
  const res = await fetch(`${FIRESTORE}/catalog/programIndex`, { headers: ADMIN });
  if (!res.ok) throw new Error(`program index unreadable: ${res.status}`);
  const doc = (await res.json()) as {
    fields: { entries: { arrayValue: { values: { mapValue: { fields: Record<string, { stringValue?: string }> } }[] } } };
  };
  const values = doc.fields.entries.arrayValue.values;
  const entry = values.find((v) => v.mapValue.fields.id?.stringValue === programId);
  if (!entry) throw new Error(`${programId} is not in the emulator program index (seed it first)`);
  const previous = entry.mapValue.fields.status?.stringValue ?? "visible";
  entry.mapValue.fields.status = { stringValue: status };
  const put = await fetch(`${FIRESTORE}/catalog/programIndex?updateMask.fieldPaths=entries`, {
    method: "PATCH",
    headers: ADMIN,
    body: JSON.stringify({ fields: { entries: doc.fields.entries } }),
  });
  if (!put.ok) throw new Error(`program index write failed: ${put.status} ${await put.text()}`);
  return previous;
}

const req = (page: Page, id: string) => page.locator(`[data-requirement="${id}"]`);

type Case = {
  name: string;
  oldId: string;
  newId: string;
  placed: { courseId: string; sem: number }[];
  /** Old requirement ids on the saved plan: some map to a layer row, some are dropped. */
  oldWaivers: string[];
  /** Layer rows (rowId within newId) the mapped waivers must produce. */
  waivedRows: string[];
  /** Rows that must NOT be waived (they cover the dropped ids and a placed course). */
  notWaivedRows: string[];
  /** A placed, non-waived course must satisfy this row. */
  satisfiedRow: string;
};

const CASES: Case[] = [
  {
    name: "Information Science",
    oldId: "cornell-infosci-bs-2025",
    newId: "cornell-information-science-bs-2026",
    placed: [
      { courseId: "INFO-1300", sem: 1 },
      { courseId: "INFO-2450", sem: 2 },
    ],
    // core-web and electives map; fwis, liberal-studies and free-elective are dropped.
    oldWaivers: ["infosci-s1-info1300", "infosci-elective", "infosci-s1-fwis", "liberal-studies", "free-elective"],
    waivedRows: ["core-web", "electives"],
    notWaivedRows: ["core-ethics", "programming", "calculus", "statistics"],
    satisfiedRow: "core-communication",
  },
  {
    name: "Communication",
    oldId: "cornell-comm-bs-2025",
    newId: "cornell-communication-bs-2026",
    placed: [
      { courseId: "COMM-1111", sem: 1 },
      { courseId: "COMM-1101", sem: 1 },
    ],
    // core-three and found-navigating-major map; the PE seat and free elective are dropped.
    oldWaivers: ["comm-core-choice", "comm-s1-comm1111", "comm-s1-pe", "free-elective"],
    waivedRows: ["core-three", "found-navigating-major"],
    notWaivedRows: ["found-visual-comm", "data-research-methods", "practicum"],
    satisfiedRow: "found-intro-comm",
  },
];

for (const c of CASES) {
  test(`a saved ${c.name} plan on the retired program id reads as the new program (spec 019 D12)`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const planId = `legacy-${c.oldId}`;
    let indexStatusBefore: string | null = null;

    try {
      // 1. A fresh anonymous user, so a profile doc exists (first run shows).
      await page.goto("/");
      await expect(page).toHaveTitle(/Coursemap/, { timeout: 15_000 });
      await expect(page.getByRole("button", { name: /I know my major/ })).toBeVisible({ timeout: 45_000 });
      // The auth store is written just after sign-in; poll until the uid is there.
      let uid = "";
      await expect
        .poll(async () => (uid = await currentUid(page).catch(() => "")), { timeout: 30_000 })
        .not.toBe("");
      await expect.poll(() => docExists(`users/${uid}`), { timeout: 30_000 }).toBe(true);

      // 2. The saved plan, written the way a pre-migration plan sits in Firestore.
      const placements = c.placed.map((p, i) => ({ id: `pl-${i + 1}`, courseId: p.courseId, sem: p.sem, order: i }));
      const courseSnapshots: Record<string, unknown> = {};
      for (const p of c.placed) {
        const [subject, number] = p.courseId.split("-");
        courseSnapshots[p.courseId] = {
          id: p.courseId,
          subject,
          number,
          title: p.courseId.replace("-", " "),
          creditsMin: 3,
          creditsMax: 3,
        };
      }
      const now = new Date();
      await patchDoc(
        `users/${uid}/plans/${planId}`,
        {
          name: `${c.name} (saved before the move)`,
          programId: c.oldId,
          placements,
          courseSnapshots,
          completedIds: [],
          inProgressIds: [],
          waivedRequirementIds: c.oldWaivers,
          schemaVersion: 3,
          createdAt: now,
          updatedAt: now,
        },
        ["name", "programId", "placements", "courseSnapshots", "completedIds", "inProgressIds", "waivedRequirementIds", "schemaVersion"],
      );
      // The profile points at it and already holds the college answers, so the
      // CALS rules resolve without asking (entry term FA25, not a transfer).
      await patchDoc(
        `users/${uid}`,
        { activePlanId: planId, prefs: { enteringYear: 2025, entryTerm: "FA25", transfer: "none", college: "cals" } },
        ["activePlanId", "prefs.enteringYear", "prefs.entryTerm", "prefs.transfer", "prefs.college"],
      );

      // 3. The browser's persisted selection is the OLD id (zustand persist).
      await page.evaluate((oldId) => {
        localStorage.setItem(
          "cornell-program-v2",
          JSON.stringify({ state: { selectedProgramId: oldId, customTemplates: [] }, version: 1 }),
        );
      }, c.oldId);

      // 4. As seeded the major is hidden: the panel says it is under review.
      await page.reload();
      await expect(page.locator("[data-requirement-notice='under-review']")).toContainText("being reviewed", { timeout: 45_000 });
      await expect(page.locator("[data-requirement]")).toHaveCount(0);
      await expect(page.getByText(/Program not found/i)).toHaveCount(0);

      // 5. Make the major visible in the emulator's index and look at the rows.
      indexStatusBefore = await setIndexStatus(c.newId, "visible");
      await page.reload();
      await expect(page.locator("[data-requirement-notice='under-review']")).toHaveCount(0, { timeout: 45_000 });
      await expect(page.locator(`[data-requirement^="${c.newId}:"]`).first()).toBeAttached({ timeout: 45_000 });
      await expect(page.getByText(/Program not found/i)).toHaveCount(0);

      // Waived and satisfied rows sit under the collapsed "Satisfied (n)" list.
      await page.getByRole("button", { name: /^Satisfied \(/ }).click({ timeout: 15_000 });

      // The mapped waivers render as waived, in both the status and the row text.
      for (const row of c.waivedRows) {
        const el = req(page, `${c.newId}:${row}`);
        await expect(el, `${row} should be waived`).toHaveAttribute("data-status", "waived", { timeout: 15_000 });
        await expect(el).toContainText("Waived");
      }
      // The dropped ones waive nothing: only the mapped rows are waived, anywhere.
      const waivedIds = await page.locator('[data-requirement][data-status="waived"]').evaluateAll((els) =>
        els.map((e) => e.getAttribute("data-requirement")).sort(),
      );
      expect(waivedIds).toEqual(c.waivedRows.map((r) => `${c.newId}:${r}`).sort());
      for (const row of c.notWaivedRows) {
        const el = req(page, `${c.newId}:${row}`);
        if ((await el.count()) > 0) await expect(el).not.toHaveAttribute("data-status", "waived");
      }
      // A placed course still counts toward its row.
      await expect(req(page, `${c.newId}:${c.satisfiedRow}`)).toHaveAttribute("data-status", "satisfied");
      // The plan still holds its courses.
      for (const p of c.placed) {
        await expect(page.locator(`[data-placement][data-course="${p.courseId}"]`)).toHaveCount(1, { timeout: 15_000 });
      }

      // Report what the panel showed (visible in the run output).
      const rows = await page.locator("[data-requirement]").evaluateAll((els) =>
        els.map((e) => `${e.getAttribute("data-requirement")}=${e.getAttribute("data-status")}`),
      );
      const notices = await page.locator("[data-requirement-notice]").evaluateAll((els) =>
        els.map((e) => `${e.getAttribute("data-requirement-notice")}: ${(e.textContent ?? "").trim().slice(0, 120)}`),
      );
      console.log(`[${c.name}] rows (${rows.length}): ${rows.join(" | ")}`);
      console.log(`[${c.name}] notices: ${notices.join(" | ") || "none"}`);

      expect(errors.filter((e) => !/favicon|ResizeObserver/.test(e))).toEqual([]);
    } finally {
      if (indexStatusBefore) await setIndexStatus(c.newId, indexStatusBefore as "visible" | "hidden").catch(() => {});
    }
  });
}
