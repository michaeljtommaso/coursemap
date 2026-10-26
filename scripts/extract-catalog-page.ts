// scripts/extract-catalog-page.ts
// Reads a saved catalog page (snapshot/page.html) and writes extract.json: the
// page's course lists, rule sentences and headings in a numbered, structured
// form (spec 019 Phase 5). Authors point at a list ("L3") instead of retyping
// its courses; expand-draft.ts turns those references into course ids, and
// check-draft.ts accepts a referenced list as the citation for its courses.
//
//   npx tsx extract-catalog-page.ts --program <programId> [--dir <provenanceDir>] [--all] [--json]
//
// The catalog (CourseLeaf) renders every program from one template: course
// lists are <table class="sc_courselist"> whose rows are a course (codecol), an
// "or" alternative (orclass), a section header (areaheader) or a comment line
// (courselistcomment). Every block's `text` is exactly what page.txt shows for
// it (the snapshot's own renderer), and the tool refuses to write when:
//   - a block's text is not on page.txt (the two renderings disagree),
//   - a course code linked anywhere in the scanned section is in no block,
//   - page.html no longer matches the snapshot's hash.
// Without --all only the program's own section is scanned: everything before
// the university-wide requirements that every program page repeats. College
// layers pass --all.
//
// Page-only courses (pageOnlyCourses): a course the page lists in a list row or links
// (linkedCourseIds) that the catalog dump lacks. Course-looking text in unlinked
// prose ("CALS 2025" in a sentence) is NOT a course and is never accepted.
//
// Exit: 0 written, 1 refused (nothing written), 2 bad usage or unreadable input.
// Pure functions are exercised offline by extract-catalog-page.corpus.ts.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { PROVENANCE_FILES, normalizeCourseId, normalizeQuoteText, provenanceDir, type SnapshotMeta } from "./layer-authoring";
import {
  findAll,
  inlineText,
  isDropped,
  parseHtml,
  selectContent,
  sha256,
  toLf,
  type HtmlElement,
  type HtmlNode,
} from "./snapshot-catalog-page";

// ─── Shapes ─────────────────────────────────────────────────────────────────

export type RowKind = "course" | "or" | "header" | "comment";

export type ListRow = {
  /** The row exactly as page.txt shows it (cells joined by " | "). */
  line: string;
  kind: RowKind;
  /** Course ids on the row, "SUBJ-NNNN" (two for a "&" pair). */
  courseIds: string[];
  /** Two or more courses joined by "&": taken together, not alternatives. */
  paired: boolean;
  /** Indented under the row above (an option inside a choice). */
  indented: boolean;
  /** The credit cell as printed ("3", "3-4", "9-12"), "" when blank. */
  credits: string;
};

/** One run of course rows in a table, with the header/comment lines just above it. */
export type CourseList = {
  id: string;
  /** Heading path above the table (container id first). */
  path: string[];
  /** Header and comment rows directly above these course rows, in order. */
  lead: ListRow[];
  rows: ListRow[];
  /** Every course id in the run, unique, page order. */
  courseIds: string[];
};

export type Block = {
  /** "H3", "P12", "T4" (table row). */
  id: string;
  kind: "heading" | "prose" | "row";
  level?: number;
  path: string[];
  text: string;
  courseIds: string[];
  /** For table rows: the list it belongs to (course/or rows) or leads (header/comment rows). */
  list?: string;
  rowKind?: RowKind;
};

export type PageExtract = {
  schemaVersion: 1;
  programId: string;
  textSha256: string;
  htmlSha256: string;
  /** false: only the program's own section (default); true: the whole page. */
  all: boolean;
  blocks: Block[];
  lists: CourseList[];
  /** Headings that name a concentration, track or option inside the program. */
  concentrationHeadings: string[];
  /** Every course code linked in the scanned section. */
  linkedCourseIds: string[];
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const CODE_RE = /\b([A-Z]{2,6})[\s ]+(\d{4}[A-Z]?)\b/g;

function cls(el: HtmlElement): string[] {
  return (el.attrs.class ?? "").split(/\s+/).filter(Boolean);
}

function codesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CODE_RE)) out.push(normalizeCourseId(`${m[1]} ${m[2]}`));
  return [...new Set(out)];
}

