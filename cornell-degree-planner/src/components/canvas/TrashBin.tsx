import { useRef, useEffect, useSyncExternalStore } from "react";
import { Trash2 } from "lucide-react";
import { animate } from "animejs";
import { dragState } from "@/lib/drag/dragState";
import { cn } from "@/lib/utils";

export function TrashBin() {
  const ref = useRef<HTMLDivElement>(null);

  const isDragging = useSyncExternalStore(
    dragState.subscribe,
    () => dragState.get()?.phase === "dragging"
  );

  const isOver = useSyncExternalStore(
    dragState.subscribe,
    () => !!(dragState.get()?.overTrashBin)
  );

  // Slide up when drag starts, slide down when it ends
  useEffect(() => {
    if (!ref.current) return;
    animate(ref.current, {
      y: isDragging ? 0 : 100,
      opacity: isDragging ? 1 : 0,
      duration: isDragging ? 320 : 200,
      ease: isDragging ? "out(3)" : "in(2)",
    });
  }, [isDragging]);

  // Pulse when hovering over trash
  useEffect(() => {
    if (!ref.current) return;
    animate(ref.current, {
      scale: isOver ? 1.15 : 1,
      duration: 180,
      ease: "out(3)",
    });
  }, [isOver]);

  return (
    <div
      ref={ref}
      data-trash-bin
      style={{ opacity: 0, transform: "translateY(100px)" }}
      className={cn(
        "fixed bottom-6 right-6 z-50 flex h-16 w-16 flex-col items-center justify-center",
        "rounded-2xl border-2 shadow-xl transition-colors",
        isOver
          ? "border-red-400 bg-red-50 text-red-500 dark:bg-red-950/60 dark:text-red-400"
          : "border-border bg-card text-muted-foreground"
      )}
    >
      <Trash2 className="h-6 w-6" />
      <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wider">
        Remove
      </span>
    </div>
  );
}
