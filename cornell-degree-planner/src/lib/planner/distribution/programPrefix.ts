/**
 * A program-id prefix (spec 047 `sharing.forbiddenWith` / a limit's `with`),
 * matched like the `program` rule leaf: "cornell-aem-bs" matches
 * "cornell-aem-bs" and "cornell-aem-bs-2026". A lowercase-kebab program id,
 * at most 80 characters, no leading or trailing dash. Shared by LayerSchema
 * and lintLayer.
 */
export const PROGRAM_ID_PREFIX_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export function isProgramIdPrefix(v: unknown): v is string {
  return typeof v === "string" && PROGRAM_ID_PREFIX_RE.test(v);
}

/** The degree tokens a program id ends in (before its catalog year). */
export const DEGREE_TOKENS = ["ba", "bs", "bfa", "barch", "bm", "minor"] as const;

const WHOLE_PROGRAM_RE = new RegExp(`-(?:${DEGREE_TOKENS.join("|")})(?:-\\d{4})?$`);

/**
 * Spec 047: a prefix that names a whole program: it ends in a degree token
 * ("-ba", "-bs", "-minor" ...), optionally followed by a catalog year. A
 * prefix matches every id that starts with it and a dash, so a shorter
 * prefix would reach other programs too: "cornell-computer-science" matches
 * "cornell-computer-science-minor-2026" as well as the B.A.
 */
export function namesWholeProgram(prefix: string): boolean {
  return WHOLE_PROGRAM_RE.test(prefix);
}
