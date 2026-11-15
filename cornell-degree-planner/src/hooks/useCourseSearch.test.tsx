// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogIndexRecord } from "@/lib/schemas";
import { rankSearch } from "@/lib/catalog/rankSearch";
import { recordToCourse } from "@/lib/catalog/recordToCourse";

// useCourseSearch returns the typed query's own ranked results, with no timer
// in between. QA (spec 045): the Requirements page's "Try a class" search
// showed AAP 1100, AAS 1100… for "ANSC" (the empty query's A→Z list, held by a
// debounce timer), and kept "ANSC 2100" up for seconds after "BIOEE" was typed.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rec = (subject: string, number: string, title: string) =>
  ({ id: `${subject}-${number}`, subject, number, title, roster: "SP27", offered: [] }) as unknown as CatalogIndexRecord;

// Index order is subject A→Z, as the real catalog index is.
const INDEX = [
  rec("AAP", "1100", "Introduction to Asian American Studies"),
  rec("AAS", "1100", "Introduction to Asian American Studies"),
  rec("AEM", "1500", "An Introduction to the Economics of Environmental and Natural Resources"),
  rec("ANSC", "1101", "Domestic Animal Biology I"),
  rec("ANSC", "2100", "Introduction to Animal Welfare"),
  rec("BIOEE", "1610", "Introductory Biology: Ecology and the Environment"),
  rec("BIOEE", "1780", "An Introduction to Evolutionary Biology and Diversity"),
];

vi.mock("@/contexts/CatalogProvider", () => ({
  useCatalogContext: () => ({
    loading: false,
    error: null,
    refetch: () => {},
    search: (q: string, limit = 40, filter?: (r: CatalogIndexRecord) => boolean) =>
      rankSearch(INDEX, q, { limit, filter }).map(recordToCourse),
  }),
}));

const { useCourseSearch } = await import("./useCourseSearch");

function Probe({ query }: { query: string }) {
  const { results, query: resultsQuery } = useCourseSearch(query);
  return <p data-query={resultsQuery}>{results.map((c) => c.id).join(",")}</p>;
}

let root: Root;
let container: HTMLDivElement;
const shownFor = () => {
  const p = container.querySelector("p")!;
  return { query: p.dataset.query, ids: p.textContent ? p.textContent.split(",") : [] };
};
let shown = { query: "" as string | undefined, ids: [] as string[] };
const show = (query: string) => {
  act(() => root.render(<Probe query={query} />));
  shown = shownFor();
};

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
});

describe("useCourseSearch", () => {
  it("a query shows its own best matches by code, with no timer to wait for", () => {
    show("");
    expect(shown.ids.slice(0, 2)).toEqual(["AAP-1100", "AAS-1100"]);

    show("ANSC");
    expect(shown).toEqual({ query: "ANSC", ids: ["ANSC-1101", "ANSC-2100"] });

    show("ANSC 2100");
    expect(shown.ids).toEqual(["ANSC-2100"]);

    show("BIOEE");
    expect(shown).toEqual({ query: "BIOEE", ids: ["BIOEE-1610", "BIOEE-1780"] });
  });
});
