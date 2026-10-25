import { ExternalLink, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { FLOWCHART_YEAR, programLinks } from "@/data/program-links";
import { collegeShortName, programCollegeId } from "@/lib/planner/colleges";

/**
 * ProgramLinks — beside the TopBar's program switcher: the selected major's
 * official Cornell flowchart and its department major page, each opening in a
 * new tab. Nothing renders for a program without links; the Flowchart button
 * is absent for majors Cornell publishes no flowchart for (the CALS majors).
 * Majors not in program-links.ts fall back to the program index's `url`.
 * Below the 2xl breakpoint they collapse to icons (names stay as aria-labels
 * and tooltips) so the top bar still fits a 1280px laptop.
 *
 * Twins (spec 019 D5): a major more than one college offers gets a plain
 * "Also offered in Arts & Sciences" line linking to Cornell's page for the
 * other one. No score — the other college's requirements aren't counted.
 */
export function ProgramLinks() {
  const { programs } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const program = programs.find((p) => p.id === selectedProgramId);
  if (!program) return null;

  const links =
    programLinks(program.short_name) ??
    (program.url ? { majorPage: program.url, flowchart: null } : null);
  const twins = (program.twins ?? []).flatMap((id) => {
    const twin = programs.find((p) => p.id === id);
    const college = programCollegeId(twin);
    return twin && college ? [{ id, college, url: twin.url ?? null }] : [];
  });
  if (!links && twins.length === 0) return null;

  const linkClass = cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5 px-2.5 2xl:px-3");

  return (
    <div className="flex items-center gap-1.5">
      {links?.flowchart && (
        <a
          href={links.flowchart}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
          aria-label="Flowchart"
          title={`Cornell's official ${FLOWCHART_YEAR} flowchart for ${program.name} (opens in a new tab)`}
        >
          <Workflow className="h-3.5 w-3.5" />
          <span className="hidden 2xl:inline">Flowchart</span>
        </a>
      )}
      {links && (
        <a
          href={links.majorPage}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
          aria-label="Major page"
          title={`${program.name} on Cornell's website (opens in a new tab)`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="hidden 2xl:inline">Major page</span>
        </a>
      )}
      {twins.map((t) => {
        const text = `Also offered in ${collegeShortName(t.college)}`;
        return t.url ? (
          <a
            key={t.id}
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            className="whitespace-nowrap px-1 t-meta text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            title={`${text} (opens in a new tab)`}
          >
            {text}
          </a>
        ) : (
          <span key={t.id} className="whitespace-nowrap px-1 t-meta text-ink-3">
            {text}
          </span>
        );
      })}
    </div>
  );
}
