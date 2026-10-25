import { termOrdinal } from "./select";
import type { AppliesClause, ChildRow, DistributionRow, Layer, Row, RowLimit } from "./types";

/**
 * lintLayer.ts (spec 019 D4/D13) — structural checks on an authored layer that
 * the strict LayerSchema cannot express: id uniqueness, internal consistency of
 * distribution and limit numbers, flag conflicts, layer-kind fields and source
 * hosts. Returns one human-readable line per problem; [] means clean. Pure.
 *
 * Catalog satisfiability (does any course match a rule?) is a separate,
 * offline check: scripts/validate-layers.ts.
 */
export function lintLayer(layer: Layer): string[] {
  const errors: string[] = [];
  const err = (where: string, msg: string) => errors.push(`${layer.id}${where ? `:${where}` : ""}: ${msg}`);

  // ── Layer-kind fields ──────────────────────────────────────────────────────
  if (layer.kind === "college") {
    if (layer.programId != null) err("", "a college layer must not have a programId");
    if (layer.concentrationId != null) err("", "a college layer must not have a concentrationId");
  } else {
    if (!layer.programId) err("", `a ${layer.kind} layer needs a programId`);
    if (layer.kind === "concentration" && !layer.concentrationId) err("", "a concentration layer needs a concentrationId");
    if (layer.kind === "major" && layer.concentrationId != null) err("", "a major layer must not have a concentrationId");
  }
  lintClauses(layer.appliesTo, (msg) => err("", msg));

  // ── Row ids ────────────────────────────────────────────────────────────────
  const topIds = new Set<string>();
  for (const row of layer.rows) {
    if (topIds.has(row.id)) err(row.id, "duplicate row id");
    topIds.add(row.id);
  }
  const childIds = new Set<string>();
  for (const row of layer.rows) {
    if (row.kind !== "anyOf") continue;
    for (const child of row.rows) {
      if (topIds.has(child.id)) err(`${row.id}/${child.id}`, "child row id repeats a top-level row id");
      if (childIds.has(child.id)) err(`${row.id}/${child.id}`, "duplicate child row id");
      childIds.add(child.id);
    }
  }

  // ── Rows ───────────────────────────────────────────────────────────────────
  for (const row of layer.rows) {
    lintRow(row, row.id, (where, msg) => err(where, msg));
    if (row.kind === "anyOf") {
      for (const child of row.rows) {
        const where = `${row.id}/${child.id}`;
        if (child.overlay != null || child.exclusive != null) {
          err(where, "child rows inherit overlay/exclusive from their anyOf parent; do not set them");
        }
        if (child.appliesTo != null) err(where, "child rows cannot carry their own appliesTo");
        if (child.kind === "credits" && row.exclusive) err(where, "a credits row cannot be exclusive (parent is exclusive)");
        lintRow(child, where, (w, msg) => err(w, msg));
      }
    }
  }
  return errors;
}

function lintClauses(clauses: AppliesClause[] | undefined, report: (msg: string) => void) {
  for (const [i, c] of (clauses ?? []).entries()) {
    if (c.enteredFrom != null && c.enteredBefore != null) {
      const from = termOrdinal(c.enteredFrom);
      const before = termOrdinal(c.enteredBefore);
      if (from != null && before != null && from >= before) {
        report(`appliesTo[${i}] has an empty entry-term range (${c.enteredFrom} to before ${c.enteredBefore})`);
      }
    }
  }
}

function lintRow(row: Row | ChildRow, where: string, report: (where: string, msg: string) => void) {
  const err = (msg: string) => report(where, msg);

  if (row.overlay && row.exclusive) err("a row cannot be both overlay and exclusive");
  if (row.kind === "credits" && row.exclusive) err("a credits row cannot be exclusive");
  lintClauses(row.appliesTo, err);
  lintSource(row.source, err);

  switch (row.kind) {
    case "pool":
      if (row.requiredCourses === 0 && row.requiredCredits === 0) err("pool requires neither courses nor credits");
      lintLimits(row.limits, err);
      break;
    case "credits":
      if (row.requiredCredits <= 0) err("credits row requires no credits");
      lintLimits(row.limits, err);
      break;
    case "distribution":
      lintDistribution(row, err);
      break;
    default:
      break;
  }
}

