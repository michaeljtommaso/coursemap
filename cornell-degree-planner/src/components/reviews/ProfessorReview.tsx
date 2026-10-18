import { cn } from "@/lib/utils";
import { SNIPPET_ENABLED } from "@/services/reviews";
import type { CourseProfessorEntry, CourseHistoryEntry } from "@/services/reviews";
import {
  formatStars,
  formatDifficulty,
  RMP_LABEL,
  probableHedge,
} from "@/lib/planner/reviews";

/**
 * ProfessorReview surfaces (spec 013 §3c/§3d) — the SHARED presenters the hub
 * (CompareModal), the near-horizon detail panel, and the card badge all render,
 * so the guardrails live in ONE place:
 *   • Nominative branding ONLY — the string "RateMyProfessors" appears solely in
 *     the "via RateMyProfessors" link label (RMP_LABEL). Never "built in".
 *   • Verified vs probable — a probable (fuzzy) match renders visibly UNVERIFIED
 *     (muted + italic + dashed link) with the "double-check on RMP ↗" hedge; a
 *     verified match renders plainly.
 *   • The top-review snippet shows ONLY when SNIPPET_ENABLED (its own kill
 *     switch) AND the match is verified — never on a probable guess.
 * All ratings are near-horizon only; the CALLER gates that (a far column passes
 * nothing here and shows its honest empty state instead).
 */

const RMP_LINK =
  "text-drop-text underline-offset-2 hover:underline whitespace-nowrap";

/** A single instructor's rating line — "4.2 ★ · difficulty 3.1 · via
 *  RateMyProfessors ↗", plus the probable hedge and (verified-only) snippet. */
export function ProfessorRatingLine({
  entry,
  className,
}: {
  entry: CourseProfessorEntry;
  className?: string;
}) {
  const stars = formatStars(entry.rating);
  const diff = formatDifficulty(entry.difficulty);
  const probable = entry.confidence === "probable";
  const showSnippet =
    SNIPPET_ENABLED && entry.confidence === "verified" && !!entry.topSnippet;

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <p className="t-body font-medium text-ink">{entry.instructor}</p>
      {stars ? (
        <p
          className={cn(
            "t-body",
            // Probable → visibly unverified: muted + italic so a fuzzy guess is
            // never mistaken for a confirmed rating.
            probable ? "italic text-ink-4" : "text-ink-2"
          )}
        >
          <span className="num font-semibold">{stars}</span>
          {diff && <span className="num text-ink-3"> · {diff}</span>}
          {" · "}
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(RMP_LINK, probable && "[text-decoration-style:dashed] underline")}
          >
            {RMP_LABEL} ↗
          </a>
        </p>
      ) : (
        // A page exists but RMP has no rating — link out, never empty stars.
        <a href={entry.url} target="_blank" rel="noopener noreferrer" className={cn(RMP_LINK, "t-body")}>
          {RMP_LABEL} ↗
        </a>
      )}
      {probable && (
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          className="t-meta italic text-ink-4 hover:text-ink-3"
        >
          {probableHedge(entry.instructor, entry.rmpName)} ↗
        </a>
      )}
      {showSnippet && (
        <p className="t-meta italic text-ink-3">“{entry.topSnippet}”</p>
      )}
    </div>
  );
}

/**
 * "Varies by instructor" badge (spec 013 §3d) — the ENTRY POINT to the timeline.
 * Two forms: an interactive button (the detail panel, where clicking expands the
 * timeline — pass onToggle + expanded) and a quiet static chip (the card near
 * face, title-attributed, no interaction). Fires only when variesByInstructor()
 * says the per-professor ratings actually diverge; the caller gates that.
 */
export function VariesByInstructorBadge({
  onToggle,
  expanded,
  className,
}: {
  onToggle?: () => void;
  expanded?: boolean;
  className?: string;
}) {
  const label = "Varies by instructor";
  const chip =
    "inline-flex items-center gap-1 rounded-pill border border-[var(--available-bd)] bg-available-tint px-1.5 py-0.5 text-[9.5px] font-semibold text-available-text";
  if (!onToggle) {
    return (
      <span className={cn(chip, className)} title="Ratings differ by who teaches this — see the panel">
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={expanded}
      className={cn(chip, "transition-colors hover:brightness-95", className)}
      title="Ratings differ by who teaches this — show the term-by-term history"
    >
      {label}
      <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
    </button>
  );
}

/**
 * Instructor-history timeline (spec 013 §3d, Michael's amendment) — "FA25: Prof
 * X 4.5★ ↗ · SP26: Prof Y 3.1★ ↗" as a quiet, each-linked list. Show the data;
 * the student draws the conclusion. Entries without a rating still link out.
 */
export function InstructorTimeline({
  history,
  className,
}: {
  history: CourseHistoryEntry[];
  className?: string;
}) {
  if (history.length === 0) return null;
  return (
    <p className={cn("t-meta leading-relaxed text-ink-3", className)}>
      {history.map((h, i) => {
        const stars = formatStars(h.rating);
        return (
          <span key={`${h.term}:${h.netid}:${i}`}>
            {i > 0 && <span className="text-ink-4"> · </span>}
            <span className="num font-medium text-ink-2">{h.term}:</span>{" "}
            {h.instructor}
            {stars && <span className="num"> {stars}</span>}{" "}
            <a
              href={h.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-drop-text underline-offset-2 hover:underline"
            >
              ↗
            </a>
          </span>
        );
      })}
    </p>
  );
}
