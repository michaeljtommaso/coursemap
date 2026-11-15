import type { ProgramColor, RequirementProgress } from "@/hooks/useRequirementProgress";
import {
  hasExtraPrograms,
  isExtraSection,
  resolveHeldBack,
  type ResolvedHeldBack,
} from "@/components/requirements/programSections";

/**
 * cardPrograms.ts (spec 047 D6/D8) — what a course card shows about a plan's
 * several programs, computed ONCE for the board (like `attribution`) and
 * handed to each card: its "counts toward" labels grouped by program, primary
 * first, each extra program's labels after its colored dot; and the courses an
 * overlap limit holds back. Pure.
 *
 * A plan with no second major or minor gets `{}`, and every card keeps its
 * plain pre-047 label line.
 */

/** One program's labels on a card. */
export type CardLabelGroup = {
  sectionId: string;
  /** The program's short name (tooltip). */
  programName: string;
  /** A second major or minor (drawn after a dot); false for the college and the primary. */
  extra: boolean;
  /** The extra program's color; null for the college and the primary. */
  color: ProgramColor | null;
  labels: string[];
};

export type CardProgramInfo = {
  /** Primary (and college) first, then each extra program in plan order. */
  groups: CardLabelGroup[];
  heldBack: ResolvedHeldBack[];
};

/** placementId → its card's program info; `{}` without extra programs. */
export function buildCardPrograms(
  progress: Pick<
    RequirementProgress,
    "sections" | "groups" | "overlap" | "attributionDetail" | "heldBackByPlacement"
  >
): Record<string, CardProgramInfo> {
  const out: Record<string, CardProgramInfo> = {};
  if (!hasExtraPrograms(progress)) return out;
  const sections = progress.sections ?? [];
  const order = new Map(sections.map((s, i) => [s.id, i]));
  const byId = new Map(sections.map((s) => [s.id, s]));
  const held = resolveHeldBack(progress);
  const ids = new Set([...Object.keys(progress.attributionDetail ?? {}), ...Object.keys(held)]);
  for (const pid of ids) {
    // The primary's and the college's labels share one dotless group ("base");
    // each extra program gets its own.
    const byKey = new Map<string, CardLabelGroup>();
    for (const { label, sectionId } of progress.attributionDetail?.[pid] ?? []) {
      const section = byId.get(sectionId);
      const extra = !!section && isExtraSection(section);
      const key = extra ? sectionId : "base";
      let g = byKey.get(key);
      if (!g) {
        g = {
          sectionId,
          programName: section ? section.shortName || section.name : sectionId,
          extra,
          color: extra ? (section.color ?? null) : null,
          labels: [],
        };
        byKey.set(key, g);
      }
      if (!g.labels.includes(label)) g.labels.push(label);
    }
    // Primary first; extra programs in plan order.
    const rank = (key: string) => (key === "base" ? -1 : (order.get(key) ?? sections.length));
    const groups = [...byKey].sort((a, b) => rank(a[0]) - rank(b[0])).map(([, g]) => g);
    out[pid] = { groups, heldBack: held[pid] ?? [] };
  }
  return out;
}

/** The tooltip: "Counts toward Econometrics · Mathematics: Electives". */
export function cardLabelTooltip(groups: readonly CardLabelGroup[]): string {
  const parts = groups
    .filter((g) => g.labels.length > 0)
    .map((g) => (!g.extra ? g.labels.join(", ") : `${g.programName}: ${g.labels.join(", ")}`));
  return `Counts toward ${parts.join(" · ")}`;
}
