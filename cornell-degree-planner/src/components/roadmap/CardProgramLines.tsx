import { Fragment } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { PROGRAM_COLOR_VAR } from "@/lib/planner/programColors";
import {
  heldBackLine,
  heldBackReason,
  type ResolvedHeldBack,
} from "@/components/requirements/programSections";
import { cardLabelTooltip, type CardLabelGroup } from "./cardPrograms";

/**
 * CardProgramLines (spec 047 D6/D8) — a course card's program lines when the
 * plan holds a second major or minor:
 *   - "↳ Econometrics · ● Electives": every label, primary first, a colored dot
 *     before each extra program's labels; one truncating line with the full
 *     text in the tooltip (as the plain line does).
 *   - "Held back from Mathematics (overlap limit)": a second line only on a
 *     card an overlap limit applies to, with the reason in its tooltip. The
 *     action to count it there instead lives in the card menu.
 *
 * DOM: [data-attribution] (the same hook as the plain line), each extra
 * program's run [data-attribution-program=<id>]; [data-held-back-line].
 */

export function CardProgramLabels({ groups }: { groups: readonly CardLabelGroup[] }) {
  const shown = groups.filter((g) => g.labels.length > 0);
  if (shown.length === 0) return null;
  return (
    <Tooltip content={cardLabelTooltip(shown)} truncatedOnly>
      <p data-attribution className="truncate text-[10px] font-semibold text-ink-3">
        <span aria-hidden="true">↳ </span>
        <span className="sr-only">{cardLabelTooltip(shown)}</span>
        <span aria-hidden="true">
          {shown.map((g, i) => (
            <Fragment key={g.extra ? g.sectionId : "base"}>
              {i > 0 && " · "}
              {g.extra ? (
                <span data-attribution-program={g.sectionId}>
                  <span
                    className="mr-[3px] inline-block h-[6px] w-[6px] rounded-full align-middle"
                    style={{ background: g.color ? PROGRAM_COLOR_VAR[g.color] : "var(--text-3)" }}
                  />
                  {g.labels.join(" · ")}
                </span>
              ) : (
                g.labels.join(" · ")
              )}
            </Fragment>
          ))}
        </span>
      </p>
    </Tooltip>
  );
}

export function HeldBackLines({ heldBack, code }: { heldBack: readonly ResolvedHeldBack[]; code: string }) {
  if (heldBack.length === 0) return null;
  return (
    <>
      {heldBack.map((h) => (
        <Tooltip key={`${h.heldFrom}:${h.countsFor}`} content={heldBackReason(h, code)}>
          <p data-held-back-line={h.heldFrom} className="truncate text-[10px] font-semibold text-available-text">
            {heldBackLine(h)}
            <span className="sr-only">. {heldBackReason(h, code)}</span>
          </p>
        </Tooltip>
      ))}
    </>
  );
}
