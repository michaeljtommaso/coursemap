import { parseRef } from "@/lib/planner/questions/keys";
import type { Layer, MarkValue } from "@/lib/planner/distribution/types";

/**
 * shareMarks (spec 020 D6) — what a share link shows of the student's course
 * marks, and whether its rules ask anything the link can't carry.
 *
 * A share copies the plan's course marks but never the student's facts, so a
 * reader sees each "yes" (or credit count) on the course it is about, in the
 * third person, and a note when a layer the share is scored on asks a student
 * fact. Pure: the view fetches the layers.
 */

function credits(n: number): string {
  return `${n} ${n === 1 ? "credit" : "credits"}`;
}

/** courseId → the lines its marks show, e.g. "Used as First-Year Writing
 *  Seminar · the student's answer". A "no" changes nothing, so it shows
 *  nothing; a mark whose question can't be read is skipped. */
export function shareMarkLines(
  courseMarks: Record<string, MarkValue> | undefined,
  layers: Layer[]
): Map<string, string[]> {
  const lines = new Map<string, string[]>();
  const add = (courseId: string, line: string) => {
    const list = lines.get(courseId) ?? [];
    list.push(`${line} · the student's answer`);
    lines.set(courseId, list);
  };
  const rowLabel = (layerId: string, rowId: string) =>
    layers.find((l) => l.id === layerId)?.rows.find((r) => r.id === rowId)?.label ?? "a requirement";

  for (const [key, value] of Object.entries(courseMarks ?? {})) {
    const at = key.indexOf("@");
    const parsed = parseRef(at >= 0 ? key.slice(0, at) : key);
    if (!parsed) continue;
    if (parsed.type === "usedAs" || parsed.type === "approvedFor" || parsed.type === "courseCondition") {
      if (at < 0 || value !== "yes") continue;
      const label = rowLabel(parsed.layerId, parsed.row);
      const courseId = key.slice(at + 1);
      if (parsed.type === "usedAs") add(courseId, `Used as ${label}`);
      else if (parsed.type === "approvedFor") add(courseId, `Approved for ${label}`);
      else add(courseId, `Counts toward ${label}`);
    } else if (parsed.type === "creditsTaken") {
      if (typeof value === "number") add(parsed.course, `Taken for ${credits(value)}`);
    } else if (parsed.type === "sequenceDone") {
      if (value === "yes") add(parsed.course, "Sequence completed");
    }
  }
  return lines;
}

/** True when any layer asks a student fact, which a share never carries. */
export function asksStudentFacts(layers: Layer[]): boolean {
  return layers.some((l) => (l.questions ?? []).some((q) => q.type === "studentFact"));
}

/** The layers a share is scored on: its major (id = programId), the college
 *  rule set it recorded, and its concentrations (`<programId>--<id>`). */
export function shareLayerIds(share: {
  programId: string;
  collegeRuleSet?: string;
  concentrationIds?: string[];
}): string[] {
  if (!share.programId) return [];
  return [
    share.programId,
    ...(share.collegeRuleSet ? [share.collegeRuleSet] : []),
    ...(share.concentrationIds ?? []).map((c) => `${share.programId}--${c}`),
  ];
}
