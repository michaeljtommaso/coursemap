import { cn } from "@/lib/utils";
import type { ProgramColor } from "@/hooks/useRequirementProgress";
import { PROGRAM_STROKE } from "./programClasses";

const R = 5.5;
const C = 2 * Math.PI * R;

/** The stack's 16px progress ring (spec 047 D5): a faint track and an arc in
 *  the program's color (ink for the primary). Decorative; the segment names
 *  the figure. */
export function ProgressRing({ pct, color, className }: { pct: number; color: ProgramColor | null; className?: string }) {
  const filled = (Math.max(0, Math.min(100, pct)) / 100) * C;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className={cn("shrink-0", className)}>
      <circle cx="8" cy="8" r={R} fill="none" strokeWidth="2.5" className="stroke-line" />
      <circle
        cx="8"
        cy="8"
        r={R}
        fill="none"
        strokeWidth="2.5"
        strokeDasharray={`${filled.toFixed(1)} ${C.toFixed(1)}`}
        transform="rotate(-90 8 8)"
        className={color ? PROGRAM_STROKE[color] : "stroke-ink"}
      />
    </svg>
  );
}
