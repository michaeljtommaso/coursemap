// @vitest-environment happy-dom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CourseFilters } from "@/hooks/useCourseFilters";
import { findClassUrl, useCountsTowardParam } from "@/hooks/useCountsTowardParam";

// The Requirements page's "Find a class" → /classes with "Counts toward" set.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let seen: { filters: CourseFilters; search: string } = { filters: {}, search: "" };

function Probe() {
  const [filters, setFilters] = useState<CourseFilters>({ subject: "HIST" });
  useCountsTowardParam(setFilters, [{ options: [{ id: "cas-college:fws", label: "First-Year Writing Seminars" }] }]);
  const loc = useLocation();
  useEffect(() => {
    seen = { filters, search: loc.search };
  });
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("useCountsTowardParam", () => {
  it("findClassUrl encodes the requirement id", () => {
    expect(findClassUrl("cas-college:fws")).toBe("/classes?countsToward=cas-college%3Afws");
  });

  it("applies the requirement to the filters once and drops the param", () => {
    act(() =>
      root.render(
        <MemoryRouter initialEntries={[findClassUrl("cas-college:fws")]}>
          <Probe />
        </MemoryRouter>
      )
    );
    expect(seen.filters).toEqual({
      subject: "HIST",
      requirementId: "cas-college:fws",
      requirementLabel: "First-Year Writing Seminars",
    });
    expect(seen.search).toBe("");
  });

  it("no param → filters untouched", () => {
    act(() =>
      root.render(
        <MemoryRouter initialEntries={["/classes"]}>
          <Probe />
        </MemoryRouter>
      )
    );
    expect(seen.filters).toEqual({ subject: "HIST" });
  });
});
