import type { ReactNode } from "react";
import { usePlannerStore } from "@/store/usePlannerStore";
import { useTopBarStore } from "@/store/useTopBarStore";
import { programFamily } from "@/lib/planner/colleges";

/**
 * The planner tour's scripts (spec 033). Three paths, because the board a
 * student lands on differs:
 *   - engineering: the major's standard plan is already placed on the board.
 *   - layer:       an Arts & Sciences / CALS major — the college sets no
 *                  semester-by-semester plan, so the board starts empty.
 *   - discover:    "Still figuring it out" — no major, empty board, the
 *                  Majors tab already open.
 */
export type TourPath = "engineering" | "layer" | "discover";

/** Which planner script a student gets: the blank canvas is the
 *  "Still figuring it out" door; any non-Engineering major is a layer major. */
export function tourPathFor(
  selectedProgramId: string | null,
  program: Parameters<typeof programFamily>[0]
): TourPath {
  if (selectedProgramId === "blank") return "discover";
  return programFamily(program) === "engineering" ? "engineering" : "layer";
}

/** The three tours: the planner's, plus a short one on each of the other pages. */
export type TourId = "planner" | "requirements" | "classes";

/** `prefs.tours[id]`: OWED once first run finishes, SEEN once finished or
 *  skipped. Missing = a student from before the tours shipped: never started
 *  automatically, so a deploy never puts an active student through a tour. */
export const TOUR_OWED = 0;
export const TOUR_SEEN = 1;
export const TOUR_IDS: TourId[] = ["planner", "requirements", "classes"];

/** When the tour may start: its page has painted what the first step points at. */
export const TOUR_READY: Record<TourId, string> = {
  planner: "[data-column]",
  requirements: "[data-requirement]",
  classes: '[data-tour="class-row"]',
};

/** What "the page has stopped filling in" counts, per tour. */
export const TOUR_SETTLE: Record<TourId, string> = {
  planner: "[data-placement]",
  requirements: "[data-requirement]",
  classes: '[data-tour="class-row"]',
};

export interface TourStep {
  id: string;
  /** CSS selectors to spotlight (their union). null = centered, no spotlight.
   *  A step whose targets are all missing is skipped. */
  target: string[] | null;
  title: string;
  body: ReactNode;
  /** Used when nothing in `target` is on screen. */
  fallback?: string[];
  /** Runs when the step opens (e.g. open the drawer). */
  enter?: () => void;
  /** The target only exists once `enter` has run (it's inside the top-bar
   *  menu on a narrow screen), so the step is never dropped up front. */
  revealedByEnter?: boolean;
}

const closeMenu = () => useTopBarStore.getState().setMenuOpen(false);
const openCatalog = () => {
  closeMenu();
  usePlannerStore.getState().openPanel("catalog");
};
const openMajors = () => {
  closeMenu();
  usePlannerStore.getState().openPanel("majors");
};
/** Every other step starts from a clear page: no drawer, no top-bar menu. */
const closeDrawer = () => {
  closeMenu();
  usePlannerStore.getState().setPanelOpen(false);
};
/** Share and Sign in sit in the top bar on a wide screen; on a narrow one
 *  they're behind the menu button, so open it for the student (spec 033 D8). */
const showSaveControls = () => {
  usePlannerStore.getState().setPanelOpen(false);
  const bar = useTopBarStore.getState();
  bar.setMenuOpen(bar.tier === "menu");
};

const T = {
  column: "[data-column]",
  card: "[data-placement]",
  nearCard: '[data-placement][data-near="true"]',
  stillNeeded: "[data-rail-still-needed]",
  drawer: '[data-tour="drawer"]',
  addClass: '[data-tour="add-class"]',
  nav: '[data-tour="nav"]',
  plans: '[data-tour="plans"]',
  share: '[data-tour="share"]',
  account: '[data-tour="account"]',
  openRequirement: "[data-requirement]:has([data-find-class])",
  requirement: "[data-requirement]",
  tryStrip: "[data-try-strip]",
  classFilters: '[data-tour="class-filters"]',
  classRow: '[data-tour="class-row"]',
};

const cardStep: TourStep = {
  id: "card",
  target: [T.card],
  title: "Reading a course card",
  enter: closeDrawer,
  body: (
    <>
      <p>Drag a card to move it to another semester. Along the bottom:</p>
      <ul>
        <li>
          <b>PRE 1/1 ✓</b> means its prerequisites come earlier on your board.
        </li>
        <li>
          <b>→38</b> is how many later courses it unlocks.
        </li>
        <li>
          <b>FA SP</b> are the terms it's usually offered.
        </li>
      </ul>
      <p>Click any card for its details and what it counts toward.</p>
    </>
  ),
};

const professorStep: TourStep = {
  id: "professor",
  target: [T.nearCard],
  title: "Who's teaching it",
  enter: closeDrawer,
  body: (
    <p>
      Classes on next semester's roster name the professor teaching them. Click the card to see
      their rating, or open Rate My Professors to read every review.
    </p>
  ),
};

