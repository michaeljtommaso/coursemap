import type {
  HeldBack,
  OverlapPair,
  ProgramSection,
  ProgramSectionKind,
  RequirementGroup,
  RequirementProgress,
} from "@/hooks/useRequirementProgress";
import type { MarkValue, SharingLimit } from "@/lib/planner/distribution/types";
import { parseCountsForKey } from "@/lib/planner/questions/keys";

/**
 * programSections.ts (spec 047 D6/D8/D14) — what the views share about a
 * plan's several programs, read from `progress.sections` / `overlap` / the
 * groups' `sectionId`. Pure; no engine logic.
 *
 * A plan with no second major or minor has no "extra" section, and every view
 * then renders exactly as before spec 047 (`hasExtraPrograms` is the switch).
 */

/** The page's and panel's word for each kind of program. */
export const SECTION_KIND_LABEL: Record<ProgramSectionKind, string> = {
  college: "College",
  primary: "Major",
  secondMajor: "Second major",
  minor: "Minor",
};

/** A second major or a minor (the college and the primary are not extra). */
export function isExtraSection(s: Pick<ProgramSection, "kind">): boolean {
  return s.kind === "secondMajor" || s.kind === "minor";
}

/** The plan's second major and minors, in plan order. */
export function extraSections(progress: Pick<RequirementProgress, "sections">): ProgramSection[] {
  return (progress.sections ?? []).filter(isExtraSection);
}

/** True when the plan holds a second major or a minor. */
export function hasExtraPrograms(progress: Pick<RequirementProgress, "sections">): boolean {
  return extraSections(progress).length > 0;
}

/**
 * The section a group belongs to: its `sectionId` when it names a known
 * section; otherwise a college-layer group goes to the college section and
 * anything else to the primary's (an engine that doesn't tag groups yet).
 */
export function sectionIdOf(group: RequirementGroup, sections: readonly ProgramSection[]): string | null {
  if (group.sectionId && sections.some((s) => s.id === group.sectionId)) return group.sectionId;
  const layerKind = group.items.find((it) => it.dist)?.dist?.layerKind;
  const kind: ProgramSectionKind = layerKind === "college" ? "college" : "primary";
  return sections.find((s) => s.kind === kind)?.id ?? sections.find((s) => s.kind === "primary")?.id ?? null;
}

/**
 * The layer id a "count it for X" choice names for program `sectionId`
 * (spec 047 D8, `countsForKey`): the program's own major or minor layer, read
 * from its rows; any of its layers when no such row is loaded; null when none
 * of its rows is (the action is then not offered).
 */
export function programLayerId(groups: readonly RequirementGroup[], sectionId: string): string | null {
  let fallback: string | null = null;
  for (const g of groups) {
    if (g.sectionId !== sectionId) continue;
    for (const it of g.items) {
      const d = it.dist;
      if (!d) continue;
      if (d.layerKind === "major" || d.layerKind === "minor") return d.layerId;
      fallback ??= d.layerId;
    }
  }
  return fallback;
}

