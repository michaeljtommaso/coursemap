import { Columns } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthProvider";

/**
 * PinButton (spec 013 §2) — the compare-tray pin toggle, the same idiom as
 * FavoriteStar and sitting right next to it on directory rows. Reads the
 * profile's pins from AuthProvider (works for anonymous uids); stops propagation
 * so it never opens the row's detail panel. AuthProvider caps active pins at 4,
 * so an add past the cap is a quiet no-op (the tray shows the "up to 4" note).
 */
export function PinButton({
  courseId,
  className,
  size = "sm",
}: {
  courseId: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const { pinnedCourseIds, togglePin } = useAuth();
  const isPinned = pinnedCourseIds.includes(courseId);
  const icon = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void togglePin(courseId);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={isPinned ? "Remove from compare" : "Add to compare"}
      aria-pressed={isPinned}
      title={isPinned ? "In your compare tray" : "Compare"}
      className={cn(
        "inline-flex items-center rounded p-0.5 transition-colors",
        isPinned ? "text-drop-text" : "text-ink-4 hover:text-ink-2",
        className
      )}
    >
      <Columns className={icon} />
    </button>
  );
}
