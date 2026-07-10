import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { annotatePrereq, type AnnotatedPrereq, type PrereqPools } from "@/lib/planner/prereqTree";
import type { PrereqExpr } from "@/types/db";

/**
 * PrereqTree (spec 006 §D4) — the recursive renderer for a course's prereq /
 * coreq expression, colored met (green ✓) vs unmet (red ○) against the current
 * plan pools via annotatePrereq (same semantics as computeSlotStatusMap). AND
 * nodes stack their children; OR nodes read "One of:" and list the alternatives;
 * patterns render "CS 111x (any matching)"; concurrent nodes are marked
 * "(can be taken together)". Used inside CourseDetailPanel for the #5 tree half.
 */

function Leaf({ label, met }: { label: string; met: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {met ? (
        <Check className="h-3 w-3 shrink-0 text-complete-text" aria-hidden="true" />
      ) : (
        <Circle className="h-2.5 w-2.5 shrink-0 text-destructive" aria-hidden="true" />
      )}
      <span className={cn("t-body", met ? "text-complete-text" : "text-ink")}>{label}</span>
    </div>
  );
}

function Node({ node, depth }: { node: AnnotatedPrereq; depth: number }) {
  if (node.type === "course") {
    return <Leaf label={node.code} met={node.met} />;
  }
  if (node.type === "concurrent") {
    return <Leaf label={`${node.code} — can be taken together`} met={node.met} />;
  }
  if (node.type === "pattern") {
    return <Leaf label={node.label} met={node.met} />;
  }

  // and / or group
  const isOr = node.type === "or";
  const connective = isOr ? "One of" : "All of";
  return (
    <div className="flex flex-col gap-1">
      <span
        className={cn(
          "t-label normal-case tracking-normal",
          node.met ? "text-complete-text" : "text-ink-3"
        )}
      >
        {connective}
      </span>
      <div
        className={cn(
          "flex flex-col gap-1 border-l pl-2.5",
          node.met ? "border-complete/40" : "border-line"
        )}
      >
        {node.children.map((child, i) => (
          <Node key={i} node={child} depth={depth + 1} />
        ))}
      </div>
    </div>
  );
}

export function PrereqTree({
  expr,
  pools,
  codeOf,
}: {
  expr: PrereqExpr;
  pools: PrereqPools;
  /** Optional id → display code/title resolver (defaults to "CS-2110"→"CS 2110"). */
  codeOf?: (id: string) => string;
}) {
  const annotated = annotatePrereq(expr, pools, codeOf);
  return <Node node={annotated} depth={0} />;
}
