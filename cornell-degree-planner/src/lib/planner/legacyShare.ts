import { snapshotToCourse } from "@/lib/normalize/courseSnapshot";
import { clampSem, normalizePlacementOrder, sanitizePlacements } from "@/lib/planner/placementOps";
import { slotCredits } from "@/lib/planner/semesters";
import { PLAN_SCHEMA_VERSION } from "@/lib/schemas";
import type { Placement } from "@/types/plan";
import type { Course, ProgramSlotWithData } from "@/types/db";

/**
 * legacyShare (spec 014 "Dependencies and blast radius" → Shares) — the PURE
 * read model behind ShareView, for BOTH share shapes. Share docs are immutable:
 * a link minted before spec 014 holds the OLD slot shape forever, so ShareView
 * reads both shapes. Read-only by construction — nothing here writes anywhere.
 *
 * NEW shape (schemaVersion ≥ 3): placements + courseSnapshots + completedIds /
 * inProgressIds (placement ids) + waivedRequirementIds. Adapted as-is.
 *
 * OLD shape (schemaVersion ≤ 2, the pre-014 slot model — firestore.rules
 * isOldShareShape): slotSelections {slotId → courseId}, completedSlotIds /
 * inProgressSlotIds / waivedSlotIds (slot ids), courseSnapshots
 * {courseId → snapshot}, slotOverrides {slotId → {sem?, removed?}}, customSlots
 * [{id, sem, title?}]. The template (requirement) slots are NOT in the share —
 * the caller fetches the program doc read-only and passes its slots.
 *
 * OLD → read-model mapping rules (adaptLegacyShare):
 *   1. Effective slots = template slots minus `removed` overrides, with an
 *      override `sem` replacing suggested_semester, plus the custom slots
 *      (after every template slot, in their stored order) — exactly the old
 *      board's merge. A removed slot drops with its selection and marks.
 *   2. Each effective slot yields AT MOST one placement, whose id IS the slot
 *      id (so the old marks map 1:1):
 *        - a user selection (slotSelections[slot.id]) → that course, its
 *          display from courseSnapshots (else derived from the id);
 *        - else a course-kind template slot → its template course
 *          (from the program doc);
 *        - else (an empty elective / pattern / attribute / custom bucket) →
 *          a placement ONLY when the bucket was marked completed or in
 *          progress (bucket completion, spec 005 §11: a student finished
 *          "First-Year Writing Seminar" without naming the course). It
 *          renders as a requirement card (see `buckets`). An unmarked empty
 *          bucket is dropped — the board holds courses, not containers (D1).
 *   3. Waived slots: a waived, UNMARKED slot showing only its TEMPLATE course
 *      is dropped (the student isn't taking it — the requirement was waived);
 *      a waived slot holding a course the user CHOSE keeps it. A slot that is
 *      both waived and completed/in progress keeps its card — the old view's
 *      precedence was Complete > In progress > Waived (spec 006 §B.1).
 *      waivedRequirementIds = the waived TEMPLATE slot ids (custom slots were
 *      never requirements).
 *   4. De-duplication (the pre-014 "duplicate" bug, sweep D9): when a
 *      template-default course is also a user selection elsewhere, the user's
 *      placement wins; the default is dropped and its mark (if any) carries
 *      over to the kept placement when that one has none.
 *   5. Semester: override sem ?? the slot's semester (custom: its own sem),
 *      clamped to 1..10. Order within a column = template order (slot_row,
 *      then template array order); custom slots after the template's (the old
 *      board put them at row 900+i). Renumbered dense 0..n-1.
 *   6. Marks: completedIds = completedSlotIds ∩ produced placements;
 *      inProgressIds likewise, minus anything completed (Complete wins,
 *      spec 006 §B.1).
 *   7. A selection whose slot is in neither the template nor customSlots (the
 *      program doc changed or failed to load) is placed only if its override
 *      carries a sem; otherwise it can't be positioned and is dropped.
 *   8. No placement cap: this is a display model, never written back.
 */

/** A requirement card (rule 2's marked empty bucket) — no course to name. */
export type ShareBucket = {
  /** Short code-row label: "CS 111x", "Elective". */
  label: string;
  /** Body line: the group / pattern title, or "Any course". */
  title: string;
  credits: { min: number; max: number } | null;
};

export type ShareReadModel = {
  placements: Placement[];
  /** courseId → display Course for every placement (buckets excluded). */
  courses: Record<string, Course>;
  completedIds: string[];
  inProgressIds: string[];
  waivedRequirementIds: string[];
  /** placement id → requirement-card display, for marked empty buckets. */
  buckets: Record<string, ShareBucket>;
};

/** A share is OLD-shape when it predates the placement schemaVersion. */
export function isLegacyShare(share: { schemaVersion: number }): boolean {
  return share.schemaVersion < PLAN_SCHEMA_VERSION;
}

