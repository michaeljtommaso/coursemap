// scripts/snapshot-catalog-page.ts
// Saves one catalog page as the frozen source a major is authored from (spec 019
// Phase 4, D4/D12). Authors read and quote snapshot/page.txt; check-draft.ts
// proves every quote is on it, word for word.
//
//   npx tsx snapshot-catalog-page.ts --program <programId> --url <https url>
//                                    [--out <dir>] [--via auto|direct|jina] [--force]
//
// Writes <out>/snapshot/page.html, page.txt and meta.json (SnapshotMeta), LF line
// endings. <out> defaults to provenanceDir(programId). A snapshot that already
// exists is replaced only when the new page text is the same; if the text has
// changed it is refused (drafts quote the old text) unless --force is given.
//
// Fetching uses FREE tiers only, never a paid fetcher:
//   direct  a plain GET with a normal browser User-Agent (30 s timeout)
//   jina    the free Jina reader in html mode, r.jina.ai/<url> (60 s timeout)
//   auto    direct first; on a bot challenge (or a network failure) fall back to
//           jina. The catalog's firewall answers a plain request with HTTP 202 and
//           an empty body; the reader returns the rendered page.
//
// page.txt is a faithful plain-text rendering of the page's requirement content:
// headings prefixed "#" by level, paragraphs as lines, list items as "- ", one
// line per table row with cells joined by " | ", entities decoded. It never
// rewords anything. The converter is a small tag-aware parser below (no deps).
//
// Exit: 0 written, 1 fetch or extraction failure or a changed snapshot without
// --force (nothing written), 2 bad usage.
// Pure functions are exercised offline by snapshot-catalog-page.corpus.ts.

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { PROVENANCE_FILES, provenanceDir, type SnapshotMeta } from "./layer-authoring";

// ─── Challenge detection ────────────────────────────────────────────────────

/** Below this many characters a "page" is a challenge stub or an error, not a catalog page. */
export const MIN_PAGE_CHARS = 2000;
/** Refuse to write a snapshot whose extracted text is shorter than this. */
export const MIN_TEXT_CHARS = 200;

const CHALLENGE_STATUSES = new Set([202, 403, 429, 503]);
const CHALLENGE_MARKERS = /awswaf|aws-waf|gokuProps|challenge\.js|challenge-platform|captcha|cf-chl|just a moment\.\.\./i;

/** Does this response look like a bot challenge rather than the page? */
export function isChallengeResponse(status: number, body: string): boolean {
  if (CHALLENGE_STATUSES.has(status)) return true;
  if (body.trim().length < MIN_PAGE_CHARS) return true;
  return CHALLENGE_MARKERS.test(body);
}

// ─── Entities ───────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", minus: "−", hyphen: "‐",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", prime: "′", Prime: "″",
  hellip: "…", bull: "•", middot: "·", sect: "§", para: "¶", dagger: "†", Dagger: "‡",
  copy: "©", reg: "®", trade: "™", deg: "°", plusmn: "±", times: "×", divide: "÷",
  frac12: "½", frac14: "¼", frac34: "¾", sup1: "¹", sup2: "²", sup3: "³",
  le: "≤", ge: "≥", ne: "≠", rarr: "→", larr: "←", harr: "↔",
  shy: "­", zwj: "‍", zwnj: "‌", ensp: " ", emsp: " ", thinsp: " ",
  cent: "¢", pound: "£", euro: "€", yen: "¥", iexcl: "¡", iquest: "¿",
  aacute: "á", agrave: "à", acirc: "â", auml: "ä", atilde: "ã", aring: "å",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  iacute: "í", igrave: "ì", icirc: "î", iuml: "ï",
  oacute: "ó", ograve: "ò", ocirc: "ô", ouml: "ö", otilde: "õ", oslash: "ø",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü",
  ntilde: "ñ", ccedil: "ç", szlig: "ß", yacute: "ý", yuml: "ÿ",
  Aacute: "Á", Agrave: "À", Acirc: "Â", Auml: "Ä", Atilde: "Ã", Aring: "Å",
  Eacute: "É", Egrave: "È", Ecirc: "Ê", Euml: "Ë",
  Iacute: "Í", Oacute: "Ó", Ouml: "Ö", Uacute: "Ú", Uuml: "Ü", Ntilde: "Ñ", Ccedil: "Ç",
};

