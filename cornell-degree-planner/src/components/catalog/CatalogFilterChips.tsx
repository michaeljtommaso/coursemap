import { Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CourseFilters } from "@/hooks/useCourseFilters";

/**
 * CatalogFilterChips (spec 006 §E3) — the COMPACT filter row for the catalog
 * drawer, over the same CourseFilters model the /classes fuller bar uses. A
 * wrapping row of toggle chips; deliberately fewer axes than the sidebar (no
 * subject select) to fit the 480px drawer. Seeded scopes (an attribute slot's
 * FWS filter, a Still-needed requirement — spec 014 D2) render as removable
 * chips at the front of the row.
 */

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 t-meta transition-colors",
        active
          ? "border-drop bg-drop-tint text-drop-text"
          : "border-line text-ink-3 hover:border-ink-3 hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

export function CatalogFilterChips({
  filters,
  onChange,
  hasProgram,
  hasOffered = true,
  showFavorites = false,
}: {
  filters: CourseFilters;
  onChange: (f: CourseFilters) => void;
  hasProgram: boolean;
  hasOffered?: boolean;
  showFavorites?: boolean;
}) {
  const set = (patch: Partial<CourseFilters>) => onChange({ ...filters, ...patch });
  const toggle = <K extends keyof CourseFilters>(key: K, value: CourseFilters[K]) =>
    set({ [key]: filters[key] === value ? undefined : value } as Partial<CourseFilters>);
  const active = Object.values(filters).some((v) => v !== undefined);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {/* Attribute requirement chip (spec 010 §2) — an attribute slot's "Find a
          class" opens the drawer with this active. Always ON while set; clicking
          it removes the attribute filter (matches the toggle-chip idiom). */}
      {filters.attribute && (
        <Chip
          active
          onClick={() => set({ attribute: undefined, attributeLabel: undefined })}
        >
          <span className="inline-flex items-center gap-1">
            {filters.attributeLabel ?? "Attribute"}
            <X className="h-2.5 w-2.5" />
          </span>
        </Chip>
      )}
      {/* Requirement chip (spec 014 D2) — an unmet Still-needed item opened the
          drawer scoped to courses that would satisfy it. Clicking removes it. */}
      {filters.requirementId && (
        <Chip
          active
          onClick={() => set({ requirementId: undefined, requirementLabel: undefined })}
        >
          <span
            className="inline-flex items-center gap-1"
            data-requirement-chip={filters.requirementId}
          >
            {filters.requirementLabel ?? "Requirement"}
            <X className="h-2.5 w-2.5" aria-hidden />
          </span>
        </Chip>
      )}
      {hasProgram && (
        <Chip
          active={!!filters.relevantToMajor}
          onClick={() => set({ relevantToMajor: filters.relevantToMajor ? undefined : true })}
        >
          For my major
        </Chip>
      )}
      {showFavorites && (
        <Chip
          active={!!filters.favoritesOnly}
          onClick={() => set({ favoritesOnly: filters.favoritesOnly ? undefined : true })}
        >
          <span className="inline-flex items-center gap-1">
            <Star className="h-2.5 w-2.5" /> Favorites
          </span>
        </Chip>
      )}
      <Chip active={filters.hasPrereqs === false} onClick={() => toggle("hasPrereqs", false)}>
        No prereqs
      </Chip>
      {[1, 2, 3, 4].map((l) => (
        <Chip key={l} active={filters.level === l} onClick={() => toggle("level", l)}>
          <span className="num">{l}000</span>
        </Chip>
      ))}
      {hasOffered &&
        [
          { key: "FA", label: "Fall" },
          { key: "SP", label: "Spring" },
        ].map((t) => (
          <Chip key={t.key} active={filters.offered === t.key} onClick={() => toggle("offered", t.key)}>
            {t.label}
          </Chip>
        ))}
      {active && (
        <button
          onClick={() => onChange({})}
          className="shrink-0 t-meta text-ink-3 underline-offset-2 transition-colors hover:text-ink hover:underline"
        >
          Clear
        </button>
      )}
    </div>
  );
}
