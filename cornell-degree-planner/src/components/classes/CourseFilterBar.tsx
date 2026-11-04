import { Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CourseFilters, PlanStatus } from "@/hooks/useCourseFilters";
import { TIME_CHOICES, clockLabel, type DayToken, type ScheduleParts } from "@/lib/classes/schedule";
import { DIST_TAG_GROUPS, type RequirementOptionGroup } from "@/lib/classes/requirementFilter";

/**
 * CourseFilterBar (spec 006 §E3) — the /classes fuller filter sidebar over the
 * shared CourseFilters model. Subject, level, credits, offered term, has-prereqs,
 * prereqs met by my taken / in-progress / planned courses (multi-select),
 * favorites, "relevant to my major", and (spec 017 D7, when ratings are live)
 * "well-rated professor", and (spec 021, once the index carries meeting
 * times) a Schedule section, and (spec 022) a Requirements section: "Counts
 * toward" one of the plan's open requirements and a roster distribution tag.
 * The catalog drawer uses a compact chip
 * row over the same model (see CatalogFilterChips); this is the roomy variant.
 */

const LEVELS = [1, 2, 3, 4, 5, 6, 7];
const CREDITS = [1, 2, 3, 4];
const PLAN_STATUSES: { key: PlanStatus; label: string; title: string }[] = [
  {
    key: "taken",
    label: "Taken",
    title: "Count courses you've marked complete or have AP/transfer credit for",
  },
  { key: "in-progress", label: "In progress", title: "Count courses you've marked in progress" },
  {
    key: "planned",
    label: "Planning to take",
    title: "Count courses on your board you haven't started yet",
  },
];

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
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={title}
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

const DAYS: { key: DayToken; label: string; title: string }[] = [
  { key: "M", label: "M", title: "Monday" },
  { key: "T", label: "T", title: "Tuesday" },
  { key: "W", label: "W", title: "Wednesday" },
  { key: "R", label: "R", title: "Thursday" },
  { key: "F", label: "F", title: "Friday" },
  { key: "S", label: "Sa", title: "Saturday" },
  { key: "Su", label: "Su", title: "Sunday" },
];

const PARTS: { key: ScheduleParts; label: string; title: string }[] = [
  { key: "lecture", label: "Lecture", title: "Check the lecture times (any one lecture time is enough)" },
  {
    key: "section",
    label: "Disc & lab",
    title: "Check the discussion and lab times (one of each must fit)",
  },
  { key: "all", label: "All", title: "Check the lecture and the discussion/lab times" },
];

/**
 * Spec 021 — the schedule filters: the days you're free (a class shows only if
 * it meets on those days alone), a time window (starts at or after, ends by),
 * which part to check (lecture / discussion & lab / all), and "Fits my
 * semester" (no clash with the courses already in the enrollment-term column).
 */
function ScheduleSection({
  filters,
  set,
  semesterLabel,
}: {
  filters: CourseFilters;
  set: (patch: Partial<CourseFilters>) => void;
  semesterLabel: string | null;
}) {
  const toggleDay = (d: DayToken) => {
    const cur = filters.days ?? [];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
    set({ days: next.length > 0 ? next : undefined });
  };
  const parts = filters.scheduleParts ?? "lecture";
  const select =
    "min-w-0 flex-1 rounded-md border border-line bg-surface px-1.5 py-1 t-body outline-none focus:border-ink";

  return (
    <Section label="Schedule">
      <p className="t-meta text-ink-3">Days I&apos;m free:</p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Days I'm free">
        {DAYS.map((d) => (
          <Toggle
            key={d.key}
            active={!!filters.days?.includes(d.key)}
            onClick={() => toggleDay(d.key)}
            title={d.title}
          >
            {d.label}
          </Toggle>
        ))}
      </div>
      <p className="pt-1 t-meta text-ink-3">Between:</p>
      <div className="flex items-center gap-1">
        <select
          aria-label="Earliest start"
          value={filters.timeFrom ?? ""}
          onChange={(e) => set({ timeFrom: e.target.value === "" ? undefined : Number(e.target.value) })}
          className={select}
        >
          <option value="">Any</option>
          {TIME_CHOICES.map((t) => (
            <option key={t} value={t}>
              {clockLabel(t)}
            </option>
          ))}
        </select>
        <span className="t-meta text-ink-3">to</span>
        <select
          aria-label="Latest end"
          value={filters.timeTo ?? ""}
          onChange={(e) => set({ timeTo: e.target.value === "" ? undefined : Number(e.target.value) })}
          className={select}
        >
          <option value="">Any</option>
          {TIME_CHOICES.map((t) => (
            <option key={t} value={t}>
              {clockLabel(t)}
            </option>
          ))}
        </select>
      </div>
      <p className="pt-1 t-meta text-ink-3">Check:</p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Which times to check">
        {PARTS.map((p) => (
          <Toggle
            key={p.key}
            active={parts === p.key}
            onClick={() => set({ scheduleParts: p.key === "lecture" ? undefined : p.key })}
            title={p.title}
          >
            {p.label}
          </Toggle>
        ))}
      </div>
      {semesterLabel && (
        <div className="pt-1">
          <Toggle
            active={!!filters.fitsSemester}
            onClick={() => set({ fitsSemester: filters.fitsSemester ? undefined : true })}
            title={`Hide classes that clash with the courses in your ${semesterLabel} column`}
          >
            Fits my {semesterLabel} schedule
          </Toggle>
        </div>
      )}
    </Section>
  );
}

/**
 * Spec 022 — "Counts toward" (the plan's open requirements; one the app can't
 * check is listed but disabled) and "Distribution tag" (Cornell's roster
 * tags, with how many classes carry each). Both combine with every other
 * filter, so "a literature class on T/R after 1 PM" is one search.
 */