const stillNeededStep = (first: boolean): TourStep => ({
  id: "still-needed",
  target: [T.stillNeeded],
  title: first ? "Start with what your major needs" : "What's still needed",
  enter: closeDrawer,
  body: (
    <p>
      Every requirement for your major, with a bar that fills as classes land on your board. Click
      one to find classes that count toward it.
    </p>
  ),
});

const catalogStep = (withProfessor: boolean): TourStep => ({
  id: "catalog",
  target: [T.drawer],
  title: "Find any Cornell class",
  enter: openCatalog,
  body: (
    <>
      <p>Search the full catalog here, then drag a class onto any semester.</p>
      {withProfessor && (
        <p>
          Once a class is on your board, click it to see who teaches it next semester and their
          rating, with a link to all of their Rate My Professors reviews.
        </p>
      )}
    </>
  ),
});

const addClassStep: TourStep = {
  id: "add-class",
  target: [T.addClass],
  title: "Or add right where you want it",
  enter: closeDrawer,
  body: <p>Add a class opens the search for that semester, so the class lands right there.</p>,
};

const navStep: TourStep = {
  id: "nav",
  target: [T.nav],
  title: "Two more views",
  enter: closeDrawer,
  body: (
    <p>
      <b>Classes</b> shows what's offered next semester, with times and professors.{" "}
      <b>Requirements</b> is the full checklist for your major.
    </p>
  ),
};

const plansStep: TourStep = {
  id: "plans",
  target: [T.plans],
  title: "Your saved plans",
  enter: closeDrawer,
  body: (
    <p>
      This is the plan you're working on. Click its name to rename it. The arrow lists all of
      your saved plans, so you can switch between them or start a new draft to try a different
      path.
    </p>
  ),
};

const saveStep: TourStep = {
  id: "save",
  target: [T.share, T.account],
  title: "It saves as you go",
  enter: showSaveControls,
  revealedByEnter: true,
  body: (
    <p>
      Every change saves automatically. Sign in with Google to keep your plan on any device, or
      share a read-only link with an advisor or a friend.
    </p>
  ),
};

export function plannerSteps(path: TourPath, collegeName: string | null): TourStep[] {
  if (path === "engineering") {
    return [
      {
        id: "welcome",
        target: [T.column],
        title: "Welcome to your roadmap",
        enter: closeDrawer,
        body: (
          <p>
            Each column is a semester. Your major's standard plan is already laid out, one card
            per course. Move things around to make it yours.
          </p>
        ),
      },
      cardStep,
      professorStep,
      stillNeededStep(false),
      catalogStep(false),
      navStep,
      plansStep,
      saveStep,
    ];
  }
  if (path === "layer") {
    return [
      {
        id: "welcome",
        target: [T.column],
        title: "Welcome to your roadmap",
        enter: closeDrawer,
        body: (
          <p>
            Each column is a semester. {collegeName ?? "Your college"} doesn't set a
            semester-by-semester plan, so your board starts empty and you build it.
          </p>
        ),
      },
      stillNeededStep(true),
      catalogStep(true),
      addClassStep,
      navStep,
      plansStep,
      saveStep,
    ];
  }
  return [
    {
      id: "welcome",
      target: [T.column],
      title: "Welcome to your roadmap",
      enter: closeDrawer,
      body: (
        <p>
          Each column is a semester. Your board starts empty: add classes you're curious about and
          see where they lead.
        </p>
      ),
    },
    {
      id: "majors",
      target: [T.drawer],
      title: "Majors your classes point to",
      enter: openMajors,
      body: (
        <p>
          As you add classes, this ranks the majors they count toward, and it updates with every
          class you add.
        </p>
      ),
    },
    catalogStep(true),
    addClassStep,
    navStep,
    plansStep,
    saveStep,
  ];
}

export function requirementsSteps(): TourStep[] {
  return [
    {
      id: "row",
      target: [T.openRequirement],
      fallback: [T.requirement],
      title: "Every requirement, one row each",
      body: (
        <ul>
          <li>
            <b>Find a class</b> lists classes that count toward it.
          </li>
          <li>
            <b>Waive</b> marks it done if your advisor excused it.
          </li>
          <li>
            <b>Looks wrong?</b> tells us when a rule doesn't match Cornell's.
          </li>
        </ul>
      ),
    },
    {
      id: "try",
      target: [T.tryStrip],
      title: "Try a class before you commit",
      body: (
        <p>
          Try shows, in blue, what a class would fill without putting it on your board. Like it?
          Place it on your board. Tried classes stay listed so the planner can remind you.
        </p>
      ),
    },
  ];
}

export function classesSteps(): TourStep[] {
  return [
    {
      id: "filters",
      target: [T.classFilters],
      title: "Narrow it down",
      body: (
        <p>
          Filter by subject, by the requirements a class fills for your major, by when it meets, or
          by how well its professor is rated.
        </p>
      ),
    },
    {
      id: "row",
      target: [T.classRow],
      title: "One class per row",
      body: (
        <p>
          Each row shows who teaches it next semester and their rating, plus its time and terms.
          Click a row for details and to add it to your plan. <b>★</b> saves it to your favorites,
          and the pin adds it to a side-by-side compare.
        </p>
      ),
    },
  ];
}
