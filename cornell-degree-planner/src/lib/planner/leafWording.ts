import { patternToRegex } from "./satisfies";

/**
 * leafWording.ts — the ONE place an unmet prerequisite leaf becomes student-
 * facing text. The engine reports leaves as course codes ("CS 2110") or, for
 * wildcard leaves, the pattern in code form ("CS 111x"). A raw pattern is
 * never shown to a student: it reads as its concrete alternatives when the
 * catalog can name them ("CS 1110 or CS 1112"), else as plain language
 * ("an intro CS course (CS 111x)").
 *
 * Pure and React-free (relative imports only) so status-line copy, the detail
 * panel, the prereq tree and offline scripts all word leaves identically.
 */

export type LeafDescriber = (leaf: string) => string;

/** Most alternatives a pattern expands to before the plain-language fallback
 *  reads better than a list. */
const MAX_ALTERNATIVES = 3;

function splitCode(leaf: string): { subject: string; number: string } | null {
  const code = leaf.replace(/-/g, " ").trim();
  const sp = code.lastIndexOf(" ");
  if (sp <= 0) return null;
  return { subject: code.slice(0, sp), number: code.slice(sp + 1) };
}

/** True for a wildcard leaf ("CS 111x", "ENGRD-2xxx", "BME 3X10"): its number
 *  is digits and wildcards (x, X, *) with at least one wildcard. */
export function isPatternLeaf(leaf: string): boolean {
  const parts = splitCode(leaf);
  if (!parts) return false;
  return /^[\dxX*]+$/.test(parts.number) && /[xX*]/.test(parts.number);
}

/** "a", "a or b", "a, b or c" — alternatives, either of which would do. */
export function joinAlternatives(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** Plain-language reading of a pattern leaf, naming the pattern in brackets:
 *  "an intro CS course (CS 111x)", "a 3000-level CS course (CS 3xxx)". */
export function plainPattern(leaf: string): string {
  const parts = splitCode(leaf);
  if (!parts) return leaf;
  const code = `${parts.subject} ${parts.number}`;
  const lead = parts.number[0];
  if (lead === "1") return `an intro ${parts.subject} course (${code})`;
  if (lead && /\d/.test(lead)) {
    const article = lead === "8" ? "an" : "a";
    return `${article} ${lead}000-level ${parts.subject} course (${code})`;
  }
  return `a ${parts.subject} course (${code})`;
}

/**
 * A describer backed by a list of known course codes (the catalog index the
 * client already holds). Course leaves pass through in code form; a pattern
 * leaf expands to the catalog courses it matches when there are 1–3 of them,
 * otherwise falls back to plainPattern. Expansions are cached per pattern.
 */
export function makeLeafDescriber(codes: Iterable<string>): LeafDescriber {
  const known = [...new Set(codes)];
  const cache = new Map<string, string>();
  return (leaf: string) => {
    if (!isPatternLeaf(leaf)) return leaf.replace(/-/g, " ");
    const hit = cache.get(leaf);
    if (hit !== undefined) return hit;
    const re = patternToRegex(leaf);
    const matches = known.filter((c) => re.test(c)).sort((a, b) => a.localeCompare(b));
    const text =
      matches.length > 0 && matches.length <= MAX_ALTERNATIVES
        ? joinAlternatives(matches)
        : plainPattern(leaf);
    cache.set(leaf, text);
    return text;
  };
}

/** The catalog-free describer: course leaves in code form, pattern leaves in
 *  plain language. The default wherever no catalog is at hand. */
export const describeLeaf: LeafDescriber = makeLeafDescriber([]);
