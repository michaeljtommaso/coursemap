import { parseRosterSlug } from "@/lib/planner/horizon";
import { displayedRating, type ProfessorRatingsMap } from "@/lib/classes/professorRatings";
import type { CatalogIndexRecord } from "@/lib/schemas";

/**
 * The /classes enrollment-term switch (spec 017 D1/D3/D4) — pure helpers:
 * roster-slug wording, the per-browser memory of a turned-off switch, the
 * search fallback, and the row's lead-lecturer line. Unit-tested; the page and
 * row only render what these decide.
 */

const TERM_NAMES: Record<string, string> = {
  FA: "Fall",
  SP: "Spring",
  SU: "Summer",
  WI: "Winter",
};

/** "SP27" → "Spring 2027", "FA26" → "Fall 2026"; null for anything unparseable. */
export function formatRosterTerm(slug: string | null | undefined): string | null {
  const ty = parseRosterSlug(slug);
  if (!ty) return null;
  return `${TERM_NAMES[ty.term]} ${ty.year}`;
}

// ─── Memory (D3) ─────────────────────────────────────────────────────────────

export const TARGET_FILTER_STORAGE_KEY = "coursemap.classes.targetFilter";

/** The stored shape: written only when the student turns the switch OFF. */
export type TargetFilterPref = { target: string; on: false };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** window.localStorage, or null where it's unavailable or throws on access. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Should the switch start ON for this target? Yes, unless this browser stored a
 * turned-off switch for the SAME target. A stored "off" for an older target no
 * longer applies, so the default comes back when the enrollment term moves on.
 * Unreadable or malformed storage → the default (on).
 */
export function initialTargetFilterOn(
  storage: StorageLike | null,
  target: string | null | undefined
): boolean {
  if (!storage || !target) return true;
  try {
    const raw = storage.getItem(TARGET_FILTER_STORAGE_KEY);
    if (!raw) return true;
    const v: unknown = JSON.parse(raw);
    if (
      v &&
      typeof v === "object" &&
      (v as { target?: unknown }).target === target &&
      (v as { on?: unknown }).on === false
    ) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

/** Remember the student's choice: OFF stores `{ target, on: false }`; ON clears
 *  it (on is the default, so there's nothing to remember). Never throws. */
export function saveTargetFilterChoice(
  storage: StorageLike | null,
  target: string,
  on: boolean
): void {
  if (!storage) return;
  try {
    if (on) {
      storage.removeItem(TARGET_FILTER_STORAGE_KEY);
    } else {
      const pref: TargetFilterPref = { target, on: false };
      storage.setItem(TARGET_FILTER_STORAGE_KEY, JSON.stringify(pref));
    }
  } catch {
    // Storage full, blocked, or private mode: the switch still works this visit.
  }
}

// ─── Search fallback (D1) ────────────────────────────────────────────────────

/**
 * With the switch on, a non-empty query that finds nothing on the target roster
 * shows the matches from the rest of the catalog instead of an empty state,
 * flagged so the page can say they're not offered that term. `others` is only
 * evaluated when the fallback can apply.
 */
export function selectDirectoryResults<T>(
  primary: T[],
  opts: { targetOn: boolean; query: string; others: () => T[] }
): { rows: T[]; notOnTarget: boolean } {
  if (!opts.targetOn || primary.length > 0 || opts.query.trim() === "") {
    return { rows: primary, notOnTarget: false };
  }
  const others = opts.others();
  return others.length > 0 ? { rows: others, notOnTarget: true } : { rows: primary, notOnTarget: false };
}

// ─── Row lead-lecturer line (D4) ─────────────────────────────────────────────

export type LeadLine = {
  /** "Fall 2026" when the course's sections are not from the enrollment term. */
  termLabel: string | null;
  name: string;
  /** "3.6 ★"; null when there's no live rating (or ratings are off). */
  rating: string | null;
  probable: boolean;
  /** Other distinct instructors on the primary component. */
  more: number;
};

/**
 * What the row's professor line says, or null when there is no lead lecturer.
 * A rating appears only beside the enrollment term or a term label naming where
 * the professor came from — never bare. If the course's roster is unknown, the
 * line shows the name only.
 */
export function leadLine(
  record: Pick<CatalogIndexRecord, "lead" | "roster">,
  target: string | null | undefined,
  ratings: ProfessorRatingsMap
): LeadLine | null {
  const lead = record.lead;
  if (!lead || !lead.name.trim()) return null;
  const roster = record.roster;
  const termLabel = roster && roster !== target ? formatRosterTerm(roster) : null;
  const placed = !!roster && (roster === target || termLabel !== null);
  const r = placed ? ratings.get(lead.netid) : undefined;
  return {
    termLabel,
    name: lead.name,
    rating: r ? `${displayedRating(r.rating).toFixed(1)} ★` : null,
    probable: r?.tier === "probable",
    more: lead.more,
  };
}