function headingLevel(el: HtmlElement): number | null {
  if (cls(el).includes("page-title")) return 1;
  const m = /^h([1-6])$/.exec(el.tag);
  return m ? Number(m[1]) : null;
}

/** The headings where every program page's shared university/college text starts. */
export const SHARED_SECTION_RE = /^(University Graduation Requirements|Requirements for All Students)$/;
/** Headings that name a concentration, track or focused-elective option. */
export const CONCENTRATION_RE = /\b(concentrations?|tracks?|focused electives?)\b/i;
/** Headings that are about outcomes, not requirements (never concentrations). */
const OUTCOMES_RE = /learning outcomes|goals of/i;

/** Linked course codes in a subtree (CourseLeaf links each code: a.bubblelink.code). */
export function linkedCodes(node: HtmlElement): string[] {
  const out: string[] = [];
  for (const a of findAll(node, (el) => el.tag === "a" && cls(el).includes("code"), false)) {
    if (isDropped(a)) continue;
    out.push(...codesIn(inlineText(a)));
  }
  return [...new Set(out)];
}

function rowKind(tr: HtmlElement): RowKind | null {
  const c = cls(tr);
  const has = (name: string) => c.includes(name) || findAll(tr, (el) => cls(el).includes(name)).length > 0;
  if (has("areaheader")) return "header";
  if (has("courselistcomment")) return "comment";
  if (has("orclass")) return "or";
  if (has("codecol")) return "course";
  return null;
}

/** Does the code cell START indented (CourseLeaf wraps an option's code in a
 *  .blockindent block)? A "&" pair's second code is indented too, but its first
 *  is not, so a pair is not an option row. */
function leadsWithIndent(code: HtmlElement): boolean {
  for (const c of code.children) {
    if (typeof c === "string") {
      if (c.trim()) return false;
      continue;
    }
    if (isDropped(c)) continue;
    if (cls(c).includes("blockindent")) return true;
    return c.tag === "br" ? false : leadsWithIndent(c);
  }
  return false;
}

function cellsOf(tr: HtmlElement): HtmlElement[] {
  return tr.children.filter((c): c is HtmlElement => typeof c !== "string" && (c.tag === "td" || c.tag === "th") && !isDropped(c));
}

// ─── Extraction ─────────────────────────────────────────────────────────────

/** The structured extract of a page (pure). Throws nothing; consistency with
 *  page.txt is checked separately by `checkExtract`. */