// ─── defensive readers (old fields arrive as passthrough `unknown`) ──────────

type Override = { sem?: number; removed?: boolean };
type CustomSlot = { id: string; sem: number; title?: string };

export type LegacyShareFields = {
  slotSelections: Record<string, string>;
  completedSlotIds: string[];
  inProgressSlotIds: string[];
  waivedSlotIds: string[];
  courseSnapshots: Record<string, unknown>;
  slotOverrides: Record<string, Override>;
  customSlots: CustomSlot[];
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/** Read the pre-014 fields off a share doc, tolerating absent/garbled values
 *  (v1 shares predate inProgressSlotIds / slotOverrides / customSlots). */
export function readLegacyShareFields(doc: Record<string, unknown>): LegacyShareFields {
  const slotSelections: Record<string, string> = {};
  if (isObj(doc.slotSelections)) {
    for (const [k, v] of Object.entries(doc.slotSelections)) {
      if (typeof v === "string" && v) slotSelections[k] = v;
    }
  }
  const slotOverrides: Record<string, Override> = {};
  if (isObj(doc.slotOverrides)) {
    for (const [k, v] of Object.entries(doc.slotOverrides)) {
      if (!isObj(v)) continue;
      const o: Override = {};
      if (typeof v.sem === "number" && Number.isFinite(v.sem)) o.sem = v.sem;
      if (v.removed === true) o.removed = true;
      slotOverrides[k] = o;
    }
  }
  const customSlots: CustomSlot[] = [];
  if (Array.isArray(doc.customSlots)) {
    for (const c of doc.customSlots) {
      if (!isObj(c) || typeof c.id !== "string" || !c.id) continue;
      const sem = typeof c.sem === "number" ? c.sem : 1;
      customSlots.push(
        typeof c.title === "string" && c.title ? { id: c.id, sem, title: c.title } : { id: c.id, sem }
      );
    }
  }
  return {
    slotSelections,
    completedSlotIds: strList(doc.completedSlotIds),
    inProgressSlotIds: strList(doc.inProgressSlotIds),
    waivedSlotIds: strList(doc.waivedSlotIds),
    courseSnapshots: isObj(doc.courseSnapshots) ? doc.courseSnapshots : {},
    slotOverrides,
    customSlots,
  };
}

// ─── new shape ───────────────────────────────────────────────────────────────

/** Read model for a NEW-shape share (schemaVersion ≥ 3). */
export function adaptCurrentShare(share: {
  placements: unknown;
  courseSnapshots: Record<string, unknown>;
  completedIds: string[];
  inProgressIds: string[];
  waivedRequirementIds: string[];
}): ShareReadModel {
  const placements = sanitizePlacements(share.placements);
  const courses: Record<string, Course> = {};
  for (const p of placements) {
    courses[p.courseId] ??= snapshotToCourse(p.courseId, share.courseSnapshots[p.courseId]);
  }
  const ids = new Set(placements.map((p) => p.id));
  const completed = share.completedIds.filter((id) => ids.has(id));
  const done = new Set(completed);
  return {
    placements,
    courses,
    completedIds: completed,
    inProgressIds: share.inProgressIds.filter((id) => ids.has(id) && !done.has(id)),
    waivedRequirementIds: [...share.waivedRequirementIds],
    buckets: {},
  };
}

// ─── old shape ───────────────────────────────────────────────────────────────

type Mark = "completed" | "in-progress" | null;

type Entry = {
  id: string; // slot id → placement id
  sem: number;
  rank: number; // template order key
  source: "selection" | "default" | "bucket";
  course: Course | null; // null for buckets
  bucket: ShareBucket | null;
  mark: Mark;
};

const CUSTOM_ROW_BASE = 900; // the old board's custom-slot row (slot_row 900+i)

function bucketFor(slot: ProgramSlotWithData): ShareBucket {
  const label =
    slot.kind === "pattern" && slot.pattern
      ? slot.pattern.replace(/-/g, " ")
      : slot.kind === "pattern"
        ? "Pattern"
        : "Elective";
  const title = slot.elective_groups?.name ?? slot.pattern_title ?? "Any course";
  return { label, title, credits: slotCredits(slot, null) };
}

/**
 * Read model for an OLD-shape share. `templateSlots` are the share's program
 * slots (services/programs.ts fetchProgram), or [] when the program can't be
 * read. Mapping rules: see the module comment.
 */
export function adaptLegacyShare(
  fields: LegacyShareFields,
  templateSlots: ProgramSlotWithData[]
): ShareReadModel {
  const {
    slotSelections,
    completedSlotIds,
    inProgressSlotIds,
    waivedSlotIds,
    courseSnapshots,
    slotOverrides,
    customSlots,
  } = fields;
  const completed = new Set(completedSlotIds);
  const inProgress = new Set(inProgressSlotIds);
  const waived = new Set(waivedSlotIds);
  const markOf = (id: string): Mark =>
    completed.has(id) ? "completed" : inProgress.has(id) ? "in-progress" : null;
  const selectedCourse = (courseId: string) => snapshotToCourse(courseId, courseSnapshots[courseId]);

  const entries: Entry[] = [];
  const seenSlotIds = new Set<string>();

  // (1)+(2) template slots, in template order.
  templateSlots.forEach((slot, i) => {
    seenSlotIds.add(slot.id);
    const ov = slotOverrides[slot.id];
    if (ov?.removed) return;
    const sem = clampSem(ov?.sem ?? slot.suggested_semester);
    // Template order: slot_row, then array position (sub-row tiebreak).
    const rank = slot.slot_row * 10_000 + i;
    const selection = slotSelections[slot.id];
    const mark = markOf(slot.id);
    if (selection) {
      entries.push({ id: slot.id, sem, rank, source: "selection", course: selectedCourse(selection), bucket: null, mark });
      return;
    }
    if (slot.kind === "course" && (slot.courses || slot.course_id)) {
      if (waived.has(slot.id) && !mark) return; // (3) waived template course: not taken
      const course =
        slot.courses ?? selectedCourse(slot.course_id as string); // course_id-only slot: snapshot/id fallback
      entries.push({ id: slot.id, sem, rank, source: "default", course, bucket: null, mark });
      return;
    }
    if (mark) {
      entries.push({ id: slot.id, sem, rank, source: "bucket", course: null, bucket: bucketFor(slot), mark });
    }
  });

  // (1)+(2) custom slots, after the template's rows.
  customSlots.forEach((c, i) => {
    seenSlotIds.add(c.id);
    const ov = slotOverrides[c.id];
    if (ov?.removed) return; // never written for customs, but honour it
    const sem = clampSem(c.sem);
    const rank = (CUSTOM_ROW_BASE + i) * 10_000;
    const selection = slotSelections[c.id];
    const mark = markOf(c.id);
    if (selection) {
      entries.push({ id: c.id, sem, rank, source: "selection", course: selectedCourse(selection), bucket: null, mark });
    } else if (mark) {
      entries.push({
        id: c.id,
        sem,
        rank,
        source: "bucket",
        course: null,
        bucket: { label: "Elective", title: c.title ?? "Any course", credits: { min: 3, max: 3 } },
        mark,
      });
    }
  });

  // (7) orphan selections: placeable only with an override sem.
  for (const [slotId, courseId] of Object.entries(slotSelections)) {
    if (seenSlotIds.has(slotId)) continue;
    const ov = slotOverrides[slotId];
    if (ov?.removed || ov?.sem == null) continue;
    entries.push({
      id: slotId,
      sem: clampSem(ov.sem),
      rank: Number.MAX_SAFE_INTEGER,
      source: "selection",
      course: selectedCourse(courseId),
      bucket: null,
      mark: markOf(slotId),
    });
  }

  // (4) de-duplicate template defaults against user selections.
  const selectionByCourse = new Map<string, Entry>();
  for (const e of entries) {
    if (e.source === "selection" && e.course && !selectionByCourse.has(e.course.id)) {
      selectionByCourse.set(e.course.id, e);
    }
  }
  const kept = entries.filter((e) => {
    if (e.source !== "default" || !e.course) return true;
    const owner = selectionByCourse.get(e.course.id);
    if (!owner) return true;
    if (e.mark === "completed" || (e.mark === "in-progress" && owner.mark === null)) owner.mark = e.mark;
    return false;
  });

  // (5) order: sem, then template rank → dense 0..n-1 per column.
  kept.sort((a, b) => a.sem - b.sem || a.rank - b.rank);
  const placements: Placement[] = [];
  const courses: Record<string, Course> = {};
  const buckets: Record<string, ShareBucket> = {};
  const completedIds: string[] = [];
  const inProgressIds: string[] = [];
  for (const e of kept) {
    // A bucket has no course; its placement carries a synthetic, never-fetched
    // id so it can never collide with (or be mistaken for) a real course.
    const courseId = e.course ? e.course.id : `requirement:${e.id}`;
    placements.push({ id: e.id, courseId, sem: e.sem, order: placements.length });
    if (e.course) courses[e.course.id] ??= e.course;
    if (e.bucket) buckets[e.id] = e.bucket;
    if (e.mark === "completed") completedIds.push(e.id);
    else if (e.mark === "in-progress") inProgressIds.push(e.id);
  }

  const templateIds = new Set(templateSlots.map((s) => s.id));
  return {
    placements: normalizePlacementOrder(placements),
    courses,
    completedIds,
    inProgressIds,
    waivedRequirementIds: waivedSlotIds.filter((id) => templateIds.has(id)),
    buckets,
  };
}
