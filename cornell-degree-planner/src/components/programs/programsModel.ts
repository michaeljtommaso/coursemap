import type { AdditionalProgram, MinorIndexEntry } from "@/lib/schemas";
import type { LayerSharing } from "@/lib/planner/distribution/types";
import type {
  OverlapPair,
  ProgramColor,
  ProgramSection,
  RequirementProgress,
} from "@/hooks/useRequirementProgress";
import type { Program } from "@/types/db";
import { courseCode } from "@/lib/planner/questions/registry";
import { programColorFor } from "@/lib/planner/programColors";
import { programCollegeId, programIsVisible, collegeShortName } from "@/lib/planner/colleges";

/**
 * programsModel (spec 047 D5) — the pure half of the program stack, the
 * "Your programs" panel and the add picker: which segments show, what each
 * says, which programs the picker offers and why some are disabled, and the
 * toast and overlap wording. No React, so every rule is unit-tested.
 */

export type ProgramKindLabel = "primary" | "secondMajor" | "minor";

/** One program on the plan, as the stack and the panel show it. */
export type ProgramEntry = {
  id: string;
  kind: ProgramKindLabel;
  name: string;
  shortName: string;
  /** null: the primary (ink). */
  color: ProgramColor | null;
  pct: number;
  done: number;
  total: number;
  status: "ok" | "loading" | "unavailable";
};

export type NameLookup = (id: string, kind: "major" | "minor") => { name: string; shortName: string } | null;

/** Program-id prefixes match an id the way the `program` rule leaf does:
 *  "cornell-aem-bs" matches itself and "cornell-aem-bs-2026". */
export function matchesProgramPrefix(id: string | null | undefined, prefixes: readonly string[] | undefined): boolean {
  if (!id || !prefixes) return false;
  return prefixes.some((p) => id === p || id.startsWith(`${p}-`));
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** The primary's entry: its section when the engine reports one, else the
 *  top-level numbers (which keep meaning the primary degree, D14). */
export function primaryEntry(
  programId: string,
  program: Pick<Program, "name" | "short_name"> | undefined,
  progress: Pick<RequirementProgress, "sections" | "pct" | "satisfiedCount" | "total">
): ProgramEntry {
  const section = progress.sections?.find((s) => s.kind === "primary");
  const done = section?.satisfiedCount ?? progress.satisfiedCount;
  const total = section?.total ?? progress.total;
  const pct = section?.pct ?? progress.pct ?? (total > 0 ? (done / total) * 100 : 0);
  return {
    id: programId,
    kind: "primary",
    name: program?.name ?? section?.name ?? programId,
    shortName: program?.short_name ?? section?.shortName ?? programId,
    color: null,
    pct: clampPct(pct),
    done,
    total,
    status: section?.status ?? (total > 0 ? "ok" : "loading"),
  };
}

/** The plan's extra programs in the order added, each with its color and its
 *  section's numbers ("loading" until the engine reports the section). */
export function extraEntries(
  list: readonly AdditionalProgram[],
  sections: readonly ProgramSection[] | undefined,
  names: NameLookup
): ProgramEntry[] {
  return list.map((p, i) => {
    const section = sections?.find((s) => s.id === p.programId && s.kind !== "college" && s.kind !== "primary");
    const looked = names(p.programId, p.kind);
    return {
      id: p.programId,
      kind: p.kind === "major" ? "secondMajor" : "minor",
      name: section?.name ?? looked?.name ?? p.programId,
      shortName: section?.shortName ?? looked?.shortName ?? p.programId,
      color: section?.color ?? programColorFor(i),
      pct: clampPct(section?.pct ?? 0),
      done: section?.satisfiedCount ?? 0,
      total: section?.total ?? 0,
      status: section?.status ?? "loading",
    };
  });
}

/** The short figure beside a segment's name: majors a percent, minors "3/6"
 *  (D5); nothing while the numbers aren't in yet. */
export function segmentValue(e: ProgramEntry): string {
  if (e.status === "unavailable") return "can't load";
  if (e.status === "loading" || e.total === 0) return "";
  return e.kind === "minor" ? `${e.done}/${e.total}` : `${e.pct}%`;
}

/** The accessible / tooltip summary of one program's progress. */
export function entrySummary(e: ProgramEntry): string {
  if (e.status === "unavailable") return `${e.shortName}: can't load right now`;
  if (e.status === "loading" || e.total === 0) return `${e.shortName}: loading`;
  return e.kind === "minor" ? `${e.shortName} ${e.done} of ${e.total}` : `${e.shortName} ${e.pct}%`;
}

export const KIND_LABEL: Record<ProgramKindLabel, string> = {
  primary: "Major",
  secondMajor: "Second major",
  minor: "Minor",
};

/** "N of M done" for a panel row. */
export function doneLine(e: ProgramEntry): string {
  if (e.status === "unavailable") return "Can't load right now";
  if (e.status === "loading" || e.total === 0) return "Loading…";
  return `${e.done} of ${e.total} done`;
}

// ─── Add buttons (D5) ───────────────────────────────────────────────────────

export type AddAvailability = { enabled: boolean; label: string };

/** "Add a second major" / "Add a minor", or the reason it is off. */
export function addButtons(opts: {
  list: readonly AdditionalProgram[];
  primaryProgram: Pick<Program, "short_name" | "college" | "collegeId" | "family"> | undefined;
  primarySharing: LayerSharing | undefined;
}): { major: AddAvailability; minor: AddAvailability } {
  const majors = opts.list.filter((p) => p.kind === "major").length;
  const minors = opts.list.filter((p) => p.kind === "minor").length;
  const college = programCollegeId(opts.primaryProgram);
  let major: AddAvailability = { enabled: true, label: "Add a second major" };
  if (majors >= 1) major = { enabled: false, label: "Second major (one per plan)" };
  else if (college !== "cas" && college !== "cals")
    major = { enabled: false, label: "Second major (Arts & Sciences and CALS only)" };
  else if (opts.primarySharing?.otherMajors === "forbidden")
    major = {
      enabled: false,
      label: `Second major (${opts.primaryProgram?.short_name ?? "your major"} doesn't allow one)`,
    };
  const minor: AddAvailability =
    minors >= 3 ? { enabled: false, label: "Minor (three per plan)" } : { enabled: true, label: "Add a minor" };
  return { major, minor };
}

// ─── The add picker (D5, D12, D14) ──────────────────────────────────────────

export type PickerRow = {
  id: string;
  kind: "major" | "minor";
  name: string;
  shortName: string;
  /** Set when the row can't be picked; shown at its right. */
  disabledReason: string | null;
};
export type PickerGroup = { label: string; rows: PickerRow[] };

export type PickerContext = {
  primaryId: string;
  primaryProgram: Pick<Program, "short_name" | "college" | "collegeId"> | undefined;
  list: readonly AdditionalProgram[];
  /** Names of the programs on the plan, for "Not open to X majors". */
  shortNameOf: (id: string) => string;
  /** A program's layer sharing when it is already in memory (no fetch). */
  sharingOf: (id: string) => LayerSharing | undefined;
};

function search(rows: PickerRow[], query: string): PickerRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(q) || r.shortName.toLowerCase().includes(q));
}

