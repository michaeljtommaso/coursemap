import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { MAX_TRIED_COURSES, type CatalogIndexRecord } from "@/lib/schemas";
import { collegeShortName } from "@/lib/planner/colleges";
import { horizonForSemester } from "@/lib/planner/horizon";
import { buildBoard } from "@/lib/planner/board";
import { formatRosterTerm } from "@/lib/classes/targetFilter";
import type { Course } from "@/types/db";
import { CreditsDialog } from "@/components/auth/CreditsDialog";
import { Toast } from "@/components/ui/Toast";
import { StudentContextQuestions } from "@/components/onboarding/StudentContextQuestions";
import { useAnswerActions } from "@/components/requirements/useAnswerActions";
import { CONCENTRATION_TEXT, NOTICE_NEED, NOTICE_TEXT } from "@/components/requirements/requirementText";
import { PageHeader } from "./PageHeader";
import { Outline, type OutlineSection } from "./Outline";
import { CreditCard } from "./CreditCard";
import { CREDIT_CARD_KEY, creditTotal } from "./creditLines";
import { AdvisorCard, GroupCard } from "./GroupCard";
import { PageRow } from "./PageRow";
import { TryStrip } from "./TryStrip";
import type { TryActions } from "./tryCourse";
import { TriedLine } from "./TriedLine";
import {
  buildCandidates,
  elsewhereTargets,
  type CandidateIndex,
  type FillTarget,
  type GroupTargets,
} from "./suggestions";
import { useFillTargets } from "./useFillTargets";
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
  triedFillsIn,
  type PageGroup,
} from "./pageModel";

/**
 * RequirementsPage (spec 028 D8/D10/D11) — `/requirements`: every requirement
 * in full, read in one column with an outline, and classes tried against
 * them.
 *
 *   header   "Requirements · <program>" · "3 of 13 done ⓘ" (PageHeader)
 *   outline  every group with its progress, sticky; click jumps, the group
 *            in view is highlighted
 *   column   Credit before Cornell → the college's groups → the major's →
 *            the concentration's (Engineering: the program's groups) →
 *            Check with your advisor (N), collapsed
 *
 * Each row carries Find a class (/classes with "Counts toward" set), Show on
 * board (back to the planner with its cards lit), Waive, its question and
 * "Looks wrong?". Each group with open rows ends with a Try strip. Tried
 * classes count in blue only (progress.tried), never as met.
 *
 * DOM: root [data-requirements-page]; rows keep the rail's hooks
 * ([data-requirement][data-status][data-engine-status]); notices
 * [data-requirement-notice=<kind>]; outline entries [data-outline-group].
 */

const NO_TRIED: string[] = [];

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

