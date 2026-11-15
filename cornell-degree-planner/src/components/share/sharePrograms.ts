import type { AdditionalProgram } from "@/lib/schemas";

/**
 * sharePrograms.ts (spec 047 D13) — the share header's program line:
 * "Economics + Mathematics (second major) + CS minor". Pure.
 *
 * Names come from the program index (a second major) and the minor index (a
 * minor), read only for a share that carries extra programs. An id with no
 * name available reads prettified ("cas-mathematics" → "Cas Mathematics")
 * rather than leaving the program out.
 */

/** "cas-mathematics" → "Cas Mathematics". */
export function prettifyProgramId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** One extra program's words in the header. */
export function extraProgramLabel(p: Pick<AdditionalProgram, "programId" | "kind">, name: string | undefined): string {
  const base = name?.trim() || prettifyProgramId(p.programId);
  if (p.kind === "major") return `${base} (second major)`;
  return /\bminor\b/i.test(base) ? base : `${base} minor`;
}

/** "Economics + Mathematics (second major) + CS minor". */
export function shareProgramsLine(
  primaryName: string,
  additional: readonly Pick<AdditionalProgram, "programId" | "kind">[] | undefined,
  names: Readonly<Record<string, string>>
): string {
  const extras = (additional ?? []).map((p) => extraProgramLabel(p, names[p.programId]));
  return [primaryName, ...extras].filter(Boolean).join(" + ");
}
