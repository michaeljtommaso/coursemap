import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthProvider";
import { COLLEGES, type CollegeId } from "@/lib/planner/colleges";
import { choicePillClass } from "./choicePill";

/**
 * CollegePicker (spec 019 D11) — asks which college the student is in when
 * nothing else says so: the blank canvas has no major, so the "Still figuring
 * it out" door and Major Match ask here. Saves `college` on the profile the
 * moment a college is picked (Major Match ranks inside it, D3).
 */
export function CollegePicker({
  compact = false,
  onDone,
}: {
  /** Inline panel styling (tight, left-aligned). */
  compact?: boolean;
  onDone?: (college: CollegeId) => void;
}) {
  const { studentContext, setStudentContext } = useAuth();

  const pick = (id: CollegeId) => {
    void setStudentContext({ college: id });
    onDone?.(id);
  };

  return (
    <div className={cn("flex flex-col gap-2", compact ? "items-start" : "items-center gap-4 text-center")}>
      <div className={cn("flex flex-col gap-1", !compact && "items-center")}>
        <p className={compact ? "t-meta text-ink-2" : "t-body text-ink-2"}>Which college are you in?</p>
        {!compact && (
          <p className="t-meta text-ink-3">Major Match compares the majors inside your college.</p>
        )}
      </div>
      <div className={cn("flex flex-wrap gap-2", !compact && "justify-center")}>
        {COLLEGES.map((c) => (
          <button
            key={c.id}
            onClick={() => pick(c.id)}
            aria-pressed={studentContext.college === c.id}
            title={c.name}
            className={choicePillClass(studentContext.college === c.id, compact)}
          >
            {c.shortName}
          </button>
        ))}
      </div>
    </div>
  );
}
