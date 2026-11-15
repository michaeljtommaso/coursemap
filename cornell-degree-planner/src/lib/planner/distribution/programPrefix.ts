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
