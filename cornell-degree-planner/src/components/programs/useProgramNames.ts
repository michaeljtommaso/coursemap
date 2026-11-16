import { useCallback } from "react";
import { usePrograms } from "@/hooks/usePrograms";
import { useMinorIndex } from "@/hooks/useAdditionalProgramData";
import type { NameLookup } from "./programsModel";

/**
 * Display names for programs that may not have a requirement section yet: a
 * major from the program index, a minor from the minor index. Reads the minor
 * index (one doc), so call it only where minors can show: the extra segments,
 * the panel, the picker.
 */
export function useProgramNames(): { lookup: NameLookup; shortNameOf: (id: string) => string } {
  const { programs } = usePrograms();
  const { entries } = useMinorIndex();
  const lookup = useCallback<NameLookup>(
    (id, kind) => {
      if (kind === "minor") {
        const m = entries.find((e) => e.id === id);
        return m ? { name: m.name, shortName: m.shortName } : null;
      }
      const p = programs.find((x) => x.id === id);
      return p ? { name: p.name, shortName: p.short_name } : null;
    },
    [programs, entries]
  );
  const shortNameOf = useCallback(
    (id: string) => lookup(id, "major")?.shortName ?? lookup(id, "minor")?.shortName ?? id,
    [lookup]
  );
  return { lookup, shortNameOf };
}
