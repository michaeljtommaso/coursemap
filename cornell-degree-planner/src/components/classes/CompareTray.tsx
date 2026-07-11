import { useMemo, useState } from "react";
import { Columns, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { CompareModal } from "@/components/classes/CompareModal";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * CompareTray (spec 013 §2) — the docked bar that appears once at least one
 * course is pinned. Each pin is a chip with an unpin ✕; "Compare" opens the
 * side-by-side CompareModal. The "up to 4" note is the explanation for the
 * product cap AuthProvider enforces on togglePin.
 */
export function CompareTray({ slots }: { slots: ProgramSlotWithData[] }) {
  const { pinnedCourseIds, togglePin } = useAuth();
  const { index } = useCatalogContext();
  const [open, setOpen] = useState(false);

  const codeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of index) m.set(r.id, `${r.subject} ${r.number}`);
    return m;
  }, [index]);

  if (pinnedCourseIds.length === 0) return null;

  return (
    <>
      <div className="shrink-0 border-t border-line bg-surface/90 px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 t-label text-ink-2">
            <Columns className="h-3.5 w-3.5" />
            Compare
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {pinnedCourseIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-pill border border-line bg-surface-2 py-0.5 pl-2 pr-1 t-meta text-ink-2"
              >
                <span className="font-mono">{codeById.get(id) ?? id.replace("-", " ")}</span>
                <button
                  onClick={() => togglePin(id)}
                  aria-label={`Remove ${codeById.get(id) ?? id} from compare`}
                  className="rounded p-0.5 text-ink-4 transition-colors hover:text-ink"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </span>
          <span className="t-meta text-ink-4">up to 4</span>
          <button
            onClick={() => setOpen(true)}
            disabled={pinnedCourseIds.length < 2}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 t-label text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
            title={pinnedCourseIds.length < 2 ? "Pin at least two courses to compare" : "Open comparison"}
          >
            <Columns className="h-3.5 w-3.5" />
            Compare
          </button>
        </div>
      </div>

      {open && <CompareModal slots={slots} onClose={() => setOpen(false)} />}
    </>
  );
}