/** Decodes named (common set), decimal and hex character references. Unknown names stay as written. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ref] ?? whole;
  });
}

// ─── A small HTML tree parser ───────────────────────────────────────────────

export type HtmlElement = { tag: string; attrs: Record<string, string>; children: HtmlNode[] };
export type HtmlNode = HtmlElement | string;

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title", "xmp", "noscript", "template", "iframe"]);
/** Opening one of these closes an open <p> (HTML's implied end tags). */
const CLOSES_P = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "fieldset", "figcaption", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "menu", "nav", "ol", "p", "pre",
  "section", "table", "ul",
]);
const P_SCOPE_BOUNDARY = new Set(["div", "li", "td", "th", "table", "body", "main", "section", "article", "dd", "dt", "blockquote", "button"]);

/** Parses HTML into a tree under a synthetic "#root" element. Tolerant, not
 *  spec-complete: enough for server-rendered catalog pages. */
export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { tag: "#root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const top = () => stack[stack.length - 1];

  /** Pops up to and including the nearest open `tags` element above the nearest `boundary`. */
  const closeImplied = (tags: Set<string>, boundary: Set<string>) => {
    for (let i = stack.length - 1; i > 0; i--) {
      const t = stack[i].tag;
      if (tags.has(t)) {
        stack.length = i;
        return;
      }
      if (boundary.has(t)) return;
    }
  };

  const open = (tag: string, attrs: Record<string, string>, selfClosing: boolean): HtmlElement => {
    if (CLOSES_P.has(tag)) closeImplied(new Set(["p"]), P_SCOPE_BOUNDARY);
    if (tag === "li") closeImplied(new Set(["li"]), new Set(["ul", "ol", "menu"]));
    if (tag === "dt" || tag === "dd") closeImplied(new Set(["dt", "dd"]), new Set(["dl"]));
    if (tag === "tr") closeImplied(new Set(["tr"]), new Set(["table", "thead", "tbody", "tfoot"]));
    if (tag === "td" || tag === "th") closeImplied(new Set(["td", "th"]), new Set(["tr", "table"]));
    if (tag === "thead" || tag === "tbody" || tag === "tfoot") closeImplied(new Set(["thead", "tbody", "tfoot"]), new Set(["table"]));
    if (tag === "option") closeImplied(new Set(["option"]), new Set(["select", "datalist"]));
    const el: HtmlElement = { tag, attrs, children: [] };
    top().children.push(el);
    if (!VOID_TAGS.has(tag) && !selfClosing) stack.push(el);
    return el;
  };

  const close = (tag: string) => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i].tag === tag) {
        stack.length = i;
        return;
      }
    }
  };

  const text = (s: string) => {
    if (!s) return;
    const kids = top().children;
    const decoded = decodeEntities(s);
    if (typeof kids[kids.length - 1] === "string") kids[kids.length - 1] += decoded;
    else kids.push(decoded);
  };

  const attrRe = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      text(html.slice(i));
      break;
    }
    if (lt > i) text(html.slice(i, lt));
    i = lt;
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const end = html.indexOf(">", i + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (html[i + 1] === "/") {
      const m = /^<\/([A-Za-z][A-Za-z0-9:-]*)[^>]*>?/.exec(html.slice(i, i + 200));
      if (!m) {
        text("<");
        i++;
        continue;
      }
      close(m[1].toLowerCase());
      i += m[0].length;
      continue;
    }
    const nameMatch = /^<([A-Za-z][A-Za-z0-9:-]*)/.exec(html.slice(i, i + 100));
    if (!nameMatch) {
      text("<");
      i++;
      continue;
    }
    const tag = nameMatch[1].toLowerCase();
    let j = i + nameMatch[0].length;
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    while (j < n) {
      while (j < n && /[\s\/]/.test(html[j])) {
        if (html[j] === "/" && html[j + 1] === ">") selfClosing = true;
        j++;
      }
      if (j >= n || html[j] === ">") break;
      attrRe.lastIndex = j;
      const am = attrRe.exec(html);
      if (!am || am[0].length === 0) {
        j++;
        continue;
      }
      const name = am[1].toLowerCase();
      if (!(name in attrs)) attrs[name] = decodeEntities(am[2] ?? am[3] ?? am[4] ?? "");
      j = attrRe.lastIndex;
    }
    i = j < n ? j + 1 : n;
    const el = open(tag, attrs, selfClosing);
    if (RAW_TEXT_TAGS.has(tag) && !selfClosing) {
      const endRe = new RegExp(`</${tag}\\s*>`, "ig");
      endRe.lastIndex = i;
      const em = endRe.exec(html);
      const rawEnd = em ? em.index : n;
      if (rawEnd > i) el.children.push(tag === "title" || tag === "textarea" ? decodeEntities(html.slice(i, rawEnd)) : html.slice(i, rawEnd));
      i = em ? em.index + em[0].length : n;
      stack.pop();
    }
  }
  return root;
}

