import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { animate } from "animejs";
import { cn } from "@/lib/utils";
import { CourseCatalog } from "@/components/catalog/CourseCatalog";
import { MajorMatchPanel } from "@/components/majors/MajorMatchPanel";
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

  // Click-outside-to-close. The panel is a slide-in drawer over the
  // roadmap, not a modal — the roadmap and top bar must stay clickable
  // while it's open, since click-to-place (CourseCatalog: arm a course,
  // tap a lit slot on the roadmap) depends on it, and so does the top
  // bar's Reset control. So this closes on outside clicks via a document
  // listener instead of a pointer-blocking backdrop: it never intercepts
  // the click, it only reacts after the click's own handler (e.g. a
  // slot's onClick, or Reset's onClick) has already run.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, setPanelOpen]);

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
      {/*
       * Visual-only layer — no click handler (outside-click-to-close is the
       * document listener above, which never blocks the click itself).
       * pointer-events-none so it can never sit in front of the roadmap or
       * top bar and swallow real clicks the way a blocking backdrop would;
       * kept as an element (rather than dropped entirely) purely so its
       * opacity fade stays in sync with the panel's slide animation.
       */}
      <div
        ref={backdropRef}
        style={{ display: "none", opacity: 0 }}
        className="pointer-events-none fixed inset-0 z-[var(--z-sidebar-backdrop)]"
      />

      {/* Anchored to AppShell's content row (absolute within its `relative
          flex-1` wrapper), so the drawer spans exactly the area below the top
          bar — it can never cover the header's Reset / Save / theme controls,
          whatever the header's real rendered height is. */}
      <div
        ref={panelRef}
        className="absolute inset-y-0 right-0 z-[var(--z-sidebar-panel)] flex"
      >
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
