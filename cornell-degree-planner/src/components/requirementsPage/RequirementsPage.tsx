import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ListTree } from "lucide-react";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { usePlan } from "@/hooks/usePlan";
import { usePrograms } from "@/hooks/usePrograms";
import { useProgramData } from "@/hooks/useProgramData";
import { useCreditProfile } from "@/hooks/useCreditProfile";
import { useRequirementProgress, type AnswerListEntry, type RequirementItem } from "@/hooks/useRequirementProgress";
import { findClassUrl } from "@/hooks/useCountsTowardParam";
import { useAuth } from "@/contexts/AuthProvider";
import { useCatalogContext } from "@/contexts/CatalogProvider";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useProgramStore } from "@/store/useProgramStore";
import { MAX_TRIED_COURSES, type AdditionalProgram, type CatalogIndexRecord } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { collegeShortName } from "@/lib/planner/colleges";
import { horizonForSemester } from "@/lib/planner/horizon";
import { buildBoard } from "@/lib/planner/board";
import { formatRosterTerm } from "@/lib/classes/targetFilter";
import type { Course } from "@/types/db";
import { CreditsDialog } from "@/components/auth/CreditsDialog";
import { Toast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { StudentContextQuestions } from "@/components/onboarding/StudentContextQuestions";
import { useAnswerActions } from "@/components/requirements/useAnswerActions";
import { useMakeRoom } from "@/components/requirements/orphanPrune";
import {
  countItForLabel,
  countsForChoices,
  extraSections,
  heldBackReason,
  isExtraSection,
  overlapLine,
  resolveHeldBack,
  sectionNamer,
} from "@/components/requirements/programSections";
import { countsForKey } from "@/lib/planner/questions/keys";
import { ProgramSectionHeader } from "./ProgramSectionHeader";
import { useMinorIndex } from "@/hooks/useAdditionalProgramData";
import { notOpenWarnings } from "@/components/programs/programsModel";
import { ConcentrationChooser } from "@/components/programs/ConcentrationChooser";
import { useSecondMajorConcentration } from "@/components/programs/useSecondMajorConcentration";
import { CONCENTRATION_TEXT, NOTICE_NEED, NOTICE_TEXT } from "@/components/requirements/requirementText";
import { PageHeader } from "./PageHeader";
import { Outline, type OutlineSection } from "./Outline";
import { CreditTable } from "./CreditTable";
import { CREDIT_CARD_KEY, creditTotal } from "./creditLines";
import { RequirementTable } from "./RequirementTable";
import { RequirementPanel, type PanelHeldBack, type PanelSuggestProps } from "./RequirementPanel";
import { TrySearch } from "./TrySearch";
import type { TryActions } from "./tryCourse";
import { buildCandidates, type FillTarget, type GroupTargets } from "./suggestions";
import { useFillTargets } from "./useFillTargets";
import { WIDE_QUERY, outlineMode, useMediaQuery } from "./pageLayout";
import {
  ADVISOR_CARD_KEY,
  amountDone,
  buildPageModel,
  cardDomId,
  codeFromId,
  formatAmount,
  groupAmount,
  isConfirm,
  isOpen,
  locateRow,
  triedFillsIn,
  type PageGroup,
  type PageSection,
} from "./pageModel";

/**
 * RequirementsPage (spec 045, after spec 028 D8/D10/D11) — `/requirements`:
 * every requirement as one line of a group table, with the selected one's
 * details in a side panel.
 *
 *   header   back · "Requirements · <program>" · "Try a class…" search
 *            (TrySearch, with the tried chips) · "3 of 13 done ⓘ"
 *   outline  every group with its progress; click jumps, the group in view
 *            is highlighted. Below 1280px with the panel open it collapses
 *            to a "Show the outline" button that opens it over the table.
 *   main     Credit before Cornell (CreditTable) → the college's groups →
 *            the major's → the concentration's (Engineering: the program's
 *            groups) → Check with your advisor (N), collapsed. Finished rows
 *            fold into one line per group.
 *   panel    the selected requirement (RequirementPanel): note, categories,
 *            question, Show on board, Waive, Looks wrong?, and classes that
 *            would fill it. ✕ or Esc closes it; the selection is per visit.
 *
 * Tried classes count in blue only (progress.tried), never as met.
 *
 * Spec 047 D6/D8/D10: with a second major or minor the main column stacks one
 * foldable section per program (ProgramSectionHeader: college, primary,
 * second major, minors), each with its own percent and, under the later
 * program of a limited pair, the overlap line; the outline jumps between
 * programs too; the header counts every program. A course an overlap limit
 * holds back shows in the panel of the row it counts for, with "Count it for
 * X instead". A waiver or answer write at its cap first drops orphaned
 * entries (orphanPrune.ts). The second major's section carries its
 * concentration chooser (D2: "Choose a concentration to finish Mathematics"
 * until one is chosen); a minor a major on the plan isn't open to reads as a
 * warning (D12), like a pair that can't be combined (D14). A plan with no
 * extra program renders as before.
 *
 * DOM: root [data-requirements-page] (with the roomy type scale); rows keep
 * the rail's hooks ([data-requirement][data-status][data-engine-status]);
 * the panel [data-requirement-panel]; notices [data-requirement-notice=<kind>];
 * outline entries [data-outline-group]; the collapsed outline's button
 * [data-outline-toggle].
 */

const NO_TRIED: string[] = [];
const NO_PROGRAMS: AdditionalProgram[] = [];
const PANEL_ID = "requirement-panel";

/**
 * The board column whose term is the enrollment term, among the board's REAL
 * columns (as the rail's targetHighlightSem reads them), or null when the
 * board shows no such column. "+ <term>" only places into a column it can
 * name; otherwise the course is armed for the board.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function enrollmentColumn(
  columnSems: readonly number[],
  enteringYear: number | null,
  target: string | null
): number | null {
  for (const sem of columnSems) {
    if (horizonForSemester(sem, enteringYear, target) === "near") return sem;
  }
  return null;
}

/** Tracks which group is in view inside the scrolling column. */
function useGroupInView(root: React.RefObject<HTMLElement | null>, keysSig: string) {
  const [active, setActive] = useState<string | null>(null);
  // A jump from the outline holds its mark until the student scrolls the page
  // themselves (spec 039): the page is often too short to bring the last
  // groups to the top, and the observer would otherwise mark whichever group
  // the scroll stopped on.
  const held = useRef(false);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const cards = [...el.querySelectorAll<HTMLElement>("[data-group-card]")];
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).dataset.groupCard!;
          if (e.isIntersecting) visible.add(key);
          else visible.delete(key);
        }
        if (held.current) return;
        const first = cards.find((c) => visible.has(c.dataset.groupCard!));
        if (first) setActive(first.dataset.groupCard!);
      },
      { root: el, rootMargin: "-20px 0px -65% 0px" /* past the groups' 16px scroll margin, so a jump marks the group it landed on */ }
    );
    cards.forEach((c) => io.observe(c));
    const release = () => {
      held.current = false;
    };
    el.addEventListener("wheel", release, { passive: true });
    el.addEventListener("touchmove", release, { passive: true });
    el.addEventListener("keydown", release);
    el.addEventListener("pointerdown", release); // dragging the scrollbar
    return () => {
      io.disconnect();
      el.removeEventListener("wheel", release);
      el.removeEventListener("touchmove", release);
      el.removeEventListener("keydown", release);
      el.removeEventListener("pointerdown", release);
    };
  }, [root, keysSig]);
  const jumpTo = useCallback((key: string) => {
    held.current = true;
    setActive(key);
  }, []);
  return [active, jumpTo] as const;
}

