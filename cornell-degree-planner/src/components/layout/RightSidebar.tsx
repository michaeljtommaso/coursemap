import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { animate } from "animejs";
import { CourseCatalog } from "@/components/catalog/CourseCatalog";
import { dragState } from "@/lib/drag/dragState";
import type { ProgramSlotWithData } from "@/types/db";

export function RightSidebar({ slots }: { slots: ProgramSlotWithData[] }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const hasInitRef = useRef(false);

  // Disable the backdrop's pointer-event blocking during an active drag so
  // the ghost can reach drop targets on the rest of the page.
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
      // Show backdrop
      if (!isFirst) {
        backdropRef.current.style.display = "block";
        animate(backdropRef.current, {
          opacity: [0, 1],
          duration: 200,
          ease: "out(2)",
        });
      }
      animate(panelRef.current, {
        x: 0,
        duration: isFirst ? 0 : 360,
        ease: "out(3)",
      });
    } else {
      // Hide backdrop
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
      animate(panelRef.current, {
        x: 480,
        duration: isFirst ? 0 : 360,
        ease: "in(2)",
      });
    }
  }, [open]);

  return (
    <>
      {/* Backdrop — clicking it closes the panel */}
      <div
        ref={backdropRef}
        style={{ display: "none", opacity: 0 }}
        className="fixed inset-0 z-30"
        onClick={() => setOpen(false)}
      />

      {/* Slide-in panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 z-40 flex h-full"
      >
        {/* Toggle tab */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="relative -left-7 top-1/2 z-50 flex h-14 w-7 -translate-y-1/2 items-center justify-center rounded-l-xl border border-r-0 border-border bg-card text-muted-foreground shadow-md transition-colors hover:text-foreground"
          aria-label={open ? "Close panel" : "Open panel"}
        >
          {open ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>

        {/* Panel content */}
        <div className="flex h-full w-[480px] flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4 shadow-xl">
          <CourseCatalog slots={slots} />
        </div>
      </div>
    </>
  );
}
