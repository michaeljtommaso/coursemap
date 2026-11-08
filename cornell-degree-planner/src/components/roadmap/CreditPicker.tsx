import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCredits as formatRange } from "@/lib/planner/semesters";
import { Tooltip } from "@/components/ui/Tooltip";
import { creditChoices, parseCreditInput } from "@/lib/planner/chosenCredits";
import { cardMenuState } from "@/lib/cardMenuState";

/**
 * CreditPicker — the credits pill on a variable-credit course card ("1–4 cr")
 * as a button: it opens a small popover to say how many credits the student
 * took the course for. A button per value (whole numbers, or halves for a
 * half-credit range), or a number field for a wide range (1–15). "Clear" goes
 * back to the range.
 *
 * Rendered through a portal so the card body's overflow can't clip it; closes
 * on an outside press, Escape, or a scroll that moves the pill. Presses never
 * reach the card (no drag, no detail panel).
 *
 * DOM contract (e2e): trigger [data-credit-pill]; popover [data-credit-picker];
 * each value button [data-credit-choice=<value>].
 */
export function CreditPicker({
  courseLabel,
  min,
  max,
  chosen,
  onChoose,
  pillClassName,
}: {
  courseLabel: string;
  min: number;
  max: number;
  chosen: number | null;
  /** A value in range, or null to clear the choice. */
  onChoose: (value: number | null) => void;
  pillClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const choices = creditChoices(min, max);
  const range = formatRange({ min, max }) ?? "";
  const label = chosen !== null ? String(chosen) : range;

  const place = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = 220;
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom;
    setPos(below >= 170 || below >= r.top ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 });
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    setInvalid(false);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
  };

  // Focus the chosen value (else the first control) when it opens.
  useEffect(() => {
    if (!open || !pos) return;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>('[aria-pressed="true"]') ??
      panel?.querySelector<HTMLElement>("button, input");
    target?.focus({ preventScroll: true });
  }, [open, pos]);

  // Keep the board's hover suggestions closed while this is up, as card menus do.
  useEffect(() => {
    if (!open) return;
    return cardMenuState.hold();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const anchor = btnRef.current?.getBoundingClientRect() ?? null;
    const onScroll = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      const now = btnRef.current?.getBoundingClientRect();
      if (anchor && now && Math.abs(now.left - anchor.left) < 1 && Math.abs(now.top - anchor.top) < 1) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  const pick = (value: number | null) => {
    onChoose(value);
    close(true);
  };

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const value = parseCreditInput(text, min, max);
    if (value === null) {
      setInvalid(true);
      return;
    }
    pick(value);
  };

  const chip =
    "num min-w-[34px] rounded-md border px-2 py-1 t-label font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink";

  return (
    <>
      <Tooltip content={chosen !== null ? `Taken for ${label} credits · change` : "How many credits did you take it for?"}>
        <button
          ref={btnRef}
          type="button"
          data-credit-pill
          data-credit-chosen={chosen ?? undefined}
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            if (!open) {
              place();
              setText(chosen !== null ? String(chosen) : "");
            }
            setOpen(!open);
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={
            chosen !== null
              ? `${courseLabel}: taken for ${label} credits (range ${range}). Change credits`
              : `${courseLabel}: ${range} credits. Choose how many you took it for`
          }
          className={cn(
            pillClassName,
            // Reads as editable: a dashed outline in the link colour and a pencil
            // until a value is chosen, then a solid outline (the pencil stays).
            "inline-flex cursor-pointer items-center gap-[3px] transition-colors hover:bg-drop-tint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink",
            chosen !== null
              ? "border-solid border-line-strong text-ink"
              : "border-dashed border-drop text-drop-text"
          )}
        >
          {label} cr
          <Pencil aria-hidden="true" className="h-[7px] w-[7px] flex-none" strokeWidth={2.5} />
        </button>
      </Tooltip>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`Credits for ${courseLabel}`}
            data-credit-picker
            onPointerDown={stop}
            onClick={stop}
            style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: 220 }}
            className="z-50 flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 shadow-xl"
          >
            <div className="flex flex-col gap-0.5">
              <p className="t-label font-semibold text-ink">Credits taken</p>
              <p className="t-meta text-ink-3">
                {courseLabel} is {range} credits.
                {chosen === null && ` It counts as ${String(min)} until you choose.`}
              </p>
            </div>
            {choices ? (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Credits">
                {choices.map((v) => {
                  const on = chosen === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      data-credit-choice={v}
                      aria-pressed={on}
                      onClick={() => pick(on ? null : v)}
                      className={cn(
                        chip,
                        on
                          ? "border-ink bg-ink text-surface"
                          : "border-line bg-surface-2 text-ink-2 hover:border-line-strong hover:text-ink"
                      )}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            ) : (
              <form onSubmit={submitTyped} noValidate className="flex flex-col gap-1">
                <label htmlFor={inputId} className="t-meta text-ink-3">
                  Credits ({range})
                </label>
                <div className="flex gap-1.5">
                  <input
                    id={inputId}
                    type="number"
                    inputMode="decimal"
                    min={min}
                    max={max}
                    step={0.5}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setInvalid(false);
                    }}
                    aria-invalid={invalid}
                    className="num w-full min-w-0 rounded-md border border-line bg-surface-2 px-2 py-1 t-label text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-ink px-2.5 py-1 t-label font-semibold text-surface hover:opacity-90"
                  >
                    Set
                  </button>
                </div>
                {invalid && (
                  <p role="alert" className="t-meta text-destructive-text">
                    Enter a number from {String(min)} to {String(max)}.
                  </p>
                )}
              </form>
            )}
            {chosen !== null && (
              <button
                type="button"
                data-credit-clear
                onClick={() => pick(null)}
                className="self-start rounded px-1 py-0.5 t-meta text-ink-3 underline-offset-2 hover:text-ink hover:underline"
              >
                Clear (back to {range})
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