/** A row's select button, by requirement id. */
function rowButton(id: string): HTMLElement | undefined {
  const li = [...document.querySelectorAll<HTMLElement>("[data-requirement]")].find((n) => n.dataset.requirement === id);
  return li?.querySelector<HTMLElement>("[data-row-select]") ?? undefined;
}

/** Typing contexts handle their own Esc (a report note, a search box). */
function isTextField(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export function RequirementsPage() {
  const progress = useRequirementProgress();
  const {
    placements,
    placedCourses,
    planProgramId,
    toggleWaivedRequirement,
    triedCourseIds = NO_TRIED,
    tryCourse,
    untryCourse,
    clearTried,
    addPlacement,
    courseMarks,
    setCountsFor,
    additionalPrograms = NO_PROGRAMS,
  } = usePlan();
  const selectedProgramId = useProgramStore((s) => s.selectedProgramId);
  const programId = planProgramId ?? selectedProgramId;
  const { programs } = usePrograms();
  const program = programs.find((p) => p.id === programId) ?? null;
  const { slots: templateSlots } = useProgramData(programId);
  const { resolved, college, major } = useCreditProfile();
  const { index, aliases, enrollmentTarget } = useCatalogContext();
  const { enteringYear } = useAuth();
  const setHighlighted = usePlannerStore((s) => s.setHighlightedPlacementIds);
  const creditsOpen = usePlannerStore((s) => s.creditsOpen);
  const setCreditsOpen = usePlannerStore((s) => s.setCreditsOpen);
  const armCourse = usePlannerStore((s) => s.armCourse);
  const showToast = usePlannerStore((s) => s.showToast);
  const navigate = useNavigate();
  // D10: a write at its cap drops orphaned entries first (when safe).
  const makeRoom = useMakeRoom(progress);
  const beforeMark = useCallback(
    (key: string, value: Parameters<typeof makeRoom>[2]) => makeRoom("mark", key, value),
    [makeRoom]
  );
  const saveAnswer = useAnswerActions(beforeMark);
  const targetsFor = useFillTargets(programId, templateSlots);
  const wide = useMediaQuery(WIDE_QUERY);

  const [openForm, setOpenForm] = useState<{ rowId: string; key: string } | null>(null);
  const answerByKey = useMemo(() => {
    const map = new Map<string, AnswerListEntry>();
    for (const a of progress.answers ?? []) map.set(a.key, a);
    return map;
  }, [progress.answers]);
  const answerEntry = useCallback((key: string) => answerByKey.get(key), [answerByKey]);

  // ── The page's shape ──
  const conc = progress.concentrations;
  const concentrationName =
    conc && conc.chosen.length > 0
      ? conc.chosen.map((id) => conc.options.find((o) => o.id === id)?.name ?? id).join(", ")
      : null;
  const model = useMemo(
    () =>
      buildPageModel(
        progress.groups,
        {
          college: college ? collegeShortName(college) : null,
          program: program?.name ?? null,
          concentration: concentrationName,
        },
        progress.engine ?? "engineering",
        progress.sections
      ),
    [progress.groups, college, program?.name, concentrationName, progress.engine, progress.sections]
  );
  // -- Spec 047: several programs --
  const programMode = model.sections.some((s) => s.program);
  const extras = useMemo(() => extraSections(progress), [progress]);
  const nameOf = useMemo(() => sectionNamer(progress.sections), [progress.sections]);
  // Folded program sections (open by default; per visit).
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleFold = useCallback((key: string) => {
    setFolded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  /** Group key -> its program section (program mode only). */
  const sectionOfGroup = useMemo(() => {
    const map = new Map<string, PageSection>();
    for (const s of model.sections) if (s.program) for (const g of s.groups) map.set(g.key, s);
    return map;
  }, [model]);
  const allDone = useMemo(() => {
    if (!programMode) return undefined;
    let satisfied = 0;
    let total = 0;
    for (const s of progress.sections ?? []) {
      satisfied += s.satisfiedCount;
      total += s.total;
    }
    return { satisfied, total };
  }, [programMode, progress.sections]);
  const tried = progress.tried;
  // What each group's open rows can fill, built once for the page: the header
  // search names what a class would fill anywhere on the page.
  const groupTargets = useMemo<GroupTargets[]>(
    () =>
      model.sections.flatMap((s) =>
        s.groups.map((g) => ({ key: g.key, title: g.title, targets: targetsFor(g.items) }))
      ),
    [model, targetsFor]
  );

  // ── Lookups ──
  const canonical = useCallback((id: string) => aliases[id] ?? id, [aliases]);
  const codeByPlacement = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of placements) {
      const c = placedCourses[p.courseId];
      map.set(p.id, c ? `${c.subject} ${c.number}` : codeFromId(p.courseId));
    }
    return map;
  }, [placements, placedCourses]);
  const codeOfPlacement = useCallback((id: string) => codeByPlacement.get(id) ?? "a course", [codeByPlacement]);
  const recordMap = useMemo(() => new Map(index.map((r) => [r.id, r])), [index]);
  const recordById = useCallback(
    (id: string): CatalogIndexRecord | undefined => recordMap.get(id) ?? recordMap.get(canonical(id)),
    [recordMap, canonical]
  );
  // Never suggested: on the board or earned by credit. Tried classes are not
  // in this key (a Try click must not rescan the catalog): the panel skips
  // them after the scan.
  const onBoardIds = useMemo(() => new Set(placements.map((p) => canonical(p.courseId))), [placements, canonical]);
  const isOnBoard = useCallback((id: string) => onBoardIds.has(canonical(id)), [onBoardIds, canonical]);
  const excluded = useMemo(() => {
    const s = new Set<string>(onBoardIds);
    for (const c of resolved) for (const id of c.satisfiesCourseIds) s.add(canonical(id));
    return s;
  }, [onBoardIds, resolved, canonical]);
  const exclude = useCallback((id: string) => excluded.has(canonical(id)), [excluded, canonical]);
  // The catalog split once per page; the panel's suggestions scan this.
  const candidates = useMemo(() => buildCandidates(index, enrollmentTarget), [index, enrollmentTarget]);
  const codeOfCourse = useCallback(
    (id: string) => {
      const r = recordById(id);
      return r ? `${r.subject} ${r.number}` : codeFromId(id);
    },
    [recordById]
  );

  // Spec 047 D8: where shared courses count, for "Your answers". Listed even
  // with no extra program left (a removed program's choice stays stored, D10,
  // and must stay clearable); a plan that never had one has none.
  const choices = useMemo(
    () => countsForChoices(courseMarks, progress, codeOfCourse),
    [courseMarks, progress, codeOfCourse]
  );
  // D12: a minor a major on the plan isn't open to (an old plan, or a carry-
  // over before the minor index loaded) reads as a warning.
  const { entries: minorEntries } = useMinorIndex(additionalPrograms.some((p) => p.kind === "minor"));
  const notOpen = useMemo(
    () =>
      programId
        ? notOpenWarnings({
            primaryId: programId,
            list: additionalPrograms,
            notOpenToOf: (id) => minorEntries.find((e) => e.id === id)?.notOpenTo,
            shortNameOf: nameOf,
          })
        : new Map<string, string>(),
    [programId, additionalPrograms, minorEntries, nameOf]
  );
  // Overlap lines (under the later program, `pair.b`) and D14 / D12 warnings.
  const overlapBySection = useMemo(() => {
    const lines = new Map<string, string[]>();
    const forbidden = new Map<string, string>(notOpen);
    for (const pair of progress.overlap ?? []) {
      const line = overlapLine(pair, nameOf, codeOfCourse);
      if (pair.limit === "forbidden") forbidden.set(pair.b, forbidden.has(pair.b) ? `${forbidden.get(pair.b)} ${line}` : line);
      else lines.set(pair.b, [...(lines.get(pair.b) ?? []), line]);
    }
    return { lines, forbidden };
  }, [progress.overlap, nameOf, codeOfCourse, notOpen]);
  // D2: the second major's concentration chooser.
  const { choice: secondConcentration, choose: chooseSecondConcentration } = useSecondMajorConcentration();
  const heldBackByPlacement = useMemo(() => (programMode ? resolveHeldBack(progress) : {}), [programMode, progress]);

  // ── Actions ──
  // Semesters only: "+ <term>" adds to the enrollment-term SEMESTER, never a
  // short term (spec 042), which shares its semester's `sem`.
  const columnSems = useMemo(
    () =>
      buildBoard(placements, placedCourses)
        .columns.filter((c) => !c.shortTerm)
        .map((c) => c.sem),
    [placements, placedCourses]
  );
  const enrollSem = useMemo(
    () => enrollmentColumn(columnSems, enteringYear, enrollmentTarget),
    [columnSems, enteringYear, enrollmentTarget]
  );
  const termLabel = formatRosterTerm(enrollmentTarget);
  const atCap = triedCourseIds.length >= MAX_TRIED_COURSES;
  const onAdd = useCallback(
    (course: Course) => {
      const code = `${course.subject} ${course.number}`;
      if (enrollSem != null && termLabel) {
        if (addPlacement(course, enrollSem)) {
          showToast(`${code} added to ${termLabel}`, { actionLabel: "View board", onAction: () => navigate("/") });
        }
        return;
      }
      // No enrollment term, or no board column for it: the board's
      // click-to-place.
      armCourse(course, null);
      navigate("/");
    },
    [enrollSem, termLabel, addPlacement, showToast, armCourse, navigate]
  );
  const tryActions: TryActions = {
    triedIds: triedCourseIds,
    atCap,
    onTry: tryCourse,
    onUntry: untryCourse,
    onAdd,
    addLabel: enrollSem != null && termLabel ? `+ ${termLabel}` : "Place on board",
  };

  const showOnBoard = useCallback(
    (it: RequirementItem) => {
      setHighlighted(it.coveredBy);
      navigate("/");
    },
    [setHighlighted, navigate]
  );

  // ── Selection (D3) ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overlayWanted, setOutlineOverlay] = useState(false);
  /** The row to give focus back to once the panel closes. */
  const returnFocus = useRef<{ id: string; groupKey: string } | null>(null);
  const located = useMemo(() => locateRow(model, selectedId), [model, selectedId]);
  const selected = located?.item ?? null;
  const panelOpen = !!selected;
  // A selection whose row is gone (a notice, or a start-term, transfer or
  // concentration change removed it) is dropped while rendering, so the
  // panel never reopens on its own later and takes focus.
  if (selectedId != null && !located) {
    setSelectedId(null);
    setOpenForm(null);
  }

  const closePanel = useCallback(() => {
    if (!located) return;
    returnFocus.current = { id: located.item.id, groupKey: located.group?.key ?? ADVISOR_CARD_KEY };
    setSelectedId(null);
    setOpenForm(null);
    setOutlineOverlay(false);
  }, [located]);
  // Focus goes back to the row, or (when it folded away on closing) to its
  // group's fold toggle.
  useEffect(() => {
    if (panelOpen || !returnFocus.current) return;
    const { id, groupKey } = returnFocus.current;
    returnFocus.current = null;
    // The fold toggle wins over the group's other buttons wherever it sits;
    // the first button only when the group has no fold toggle.
    const card = document.getElementById(cardDomId(groupKey));
    const target =
      rowButton(id) ??
      card?.querySelector<HTMLElement>("[data-fold-toggle]") ??
      card?.querySelector<HTMLElement>("button");
    target?.focus({ preventScroll: true });
  }, [panelOpen]);

  const select = useCallback(
    (it: RequirementItem) => {
      if (it.id === selectedId) {
        closePanel();
        return;
      }
      setSelectedId(it.id);
      setOpenForm((f) => (f?.rowId === it.id ? f : null));
    },
    [selectedId, closePanel]
  );

  // ── Outline (D9) ──
  const mode = outlineMode(wide, panelOpen);
  // Only over a collapsed outline; closing the panel or a jump clears it.
  const outlineOverlay = mode === "collapsed" && overlayWanted;

  // Esc closes the outline overlay first, then the panel.
  useEffect(() => {
    if (!panelOpen && !outlineOverlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || creditsOpen || isTextField(e.target)) return;
      if (outlineOverlay) setOutlineOverlay(false);
      else closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, outlineOverlay, creditsOpen, closePanel]);

  const outline = useMemo<OutlineSection[]>(() => {
    const total = creditTotal(resolved);
    const out: OutlineSection[] = [
      {
        key: "credit-section",
        label: null,
        entries: [{ key: CREDIT_CARD_KEY, label: "Credit before Cornell", progress: total > 0 ? `${total} cr` : "" }],
      },
    ];
    for (const s of model.sections) {
      const p = s.program;
      out.push({
        key: s.key,
        label: p ? p.shortName || p.name : s.label,
        program: p
          ? {
              color: p.color,
              progress:
                p.status === "loading" ? "…" : p.status === "unavailable" ? "—" : `${Math.round(p.pct)}%`,
            }
          : undefined,
        entries: s.groups.map((g: PageGroup) => {
          const a = groupAmount(g, tried);
          const done = amountDone(a);
          return {
            key: g.key,
            label: g.title,
            progress: a.need > 0 ? (done ? "✓" : formatAmount(a)) : "",
            done,
            plus: a.plus,
          };
        }),
      });
    }
    if (model.advisor.length > 0) {
      out.push({
        key: "advisor-section",
        label: null,
        entries: [
          { key: ADVISOR_CARD_KEY, label: "Check with your advisor", progress: String(model.advisor.length), muted: true },
        ],
      });
    }
    return out;
  }, [resolved, model, tried]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Folding mounts and unmounts group cards, so the in-view observer re-reads them.
  const keysSig = `${outline.flatMap((s) => s.entries.map((e) => e.key)).join("|")}#${[...folded].join("|")}`;
  const [active, setActive] = useGroupInView(scrollRef, keysSig);
  const scrollToCard = (key: string) =>
    document.getElementById(cardDomId(key))?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  /** Unfold the program section holding `key` (a section or one of its groups). */
  const unfoldFor = (key: string): boolean => {
    const sectionKey = folded.has(key) ? key : sectionOfGroup.get(key)?.key;
    if (!sectionKey || !folded.has(sectionKey)) return false;
    toggleFold(sectionKey);
    return true;
  };
  const jump = (key: string) => {
    setActive(key);
    setOutlineOverlay(false);
    // A group in a folded section: unfold first, scroll once it renders.
    if (unfoldFor(key)) requestAnimationFrame(() => scrollToCard(key));
    else scrollToCard(key);
  };

  // The header's question count opens the panel on the first row with a
  // question, its form open.
  const openFirstQuestion = () => {
    const rows = model.sections.flatMap((s) => s.groups.flatMap((g) => g.items));
    const first = rows.find((it) => it.status !== "waived" && (it.dist?.questions?.length ?? 0) > 0);
    if (!first) return;
    for (const s of model.sections) {
      if (s.program && folded.has(s.key) && s.groups.some((g) => g.items.includes(first))) toggleFold(s.key);
    }
    setSelectedId(first.id);
    setOpenForm({ rowId: first.id, key: first.dist!.questions![0].key });
    requestAnimationFrame(() => rowButton(first.id)?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
  };

  // ── The panel's suggestions: this requirement's open things only ──
  const selectedTargets = useMemo<readonly FillTarget[]>(
    () => (selected && !isConfirm(selected) ? targetsFor([selected]) : []),
    [selected, targetsFor]
  );
  const selectedTriedFills = useMemo(
    () => (selected ? triedFillsIn([selected], tried, canonical) : {}),
    [selected, tried, canonical]
  );

  // ── Body ──
  const notice = programId ? progress.notice : undefined;
  const loading = !!programId && !notice && progress.groups.length === 0 && progress.engine === "distribution";

  const creditTable = (
    <CreditTable
      resolved={resolved}
      college={college}
      major={major}
      fills={progress.creditFills}
      creditCount={progress.creditCount}
      onEdit={() => setCreditsOpen(true)}
    />
  );

  const table = (g: PageGroup) => (
    <RequirementTable
      key={g.key}
      group={g}
      tried={tried}
      codeOfPlacement={codeOfPlacement}
      selectedId={selectedId}
      panelId={PANEL_ID}
      onSelect={select}
    />
  );

  let body: React.ReactNode;
  if (!programId) {
    body = (
      <>
        <p className="t-body text-ink-3">
          Pick a major on the <Link to="/" className="text-drop-text underline underline-offset-2">planner</Link> and
          everything it needs shows up here.
        </p>
        {creditTable}
      </>
    );
  } else if (notice) {
    const need = NOTICE_NEED[notice.kind];
    body = (
      <>
        <div
          data-requirement-notice={notice.kind}
          className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3"
        >
          <p className="t-body text-ink-2">{NOTICE_TEXT[notice.kind]}</p>
          {need && <StudentContextQuestions need={need} compact />}
        </div>
        {creditTable}
      </>
    );
  } else if (loading) {
    body = <p className="t-body text-ink-3">Loading requirements…</p>;
  } else {
    body = (
      <>
        {conc?.needed && (
          <div
            data-requirement-notice="needs-concentration"
            className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3"
          >
            <p className="t-body text-ink-2">{CONCENTRATION_TEXT(conc.min, conc.max)}</p>
            <StudentContextQuestions need="concentration" compact />
          </div>
        )}
        {creditTable}
        {model.sections.length === 0 && (
          <p className="t-body text-ink-3">This board has no major requirements to track. Add any course you like.</p>
        )}
        {model.sections.map((s) =>
          s.program ? (
            <ProgramSectionHeader
              key={s.key}
              section={s.program}
              domId={cardDomId(s.key)}
              open={!folded.has(s.key)}
              onToggle={() => toggleFold(s.key)}
              overlapLines={overlapBySection.lines.get(s.program.id) ?? []}
              forbiddenText={overlapBySection.forbidden.get(s.program.id) ?? null}
              concentration={
                secondConcentration && secondConcentration.programId === s.program.id
                  ? {
                      needed: secondConcentration.needed,
                      chooser: (
                        <ConcentrationChooser choice={secondConcentration} onChange={chooseSecondConcentration} />
                      ),
                    }
                  : null
              }
            >
              {s.groups.length > 0 ? (
                s.groups.map(table)
              ) : (
                <p className="t-body text-ink-3">Nothing to track here.</p>
              )}
            </ProgramSectionHeader>
          ) : (
            <Fragment key={s.key}>
              {model.sections.length > 1 && <p className="-mb-1 mt-2 t-label text-ink-4">{s.label}</p>}
              {s.groups.map(table)}
            </Fragment>
          )
        )}
        {model.advisor.length > 0 && (
          <RequirementTable
            variant="advisor"
            group={{ key: ADVISOR_CARD_KEY, title: "Check with your advisor", items: model.advisor }}
            codeOfPlacement={codeOfPlacement}
            selectedId={selectedId}
            panelId={PANEL_ID}
            onSelect={select}
          />
        )}
      </>
    );
  }

  // ── The panel ──
  let panel: React.ReactNode = null;
  if (located) {
    const it = located.item;
    const advisor = located.advisor;
    // Spec 047: an extra program's breadcrumb names the program.
    const groupSection = located.group ? sectionOfGroup.get(located.group.key) : undefined;
    const where = located.group
      ? groupSection?.program && isExtraSection(groupSection.program)
        ? `${groupSection.program.shortName || groupSection.program.name} · ${located.group.title}`
        : located.group.title
      : "Check with your advisor";
    // D8: courses counting here that a limit holds back from another program.
    const rowSection = groupSection?.program?.id;
    const panelHeldBack: PanelHeldBack[] = advisor
      ? []
      : it.coveredBy.flatMap((pid) =>
          (heldBackByPlacement[pid] ?? [])
            .filter((h) => !rowSection || h.countsFor === rowSection)
            .map((h) => {
              const code = codeOfCourse(h.courseId);
              const layerId = h.layerId;
              return {
                courseId: h.courseId,
                text: `${code} is held back from ${h.heldFromName} (overlap limit)`,
                reason: heldBackReason(h, code),
                actionLabel: countItForLabel(h),
                onChoose: layerId
                  ? () => {
                      makeRoom("mark", countsForKey(layerId, h.courseId), "yes");
                      setCountsFor(h.courseId, layerId);
                    }
                  : undefined,
              };
            })
        );
    const suggest: PanelSuggestProps | undefined =
      !advisor && isOpen(it) && it.checkable && selectedTargets.length > 0
        ? {
            targets: selectedTargets,
            candidates,
            exclude,
            recordById,
            enrollmentTarget,
            termLabel,
            triedFills: selectedTriedFills,
            actions: tryActions,
          }
        : undefined;
    panel = (
      <RequirementPanel
        key={it.id}
        id={PANEL_ID}
        item={it}
        where={where}
        advisor={advisor}
        tried={advisor ? undefined : tried?.items[it.id]}
        codeOfPlacement={codeOfPlacement}
        programId={programId}
        formKey={openForm?.rowId === it.id ? openForm.key : null}
        onFormChange={(key) => setOpenForm(key ? { rowId: it.id, key } : null)}
        answerEntry={answerEntry}
        onAnswer={saveAnswer}
        onToggleWaive={
          advisor
            ? undefined
            : () => {
                makeRoom("waiver", it.id);
                toggleWaivedRequirement(it.id);
              }
        }
        onFindClass={!advisor && isOpen(it) && it.checkable ? () => navigate(findClassUrl(it.id)) : undefined}
        onShowOnBoard={!advisor && it.coveredBy.length > 0 ? () => showOnBoard(it) : undefined}
        onClose={closePanel}
        suggest={suggest}
        heldBack={panelHeldBack}
      />
    );
  }

  return (
    // A fixed h-screen viewport that never scrolls as a whole: only the outline
    // and the main column scroll. `relative` + `overflow-clip` keep anything
    // absolutely placed with no positioned parent (sr-only labels deep in the
    // scrolled content) from stretching the document past the window.
    <div data-requirements-page className="relative flex h-screen flex-col overflow-clip bg-canvas text-ink">
      <PageHeader
        programName={program?.name ?? null}
        progress={progress}
        triedCount={triedCourseIds.length}
        onOpenFirstQuestion={openFirstQuestion}
        onAnswer={saveAnswer}
        extraProgramCount={extras.length}
        allDone={allDone}
        choices={choices}
        search={
          <TrySearch
            groupTargets={groupTargets}
            recordById={recordById}
            enrollmentTarget={enrollmentTarget}
            termLabel={termLabel}
            isOnBoard={isOnBoard}
            actions={tryActions}
            codeOf={codeOfCourse}
            onClearTried={clearTried}
            missingTried={tried?.missing ?? []}
            compact={!wide}
          />
        }
      />
      <div className="relative flex min-h-0 flex-1">
        {mode === "full" ? (
          <aside className="w-60 shrink-0 overflow-y-auto border-r border-line bg-surface/60 px-3 py-4">
            <Outline sections={outline} active={active} onJump={jump} />
          </aside>
        ) : (
          <aside data-outline-collapsed className="flex w-12 shrink-0 justify-center border-r border-line bg-surface/60 pt-3.5">
            <Tooltip content="Show the outline" placement="right">
              <button
                type="button"
                data-outline-toggle
                aria-label="Show the outline"
                aria-expanded={outlineOverlay}
                onClick={() => setOutlineOverlay((v) => !v)}
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink",
                  outlineOverlay ? "bg-surface-2" : "bg-surface"
                )}
              >
                <ListTree className="h-4 w-4" aria-hidden />
              </button>
            </Tooltip>
            {outlineOverlay && (
              <>
                <div className="absolute inset-0 left-12 z-10" aria-hidden onClick={() => setOutlineOverlay(false)} />
                <div
                  data-outline-overlay
                  className="absolute bottom-0 left-12 top-0 z-20 w-60 overflow-y-auto border-r border-line bg-surface px-3 py-4 shadow-[var(--shadow-xl)]"
                >
                  <Outline sections={outline} active={active} onJump={jump} />
                </div>
              </>
            )}
          </aside>
        )}
        {/* One column of group tables filling the window (no newspaper
            columns, spec 045 D1). */}
        <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <main className="flex w-full flex-col gap-4 px-6 py-5">{body}</main>
        </div>
        {panel}
      </div>
      <CreditsDialog open={creditsOpen} onClose={() => setCreditsOpen(false)} />
      <TourOverlay tour="requirements" />
      <Toast />
    </div>
  );
}
