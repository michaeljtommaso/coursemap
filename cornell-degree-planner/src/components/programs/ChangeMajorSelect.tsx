import { ChevronDown } from "lucide-react";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramStore } from "@/store/useProgramStore";
import { useAuth } from "@/contexts/AuthProvider";
import { COLLEGES, programCollegeId, programIsVisible } from "@/lib/planner/colleges";

/**
 * "Change major" in the primary's panel row (spec 047 D5): today's major list
 * — hidden majors left out except the one this plan is on, grouped by college
 * when it spans more than one — and the old top-bar select's behavior: picking
 * a major switches to that major's plan and makes its college the student's
 * (spec 019 D11). A native select under a "Change major" face, so it keeps the
 * platform's list and keyboard handling; `#program-select` is the e2e hook.
 */
export function ChangeMajorSelect({ onChanged }: { onChanged?: () => void }) {
  const { programs, loading } = usePrograms();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const setSelectedProgramId = useProgramStore((s) => s.setSelectedProgramId);
  const { setStudentContext } = useAuth();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value || null;
    // Each program has its own cloud plan; switching never wipes anything.
    if (id === selectedProgramId) return;
    setSelectedProgramId(id);
    // The picked major's college is the student's (spec 019 D11).
    const college = programCollegeId(programs.find((p) => p.id === id));
    if (college) void setStudentContext({ college });
    onChanged?.();
  };

  const pickable = programs.filter((p) => programIsVisible(p) || p.id === selectedProgramId);
  const ungrouped = pickable.filter((p) => programCollegeId(p) === null);
  const groups = COLLEGES.map((c) => ({
    college: c,
    programs: pickable.filter((p) => programCollegeId(p) === c.id),
  })).filter((g) => g.programs.length > 0);
  const option = (p: (typeof programs)[number]) => (
    <option key={p.id} value={p.id}>
      {p.name}
    </option>
  );

  return (
    <span className="relative inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 t-meta font-semibold text-drop-text focus-within:ring-1 focus-within:ring-ink hover:bg-surface-2">
      Change major
      <ChevronDown className="h-3 w-3" aria-hidden />
      <select
        id="program-select"
        aria-label="Change major"
        value={selectedProgramId ?? ""}
        onChange={handleChange}
        disabled={loading}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-default"
      >
        {groups.length > 1 ? (
          <>
            {ungrouped.map(option)}
            {groups.map((g) => (
              <optgroup key={g.college.id} label={g.college.shortName}>
                {g.programs.map(option)}
              </optgroup>
            ))}
          </>
        ) : (
          pickable.map(option)
        )}
      </select>
    </span>
  );
}
