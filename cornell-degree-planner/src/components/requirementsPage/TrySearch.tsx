import type { CatalogIndexRecord } from "@/lib/schemas";
import type { GroupTargets } from "./suggestions";
import type { TryActions } from "./tryCourse";

/**
 * TrySearch (spec 045 D10) — the Requirements page header's "Try a class…"
 * search: a result names everything the class would fill on the page, with
 * Try and + <enrollment term>; the classes being tried sit beside it as
 * chips (× untries, Clear empties). Replaces the per-group Try strips' search
 * and the TriedLine.
 *
 * DOM: root [data-try-search]; each result [data-try-course=<id>]; each tried
 * chip [data-tried-chip=<id>]; the no-longer-offered line [data-tried-missing].
 *
 * CONTRACT STUB (spec 045 phase 0): props are final; lane B builds the body.
 */
export type TrySearchProps = {
  /** Every group's open fill targets, labelled with its group (the page's). */
  groupTargets: readonly GroupTargets[];
  recordById: (id: string) => CatalogIndexRecord | undefined;
  enrollmentTarget: string | null;
  /** "Spring 2027", or null. */
  termLabel: string | null;
  /** On the board (canonical ids): a result says "On your board". */
  isOnBoard: (id: string) => boolean;
  actions: TryActions;
  /** Course id → "ANSC 3800" for the tried chips. */
  codeOf: (id: string) => string;
  onClearTried: () => void;
  /** Tried course ids no longer offered: "<code> is no longer offered · Remove". */
  missingTried: readonly string[];
  /** 1024–1279px: an icon button that expands into the search in place. */
  compact?: boolean;
};

export function TrySearch(props: TrySearchProps) {
  return <div data-try-search data-stub={props.compact ? "compact" : "full"} />;
}
