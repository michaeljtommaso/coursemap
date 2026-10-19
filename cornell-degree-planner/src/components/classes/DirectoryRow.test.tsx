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

function leadText(html: string): string | null {
  const m = /data-testid="lead-line"[^>]*>(.*?)<\/span><\/span><span class="flex shrink-0/.exec(html);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
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
});