function RequirementsSection({
  filters,
  set,
  requirementGroups,
  tagCounts,
}: {
  filters: CourseFilters;
  set: (patch: Partial<CourseFilters>) => void;
  requirementGroups: RequirementOptionGroup[];
  tagCounts: Record<string, number>;
}) {
  const select = "w-full rounded-md border border-line bg-surface px-2 py-1 t-body outline-none focus:border-ink";
  const offered = new Set(requirementGroups.flatMap((g) => g.options.map((o) => o.id)));
  // A chosen requirement that has since been met stays selectable (and
  // clearable) instead of silently vanishing from the select.
  const stale = filters.requirementId && !offered.has(filters.requirementId) ? filters.requirementId : null;
  const tagGroups = DIST_TAG_GROUPS.map((g) => ({
    ...g,
    tags: g.tags.filter((t) => (tagCounts[t.code] ?? 0) > 0 || t.code === filters.distTag),
  })).filter((g) => g.tags.length > 0);

  if (requirementGroups.length === 0 && !stale && tagGroups.length === 0) return null;

  return (
    <Section label="Requirements">
      {(requirementGroups.length > 0 || stale) && (
        <>
          <p className="t-meta text-ink-3">Counts toward:</p>
          <select
            aria-label="Counts toward"
            value={filters.requirementId ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              const opt = requirementGroups.flatMap((g) => g.options).find((o) => o.id === id);
              set({ requirementId: id || undefined, requirementLabel: id ? opt?.label : undefined });
            }}
            className={select}
          >
            <option value="">Any requirement</option>
            {stale && <option value={stale}>{filters.requirementLabel ?? "Chosen requirement"}</option>}
            {requirementGroups.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.id} value={o.id} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </>
      )}
      {tagGroups.length > 0 && (
        <>
          <p className="pt-1 t-meta text-ink-3">Distribution tag:</p>
          <select
            aria-label="Distribution tag"
            value={filters.distTag ?? ""}
            onChange={(e) => set({ distTag: e.target.value || undefined })}
            className={select}
          >
            <option value="">Any tag</option>
            {tagGroups.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {g.tags.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.short} — {t.name} ({tagCounts[t.code] ?? 0})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {filters.distTag && (
            <p className="t-meta text-ink-3" data-testid="dist-tag-note">
              Cornell&apos;s roster tag. Engineering liberal studies keeps its own approved list, so check a
              class there before counting it.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

export function CourseFilterBar({
  filters,
  onChange,
  subjects,
  hasProgram,
  hasOffered = true,
  showFavorites = false,
  showWellRated = false,
  hasMeetings = false,
  semesterLabel = null,
  requirementGroups = [],
  tagCounts = {},
}: {
  /** Spec 022 — the plan's open requirements for "Counts toward". */
  requirementGroups?: RequirementOptionGroup[];
  /** Spec 022 — index records per distribution tag (a tag with none hides). */
  tagCounts?: Record<string, number>;
  filters: CourseFilters;
  onChange: (f: CourseFilters) => void;
  subjects: string[];
  hasProgram: boolean;
  hasOffered?: boolean;
  showFavorites?: boolean;
  /** Spec 017 D7 — offer the well-rated chip. The caller passes true only when
   *  ratings are enabled AND loaded with at least one entry. */
  showWellRated?: boolean;
  /** Spec 021 — the index carries meeting times: show the Schedule section. */
  hasMeetings?: boolean;
  /** Spec 021 — the enrollment term's name ("Spring 2027"); null hides
   *  "Fits my semester" (no term to fit around). */
  semesterLabel?: string | null;
}) {
  const set = (patch: Partial<CourseFilters>) => onChange({ ...filters, ...patch });
  const toggle = <K extends keyof CourseFilters>(key: K, value: CourseFilters[K]) =>
    set({ [key]: filters[key] === value ? undefined : value } as Partial<CourseFilters>);

  const active = Object.values(filters).some((v) => v !== undefined);
  // Multi-select: toggle one status in or out; an empty selection clears the axis.
  const toggleMetBy = (s: PlanStatus) => {
    const cur = filters.prereqsMetBy ?? [];
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    set({ prereqsMetBy: next.length > 0 ? next : undefined });
  };

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

      <RequirementsSection
        filters={filters}
        set={set}
        requirementGroups={requirementGroups}
        tagCounts={tagCounts}
      />

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

      {hasMeetings && (
        <ScheduleSection filters={filters} set={set} semesterLabel={semesterLabel} />
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
        {/* Prereqs met by (multi-select): show only courses whose
            prerequisites the student's courses with these statuses cover;
            courses with no prerequisites always show. */}
        <p className="pt-1 t-meta text-ink-3">Met by courses I&apos;m counting:</p>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Prereqs met by">
          {PLAN_STATUSES.map((s) => (
            <Toggle
              key={s.key}
              active={!!filters.prereqsMetBy?.includes(s.key)}
              onClick={() => toggleMetBy(s.key)}
              title={s.title}
            >
              {s.label}
            </Toggle>
          ))}
        </div>
      </Section>

      {(showFavorites || hasProgram || showWellRated) && (
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
            {showWellRated && (
              <Toggle
                active={!!filters.wellRated}
                onClick={() => set({ wellRated: filters.wellRated ? undefined : true })}
                title="Lead lecturer has a verified rating of 4.0 or higher from at least 5 reviews"
              >
                Well-rated professor (4+ ★, 5+ reviews)
              </Toggle>
            )}
          </div>
        </Section>
      )}
    </aside>
  );
}