function classes(el: HtmlElement): string[] {
  return (el.attrs.class ?? "").split(/\s+/).filter(Boolean);
}

/** Every element under `node` (document order) matching `pred`, not descending into matches. */
export function findAll(node: HtmlElement, pred: (el: HtmlElement) => boolean, descendIntoMatches = false): HtmlElement[] {
  const out: HtmlElement[] = [];
  const walk = (el: HtmlElement) => {
    for (const c of el.children) {
      if (typeof c === "string") continue;
      if (pred(c)) {
        out.push(c);
        if (!descendIntoMatches) continue;
      }
      walk(c);
    }
  };
  walk(node);
  return out;
}

export function findFirst(node: HtmlElement, pred: (el: HtmlElement) => boolean): HtmlElement | null {
  return findAll(node, pred)[0] ?? null;
}

// ─── Content selection ──────────────────────────────────────────────────────

/** Never page content: chrome, scripts, forms, and the program list sidebar. */
const DROP_TAGS = new Set([
  "script", "style", "noscript", "template", "nav", "header", "footer", "aside", "form", "button", "input",
  "select", "textarea", "svg", "iframe", "object", "canvas", "head", "title", "meta", "link",
]);
const HIDDEN_CLASSES = new Set(["hidden", "sr-only", "visually-hidden", "screen-reader-text", "visuallyhidden"]);

export function isDropped(el: HtmlElement): boolean {
  if (DROP_TAGS.has(el.tag)) return true;
  if ("hidden" in el.attrs) return true;
  const cls = classes(el);
  if (cls.some((c) => HIDDEN_CLASSES.has(c))) return true;
  if (/breadcrumb/i.test(el.attrs.id ?? "") || cls.some((c) => /breadcrumb/i.test(c))) return true;
  return false;
}

/** A CourseLeaf tab panel holding page text ("textcontainer", "curriculumtextcontainer", …). */
function isTextContainer(el: HtmlElement): boolean {
  return /textcontainer$/i.test(el.attrs.id ?? "");
}

/** The nodes page.txt is rendered from: the page title plus the text tab panels
 *  when the page has them, else <main> (preferring id="contentarea"), else <body>. */
export function selectContent(doc: HtmlElement): HtmlElement[] {
  const main =
    findFirst(doc, (el) => el.attrs.id === "contentarea") ?? findFirst(doc, (el) => el.tag === "main") ?? findFirst(doc, (el) => el.tag === "body") ?? doc;
  const containers = findAll(main, (el) => isTextContainer(el) && !isDropped(el));
  if (!containers.length) return [main];
  const title = findFirst(main, (el) => classes(el).includes("page-title") || el.tag === "h1");
  const inContainer = title != null && containers.some((c) => findAll(c, (el) => el === title).length > 0);
  return title && !inContainer ? [title, ...containers] : containers;
}

// ─── Text rendering ─────────────────────────────────────────────────────────

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "caption", "dd", "details", "dialog", "div", "dl", "dt", "fieldset",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav",
  "ol", "p", "pre", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul", "menu",
  "#root", "body", "html", "center",
]);
/** Blocks set off by a blank line (when not inside a list). */
const SPACED_TAGS = new Set(["p", "table", "ul", "ol", "dl", "blockquote", "pre", "figure"]);

/** HTML whitespace (and no-break spaces) to single spaces. */
function collapse(s: string): string {
  return s.replace(/[\s ]+/g, " ");
}

