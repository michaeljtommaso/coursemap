import { parseRosterSlug } from "@/lib/planner/horizon";
import { displayedRating, rowRating, type ProfessorRatingsMap } from "@/lib/classes/professorRatings";
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
 * flagged so the page can say they're not offered that term. Only courses whose
 * roster is KNOWN and differs from the target can be called "not offered"; a
 * course with no roster on record is never labeled (no claim from missing
 * data), so it's left out of the fallback. `others` is only evaluated when the
 * fallback can apply.
 */
export function selectDirectoryResults<T extends { roster: string | null }>(
  primary: T[],
  opts: { targetOn: boolean; query: string; target: string | null | undefined; others: () => T[] }
): { rows: T[]; notOnTarget: boolean } {
  if (!opts.targetOn || !opts.target || primary.length > 0 || opts.query.trim() === "") {
    return { rows: primary, notOnTarget: false };
  }
  const target = opts.target;
  const others = opts.others().filter((r) => r.roster != null && r.roster !== target);
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
  /** Other distinct instructors on the primary component (exact count). */
  more: number;
  /** What the row prints for `more`: "+3", capped at "+9+" past nine, so a
   *  course with dozens of instructors doesn't read as a score. "" when 0. */
  moreLabel: string;
  /** Hover text with the exact count: "32 more instructors". "" when 0. */
  moreTitle: string;
};

/** Largest "+N" the row prints; beyond it the label reads "+9+". */
export const MORE_DISPLAY_CAP = 9;

/** "+3" for 1–9 other instructors, "+9+" past nine, "" for none. */
export function moreInstructorsLabel(more: number): string {
  if (!(more > 0)) return "";
  return more > MORE_DISPLAY_CAP ? `+${MORE_DISPLAY_CAP}+` : `+${more}`;
}

/** "1 more instructor" / "32 more instructors"; "" for none. */
export function moreInstructorsTitle(more: number): string {
  if (!(more > 0)) return "";
  return `${more} more ${more === 1 ? "instructor" : "instructors"}`;
}

/**
 * What the row's professor line says, or null when there is no lead lecturer.
 * A rating appears only beside the enrollment term or a term label naming where
 * the professor came from — never bare. If the course's roster is unknown, or
 * the lead has no netid (name-only), the line shows the name only. The rating
 * comes from rowRating, the same join the well-rated chip judges.
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
  const r = rowRating(record, target, ratings);
  return {
    termLabel,
    name: lead.name,
    rating: r ? `${displayedRating(r.rating).toFixed(1)} ★` : null,
    probable: r?.tier === "probable",
    more: lead.more,
    moreLabel: moreInstructorsLabel(lead.more),
    moreTitle: moreInstructorsTitle(lead.more),
  };
}

// ─── First paint and the list window ─────────────────────────────────────────

/**
 * Whether the directory can decide what to show. The term switch and its
 * filter hang on the enrollment term from catalog/meta, which can arrive after
 * the course index; deciding before it would paint the whole catalog and then
 * snap to the term's courses. So the list waits until meta has settled (a
 * target, or definitively none) — or until `metaWaitedOut`, so a slow meta read
 * never holds the directory back for long (it just shows the full list).
 */
export function directoryReady(s: {
  indexLoading: boolean;
  metaSettled: boolean;
  metaWaitedOut: boolean;
}): boolean {
  return !s.indexLoading && (s.metaSettled || s.metaWaitedOut);
}

/** What the visible window (the "Load more" count) is keyed on. */
export type DirectoryWindowKey<F> = { query: string; filters: F; targetOn: boolean };

/**
 * Should the list's visible window snap back to the first batch? Only when the
 * student changed the search, a sidebar filter, or the term switch. Ratings
 * arriving (which only reveals the well-rated chip) is not a reason: it is not
 * part of the key, so the list keeps its place.
 */
export function shouldResetDirectoryWindow<F>(
  prev: DirectoryWindowKey<F>,
  next: DirectoryWindowKey<F>
): boolean {
  return prev.query !== next.query || prev.filters !== next.filters || prev.targetOn !== next.targetOn;
}
