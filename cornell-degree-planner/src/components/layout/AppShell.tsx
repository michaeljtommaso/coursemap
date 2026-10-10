import { useEffect } from "react";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { LeftSidebar } from "@/components/layout/LeftSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { RoadmapCanvas } from "@/components/roadmap/RoadmapCanvas";
import { CourseDetailPanel } from "@/components/course/CourseDetailPanel";
import { DragGhost } from "@/components/drag/DragGhost";
import { SignInDialog } from "@/components/auth/SignInDialog";
import { CreditsDialog } from "@/components/auth/CreditsDialog";
import { Toast } from "@/components/ui/Toast";
import {
  dragState,
  edgeScrollVelocity,
  DISARMED_EDGES,
  type EdgeArming,
} from "@/lib/drag/dragState";
import { useProgramStore } from "@/store/useProgramStore";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramData } from "@/hooks/useProgramData";
import { useBoard } from "@/hooks/useBoard";

export function AppShell() {
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const { loading, error, refetch } = useProgramData(selectedProgramId);
  const signInOpen = usePlannerStore((s) => s.signInOpen);
  const setSignInOpen = usePlannerStore((s) => s.setSignInOpen);
  const creditsOpen = usePlannerStore((s) => s.creditsOpen);
  const setCreditsOpen = usePlannerStore((s) => s.setCreditsOpen);
  // The board (spec 014): placements → columns + engine slots; the program's
  // template slots are the requirements (catalog filter, relevance, checklist).
  const { columns, engineSlots, templateSlots } = useBoard();

  useEffect(() => {
    // The drag engine's continuous phase (spec 014 §D3). useDragSource detects
    // the START on each source; from there these DOCUMENT listeners own the
    // gesture: hover hit-testing (dragState.move), edge auto-scroll, drop on
    // pointerup, and cancel on Esc / pointercancel / window blur. Every exit
    // funnels through dragState.drop()/cancel() → DragGhost → dragState.end()
    // (with a fallback timer in dragState), so `dragging-active` never sticks.
    //
    // Edge auto-scroll (spec 004 §1): dragging near the VISIBLE edge of the
    // canvas scrolls it, so off-screen semesters (and the bottoms of tall
    // columns) are reachable drop targets. The rules live in
    // dragState.edgeScrollVelocity (pure, unit-tested): only while the cursor
    // is over the canvas itself (never over the catalog drawer / detail
    // panel), the zone sits at the canvas edge that's actually visible, and an
    // edge arms only once the cursor has been outside its zone this drag — so
    // a catalog drag entering through the drawer-side zone doesn't scroll the
    // board under the user (fix pass D7). rAF loop while armed; each frame
    // re-resolves the hover target, since the canvas moves under a still cursor.
    const EDGE = 56;
    const SPEED = 14;
    let scrollRaf = 0;
    let velX = 0;
    let velY = 0;
    let lastX = 0;
    let lastY = 0;
    let edgeArming: EdgeArming = DISARMED_EDGES;
    let edgeSession: string | null = null;

    const inCanvas = (x: number, y: number) =>
      !!document.elementFromPoint(x, y)?.closest("[data-canvas-scroll]");

    const scrollLoop = () => {
      const scroller = document.querySelector<HTMLElement>("[data-canvas-scroll]");
      if (scroller && (velX !== 0 || velY !== 0) && dragState.get()?.phase === "dragging") {
        const { scrollLeft, scrollTop } = scroller;
        scroller.scrollLeft += velX;
        scroller.scrollTop += velY;
        if (scroller.scrollLeft === scrollLeft && scrollTop === scroller.scrollTop) {
          // Already at the end in that direction — idle until the next move.
          scrollRaf = 0;
          return;
        }
        dragState.move(lastX, lastY);
        scrollRaf = requestAnimationFrame(scrollLoop);
      } else {
        scrollRaf = 0;
      }
    };

    const updateEdgeScroll = (x: number, y: number) => {
      const sessionId = dragState.get()?.sessionId ?? null;
      if (sessionId !== edgeSession) {
        // A new drag: every edge starts disarmed.
        edgeSession = sessionId;
        edgeArming = DISARMED_EDGES;
      }
      const v = edgeScrollVelocity(inCanvas, x, y, edgeArming, EDGE, SPEED);
      edgeArming = v.armed;
      velX = v.velX;
      velY = v.velY;
      if ((velX !== 0 || velY !== 0) && !scrollRaf) scrollRaf = requestAnimationFrame(scrollLoop);
    };

    const stopScroll = () => {
      velX = 0;
      velY = 0;
    };

    const handleMove = (e: PointerEvent) => {
      if (dragState.get()?.phase !== "dragging") return;
      // Only the pointer that started the drag steers it (fix pass D1).
      if (!dragState.ownsPointer(e.pointerId)) return;
      // A mouse with no button held means the release was missed (e.g. it
      // happened outside the window): cancel rather than let the ghost follow
      // a released mouse (fix pass D5).
      if (e.pointerType === "mouse" && e.buttons === 0) {
        handleCancel();
        return;
      }
      lastX = e.clientX;
      lastY = e.clientY;
      dragState.move(e.clientX, e.clientY);
      updateEdgeScroll(e.clientX, e.clientY);
    };

    const handleUp = (e: PointerEvent) => {
      if (dragState.get()?.phase !== "dragging") return;
      // A second finger / palm lifting must not commit the drop (fix pass D1).
      if (!dragState.ownsPointer(e.pointerId)) return;
      stopScroll();
      // Resolve the target at the release point itself, then land there.
      dragState.move(e.clientX, e.clientY);
      dragState.drop();
    };

    // Esc / window blur: cancel whatever drag is in flight.
    const handleCancel = () => {
      stopScroll();
      dragState.cancel();
    };

    // pointercancel: only the drag's own pointer cancels it (fix pass D1).
    const handlePointerCancel = (e: PointerEvent) => {
      if (dragState.get()?.phase !== "dragging") return;
      if (!dragState.ownsPointer(e.pointerId)) return;
      handleCancel();
    };

    // Esc cancels an in-flight drag; otherwise it disarms click-to-place
    // (spec 004 §4).
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dragState.get()?.phase === "dragging") {
        e.preventDefault();
        handleCancel();
        return;
      }
      usePlannerStore.getState().disarm();
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", handlePointerCancel);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("blur", handleCancel);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("blur", handleCancel);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      // Unmounting mid-drag must not leave body.dragging-active or a
      // "dragging" phase behind forever (fix pass D4).
      dragState.end();
    };
  }, []);

  return (
    // overflow-x-clip: the shell is a fixed h-screen viewport that must NEVER
    // scroll horizontally at the page level. Off-screen-parked panels (the
    // RightSidebar drawer sits at right-0 + translateX(470px) when closed, the
    // detail side-peek likewise) would otherwise extend the document's
    // scrollWidth and let the page scroll right into the docked drawer. `clip`
    // (not `hidden`) so it doesn't establish a scroll container — the canvas's
    // own inner scroller and the columns' sticky headers keep working.
    <div className="flex h-screen flex-col overflow-x-clip bg-canvas text-ink">
      {/*
       * TopBar applies `backdrop-blur` (backdrop-filter) on its own root
       * element, which per spec makes TopBar a stacking context AND a
       * containing block for its position:fixed/absolute descendants —
       * including the "Your plans" plan-switcher dropown in PlanMenu. That
       * traps the dropdown's z-index comparisons *inside* TopBar's local
       * context: it can never out-rank a later sibling here (the roadmap
       * canvas, RightSidebar) no matter how high its own z-index climbs,
       * because TopBar itself paints at its natural (unstacked) position in
       * this flex column, which is *before* those siblings in DOM order.
       *
       * Fix: give the wrapper around TopBar its own explicit stacking
       * position at this root level (`relative` + `isolate` + a z-index from
       * the shared scale in tokens.css), higher than RightSidebar's panel
       * layer. That lets TopBar's entire (locally-trapped) subtree — dropdown
       * included — paint as one unit above the canvas and RightSidebar,
       * without needing to touch TopBar.tsx itself.
       */}
      <div className="relative isolate z-[var(--z-topbar)]">
        <TopBar />
      </div>
      {/* relative: the RightSidebar drawer anchors to THIS row (absolute,
          inset-y-0) so it always starts exactly below the top bar — it must
          never cover the header's Reset / Save / theme controls. */}
      <div className="relative flex min-h-0 flex-1">
        <LeftSidebar slots={engineSlots} />
        <div className="relative flex-1">
          <RoadmapCanvas
            columns={columns}
            slots={engineSlots}
            loading={loading}
            error={error}
            onRetry={refetch}
          />
        </div>
        <RightSidebar slots={engineSlots} templateSlots={templateSlots} />
      </div>
      {/* Course detail side-peek (spec 006 §D4) — a global overlay driven by
          usePlannerStore.detailCourse; slots feed its pools + "counts toward". */}
      <CourseDetailPanel slots={engineSlots} templateSlots={templateSlots} />
      <DragGhost />
      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
      <CreditsDialog open={creditsOpen} onClose={() => setCreditsOpen(false)} />
      <Toast />
    </div>
  );
}