/** Layer id → the section its rows belong to (rows tagged with a section only). */
export function sectionOfLayer(groups: readonly RequirementGroup[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of groups) {
    if (!g.sectionId) continue;
    for (const it of g.items) if (it.dist && !out.has(it.dist.layerId)) out.set(it.dist.layerId, g.sectionId);
  }
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Economics and Mathematics can share at most 2 courses" — a pair's limit in words. */
export function limitText(limit: SharingLimit | "forbidden", aName: string, bName: string): string {
  if (limit === "forbidden") return `${bName} can't be combined with ${aName}`;
  if (limit === "none") return `${aName} and ${bName} can't share any courses`;
  const parts: string[] = [];
  if (limit.maxCourses != null) parts.push(plural(limit.maxCourses, "course", "courses"));
  if (limit.maxCredits != null) parts.push(plural(limit.maxCredits, "credit", "credits"));
  if (parts.length === 0) return `${aName} and ${bName} can share courses`;
  return `${aName} and ${bName} can share at most ${parts.join(" and ")}`;
}

/** Codes joined for a sentence: "ECON 3110", "ECON 3110 and MATH 2210", "A, B and C". */
function joinCodes(codes: string[]): string {
  if (codes.length <= 1) return codes.join("");
  return `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
}

/**
 * The overlap line for one pair (spec 047 D8), shown under the LATER
 * program's section header (`pair.b`):
 *   "2 of 2 shared courses used · ECON 3110 counts for Economics only, because of the Mathematics limit."
 * A forbidden pair (D14) reads as a warning instead.
 */
export function overlapLine(
  pair: OverlapPair,
  nameOf: (sectionId: string) => string,
  codeOf: (courseId: string) => string
): string {
  const a = nameOf(pair.a);
  const b = nameOf(pair.b);
  if (pair.limit === "forbidden") return `${limitText("forbidden", a, b)}. Check with your advisor.`;
  const shared = pair.sharedCourseIds.length;
  let usage: string;
  if (pair.limit === "none") usage = "No shared courses allowed";
  else if (pair.limit.maxCourses != null) {
    usage = `${shared} of ${plural(pair.limit.maxCourses, "shared course", "shared courses")} used`;
    if (pair.limit.maxCredits != null) usage += ` (at most ${plural(pair.limit.maxCredits, "credit", "credits")})`;
  } else if (pair.limit.maxCredits != null) {
    usage = `${plural(shared, "shared course", "shared courses")}, at most ${plural(pair.limit.maxCredits, "credit", "credits")}`;
  } else usage = plural(shared, "shared course", "shared courses");

  // Held-back courses, grouped by the program they still count for.
  const byTarget = new Map<string, string[]>();
  for (const h of pair.heldBack) {
    const code = codeOf(h.courseId);
    const list = byTarget.get(h.countsFor) ?? [];
    if (!list.includes(code)) list.push(code);
    byTarget.set(h.countsFor, list);
  }
  const held = [...byTarget].map(
    ([target, codes]) => `${joinCodes(codes)} ${codes.length === 1 ? "counts" : "count"} for ${nameOf(target)} only`
  );
  // "the Mathematics limit" when the engine says whose rule binds.
  const whose = pair.limitFrom ? `the ${nameOf(pair.limitFrom)} limit` : "the limit";
  let line = held.length > 0 ? `${usage} · ${held.join("; ")}, because of ${whose}.` : `${usage}.`;
  if (pair.estimated) line += " Estimated: your progress may be a little higher.";
  return line;
}

/** Section ids that sit in a forbidden pair as the later program (D14). */
export function forbiddenSectionIds(progress: Pick<RequirementProgress, "overlap">): Set<string> {
  return new Set((progress.overlap ?? []).filter((p) => p.limit === "forbidden").map((p) => p.b));
}

/** A section's short name, or its id when the section isn't known. */
export function sectionNamer(sections: readonly ProgramSection[] | undefined): (id: string) => string {
  const map = new Map((sections ?? []).map((s) => [s.id, s.shortName || s.name]));
  return (id) => map.get(id) ?? id;
}

/** The limit text behind a held-back course, from the pair it belongs to. */
export function heldBackLimit(
  h: HeldBack,
  overlap: readonly OverlapPair[] | undefined,
  nameOf: (id: string) => string
): string {
  const pair = (overlap ?? []).find(
    (p) => (p.a === h.countsFor && p.b === h.heldFrom) || (p.a === h.heldFrom && p.b === h.countsFor)
  );
  if (!pair) return `${nameOf(h.countsFor)} and ${nameOf(h.heldFrom)} have an overlap limit`;
  return limitText(pair.limit, nameOf(pair.a), nameOf(pair.b));
}

// ── "Count it for X instead" choices in Your answers (D8) ───────────────────

export type CountsForChoice = {
  /** The stored mark's key (`countsFor:<layer>@<course>`). */
  key: string;
  /** "ECON 3110 counts for Mathematics". */
  text: string;
};

/** Whether a stored answer key is a countsFor choice (listed on its own). */
export function isCountsForKey(key: string): boolean {
  return parseCountsForKey(key) != null;
}

/**
 * Every countsFor choice stored on the plan, named: "ECON 3110 counts for
 * Mathematics". A layer no program on the plan has (a removed program, D10)
 * reads "a program not on this plan".
 */
export function countsForChoices(
  courseMarks: Readonly<Record<string, MarkValue>> | undefined,
  progress: Pick<RequirementProgress, "groups" | "sections">,
  codeOf: (courseId: string) => string
): CountsForChoice[] {
  const out: CountsForChoice[] = [];
  if (!courseMarks) return out;
  const layerSection = sectionOfLayer(progress.groups);
  const nameOf = sectionNamer(progress.sections);
  for (const [key, value] of Object.entries(courseMarks)) {
    if (value !== "yes") continue;
    const parsed = parseCountsForKey(key);
    if (!parsed) continue;
    const section = layerSection.get(parsed.layerId);
    const program = section ? nameOf(section) : "a program not on this plan";
    out.push({ key, text: `${codeOf(parsed.courseId)} counts for ${program}` });
  }
  return out.sort((x, y) => x.text.localeCompare(y.text));
}

// ── Held-back courses (D8) ───────────────────────────────────────────────────

/** A held-back course, resolved for display and for the "count it for" action. */
export type ResolvedHeldBack = {
  courseId: string;
  placementId: string | null;
  /** Section ids. */
  countsFor: string;
  heldFrom: string;
  countsForName: string;
  heldFromName: string;
  /** The pair's limit in words ("Economics and Mathematics can share at most 2 courses"). */
  limit: string;
  /** The layer a countsFor choice names for `heldFrom`; null → no action. */
  layerId: string | null;
};

/** Every held-back entry of `progress`, keyed by placement id (placed courses only). */
export function resolveHeldBack(
  progress: Pick<RequirementProgress, "groups" | "sections" | "overlap" | "heldBackByPlacement">
): Record<string, ResolvedHeldBack[]> {
  const out: Record<string, ResolvedHeldBack[]> = {};
  const byPlacement = progress.heldBackByPlacement;
  if (!byPlacement) return out;
  const nameOf = sectionNamer(progress.sections);
  const layerOf = new Map<string, string | null>();
  for (const [pid, list] of Object.entries(byPlacement)) {
    if (!list || list.length === 0) continue;
    out[pid] = list.map((h) => {
      if (!layerOf.has(h.heldFrom)) layerOf.set(h.heldFrom, programLayerId(progress.groups, h.heldFrom));
      return {
        courseId: h.courseId,
        placementId: h.placementId,
        countsFor: h.countsFor,
        heldFrom: h.heldFrom,
        countsForName: nameOf(h.countsFor),
        heldFromName: nameOf(h.heldFrom),
        limit: heldBackLimit(h, progress.overlap, nameOf),
        layerId: layerOf.get(h.heldFrom) ?? null,
      };
    });
  }
  return out;
}

/** The card's second line, first half: "Counts for CS minor". Its second half
 *  is the switch, `countItForLabel` (D8: the line itself is the choice). */
export function heldBackLine(h: Pick<ResolvedHeldBack, "countsForName">): string {
  return `Counts for ${h.countsForName}`;
}

/** Its reason (tooltip, panel): "<limit>, so ECON 3110 counts for Economics only." */
export function heldBackReason(h: Pick<ResolvedHeldBack, "limit" | "countsForName">, code: string): string {
  return `${h.limit}, so ${code} counts for ${h.countsForName} only.`;
}

/** The action: "Count it for Mathematics instead". */
export function countItForLabel(h: Pick<ResolvedHeldBack, "heldFromName">): string {
  return `Count it for ${h.heldFromName} instead`;
}

/** The switch's accessible name, naming the course and both programs:
 *  "Count ECON 3120 for Economics instead of CS minor". */
export function countItForAria(h: Pick<ResolvedHeldBack, "countsForName" | "heldFromName">, code: string): string {
  return `Count ${code} for ${h.heldFromName} instead of ${h.countsForName}`;
}

/** The compact card's "↔" switch: the whole line as one sentence (its
 *  accessible name and tooltip): "ECON 3120 counts for CS minor (overlap
 *  limit) · Count it for Economics instead". */
export function heldBackSwitchSentence(
  h: Pick<ResolvedHeldBack, "countsForName" | "heldFromName">,
  code: string
): string {
  return `${code} counts for ${h.countsForName} (overlap limit) · ${countItForLabel(h)}`;
}

// ── "Adding a program moved a course" (D8) ──────────────────────────────────

/** A program in a sentence: "the CS minor" for a minor, "Economics" otherwise. */
export function programPhrase(s: Pick<ProgramSection, "kind" | "shortName" | "name">): string {
  const short = s.shortName || s.name;
  if (s.kind !== "minor") return short;
  return /\bminor$/i.test(short) ? `the ${short}` : `the ${short} minor`;
}

const heldKey = (h: HeldBack) => `${h.courseId}|${h.countsFor}|${h.heldFrom}`;

/**
 * The held-back entries an add created that move a course OFF a program that
 * was already on the plan: in `after` but not in `before`, and held from any
 * program but the new one (or the college). One entry per course and pair.
 */
export function newlyHeldBack(
  before: readonly OverlapPair[] | undefined,
  after: readonly OverlapPair[] | undefined,
  newProgramId: string,
  sections: readonly ProgramSection[] | undefined
): HeldBack[] {
  const seen = new Set((before ?? []).flatMap((p) => p.heldBack.map(heldKey)));
  const college = new Set((sections ?? []).filter((s) => s.kind === "college").map((s) => s.id));
  const out: HeldBack[] = [];
  for (const pair of after ?? []) {
    for (const h of pair.heldBack) {
      const key = heldKey(h);
      if (seen.has(key) || h.heldFrom === newProgramId || college.has(h.heldFrom)) continue;
      seen.add(key);
      out.push(h);
    }
  }
  return out;
}

/**
 * The toast sentence for courses an add moved (D8), or null for none:
 *   one:  "ECON 3120 now counts for the CS minor (overlap limit). It can count for Economics instead."
 *   many: "3 courses now count for the CS minor instead of Economics (overlap limit). You can switch any of them on its card."
 * Several moves between different programs get a general "many" sentence.
 */
export function movedCoursesSentence(
  moved: readonly HeldBack[],
  phraseOf: (sectionId: string) => string,
  codeOf: (courseId: string) => string
): string | null {
  if (moved.length === 0) return null;
  if (moved.length === 1) {
    const [h] = moved;
    return `${codeOf(h.courseId)} now counts for ${phraseOf(h.countsFor)} (overlap limit). It can count for ${phraseOf(h.heldFrom)} instead.`;
  }
  const [first] = moved;
  const samePair = moved.every((h) => h.countsFor === first.countsFor && h.heldFrom === first.heldFrom);
  const where = samePair
    ? `${phraseOf(first.countsFor)} instead of ${phraseOf(first.heldFrom)}`
    : "a different program than before";
  return `${moved.length} courses now count for ${where} (overlap limit). You can switch any of them on its card.`;
}
