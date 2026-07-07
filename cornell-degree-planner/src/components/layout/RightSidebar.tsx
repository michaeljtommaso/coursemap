import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { animate } from "animejs";
import { cn } from "@/lib/utils";
import { CourseCatalog } from "@/components/catalog/CourseCatalog";
import { MajorMatchPanel } from "@/components/majors/MajorMatchPanel";
import { dragState } from "@/lib/drag/dragState";
import { usePlannerStore, type PanelTab } from "@/store/usePlannerStore";
import type { ProgramSlotWithData } from "@/types/db";

/**
 * RightSidebar (spec 004 §5) — the course-first loop's home: two tabs,
 * Catalog | Majors, so "pick courses" and "see where they lead" live on one
 * surface. Open/tab state lives in usePlannerStore so the left rail's Major
 * Match teaser can deep-link into the Majors tab.
 */

const TABS: { key: PanelTab; label: string }[] = [
  { key: "catalog", label: "Catalog" },
  { key: "majors", label: "Majors" },
];

export function RightSidebar({ slots }: { slots: ProgramSlotWithData[] }) {
  const open = usePlannerStore((s) => s.panelOpen);
  const tab = usePlannerStore((s) => s.panelTab);
  const setPanelOpen = usePlannerStore((s) => s.setPanelOpen);
  const setPanelTab = usePlannerStore((s) => s.setPanelTab);

  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const hasInitRef = useRef(false);

  // Let the drag ghost reach drop targets behind the backdrop during a drag.
  useEffect(() => {
    return dragState.subscribe(() => {
      if (!backdropRef.current) return;
      backdropRef.current.style.pointerEvents = dragState.get() ? "none" : "auto";
    });
  }, []);

  useEffect(() => {
    if (!panelRef.current || !backdropRef.current) return;
    const isFirst = !hasInitRef.current;
    hasInitRef.current = true;

    if (open) {
      if (!isFirst) {
        backdropRef.current.style.display = "block";
        animate(backdropRef.current, { opacity: [0, 1], duration: 200, ease: "out(2)" });
      }
      animate(panelRef.current, { x: 0, duration: isFirst ? 0 : 360, ease: "out(3)" });
    } else {
      if (!isFirst) {
        animate(backdropRef.current, {
          opacity: [1, 0],
          duration: 200,
          ease: "in(2)",
          onComplete() {
            if (backdropRef.current) backdropRef.current.style.display = "none";
          },
        });
      } else {
        backdropRef.current.style.display = "none";
      }
      animate(panelRef.current, { x: 480, duration: isFirst ? 0 : 360, ease: "in(2)" });
    }
  }, [open]);

  return (
    <>
      <div
        ref={backdropRef}
        style={{ display: "none", opacity: 0 }}
        className="fixed inset-0 z-[var(--z-sidebar-backdrop)]"
        onClick={() => setPanelOpen(false)}
      />

      <div ref={panelRef} className="fixed right-0 top-0 z-[var(--z-sidebar-panel)] flex h-full">
        <button
          onClick={() => setPanelOpen(!open)}
          className="relative -left-7 top-1/2 z-50 flex h-14 w-7 -translate-y-1/2 items-center justify-center rounded-l-xl border border-r-0 border-line bg-surface text-ink-3 shadow-md transition-colors hover:text-ink"
          aria-label={open ? "Close panel" : "Open the catalog and majors panel"}
        >
          {open ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        <div className="flex h-full w-[480px] flex-col gap-3 border-l border-line bg-surface p-4 shadow-xl">
          {/* Segmented control — Catalog | Majors */}
          <div
            role="tablist"
            aria-label="Panel view"
            className="flex shrink-0 rounded-lg border border-line bg-surface-2/70 p-0.5"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setPanelTab(t.key)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-1.5 t-label transition-colors",
                  tab === t.key
                    ? "border-line bg-surface text-ink"
                    : "border-transparent text-ink-3 hover:text-ink"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1">
            {tab === "catalog" ? (
              <CourseCatalog slots={slots} />
            ) : (
              <MajorMatchPanel slots={slots} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