/** Tracks which group card is in view inside the scrolling column. */
function useGroupInView(root: React.RefObject<HTMLElement | null>, keysSig: string) {
  const [active, setActive] = useState<string | null>(null);
  // A jump from the outline holds its mark until the student scrolls the page
  // themselves (spec 039). In the two-column layout the page is often too
  // short to bring the chosen card to the top, and the observer would
  // otherwise mark whichever card the scroll stopped on.
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
      { root: el, rootMargin: "-20px 0px -65% 0px" /* past the cards' 16px scroll margin, so a jump marks the card it landed on */ }
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
  const saveAnswer = useAnswerActions();
  const targetsFor = useFillTargets(programId, templateSlots);

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
        progress.engine ?? "engineering"
      ),
    [progress.groups, college, program?.name, concentrationName, progress.engine]
  );
  const tried = progress.tried;
  // What each card's open rows can fill, built once for the page: a card's
  // Try strip suggests from its own, and a search result that fills nothing
  // there names what it fills in the other cards.
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
  // in this key (a Try click must not rescan the catalog): the strips skip
  // them after the scan.
  const onBoardIds = useMemo(() => new Set(placements.map((p) => canonical(p.courseId))), [placements, canonical]);
  const isOnBoard = useCallback((id: string) => onBoardIds.has(canonical(id)), [onBoardIds, canonical]);
  const excluded = useMemo(() => {
    const s = new Set<string>(onBoardIds);
    for (const c of resolved) for (const id of c.satisfiesCourseIds) s.add(canonical(id));
    return s;
  }, [onBoardIds, resolved, canonical]);
  const exclude = useCallback((id: string) => excluded.has(canonical(id)), [excluded, canonical]);
  // The catalog split once per page; every Try strip scans this.
  const candidates = useMemo(() => buildCandidates(index, enrollmentTarget), [index, enrollmentTarget]);
  const codeOfCourse = useCallback(
    (id: string) => {
      const r = recordById(id);
      return r ? `${r.subject} ${r.number}` : codeFromId(id);
    },
    [recordById]
  );

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

  const renderRow = (it: RequirementItem) => {
    const confirm = isConfirm(it);
    return (
      <PageRow
        key={it.id}
        item={it}
        tried={confirm ? undefined : tried?.items[it.id]}
        codeOfPlacement={codeOfPlacement}
        programId={programId}
        formKey={openForm?.rowId === it.id ? openForm.key : null}
        onFormChange={(key) => setOpenForm(key ? { rowId: it.id, key } : null)}
        answerEntry={answerEntry}
        onAnswer={saveAnswer}
        onToggleWaive={confirm ? undefined : () => toggleWaivedRequirement(it.id)}
        onFindClass={!confirm && isOpen(it) && it.checkable ? () => navigate(findClassUrl(it.id)) : undefined}
        onShowOnBoard={it.coveredBy.length > 0 ? () => showOnBoard(it) : undefined}
      />
    );
  };

  // ── Outline ──
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
      out.push({
        key: s.key,
        label: s.label,
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
  const keysSig = outline.flatMap((s) => s.entries.map((e) => e.key)).join("|");
  const [active, setActive] = useGroupInView(scrollRef, keysSig);
  const jump = (key: string) => {
    setActive(key);
    document.getElementById(cardDomId(key))?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  // The header's question count opens the first row with a question.
  const openFirstQuestion = () => {
    const rows = model.sections.flatMap((s) => s.groups.flatMap((g) => g.items));
    const first = rows.find((it) => it.status !== "waived" && (it.dist?.questions?.length ?? 0) > 0);
    if (!first) return;
    setOpenForm({ rowId: first.id, key: first.dist!.questions![0].key });
    const el = [...document.querySelectorAll<HTMLElement>("[data-requirement]")].find(
      (n) => n.dataset.requirement === first.id
    );
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };

  // ── Body ──
  const notice = programId ? progress.notice : undefined;
  const loading = !!programId && !notice && progress.groups.length === 0 && progress.engine === "distribution";
  const missingTried = tried?.missing ?? [];

  const creditCard = (
    <CreditCard
      resolved={resolved}
      college={college}
      major={major}
      fills={progress.creditFills}
      onEdit={() => setCreditsOpen(true)}
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
        {creditCard}
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
        {creditCard}
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
        {missingTried.length > 0 && (
          <div data-tried-missing className="flex flex-col gap-1 rounded-lg border border-dashed border-drop bg-drop-tint px-4 py-2.5">
            {missingTried.map((id) => (
              <p key={id} className="t-meta text-drop-text">
                <span className="font-semibold">{codeFromId(id)}</span> is no longer offered, so it doesn&apos;t count.{" "}
                <button type="button" onClick={() => untryCourse(id)} className="font-semibold underline underline-offset-2">
                  Remove
                </button>
              </p>
            ))}
          </div>
        )}
        <TriedLine ids={triedCourseIds} codeOf={codeOfCourse} onRemove={untryCourse} onClear={clearTried} />
        {creditCard}
        {model.sections.length === 0 && (
          <p className="t-body text-ink-3">This board has no major requirements to track. Add any course you like.</p>
        )}
        {/* The requirement cards flow down the page, and into a second column
            once the window is wide enough (spec 039): column 1 top to bottom,
            then column 2, so the reading order holds. */}
        <div className="gap-4 min-[1600px]:columns-2 [&>*]:mb-3 [&>*]:break-inside-avoid">
        {model.sections.map((s) => (
          <Fragment key={s.key}>
            {model.sections.length > 1 && <p className="mt-2 t-label text-ink-4 [break-after:avoid]">{s.label}</p>}
            {s.groups.map((g) => (
              <GroupWithStrip
                key={g.key}
                group={g}
                renderRow={renderRow}
                stripProps={{
                  groupTargets,
                  candidates,
                  recordById,
                  enrollmentTarget,
                  termLabel,
                  exclude,
                  isOnBoard,
                  canonical,
                  actions: tryActions,
                }}
                tried={tried}
              />
            ))}
          </Fragment>
        ))}
        {model.advisor.length > 0 && <AdvisorCard items={model.advisor} renderRow={renderRow} />}
        </div>
      </>
    );
  }

  return (
    <div data-requirements-page className="flex h-screen flex-col bg-canvas text-ink">
      <PageHeader
        programName={program?.name ?? null}
        progress={progress}
        triedCount={triedCourseIds.length}
        onOpenFirstQuestion={openFirstQuestion}
        onAnswer={saveAnswer}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-line bg-surface/60 px-3 py-4">
          <Outline sections={outline} active={active} onJump={jump} />
        </aside>
        {/* Fills the window like the Classes page (spec 039); the cards go
            two-up past 1600px. */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <main className="flex w-full flex-col gap-3 px-6 py-5">{body}</main>
        </div>
      </div>
      <CreditsDialog open={creditsOpen} onClose={() => setCreditsOpen(false)} />
      <TourOverlay tour="requirements" />
      <Toast />
    </div>
  );
}

/** A group card, with a Try strip when anything in it can still be filled. */
function GroupWithStrip({
  group,
  renderRow,
  stripProps,
  tried,
}: {
  group: PageGroup;
  renderRow: (it: RequirementItem) => React.ReactNode;
  stripProps: {
    groupTargets: readonly GroupTargets[];
    candidates: CandidateIndex;
    recordById: (id: string) => CatalogIndexRecord | undefined;
    enrollmentTarget: string | null;
    termLabel: string | null;
    exclude: (id: string) => boolean;
    isOnBoard: (id: string) => boolean;
    canonical: (id: string) => string;
    actions: TryActions;
  };
  tried: ReturnType<typeof useRequirementProgress>["tried"];
}) {
  const { groupTargets, canonical, actions, ...rest } = stripProps;
  const targets = useMemo<readonly FillTarget[]>(
    () => groupTargets.find((g) => g.key === group.key)?.targets ?? [],
    [groupTargets, group.key]
  );
  const elsewhere = useMemo(() => elsewhereTargets(groupTargets, group.key), [groupTargets, group.key]);
  const triedFills = useMemo(() => triedFillsIn(group.items, tried, canonical), [group.items, tried, canonical]);
  return (
    <GroupCard
      group={group}
      tried={tried}
      renderRow={renderRow}
      strip={targets.length > 0 ? <TryStrip targets={targets} elsewhere={elsewhere} triedFills={triedFills} actions={actions} {...rest} /> : undefined}
    />
  );
}
