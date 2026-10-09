import type { Course, ProgramSlotWithData, SlotCategory } from "@/types/db";
import type { CreditEntry } from "@/lib/schemas";
import type { Placement } from "@/types/plan";
import { assign, programToRequirements, type RequirementInstance } from "./majorMatch";
import { buildMatchPool, programSlotsToMatchInput } from "./matchAdapters";
import { SLOT_CATEGORIES, groupIsLiberal } from "./slotCategory";
import type {
  RequirementGroup,
  RequirementItem,
  RequirementProgress,
  RequirementStatus,
} from "@/hooks/useRequirementProgress";

/**
 * requirementProgress.ts (spec 014 D1/D2) — the PURE core behind
 * useRequirementProgress: the current program's requirements, attributed to
 * the courses on the board by majorMatch.assign (position-independent).
 *
 *   requirements = programToRequirements(programSlotsToMatchInput(templateSlots))
 *                  — one seat per course/pattern/attribute slot, one credit
 *                  pool per DISTINCT elective group (several elective slots of
 *                  one group collapse into that one pool).
 *   courses      = every placement's course (board order, a retake counted
 *                  once) + the credit profile's synthetic courses.
 *
 * Waived requirements are taken OUT of the assignment before it runs, so a
 * course is never consumed by a requirement the student waived — it stays free
 * to fill another one. Waived items still appear (status "waived").
 *
 * Output shape is the useRequirementProgress contract (types live there).
 */

export type RequirementProgressInput = {
  /** The current program's template slots (useBoard().templateSlots). */
  templateSlots: ProgramSlotWithData[];
  placements: Placement[];
  /** courseId → course (enriched when available, so attribute seats see attrs). */
  placedCourses: Record<string, Course>;
  creditProfile: CreditEntry[];
  waivedRequirementIds: string[];
  /** Cross-listing canonicalizer (alias map); identity by default. */
  canonical?: (id: string) => string;
};

/** Group heading per category — the plural, list-heading form of
 *  CATEGORY_META's labels ("CS electives"-style headings read as a list). */
export const GROUP_LABELS: Record<SlotCategory | "other", string> = {
  math: "Math",
  science: "Science",
  core: "Engineering core",
  liberal: "Liberal studies",
  elective: "Electives",
  fws: "Writing seminars",
  pe: "Phys ed",
  other: "Other requirements",
};

const GROUP_ORDER: (SlotCategory | "other")[] = [...SLOT_CATEGORIES, "other"];

type ReqMeta = { category: SlotCategory | null; suggestedSem: number | null };

/** Category + suggested semester per requirement id. Seats read their own slot;
 *  a pool reads the first (earliest) elective slot of its group, falling back
 *  to liberal-vs-elective by the group itself when no slot carries a category. */
function requirementMeta(templateSlots: ProgramSlotWithData[]): Map<string, ReqMeta> {
  const meta = new Map<string, ReqMeta>();
  for (const s of templateSlots) {
    const sem = Number.isFinite(s.suggested_semester) ? s.suggested_semester : null;
    if (s.kind === "elective") {
      const gid = s.elective_group_id ?? s.elective_groups?.id;
      if (!gid) continue;
      const prev = meta.get(gid);
      const fallback: SlotCategory = groupIsLiberal({
        id: gid,
        qualifyingRule: s.elective_groups?.qualifying_rule as { type?: string; category?: string } | undefined,
      })
        ? "liberal"
        : "elective";
      const category = prev?.category ?? s.category ?? fallback;
      const suggestedSem =
        prev?.suggestedSem != null && sem != null
          ? Math.min(prev.suggestedSem, sem)
          : (prev?.suggestedSem ?? sem);
      meta.set(gid, { category, suggestedSem });
    } else {
      meta.set(s.id, { category: s.category ?? null, suggestedSem: sem });
    }
  }
  return meta;
}

function poolMinCredits(r: RequirementInstance): number {
  return r.kind === "pool" ? r.minCredits : r.credits;
}

