import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthProvider";

/**
 * FavoriteStar (spec 006 §E4) — a self-contained favorite toggle used on catalog
 * chips, directory rows, and the detail panel. Reads the profile's favorites from
 * AuthProvider (works for anonymous uids); stops propagation so it never triggers
 * the surrounding chip/row/card action.
 */
export function FavoriteStar({
  courseId,
  className,
  size = "sm",
}: {
  courseId: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const { favoriteCourseIds, toggleFavorite } = useAuth();
  const isFav = favoriteCourseIds.includes(courseId);
  const icon = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void toggleFavorite(courseId);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={isFav}
      title={isFav ? "Favorited" : "Add to favorites"}
      className={cn(
        "inline-flex items-center rounded p-0.5 transition-colors",
        isFav ? "text-available" : "text-ink-4 hover:text-ink-2",
        className
      )}
    >
      <Star className={cn(icon, isFav && "fill-current")} />
    </button>
  );
}
