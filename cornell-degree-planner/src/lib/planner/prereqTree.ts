import type { PrereqExpr } from "@/types/db";
import { patternToRegex } from "./evaluatePrereq";

/**
 * prereqTree (spec 006 §D4 / the #5 tree half deferred from B) — annotate a raw
 * PrereqExpr into a renderable tree, tagging every node met/unmet against the
 * current plan pools. The met/unmet semantics are IDENTICAL to evaluatePrereq /
 * computeSlotStatusMap (and/or/course/pattern/concurrent), so the detail panel's
 * tree agrees with the card's blocked state. Pure — no React, fully unit-tested.
 */

export type PrereqPools = {
  /** Course ids satisfied (completed or planned, per the caller's policy). */
  completedIds: Set<string>;
  /** "SUBJECT NUMBER" codes of those courses, for pattern matching. */
  completedCodes: Set<string>;
  /** Ids that satisfy {type:"concurrent"} nodes. Omit → concurrent is
   *  satisfiable-by-definition (matches evaluatePrereq when no target semester). */
  concurrentIds?: Set<string>;
};

export type AnnotatedPrereq =
  | { type: "and" | "or"; met: boolean; children: AnnotatedPrereq[] }
  | { type: "course"; met: boolean; id: string; code: string }
  | { type: "pattern"; met: boolean; pattern: string; label: string }
  | { type: "concurrent"; met: boolean; id: string; code: string }
  // Advisory (spec 007 §3, Unit 7C2) — wraps the parser's stripped alternative.
  // `met` mirrors the INNER expr's own satisfaction (child?.met ?? true when
  // the inner expr is itself vacuous); the node is never itself "unmet" in a
  // way that reads as a hard block — callers render it as a quiet subtree,
  // never the destructive treatment.
  | { type: "advisory"; met: boolean; note: string; child: AnnotatedPrereq | null };

/** "CS-2110" → "CS 2110" (the display + pattern-match code form). */
export function idToCode(id: string): string {
  return id.replace(/-/g, " ");
}

/** True when `expr` imposes no requirement at all — null/undefined, or an
 *  and/or group whose children are all themselves vacuous (a scraped
 *  `{type:"and",children:[]}` must NOT render as a satisfied empty group; the
 *  panel shows its "no prerequisites" state instead). */
export function isVacuousPrereq(expr: PrereqExpr | null | undefined): boolean {
  if (!expr) return true;
  if (expr.type === "and" || expr.type === "or") return expr.children.every(isVacuousPrereq);
  // Advisory (spec 007 §3, Unit 7C2 — no longer vacuous): the tree now renders
  // it as a quiet subtree, so its vacuousness follows its WRAPPED expr, not a
  // blanket true. An advisory wrapping a real course/pattern/and/or is a real
  // requirement to display; only an advisory around an already-vacuous group
  // (empty and/or) renders nothing.
  if (expr.type === "advisory") return isVacuousPrereq(expr.expr);
  return false;
}

/**
 * Recursively annotate. `codeOf` resolves a course id to a human code/title for
 * display; it defaults to idToCode (so callers without a catalog still render
 * sensible codes). Vacuous group nodes (empty children) annotate to null — "no
 * requirement", not vacuously met — and are filtered out of parent groups; a
 * null root means the whole expression demands nothing. Node.met mirrors
 * evaluatePrereq exactly:
 *   and  → every child met       or → some child met
 *   course → id in completedIds   pattern → some completedCode matches
 *   concurrent → concurrentIds has id (or completedIds has it), else true
 */
export function annotatePrereq(
  expr: PrereqExpr,
  pools: PrereqPools,
  codeOf: (id: string) => string = idToCode
): AnnotatedPrereq | null {
  switch (expr.type) {
    case "and": {
      const children = expr.children
        .map((c) => annotatePrereq(c, pools, codeOf))
        .filter((c): c is AnnotatedPrereq => c !== null);
      if (children.length === 0) return null;
      return { type: "and", met: children.every((c) => c.met), children };
    }
    case "or": {
      const children = expr.children
        .map((c) => annotatePrereq(c, pools, codeOf))
        .filter((c): c is AnnotatedPrereq => c !== null);
      if (children.length === 0) return null;
      return { type: "or", met: children.some((c) => c.met), children };
    }
    case "course":
      return {
        type: "course",
        met: pools.completedIds.has(expr.id),
        id: expr.id,
        code: codeOf(expr.id),
      };
    case "pattern": {
      const re = patternToRegex(expr.pattern);
      let met = false;
      for (const code of pools.completedCodes) {
        if (re.test(code)) {
          met = true;
          break;
        }
      }
      return {
        type: "pattern",
        met,
        pattern: expr.pattern,
        label: `${expr.pattern.replace(/-/g, " ")} (any matching)`,
      };
    }
    case "concurrent": {
      const met = pools.concurrentIds
        ? pools.concurrentIds.has(expr.id) || pools.completedIds.has(expr.id)
        : true;
      return { type: "concurrent", met, id: expr.id, code: codeOf(expr.id) };
    }
    case "advisory": {
      // Renders as a quiet group (spec 007 §3, Unit 7C2): the wrapped expr
      // annotates normally (chips keep their own met/unmet colors), plus the
      // parser's stripped-alternative prose as a caption. `met` follows the
      // child so a satisfied advisory never reads as needing attention; a null
      // child (vacuous inner expr) has nothing to fail, so it's vacuously met.
      const child = annotatePrereq(expr.expr, pools, codeOf);
      return { type: "advisory", met: child ? child.met : true, note: expr.note, child };
    }
  }
}