/** The pure transformation (unit-tested). */
export function computeRequirementProgress(input: RequirementProgressInput): RequirementProgress {
  const {
    templateSlots,
    placements,
    placedCourses,
    creditProfile,
    waivedRequirementIds,
    canonical = (id: string) => id,
  } = input;

  const requirements = programToRequirements(programSlotsToMatchInput(templateSlots));
  if (requirements.length === 0) {
    return { groups: [], attribution: {}, satisfiedCount: 0, total: 0 };
  }

  const waived = new Set(waivedRequirementIds);
  const active = requirements.filter((r) => !waived.has(r.id));

  const pool = buildMatchPool({ placements, placedCourses, creditProfile });
  const result = assign(pool, active, canonical);

  // canonical course id → the ONE placement that carries it into the pool:
  // board order (sem, order), first wins — mirrors buildMatchPool's dedup, so a
  // course placed twice is attributed to its first placement only.
  const placementByCourse = new Map<string, string>();
  const ordered = placements
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.sem - b.p.sem || a.p.order - b.p.order || a.i - b.i);
  for (const { p } of ordered) {
    const cid = canonical(p.courseId);
    if (!placementByCourse.has(cid)) placementByCourse.set(cid, p.id);
  }

  // requirement id → covering placement ids + counted credits.
  const coveredBy = new Map<string, string[]>();
  const countedCredits = new Map<string, number>();
  for (const m of result.matched) {
    countedCredits.set(m.requirementId, (countedCredits.get(m.requirementId) ?? 0) + m.credits);
    const pid = placementByCourse.get(m.courseId);
    if (!pid) continue; // satisfied by credit (no placement on the board)
    const list = coveredBy.get(m.requirementId) ?? [];
    list.push(pid);
    coveredBy.set(m.requirementId, list);
  }

  const meta = requirementMeta(templateSlots);
  const labelById = new Map(requirements.map((r) => [r.id, r.label]));

  const items: RequirementItem[] = requirements.map((r) => {
    const m = meta.get(r.id) ?? { category: null, suggestedSem: null };
    let status: RequirementStatus;
    if (waived.has(r.id)) {
      status = "waived";
    } else {
      const counted = countedCredits.get(r.id) ?? 0;
      if (counted <= 0) status = "unmet";
      else if (r.kind === "pool" && counted < poolMinCredits(r)) status = "partial";
      else status = "satisfied";
    }
    return {
      id: r.id,
      label: r.label,
      category: m.category,
      suggestedSem: m.suggestedSem,
      status,
      coveredBy: status === "waived" ? [] : (coveredBy.get(r.id) ?? []),
      checkable: r.kind !== "pool" || r.computable,
    };
  });

  // Attribution: placement → labels of the requirements it counts toward.
  const attribution: Record<string, string[]> = {};
  for (const [reqId, pids] of coveredBy) {
    const label = labelById.get(reqId);
    if (!label) continue;
    for (const pid of pids) (attribution[pid] ??= []).push(label);
  }

  // Group by category (stable taxonomy order), items by suggested sem then label.
  const byKey = new Map<string, RequirementItem[]>();
  for (const it of items) {
    const key = it.category ?? "other";
    const list = byKey.get(key) ?? [];
    list.push(it);
    byKey.set(key, list);
  }
  const isDone = (it: RequirementItem) => it.status === "satisfied" || it.status === "waived";
  const groups: RequirementGroup[] = [];
  for (const key of GROUP_ORDER) {
    const list = byKey.get(key);
    if (!list || list.length === 0) continue;
    list.sort(compareBySemester);
    groups.push({
      key,
      label: GROUP_LABELS[key],
      items: list,
      satisfiedCount: list.filter(isDone).length,
      total: list.length,
    });
  }

  return {
    groups,
    attribution,
    satisfiedCount: items.filter(isDone).length,
    total: items.length,
  };
}

/** Suggested semester ascending (unknown last), then label. */
export function compareBySemester(a: RequirementItem, b: RequirementItem): number {
  const sa = a.suggestedSem ?? Number.POSITIVE_INFINITY;
  const sb = b.suggestedSem ?? Number.POSITIVE_INFINITY;
  if (sa !== sb) return sa - sb;
  return a.label.localeCompare(b.label);
}

/** The "By semester" view: every not-yet-done item (unmet + partial), flat, in
 *  suggested-semester order. */
export function itemsBySemester(progress: RequirementProgress): RequirementItem[] {
  return progress.groups
    .flatMap((g) => g.items)
    .filter((it) => it.status === "unmet" || it.status === "partial")
    .sort(compareBySemester);
}

/** Structural equality for the hook's reference-stability guard. */
export function sameProgress(a: RequirementProgress, b: RequirementProgress): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