/** The words inside an element on one line: blocks and <br> become spaces. */
export function inlineText(node: HtmlNode): string {
  const parts: string[] = [];
  const walk = (n: HtmlNode) => {
    if (typeof n === "string") {
      parts.push(n);
      return;
    }
    if (isDropped(n)) return;
    if (n.tag === "br") {
      parts.push(" ");
      return;
    }
    const block = BLOCK_TAGS.has(n.tag);
    if (block) parts.push(" ");
    for (const c of n.children) walk(c);
    if (block) parts.push(" ");
  };
  walk(node);
  return collapse(parts.join("")).trim();
}

function headingLevel(el: HtmlElement): number | null {
  if (classes(el).includes("page-title")) return 1;
  const m = /^h([1-6])$/.exec(el.tag);
  return m ? Number(m[1]) : null;
}

/** Renders content nodes as page.txt lines (see the header for the format). */
export function renderText(nodes: HtmlElement[]): string {
  const lines: string[] = [];
  let buf = "";
  let nextPrefix: string | null = null;
  let listDepth = 0;
  /** A <dt> waiting to lead its <dd>'s first line ("1 Note: …"). */
  let lead = "";

  const blank = () => {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  };
  const push = (line: string) => lines.push(line.replace(/\s+$/, ""));
  const flush = () => {
    let t = collapse(buf).trim();
    buf = "";
    if (!t) return;
    if (lead) {
      t = `${lead} ${t}`;
      lead = "";
    }
    push((nextPrefix ?? "  ".repeat(listDepth)) + t);
    nextPrefix = null;
  };
  const flushLead = () => {
    if (!lead) return;
    push("  ".repeat(listDepth) + lead);
    lead = "";
  };

  const walk = (n: HtmlNode) => {
    if (typeof n === "string") {
      buf += n;
      return;
    }
    if (isDropped(n)) return;
    if (n.tag === "br") {
      flush();
      return;
    }
    const level = headingLevel(n);
    if (level != null) {
      flush();
      flushLead();
      const t = inlineText(n);
      if (t) {
        blank();
        push(`${"#".repeat(level)} ${t}`);
        blank();
      }
      return;
    }
    if (n.tag === "table") {
      flush();
      flushLead();
      blank();
      renderTable(n);
      blank();
      return;
    }
    if (n.tag === "li") {
      flush();
      nextPrefix = `${"  ".repeat(Math.max(0, listDepth - 1))}- `;
      for (const c of n.children) walk(c);
      flush();
      nextPrefix = null;
      return;
    }
    if (n.tag === "dt") {
      flush();
      flushLead();
      lead = inlineText(n);
      return;
    }
    if (n.tag === "ul" || n.tag === "ol" || n.tag === "menu") {
      flush();
      if (listDepth === 0) blank();
      listDepth++;
      for (const c of n.children) walk(c);
      flush();
      listDepth--;
      if (listDepth === 0) blank();
      return;
    }
    if (!BLOCK_TAGS.has(n.tag)) {
      for (const c of n.children) walk(c);
      return;
    }
    const spaced = SPACED_TAGS.has(n.tag) && listDepth === 0 && !lead;
    flush();
    if (spaced) blank();
    for (const c of n.children) walk(c);
    flush();
    if (n.tag === "dl") flushLead();
    if (spaced) blank();
  };

  const renderTable = (table: HtmlElement) => {
    const caption = findFirst(table, (el) => el.tag === "caption" && !isDropped(el));
    if (caption) {
      const t = inlineText(caption);
      if (t) push(t);
    }
    const rows = findAll(table, (el) => el.tag === "tr" || el.tag === "table" || isDropped(el)).filter((el) => el.tag === "tr" && !isDropped(el));
    for (const tr of rows) {
      const cells = tr.children
        .filter((c): c is HtmlElement => typeof c !== "string" && (c.tag === "td" || c.tag === "th") && !isDropped(c))
        .map((c) => inlineText(c))
        .filter(Boolean);
      if (cells.length) push(cells.join(" | "));
    }
  };

  for (const node of nodes) {
    walk(node);
    flush();
    flushLead();
    blank();
  }

  const out: string[] = [];
  for (const l of lines) {
    if (l === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.length ? `${out.join("\n")}\n` : "";
}

/** page.txt for a page: its requirement content as faithful plain text. */
export function extractPageText(html: string): string {
  return renderText(selectContent(parseHtml(html)));
}

// ─── Meta ───────────────────────────────────────────────────────────────────

export function parseTitle(html: string): string | null {
  const title = findFirst(parseHtml(html), (el) => el.tag === "title");
  if (!title) return null;
  const t = collapse(title.children.filter((c): c is string => typeof c === "string").join("")).trim();
  return t || null;
}

/** "2026-2027" from the page's "2026-2027 Edition" text (any dash), else null. */
export function parseEdition(html: string): string | null {
  const text = collapse(decodeEntities(html.replace(/<[^>]*>/g, " ")));
  const m = /\b(\d{4})\s*[-‐-―−]\s*(\d{4})\s+Edition\b/i.exec(text);
  return m ? `${m[1]}-${m[2]}` : null;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** CRLF / CR to LF: every snapshot file is written and hashed with LF endings. */
export function toLf(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

export type Snapshot = { html: string; text: string; meta: SnapshotMeta };

export function buildSnapshot(input: {
  programId: string;
  url: string;
  via: "direct" | "jina";
  httpStatus: number;
  html: string;
  fetchedAt: Date;
}): Snapshot {
  const html = toLf(input.html);
  const text = extractPageText(html);
  return {
    html,
    text,
    meta: {
      programId: input.programId,
      url: input.url,
      fetchedAt: input.fetchedAt.toISOString(),
      via: input.via,
      httpStatus: input.httpStatus,
      title: parseTitle(html),
      edition: parseEdition(html),
      htmlSha256: sha256(html),
      textSha256: sha256(text),
      textChars: text.length,
    },
  };
}

// ─── Fetching ───────────────────────────────────────────────────────────────

export type FetchResult = { status: number; body: string };
export type Fetcher = (url: string, init: { headers: Record<string, string>; timeoutMs: number }) => Promise<FetchResult>;

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
export const DIRECT_TIMEOUT_MS = 30_000;
export const JINA_TIMEOUT_MS = 60_000;

export function jinaUrl(url: string): string {
  return `https://r.jina.ai/${url}`;
}

export const nodeFetcher: Fetcher = async (url, init) => {
  const res = await fetch(url, { headers: init.headers, redirect: "follow", signal: AbortSignal.timeout(init.timeoutMs) });
  return { status: res.status, body: await res.text() };
};

export type Via = "auto" | "direct" | "jina";
export type FetchOutcome = { ok: true; via: "direct" | "jina"; status: number; html: string; log: string[] } | { ok: false; log: string[] };

/** Fetches a page under the policy above. Never throws; `log` says what happened. */
export async function fetchPage(url: string, via: Via, fetcher: Fetcher): Promise<FetchOutcome> {
  const log: string[] = [];
  if (via === "auto" || via === "direct") {
    try {
      const r = await fetcher(url, {
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
        timeoutMs: DIRECT_TIMEOUT_MS,
      });
      if (isChallengeResponse(r.status, r.body)) {
        log.push(`direct: HTTP ${r.status}, ${r.body.length} chars: looks like a bot challenge`);
      } else if (r.status < 200 || r.status >= 300) {
        log.push(`direct: HTTP ${r.status}`);
        return { ok: false, log };
      } else {
        log.push(`direct: HTTP ${r.status}, ${r.body.length} chars`);
        return { ok: true, via: "direct", status: r.status, html: r.body, log };
      }
    } catch (e) {
      log.push(`direct: request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (via === "direct") return { ok: false, log };
    log.push("falling back to the Jina reader (html mode)");
  }
  try {
    const r = await fetcher(jinaUrl(url), { headers: { "X-Return-Format": "html" }, timeoutMs: JINA_TIMEOUT_MS });
    if (r.status < 200 || r.status >= 300) {
      log.push(`jina: HTTP ${r.status}`);
      return { ok: false, log };
    }
    if (isChallengeResponse(r.status, r.body) || !/<(html|body|main)\b/i.test(r.body)) {
      log.push(`jina: HTTP ${r.status}, ${r.body.length} chars: not a rendered page`);
      return { ok: false, log };
    }
    log.push(`jina: HTTP ${r.status}, ${r.body.length} chars`);
    return { ok: true, via: "jina", status: r.status, html: r.body, log };
  } catch (e) {
    log.push(`jina: request failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, log };
  }
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const USAGE = "usage: npx tsx snapshot-catalog-page.ts --program <programId> --url <https url> [--out <dir>] [--via auto|direct|jina] [--force]";

export type SnapshotDeps = {
  fetcher?: Fetcher;
  now?: () => Date;
  log?: (s: string) => void;
  err?: (s: string) => void;
};

/** The whole CLI as a function: returns the exit code instead of exiting. */
export async function runSnapshot(argv: string[], deps: SnapshotDeps = {}): Promise<number> {
  const log = deps.log ?? ((s: string) => console.log(s));
  const err = deps.err ?? ((s: string) => console.error(s));
  let programId: string | null = null;
  let url: string | null = null;
  let out: string | null = null;
  let via: Via = "auto";
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") force = true;
    else if (a === "--program") programId = argv[++i] ?? null;
    else if (a === "--url") url = argv[++i] ?? null;
    else if (a === "--out") out = argv[++i] ?? null;
    else if (a === "--via") {
      const v = argv[++i];
      if (v !== "auto" && v !== "direct" && v !== "jina") {
        err(`--via must be auto, direct or jina\n${USAGE}`);
        return 2;
      }
      via = v;
    } else {
      err(`unknown argument: ${a}\n${USAGE}`);
      return 2;
    }
  }
  if (!programId || !url) {
    err(USAGE);
    return 2;
  }
  let defaultOut: string;
  try {
    defaultOut = provenanceDir(programId);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 2;
  }
  try {
    if (new URL(url).protocol !== "https:") throw new Error("not https");
  } catch {
    err(`--url must be an https URL: ${url}`);
    return 2;
  }
  const outDir = resolve(out ?? defaultOut);

  const fetched = await fetchPage(url, via, deps.fetcher ?? nodeFetcher);
  for (const l of fetched.log) log(`  ${l}`);
  if (!fetched.ok) {
    err(`FAILED: could not fetch ${url} (nothing written).`);
    return 1;
  }

  const snap = buildSnapshot({ programId, url, via: fetched.via, httpStatus: fetched.status, html: fetched.html, fetchedAt: (deps.now ?? (() => new Date()))() });
  if (snap.meta.textChars < MIN_TEXT_CHARS) {
    err(`FAILED: the page's extracted text is only ${snap.meta.textChars} chars; refusing to write a snapshot (nothing written).`);
    return 1;
  }

  const htmlPath = join(outDir, PROVENANCE_FILES.pageHtml);
  const textPath = join(outDir, PROVENANCE_FILES.pageText);
  const metaPath = join(outDir, PROVENANCE_FILES.meta);
  if (existsSync(metaPath) || existsSync(textPath)) {
    // The text hash on record: meta.json's, else the hash of the page.txt there.
    let old: string | null = null;
    try {
      old = (JSON.parse(readFileSync(metaPath, "utf-8")) as Partial<SnapshotMeta>).textSha256 ?? null;
    } catch {
      old = null;
    }
    if (old == null && existsSync(textPath)) old = sha256(toLf(readFileSync(textPath, "utf-8")));
    if (old === snap.meta.textSha256) log(`  existing snapshot: text unchanged (${old.slice(0, 12)})`);
    else if (!force) {
      err(`FAILED: a snapshot already exists in ${dirname(htmlPath)} and the page text has changed.`);
      err(`  old text sha256: ${old ?? "(unreadable)"}`);
      err(`  new text sha256: ${snap.meta.textSha256}`);
      err("  Drafts written against the old snapshot will fail check-draft. Re-run with --force to replace it (nothing written).");
      return 1;
    } else log(`  existing snapshot: text CHANGED (${old ? old.slice(0, 12) : "unreadable"} → ${snap.meta.textSha256.slice(0, 12)}); replacing it (--force)`);
  }
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, snap.html, "utf-8");
  writeFileSync(textPath, snap.text, "utf-8");
  writeFileSync(metaPath, `${JSON.stringify(snap.meta, null, 2)}\n`, "utf-8");

  const lineCount = snap.text.split("\n").length - 1;
  log(`Snapshot of ${url}`);
  log(`  via ${snap.meta.via} (HTTP ${snap.meta.httpStatus}); title: ${snap.meta.title ?? "(none)"}; edition: ${snap.meta.edition ?? "(none)"}`);
  log(`  page.txt: ${snap.meta.textChars} chars, ${lineCount} lines, sha256 ${snap.meta.textSha256.slice(0, 12)}`);
  log(`  wrote ${dirname(htmlPath)}`);
  return 0;
}

if (require.main === module) {
  runSnapshot(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
}
