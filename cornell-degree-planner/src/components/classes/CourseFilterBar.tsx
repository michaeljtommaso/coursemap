import { Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CourseFilters } from "@/hooks/useCourseFilters";

/**
 * CourseFilterBar (spec 006 §E3) — the /classes fuller filter sidebar over the
 * shared CourseFilters model. Subject, level, credits, offered term, has-prereqs,
 * favorites, and "relevant to my major". The catalog drawer uses a compact chip
 * row over the same model (see CatalogFilterChips); this is the roomy variant.
 */

const LEVELS = [1, 2, 3, 4, 5, 6, 7];
const CREDITS = [1, 2, 3, 4];
const TERMS: { key: string; label: string }[] = [
  { key: "FA", label: "Fall" },
  { key: "SP", label: "Spring" },
  { key: "SU", label: "Summer" },
  { key: "WI", label: "Winter" },
];

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="t-label">{label}</p>
      {children}
    </div>
  );
}

function Toggle({
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
        "rounded-full border px-2.5 py-0.5 t-meta transition-colors",
        active
          ? "border-drop bg-drop-tint text-drop-text"
          : "border-line text-ink-3 hover:border-ink-3 hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

export function CourseFilterBar({
  filters,
  onChange,
  subjects,
  hasProgram,
  hasOffered = true,
  showFavorites = false,
}: {
  filters: CourseFilters;
  onChange: (f: CourseFilters) => void;
  subjects: string[];
  hasProgram: boolean;
  hasOffered?: boolean;
  showFavorites?: boolean;
}) {
  const set = (patch: Partial<CourseFilters>) => onChange({ ...filters, ...patch });
  const toggle = <K extends keyof CourseFilters>(key: K, value: CourseFilters[K]) =>
    set({ [key]: filters[key] === value ? undefined : value } as Partial<CourseFilters>);

  const active = Object.values(filters).some((v) => v !== undefined);

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-surface/50 px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="t-label">Filters</p>
        {active && (
          <button
            onClick={() => onChange({})}
            className="inline-flex items-center gap-1 t-meta text-ink-3 transition-colors hover:text-ink"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      <Section label="Subject">
        <select
          value={filters.subject ?? ""}
          onChange={(e) => set({ subject: e.target.value || undefined })}
          className="w-full rounded-md border border-line bg-surface px-2 py-1 t-body outline-none focus:border-ink"
        >
          <option value="">Any subject</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Section>

      <Section label="Level">
        <div className="flex flex-wrap gap-1">
          {LEVELS.map((l) => (
            <Toggle key={l} active={filters.level === l} onClick={() => toggle("level", l)}>
              <span className="num">{l}000</span>
            </Toggle>
          ))}
        </div>
      </Section>

      <Section label="Credits">
        <div className="flex flex-wrap gap-1">
          {CREDITS.map((c) => (
            <Toggle key={c} active={filters.credits === c} onClick={() => toggle("credits", c)}>
              <span className="num">{c}</span>
            </Toggle>
          ))}
        </div>
      </Section>

      {hasOffered && (
        <Section label="Offered">
          <div className="flex flex-wrap gap-1">
            {TERMS.map((t) => (
              <Toggle
                key={t.key}
                active={filters.offered === t.key}
                onClick={() => toggle("offered", t.key)}
              >
                {t.label}
              </Toggle>
            ))}
          </div>
        </Section>
      )}

      <Section label="Prerequisites">
        <div className="flex flex-wrap gap-1">
          <Toggle active={filters.hasPrereqs === false} onClick={() => toggle("hasPrereqs", false)}>
            No prereqs
          </Toggle>
          <Toggle active={filters.hasPrereqs === true} onClick={() => toggle("hasPrereqs", true)}>
            Has prereqs
          </Toggle>
        </div>
      </Section>

      {(showFavorites || hasProgram) && (
        <Section label="Quick filters">
          <div className="flex flex-col gap-1.5">
            {showFavorites && (
              <Toggle
                active={!!filters.favoritesOnly}
                onClick={() => set({ favoritesOnly: filters.favoritesOnly ? undefined : true })}
              >
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3 w-3" /> Favorites
                </span>
              </Toggle>
            )}
            {hasProgram && (
              <Toggle
                active={!!filters.relevantToMajor}
                onClick={() => set({ relevantToMajor: filters.relevantToMajor ? undefined : true })}
              >
                Relevant to my major
              </Toggle>
            )}
          </div>
        </Section>
      )}
    </aside>
  );
}