function lintSource(source: { url: string }, err: (msg: string) => void) {
  let host: string;
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:") err(`source url must be https: ${source.url}`);
    host = url.hostname;
  } catch {
    err(`source url does not parse: ${source.url}`);
    return;
  }
  if (host !== "cornell.edu" && !host.endsWith(".cornell.edu")) err(`source url is not on a cornell.edu host: ${source.url}`);
}

function lintLimits(limits: RowLimit[] | undefined, err: (msg: string) => void) {
  for (const [i, l] of (limits ?? []).entries()) {
    const name = `limit[${i}]${l.label ? ` (${l.label})` : ""}`;
    if (l.minCourses == null && l.maxCourses == null && l.minCredits == null && l.maxCredits == null) {
      err(`${name} sets no bound`);
    }
    if (l.minCourses != null && l.maxCourses != null && l.minCourses > l.maxCourses) err(`${name}: minCourses > maxCourses`);
    if (l.minCredits != null && l.maxCredits != null && l.minCredits > l.maxCredits) err(`${name}: minCredits > maxCredits`);
    if (l.maxCourses === 0 && ((l.minCredits ?? 0) > 0 || (l.minCourses ?? 0) > 0)) {
      err(`${name}: needs courses or credits but allows no course`);
    }
  }
}

function lintDistribution(row: DistributionRow, err: (msg: string) => void) {
  const ids = new Set<string>();
  for (const c of row.categories) {
    if (ids.has(c.id)) err(`duplicate category id ${c.id}`);
    ids.add(c.id);
  }
  const per = row.perCategory ?? {};
  for (const [key, bound] of Object.entries(per)) {
    if (!ids.has(key)) err(`perCategory key ${key} is not a category id`);
    if (bound.min != null && bound.max != null && bound.min > bound.max) err(`perCategory ${key}: min > max`);
  }
  if (row.requiredCourses === 0 && row.minDistinctCategories === 0) err("distribution requires neither courses nor categories");
  if (row.minDistinctCategories > row.categories.length) {
    err(`minDistinctCategories ${row.minDistinctCategories} exceeds the ${row.categories.length} categories`);
  }
  // Categories that can hold at least one course.
  const usable = row.categories.filter((c) => per[c.id]?.max !== 0).length;
  if (row.minDistinctCategories > usable) {
    err(`minDistinctCategories ${row.minDistinctCategories} exceeds the ${usable} categories that allow a course`);
  }
  // Every counted course sits in at least one category, so when every category
  // is capped, the caps bound how many distinct courses can count.
  const allCapped = row.categories.every((c) => per[c.id]?.max != null);
  if (allCapped) {
    const capacity = row.categories.reduce((n, c) => n + (per[c.id]?.max ?? 0), 0);
    if (row.requiredCourses > capacity) {
      err(`requiredCourses ${row.requiredCourses} exceeds the ${capacity} courses the category maxima allow`);
    }
  }
  for (const c of row.categories) {
    const min = per[c.id]?.min ?? 0;
    if (min > 0 && row.maxPerSubject === 0) err(`category ${c.id} needs courses but maxPerSubject is 0`);
  }
  const maxCats = row.maxCategoriesPerCourse ?? 1;
  if (maxCats > row.categories.length) err(`maxCategoriesPerCourse ${maxCats} exceeds the ${row.categories.length} categories`);
  if (row.maxDoubleCountCourses != null && maxCats <= 1) {
    err("maxDoubleCountCourses is set but maxCategoriesPerCourse allows no double counting");
  }
}