export function extractPage(html: string, opts: { programId: string; textSha256: string; all?: boolean }): PageExtract {
  const doc = parseHtml(html);
  const blocks: Block[] = [];
  const lists: CourseList[] = [];
  const concentrationHeadings: string[] = [];
  const linked: string[] = [];
  const counters = { H: 0, P: 0, T: 0, L: 0 };
  let stopped = false;
  let path: { level: number; text: string }[] = [];
  let container = "";

  const pathNow = () => [container, ...path.map((p) => p.text)].filter(Boolean);

  const prose = (el: HtmlNode) => {
    const text = inlineText(el);
    if (!text) return;
    blocks.push({ id: `P${++counters.P}`, kind: "prose", path: pathNow(), text, courseIds: codesIn(text) });
  };

  const table = (t: HtmlElement) => {
    const isCourseList = cls(t).includes("sc_courselist");
    const rows = findAll(t, (el) => el.tag === "tr" || el.tag === "table" || isDropped(el)).filter((el) => el.tag === "tr" && !isDropped(el));
    let lead: ListRow[] = [];
    let cur: CourseList | null = null;
    for (const tr of rows) {
      if (tr.children.some((c) => typeof c !== "string" && c.tag === "th")) continue;
      const cells = cellsOf(tr);
      const texts = cells.map((c) => inlineText(c)).filter(Boolean);
      if (!texts.length) continue;
      const line = texts.join(" | ");
      linked.push(...linkedCodes(tr));
      if (!isCourseList) {
        blocks.push({ id: `T${++counters.T}`, kind: "row", path: pathNow(), text: line, courseIds: codesIn(line) });
        continue;
      }
      const kind = rowKind(tr) ?? "comment";
      const code = cells.find((c) => cls(c).includes("codecol"));
      const codeText = code ? inlineText(code) : "";
      const hours = cells.find((c) => cls(c).includes("hourscol"));
      const row: ListRow = {
        line,
        kind,
        courseIds: kind === "course" || kind === "or" ? codesIn(codeText || line) : codesIn(line),
        paired: /&/.test(codeText),
        indented: code ? leadsWithIndent(code) : false,
        credits: hours ? inlineText(hours) : "",
      };
      if (kind === "header" || kind === "comment") {
        if (cur) cur = null;
        lead.push(row);
        blocks.push({ id: `T${++counters.T}`, kind: "row", path: pathNow(), text: line, courseIds: row.courseIds, rowKind: kind });
        continue;
      }
      // An indented course row is an option under the chooser line above it; a
      // course row at the other indentation is a different requirement, so the
      // run ends there ("or" rows always belong to the course above them).
      if (cur && kind === "course") {
        const lastCourse = [...cur.rows].reverse().find((x) => x.kind === "course");
        if (lastCourse && lastCourse.indented !== row.indented) cur = null;
      }
      if (!cur) {
        cur = { id: `L${++counters.L}`, path: pathNow(), lead, rows: [], courseIds: [] };
        for (const b of blocks.slice(blocks.length - lead.length)) if (b.rowKind) b.list = cur.id;
        lists.push(cur);
        lead = [];
      }
      cur.rows.push(row);
      for (const id of row.courseIds) if (!cur.courseIds.includes(id)) cur.courseIds.push(id);
      blocks.push({ id: `T${++counters.T}`, kind: "row", path: pathNow(), text: line, courseIds: row.courseIds, list: cur.id, rowKind: kind });
    }
  };

  const walk = (n: HtmlNode) => {
    if (stopped || typeof n === "string") return;
    if (isDropped(n)) return;
    const level = headingLevel(n);
    if (level != null) {
      const text = inlineText(n);
      if (!text) return;
      if (!opts.all && SHARED_SECTION_RE.test(text)) {
        stopped = true;
        return;
      }
      path = path.filter((p) => p.level < level);
      path.push({ level, text });
      blocks.push({ id: `H${++counters.H}`, kind: "heading", level, path: pathNow(), text, courseIds: codesIn(text) });
      linked.push(...linkedCodes(n));
      if (CONCENTRATION_RE.test(text) && !OUTCOMES_RE.test(text)) concentrationHeadings.push(text);
      return;
    }
    if (n.tag === "table") {
      table(n);
      return;
    }
    if (n.tag === "p" || n.tag === "li" || n.tag === "dt" || n.tag === "dd" || n.tag === "caption") {
      // A list item holding a nested list: its own words first, then the children.
      const nested = n.children.some((c) => typeof c !== "string" && ["ul", "ol", "table", "p", "div"].includes(c.tag));
      if (!nested) {
        prose(n);
        linked.push(...linkedCodes(n));
        return;
      }
      const own: HtmlNode[] = [];
      for (const c of n.children) {
        if (typeof c !== "string" && ["ul", "ol", "table", "p", "div"].includes(c.tag)) {
          if (own.length) prose({ tag: "span", attrs: {}, children: own.splice(0) });
          walk(c);
        } else own.push(c);
      }
      if (own.length) prose({ tag: "span", attrs: {}, children: own });
      linked.push(...linkedCodes(n));
      return;
    }
    // A block with loose text of its own (e.g. a <div> of words) is prose too.
    const loose = n.children.some((c) => typeof c === "string" && c.trim());
    if (loose && n.tag === "div") {
      const own: HtmlNode[] = [];
      for (const c of n.children) {
        if (typeof c !== "string" && (headingLevel(c) != null || ["table", "ul", "ol", "p", "div", "dl"].includes(c.tag))) {
          if (own.length) prose({ tag: "span", attrs: {}, children: own.splice(0) });
          walk(c);
        } else own.push(c);
      }
      if (own.length) prose({ tag: "span", attrs: {}, children: own });
      for (const c of n.children) if (typeof c !== "string" && c.tag === "a") linked.push(...linkedCodes({ tag: "div", attrs: {}, children: [c] }));
      return;
    }
    for (const c of n.children) walk(c);
  };

  for (const node of selectContent(doc)) {
    if (stopped) break;
    container = /textcontainer$/i.test(node.attrs.id ?? "") ? node.attrs.id : "";
    path = [];
    walk(node);
  }

  return {
    schemaVersion: 1,
    programId: opts.programId,
    textSha256: opts.textSha256,
    htmlSha256: sha256(toLf(html)),
    all: !!opts.all,
    blocks,
    lists,
    concentrationHeadings: [...new Set(concentrationHeadings)],
    linkedCourseIds: [...new Set(linked)],
  };
}

