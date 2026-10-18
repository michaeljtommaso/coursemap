import { ExternalLink, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { FLOWCHART_YEAR, programLinks } from "@/data/program-links";

/**
 * ProgramLinks — beside the TopBar's program switcher: the selected major's
 * official Cornell flowchart and its department major page, each opening in a
 * new tab. Nothing renders for a program without links; the Flowchart button
 * is absent for majors Cornell publishes no flowchart for (the CALS majors).
 */
export function ProgramLinks() {
  const { programs } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const program = programs.find((p) => p.id === selectedProgramId);
  const links = programLinks(program?.short_name);
  if (!program || !links) return null;

  const linkClass = cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5");

  return (
    <div className="flex items-center gap-1.5">
      {links.flowchart && (
        <a
          href={links.flowchart}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
          title={`Cornell's official ${FLOWCHART_YEAR} flowchart for ${program.name} (opens in a new tab)`}
        >
          <Workflow className="h-3.5 w-3.5" />
          Flowchart
        </a>
      )}
      <a
        href={links.majorPage}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        title={`${program.name} on Cornell's website (opens in a new tab)`}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Major page
      </a>
    </div>
  );
}
