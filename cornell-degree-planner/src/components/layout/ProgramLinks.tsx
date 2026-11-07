import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { programLinks } from "@/data/program-links";
import { collegeShortName, programCollegeId } from "@/lib/planner/colleges";

export interface TwinLink {
  id: string;
  /** "Arts & Sciences" */
  college: string;
  /** The twin program's own name, so two twins in one college stay apart. */
  name: string;
  url: string | null;
}

/**
 * The selected major's outside links (spec 039: shown in the top-bar menu):
 * Cornell's official flowchart and the department's major page, plus its
 * twins — the same major offered by another college (spec 019 D5), each a
 * plain link to Cornell's page for it. The flowchart is absent for majors
 * Cornell publishes none for (the CALS majors). Majors not in
 * program-links.ts fall back to the program index's `url`.
 */
export function useProgramLinks() {
  const { programs } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const program = programs.find((p) => p.id === selectedProgramId) ?? null;
  if (!program) return { program: null, links: null, twins: [] as TwinLink[] };

  const links =
    programLinks(program.short_name) ??
    (program.url ? { majorPage: program.url, flowchart: null } : null);
  const seen = new Set<string>();
  const twins = (program.twins ?? []).flatMap((id): TwinLink[] => {
    const twin = programs.find((p) => p.id === id);
    const college = programCollegeId(twin);
    if (!twin || !college) return [];
    // Two twin ids that resolve to one Cornell page read as one link.
    const key = twin.url ?? id;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id, college: collegeShortName(college), name: twin.name, url: twin.url ?? null }];
  });
  return { program, links, twins };
}