export type ExtractProblem = { code: "not-on-page" | "unaccounted-code" | "empty"; message: string };

/** Every block's words are on page.txt, and every linked course code is in some block. */
export function checkExtract(ex: PageExtract, pageText: string): ExtractProblem[] {
  const problems: ExtractProblem[] = [];
  const page = normalizeQuoteText(pageText);
  for (const b of ex.blocks) {
    if (!page.includes(normalizeQuoteText(b.text))) problems.push({ code: "not-on-page", message: `${b.id} is not on page.txt: ${b.text.slice(0, 80)}` });
  }
  const seen = new Set(ex.blocks.flatMap((b) => b.courseIds));
  for (const id of ex.linkedCourseIds) {
    if (!seen.has(id)) problems.push({ code: "unaccounted-code", message: `${id} is linked on the page but in no extracted block` });
  }
  if (!ex.blocks.length) problems.push({ code: "empty", message: "nothing extracted" });
  return problems;
}

/** A course the page lists (in a list row) or links (linkedCourseIds) that the offline catalog dump lacks (not offered on
 *  the rosters the dump holds). Authoring keeps such courses in rules, as the
 *  page lists them: dropping them would make a student who took one see a
 *  requirement as unmet. Shaped like a dump course so the catalog checks can
 *  count it; credits come from its list row when the page prints them. */
export type PageOnlyCourse = { id: string; subject: string; number: string; title: string; creditsMin?: number; creditsMax?: number };

export function pageOnlyCourses(ex: Pick<PageExtract, "lists" | "blocks"> & { linkedCourseIds?: string[] }, catalogIds: Set<string>): PageOnlyCourse[] {
  const out = new Map<string, PageOnlyCourse>();
  const add = (id: string, credits: string) => {
    if (catalogIds.has(id) || out.has(id)) return;
    const dash = id.indexOf("-");
    const m = /^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?$/.exec(credits.trim());
    out.set(id, {
      id,
      subject: id.slice(0, dash),
      number: id.slice(dash + 1),
      title: "(listed on the catalog page; not in the catalog dump)",
      ...(m ? { creditsMin: Number(m[1]), creditsMax: Number(m[2] ?? m[1]) } : {}),
    });
  };
  for (const l of ex.lists) for (const r of l.rows) for (const id of r.courseIds) add(id, r.paired ? "" : r.credits);
  // Prose codes (a course-looking token in a sentence) are not courses: only the page's real course links count.
  const linked = new Set(ex.linkedCourseIds ?? []);
  for (const b of ex.blocks) for (const id of b.courseIds) if (linked.has(id)) add(id, "");
  return [...out.values()];
}

