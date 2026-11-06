import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DirectoryRow } from "./DirectoryRow";
import { CatalogIndexRecordSchema, type CatalogIndexRecord } from "@/lib/schemas";
import type { ProfessorRating } from "@/lib/classes/professorRatings";

// Static render (no DOM library in this repo): read the professor line's text.
function rec(over: Record<string, unknown> = {}): CatalogIndexRecord {
  return CatalogIndexRecordSchema.parse({
    id: "CS-1112",
    subject: "CS",
    number: "1112",
    title: "Introduction to Computing Using MATLAB",
    creditsMin: 4,
    creditsMax: 4,
    hasPrereqs: false,
    roster: "SP27",
    lead: { netid: "al123", name: "Ada Lovelace", more: 1 },
    ...over,
  });
}

const rating = (over: Partial<ProfessorRating> = {}): ProfessorRating => ({
  rating: 3.6,
  count: 20,
  tier: "verified",
  fetchedAtMs: 0,
  ...over,
});

/** The line's text content, whitespace collapsed (what the e2e suite reads). */
function leadText(html: string): string | null {
  const start = html.indexOf('data-testid="lead-line"');
  if (start < 0) return null;
  const end = html.indexOf('<span class="flex shrink-0', start);
  return html
    .slice(start, end)
    .replace(/^[^>]*>/, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** The opening tag of one of the line's slots, or null when it isn't rendered. */
function slotTag(html: string, slot: "rating" | "more"): string | null {
  const m = new RegExp(`<span[^>]*data-testid="lead-${slot}"[^>]*>`).exec(html);
  return m ? m[0] : null;
}

function render(record: CatalogIndexRecord, ratings?: Map<string, ProfessorRating>, target = "SP27") {
  return renderToStaticMarkup(
    <DirectoryRow record={record} onOpen={() => {}} enrollmentTarget={target} ratings={ratings} />
  );
}

describe("DirectoryRow — lead lecturer line (spec 017 D4)", () => {
  it("target-roster course: name · rating +N", () => {
    expect(leadText(render(rec(), new Map([["al123", rating()]])))).toBe("Ada Lovelace · 3.6 ★ +1");
  });

  it("probable match gets ≈ before the rating", () => {
    const html = render(rec(), new Map([["al123", rating({ tier: "probable" })]]));
    expect(leadText(html)).toBe("Ada Lovelace · ≈3.6 ★ +1");
  });

  it("no live rating: name only", () => {
    expect(leadText(render(rec({ lead: { netid: "al123", name: "Ada Lovelace", more: 0 } }), new Map()))).toBe(
      "Ada Lovelace"
    );
  });

  it("course from another roster: same-size term label before the name", () => {
    const html = render(
      rec({ roster: "FA26", lead: { netid: "gh1", name: "Grace Hopper", more: 0 } }),
      new Map([["gh1", rating({ rating: 4.0 })]])
    );
    expect(leadText(html)).toBe("Fall 2026: Grace Hopper · 4.0 ★");
  });

  it("ratings off (empty map): names only, label kept", () => {
    expect(leadText(render(rec({ roster: "FA26" })))).toBe("Fall 2026: Ada Lovelace +1");
  });

  it("no lead (staff / TBA, or an old index): no professor line", () => {
    expect(render(rec({ lead: null }))).not.toContain("lead-line");
    expect(render(rec({ lead: undefined, roster: undefined }))).not.toContain("lead-line");
  });

  it("ratings sit in a fixed-width, right-aligned slot, kept even when a row has none", () => {
    const ratings = new Map([["al123", rating()]]);
    const rated = slotTag(render(rec(), ratings), "rating");
    expect(rated).toContain("sm:w-12");
    expect(rated).toContain("sm:text-right");
    // Another row whose lead has no rating keeps an (empty, desktop-only) slot.
    const unrated = slotTag(render(rec({ lead: { netid: "zz9", name: "Grace Hopper", more: 0 } }), ratings), "rating");
    expect(unrated).toContain("sm:w-12");
    expect(unrated).toContain("hidden sm:inline-block");
  });

  it("+N is capped at +9+ with the exact count on hover", () => {
    const html = render(rec({ lead: { netid: "al123", name: "Ada Lovelace", more: 32 } }), new Map());
    expect(leadText(html)).toBe("Ada Lovelace +9+");
    expect(slotTag(html, "more")).toContain('title="32 more instructors"');
  });
});

describe("DirectoryRow — ratings feature off", () => {
  // With the feature off the page passes no ratings (useProfessorRatings
  // returns the empty map without reading anything).
  it("names only: no rating slot at all, +N kept", () => {
    const html = render(rec(), undefined);
    expect(slotTag(html, "rating")).toBeNull();
    expect(leadText(html)).toBe("Ada Lovelace +1");
    expect(html).not.toContain("★");
  });
});

describe("DirectoryRow — class time (spec 021)", () => {
  const html = (over: Record<string, unknown>, target: string | null = "SP27") =>
    renderToStaticMarkup(<DirectoryRow record={rec(over)} onOpen={() => {}} enrollmentTarget={target} />);

  it("shows the first lecture time, with +N other lecture times", () => {
    expect(html({ meets: ["PLEC|TR 610-685", "SDIS|M 1170-1220"] })).toContain("TR 10:10–11:25");
    const two = html({ meets: ["PLEC|MW 610-685", "PLEC|MW 700-775"] });
    expect(two).toContain("MW 10:10–11:25");
    expect(two).toContain("+1");
  });

  it("no chip without a set lecture time, or for another term's times", () => {
    expect(html({ meets: ["PIND|"] })).not.toContain('data-testid="meeting-time"');
    expect(html({ meets: [] })).not.toContain('data-testid="meeting-time"');
    expect(html({ roster: "FA26", meets: ["PLEC|TR 610-685"] })).not.toContain('data-testid="meeting-time"');
  });
});
