import { cn } from "@/lib/utils";
import { annotatePrereq, type AnnotatedPrereq, type PrereqPools } from "@/lib/planner/prereqTree";
import { describeLeaf as plainLeaf, type LeafDescriber } from "@/lib/planner/leafWording";
import { advisoryEscape } from "@/lib/planner/statusLine";
import type { PrereqExpr } from "@/types/db";

/**
 * PrereqTree (spec 006 §D4, restyled per card direction 11's side-peek —
 * claude-design-2026-07-11) — the recursive renderer for a course's prereq /
 * coreq expression. Each course leaf renders as a bordered MONO CHIP behind a
 * status dot: met = green (--complete / --complete-bd), unmet = red
 * (--destructive / --destructive-bd), with an optional contextual note beside
 * it ("planned — Fall of year 2", "completed", "can be taken together",
 * "any one"). A wildcard leaf never shows its raw pattern: it reads as its
 * catalog alternatives ("CS 1110 or CS 1112") or plain language ("an intro CS
 * course (CS 111x)") via leafWording. AND/OR groups keep a small connective label ("all of" /
 * "one of") over a left-rule indent so the boolean structure stays readable.
 *
 * Satisfaction logic is annotatePrereq, UNCHANGED (identical semantics to
 * computeCardStatusMap) — this file is presentation only.
 */

function ChipRow({ code, met, note }: { code: string; met: boolean; note?: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", met ? "bg-complete" : "bg-destructive")}
        aria-hidden="true"
      />
      <span
        className={cn(
          "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-mono text-[10.5px] font-medium",
          met
            ? "border-[var(--complete-bd)] text-complete-text"
            : "border-[var(--destructive-bd)] text-destructive-text"
        )}
      >
        {code}
      </span>
      {note && <span className="text-[10px] text-ink-4">{note}</span>}
      <span className="sr-only">{met ? "met" : "not met"}</span>
    </div>
  );
}

function Node({
  node,
  noteOf,
  describe,
}: {
  node: AnnotatedPrereq;
  noteOf?: (id: string) => string | null;
  describe: LeafDescriber;
}) {
  if (node.type === "course") {
    return <ChipRow code={node.code} met={node.met} note={noteOf?.(node.id) ?? null} />;
  }
  if (node.type === "concurrent") {
    const placement = noteOf?.(node.id) ?? null;
    return (
      <ChipRow
        code={node.code}
        met={node.met}
        note={placement ? `${placement} · can be taken together` : "can be taken together"}
      />
    );
  }
  if (node.type === "pattern") {
    return <ChipRow code={describe(node.pattern)} met={node.met} note="any one" />;
  }

  if (node.type === "advisory") {
    // Quiet group (spec 007 §3, Unit 7C2): the wrapped child renders normally
    // (its own chips keep their met/unmet colors) inside a dashed, ink-toned
    // rule — deliberately NOT the destructive/warning treatment, so an unmet
    // advisory subtree never reads as a hard block. The chips above name the
    // course(s); the caption says the requirement is soft and names the
    // escape hatch the parser stripped (same wording as the card's line).
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-col gap-1.5 border-l-2 border-dashed border-line-strong pl-3.5">
          {node.child && <Node node={node.child} noteOf={noteOf} describe={describe} />}
          <span className="text-[9.5px] italic text-ink-4">
            usually needed first — {advisoryEscape(node.note)}
          </span>
        </div>
      </div>
    );
  }

  // and / or group — connective label + left-rule indent (green when the
  // whole group is satisfied, matching the chip treatment).
  const isOr = node.type === "or";
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className={cn(
          "font-mono text-[9px] font-medium uppercase tracking-[0.09em]",
          node.met ? "text-complete-text" : "text-ink-4"
        )}
      >
        {isOr ? "one of" : "all of"}
      </span>
      <div
        className={cn(
          "flex flex-col gap-1.5 border-l-2 pl-3.5",
          node.met ? "border-[var(--complete-bd)]" : "border-line-strong"
        )}
      >
        {node.children.map((child, i) => (
          <Node key={i} node={child} noteOf={noteOf} describe={describe} />
        ))}
      </div>
    </div>
  );
}

export function PrereqTree({
  expr,
  pools,
  codeOf,
  noteOf,
  describeLeaf = plainLeaf,
}: {
  expr: PrereqExpr;
  pools: PrereqPools;
  /** Optional id → display code/title resolver (defaults to "CS-2110"→"CS 2110"). */
  codeOf?: (id: string) => string;
  /** Optional id → contextual placement note ("planned — Fall of year 2",
   *  "completed"); presentation-only, derived by the caller from plan state. */
  noteOf?: (id: string) => string | null;
  /** Wording for wildcard leaves (useLeafDescriber); defaults to the
   *  catalog-free plain-language form. */
  describeLeaf?: LeafDescriber;
}) {
  // A vacuous expression (e.g. a scraped empty and-group) annotates to null —
  // render nothing; the panel gates on isVacuousPrereq to show its fallback.
  const annotated = annotatePrereq(expr, pools, codeOf);
  if (!annotated) return null;
  return <Node node={annotated} noteOf={noteOf} describe={describeLeaf} />;
}
