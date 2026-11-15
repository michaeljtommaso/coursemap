import { Fragment } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { PROGRAM_COLOR_VAR } from "@/lib/planner/programColors";
import {
  countItForAria,
  countItForLabel,
  heldBackLine,
  heldBackReason,
  heldBackSwitchSentence,
  type ResolvedHeldBack,
} from "@/components/requirements/programSections";
import { cardLabelTooltip, type CardLabelGroup } from "./cardPrograms";

/**
 * CardProgramLines (spec 047 D6/D8) — a course card's program lines when the
 * plan holds a second major or minor:
 *   - "↳ Econometrics · ● Electives": every label, primary first, a colored dot
 *     before each extra program's labels; one truncating line with the full
 *     text in the tooltip (as the plain line does).
 *   - "Counts for CS minor · Count it for Economics instead": a second line
 *     only on a card an overlap limit applies to. The first half carries the
 *     reason in its tooltip; the second half is the switch itself, a real
 *     button (the card menu keeps the same action). Compact cards show only
 *     a small "↔" switch (`HeldBackSwitches`) named by the whole sentence.
 *
 * DOM: [data-attribution] (the same hook as the plain line), each extra
 * program's run [data-attribution-program=<id>]; [data-held-back-line] and
 * its switch [data-count-it-for=<heldFrom>]; compact [data-held-back-switch].
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

/** Called when a held-back course's switch is pressed (only offered with a layer). */
export type OnCountFor = (h: ResolvedHeldBack & { layerId: string }) => void;

/** The switches sit inside the card (role=button, draggable): a press must
 *  not start a drag, open the detail panel, or reach the card's key handler. */
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function withLayer(h: ResolvedHeldBack): (ResolvedHeldBack & { layerId: string }) | null {
  return h.layerId ? { ...h, layerId: h.layerId } : null;
}

export function HeldBackLines({
  heldBack,
  code,
  onCountFor,
}: {
  heldBack: readonly ResolvedHeldBack[];
  code: string;
  onCountFor?: OnCountFor;
}) {
  if (heldBack.length === 0) return null;
  return (
    <>
      {heldBack.map((h) => {
        const target = onCountFor ? withLayer(h) : null;
        return (
          <p
            key={`${h.heldFrom}:${h.countsFor}`}
            data-held-back-line={h.heldFrom}
            className="text-[10px] font-semibold leading-[1.35] text-available-text"
          >
            <Tooltip content={heldBackReason(h, code)}>
              <span>
                {heldBackLine(h)}
                <span className="sr-only">. {heldBackReason(h, code)}</span>
              </span>
            </Tooltip>
            {target && onCountFor && (
              <>
                <span aria-hidden="true"> · </span>
                <button
                  type="button"
                  data-count-it-for={h.heldFrom}
                  aria-label={countItForAria(h, code)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCountFor(target);
                  }}
                  onPointerDown={stop}
                  onKeyDown={stop}
                  className="inline rounded-sm border-0 bg-transparent p-0 text-left font-bold text-available-text underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                >
                  {countItForLabel(h)}
                </button>
              </>
            )}
          </p>
        );
      })}
    </>
  );
}

/** Compact cards: one small "↔" switch per held-back course that has an action,
 *  its accessible name and tooltip the whole line as one sentence. */
export function HeldBackSwitches({
  heldBack,
  code,
  onCountFor,
}: {
  heldBack: readonly ResolvedHeldBack[];
  code: string;
  onCountFor: OnCountFor;
}) {
  const targets = heldBack.map(withLayer).filter((h): h is ResolvedHeldBack & { layerId: string } => h !== null);
  if (targets.length === 0) return null;
  return (
    <>
      {targets.map((h) => {
        const sentence = heldBackSwitchSentence(h, code);
        return (
          <Tooltip key={`${h.heldFrom}:${h.countsFor}`} content={sentence}>
            <button
              type="button"
              data-held-back-switch={h.heldFrom}
              aria-label={sentence}
              onClick={(e) => {
                e.stopPropagation();
                onCountFor(h);
              }}
              onPointerDown={stop}
              onKeyDown={stop}
              className="inline-flex h-[16px] min-w-[16px] flex-none items-center justify-center rounded-sm border-0 bg-transparent px-[2px] text-[11px] font-bold leading-none text-available-text hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
            >
              <span aria-hidden="true">↔</span>
            </button>
          </Tooltip>
        );
      })}
    </>
  );
}
