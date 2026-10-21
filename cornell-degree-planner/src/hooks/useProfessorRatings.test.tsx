import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Ratings feature OFF for this file: the hook must hand back the empty map,
// ready, without touching the ratings loader (no read at all).
vi.mock("@/config/features", () => ({ FEATURES: { rateMyProfessor: false } }));
const loadProfessorRatings = vi.fn();
const peekProfessorRatings = vi.fn();
vi.mock("@/services/professorRatings", () => ({
  loadProfessorRatings: (...args: unknown[]) => loadProfessorRatings(...args),
  peekProfessorRatings: () => peekProfessorRatings(),
}));

import { useProfessorRatings } from "./useProfessorRatings";
import { EMPTY_RATINGS } from "@/lib/classes/professorRatings";

// Static render: the probe prints what the hook returned.
function Probe() {
  const { ratings, ready } = useProfessorRatings();
  return (
    <i
      data-shared-empty={String(ratings === EMPTY_RATINGS)}
      data-size={ratings.size}
      data-ready={String(ready)}
    />
  );
}

describe("useProfessorRatings — ratings feature off", () => {
  it("returns the empty map, ready from the start, and reads nothing", () => {
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain('data-shared-empty="true"');
    expect(html).toContain('data-size="0"');
    expect(html).toContain('data-ready="true"');
    expect(peekProfessorRatings).not.toHaveBeenCalled();
    expect(loadProfessorRatings).not.toHaveBeenCalled();
  });
});