/** A list id → its course ids, or throws on an unknown id. */
export function listCourses(ex: Pick<PageExtract, "lists">, listId: string): string[] {
  const l = ex.lists.find((x) => x.id === listId);
  if (!l) throw new Error(`unknown list ${listId}`);
  return l.courseIds;
}

/** The extract file next to a snapshot, re-derived from page.html and compared:
 *  a hand-edited extract.json is refused. */
export function loadVerifiedExtract(dir: string): PageExtract {
  const path = join(dir, PROVENANCE_FILES.extract);
  if (!existsSync(path)) throw new Error(`no ${PROVENANCE_FILES.extract} in ${dir}: run extract-catalog-page.ts first`);
  const saved = JSON.parse(readFileSync(path, "utf-8")) as PageExtract;
  const html = readFileSync(join(dir, PROVENANCE_FILES.pageHtml), "utf-8");
  const meta = JSON.parse(readFileSync(join(dir, PROVENANCE_FILES.meta), "utf-8")) as SnapshotMeta;
  const fresh = extractPage(html, { programId: saved.programId, textSha256: meta.textSha256, all: saved.all });
  if (JSON.stringify(fresh) !== JSON.stringify(saved)) throw new Error(`${PROVENANCE_FILES.extract} does not match page.html: re-run extract-catalog-page.ts`);
  return saved;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const USAGE = "usage: npx tsx extract-catalog-page.ts --program <programId> [--dir <provenanceDir>] [--all] [--json]";

export function runExtract(argv: string[]): number {
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const program = flag("--program");
  if (!program) {
    console.error(USAGE);
    return 2;
  }
  let dir: string;
  try {
    dir = flag("--dir") ? resolve(flag("--dir")!) : provenanceDir(program);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const htmlPath = join(dir, PROVENANCE_FILES.pageHtml);
  const textPath = join(dir, PROVENANCE_FILES.pageText);
  const metaPath = join(dir, PROVENANCE_FILES.meta);
  if (![htmlPath, textPath, metaPath].every(existsSync)) {
    console.error(`no snapshot in ${dir}: run snapshot-catalog-page.ts first`);
    return 2;
  }
  const html = readFileSync(htmlPath, "utf-8");
  const pageText = readFileSync(textPath, "utf-8");
  const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as SnapshotMeta;
  if (sha256(toLf(html)) !== meta.htmlSha256) {
    console.error("REFUSED: page.html does not match snapshot/meta.json (nothing written)");
    return 1;
  }
  const ex = extractPage(html, { programId: program, textSha256: meta.textSha256, all: argv.includes("--all") });
  const problems = checkExtract(ex, pageText);
  if (problems.length) {
    console.error(`REFUSED: ${problems.length} problem(s) (nothing written)`);
    for (const p of problems.slice(0, 40)) console.error(`  ${p.code}: ${p.message}`);
    return 1;
  }
  writeFileSync(join(dir, PROVENANCE_FILES.extract), `${JSON.stringify(ex, null, 2)}\n`);
  const courses = ex.lists.reduce((n, l) => n + l.courseIds.length, 0);
  const summary = {
    blocks: ex.blocks.length,
    lists: ex.lists.length,
    listCourses: courses,
    prose: ex.blocks.filter((b) => b.kind === "prose").length,
    concentrationHeadings: ex.concentrationHeadings,
  };
  if (argv.includes("--json")) console.log(JSON.stringify(summary));
  else
    console.log(
      `WROTE ${PROVENANCE_FILES.extract}: ${summary.lists} lists (${courses} course entries), ${summary.prose} prose blocks, ${summary.blocks} blocks` +
        (summary.concentrationHeadings.length ? `; concentration headings: ${summary.concentrationHeadings.join(" · ")}` : "")
    );
  return 0;
}

if (require.main === module) process.exit(runExtract(process.argv.slice(2)));