/** A pair either side's `forbiddenWith` names (D14). */
function forbiddenPair(aId: string, bId: string, sharingOf: PickerContext["sharingOf"]): boolean {
  return (
    matchesProgramPrefix(bId, sharingOf(aId)?.forbiddenWith) || matchesProgramPrefix(aId, sharingOf(bId)?.forbiddenWith)
  );
}

/** Why a candidate can't join, from the programs already on the plan. */
function commonReason(id: string, ctx: PickerContext): string | null {
  if (id === ctx.primaryId || ctx.list.some((p) => p.programId === id)) return "on this plan";
  const onPlan = [ctx.primaryId, ...ctx.list.map((p) => p.programId)];
  const clash = onPlan.find((other) => forbiddenPair(id, other, ctx.sharingOf));
  if (clash) return `can't be combined with ${ctx.shortNameOf(clash)}`;
  return null;
}

/** Second majors (D1): visible majors of the primary's own college (A&S or
 *  CALS), alphabetical, in one group named for the college. */
export function majorGroups(programs: readonly Program[], ctx: PickerContext, query: string): PickerGroup[] {
  const college = programCollegeId(ctx.primaryProgram);
  if (college !== "cas" && college !== "cals") return [];
  const rows = programs
    .filter((p) => programCollegeId(p) === college && programIsVisible(p))
    .map<PickerRow>((p) => ({
      id: p.id,
      kind: "major",
      name: p.name,
      shortName: p.short_name,
      disabledReason:
        commonReason(p.id, ctx) ??
        (ctx.sharingOf(p.id)?.otherMajors === "forbidden" ? "doesn't allow a second major" : null),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const found = search(rows, query);
  return found.length > 0 ? [{ label: collegeShortName(college), rows: found }] : [];
}

/** Minors (D12): every visible index entry, grouped by who offers it, groups
 *  and rows alphabetical. */
export function minorGroups(entries: readonly MinorIndexEntry[], ctx: PickerContext, query: string): PickerGroup[] {
  const majorsOnPlan = [ctx.primaryId, ...ctx.list.filter((p) => p.kind === "major").map((p) => p.programId)];
  const rows = entries
    .filter((e) => e.visible !== false)
    .map<PickerRow & { offeredBy: string }>((e) => {
      const closed = majorsOnPlan.find((m) => matchesProgramPrefix(m, e.notOpenTo));
      return {
        id: e.id,
        kind: "minor",
        name: e.name,
        shortName: e.shortName,
        offeredBy: e.offeredBy,
        disabledReason:
          commonReason(e.id, ctx) ?? (closed ? `Not open to ${ctx.shortNameOf(closed)} majors` : null),
      };
    });
  const byGroup = new Map<string, PickerRow[]>();
  for (const r of search(rows, query) as (PickerRow & { offeredBy: string })[]) {
    const { offeredBy, ...row } = r;
    byGroup.set(offeredBy, [...(byGroup.get(offeredBy) ?? []), row]);
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, rs]) => ({ label, rows: rs.sort((a, b) => a.name.localeCompare(b.name)) }));
}

// ─── Toasts (D3, D9) ────────────────────────────────────────────────────────

const classes = (n: number) => `${n} required ${n === 1 ? "class" : "classes"}`;

/** The toast after an added program's required classes go to Tried. */
export function fillToast(shortName: string, candidates: number, added: number, cap: number): string {
  if (candidates === 0) return `Your board already covers ${shortName}'s required classes.`;
  if (added >= candidates) return `Added ${classes(added)} for ${shortName} to Tried.`;
  if (added === 0)
    return `Tried is full (it holds ${cap}) — place some on the board to make room for ${shortName}'s required classes.`;
  return `Added ${added} of ${candidates} required classes for ${shortName}. Tried holds ${cap} — place some on the board to make room.`;
}

// ─── Overlap line (D8) ──────────────────────────────────────────────────────

/** The panel's line under a pair with a limit: "2 of 2 shared courses used ·
 *  ECON 3110 counts for Economics only, because of the Mathematics limit." */
export function overlapLine(pair: OverlapPair, shortNameOf: (id: string) => string): string {
  const a = shortNameOf(pair.a);
  const b = shortNameOf(pair.b);
  if (pair.limit === "forbidden") return `${a} and ${b} can't be combined. Check with your advisor.`;
  const n = pair.sharedCourseIds.length;
  let head: string;
  if (pair.limit === "none") head = n === 0 ? "No shared courses allowed" : `${n} shared courses (none allowed)`;
  else if (pair.limit.maxCourses != null) head = `${n} of ${pair.limit.maxCourses} shared courses used`;
  else if (pair.limit.maxCredits != null) head = `${n} shared ${n === 1 ? "course" : "courses"} · up to ${pair.limit.maxCredits} shared credits`;
  else head = `${n} shared ${n === 1 ? "course" : "courses"}`;
  const held = pair.heldBack.map(
    (h) =>
      `${courseCode(h.courseId)} counts for ${shortNameOf(h.countsFor)} only, because of the ${shortNameOf(h.heldFrom)} limit`
  );
  const shown = held.slice(0, 3);
  const more = held.length - shown.length;
  const parts = [head, ...shown, ...(more > 0 ? [`${more} more held back`] : [])];
  return `${parts.join(" · ")}.${pair.estimated ? " Estimated: progress may be understated." : ""}`;
}

/** One side of a held-back course's either/or toggle. */
export type HeldBackSide = { id: string; name: string; current: boolean };
/** A held-back course's either/or toggle (D8): both programs, the one it
 *  counts for now pressed, and the layer id that switches it to the other. */
export type HeldBackToggle = {
  courseId: string;
  code: string;
  sides: [HeldBackSide, HeldBackSide];
  /** The held-from program's layer id: `setCountsFor(courseId, switchTo)`. */
  switchTo: string;
};

export const HELD_BACK_HINT = "Shared courses can count for either program; pick where each one goes.";

/** The panel's toggles under a pair's overlap line, one per held-back course,
 *  the pair's earlier program first. A course whose held-from program has no
 *  resolvable layer id gets no toggle (the line still names it). */
export function heldBackToggles(
  pair: OverlapPair,
  shortNameOf: (id: string) => string,
  layerIdOf: (programId: string) => string | null
): HeldBackToggle[] {
  if (pair.limit === "forbidden") return [];
  const seen = new Set<string>();
  const out: HeldBackToggle[] = [];
  for (const h of pair.heldBack) {
    if (seen.has(h.courseId)) continue;
    seen.add(h.courseId);
    const switchTo = layerIdOf(h.heldFrom);
    if (!switchTo) continue;
    const side = (id: string): HeldBackSide => ({ id, name: shortNameOf(id), current: id === h.countsFor });
    const [first, second] = h.heldFrom === pair.a ? [h.heldFrom, h.countsFor] : [h.countsFor, h.heldFrom];
    out.push({ courseId: h.courseId, code: courseCode(h.courseId), sides: [side(first), side(second)], switchTo });
  }
  return out;
}
