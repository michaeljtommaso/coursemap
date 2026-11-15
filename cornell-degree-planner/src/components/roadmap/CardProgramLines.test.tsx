// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResolvedHeldBack } from "@/components/requirements/programSections";
import { CardProgramLabels, HeldBackLines, HeldBackSwitches } from "./CardProgramLines";

// Spec 047 D6/D8: the card's program lines.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("CardProgramLabels", () => {
  it("primary labels first, then a colored dot before each extra program's labels", () => {
    const html = renderToStaticMarkup(
      <CardProgramLabels
        groups={[
          { sectionId: "economics", programName: "Economics", extra: false, color: null, labels: ["Econometrics"] },
          { sectionId: "mathematics", programName: "Mathematics", extra: true, color: 1, labels: ["Electives"] },
        ]}
      />
    );
    expect(html).toContain("data-attribution");
    expect(html).toContain('data-attribution-program="mathematics"');
    expect(html).toContain("var(--program-1)");
    expect(text(html)).toContain("Econometrics · Electives");
    // The full text for screen readers names the program.
    expect(text(html)).toContain("Counts toward Econometrics · Mathematics: Electives");
  });

  it("renders nothing when every label was filtered out", () => {
    const html = renderToStaticMarkup(
      <CardProgramLabels groups={[{ sectionId: "e", programName: "E", extra: false, color: null, labels: [] }]} />
    );
    expect(html).toBe("");
  });
});

// ECON 3120 moved to the CS minor; the switch counts it for Economics.
const HELD: ResolvedHeldBack = {
  courseId: "ECON-3120",
  placementId: "p1",
  countsFor: "cs-minor",
  heldFrom: "economics",
  countsForName: "CS minor",
  heldFromName: "Economics",
  limit: "Economics and CS minor can share at most 2 courses",
  layerId: "econ-ba",
};

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("HeldBackLines (D8: the line is the switch)", () => {
  it("reads 'Counts for CS minor · Count it for Economics instead', the reason for screen readers", () => {
    const html = renderToStaticMarkup(<HeldBackLines code="ECON 3120" heldBack={[HELD]} onCountFor={() => {}} />);
    expect(html).toContain('data-held-back-line="economics"');
    // Visible text (the reason is sr-only, read right after the first half).
    const visible = text(html.replace(/<span class="sr-only">[^<]*<\/span>/g, ""));
    expect(visible).toBe("Counts for CS minor · Count it for Economics instead");
    expect(text(html)).toContain("Economics and CS minor can share at most 2 courses, so ECON 3120 counts for CS minor only.");
    // The reason stays the first half's tooltip.
    expect(html).toContain('data-tooltip="Economics and CS minor can share at most 2 courses, so ECON 3120 counts for CS minor only."');
  });

  it("the switch is a real button named for the course and both programs; it counts it for the held-from layer", () => {
    const onCountFor = vi.fn();
    const cardClick = vi.fn();
    const cardPointer = vi.fn();
    const cardKey = vi.fn();
    act(() =>
      root.render(
        <div role="button" onClick={cardClick} onPointerDown={cardPointer} onKeyDown={cardKey}>
          <HeldBackLines code="ECON 3120" heldBack={[HELD]} onCountFor={onCountFor} />
        </div>
      )
    );
    const btn = host.querySelector<HTMLButtonElement>('button[data-count-it-for="economics"]')!;
    expect(btn).toBeTruthy();
    expect(btn.type).toBe("button");
    expect(btn.getAttribute("aria-label")).toBe("Count ECON 3120 for Economics instead of CS minor");
    expect(btn.textContent).toBe("Count it for Economics instead");
    act(() => {
      btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      btn.click();
    });
    expect(onCountFor).toHaveBeenCalledTimes(1);
    expect(onCountFor.mock.calls[0][0]).toMatchObject({ courseId: "ECON-3120", layerId: "econ-ba", heldFrom: "economics" });
    // Never opens the card, starts a drag, or reaches the card's key handler.
    expect(cardClick).not.toHaveBeenCalled();
    expect(cardPointer).not.toHaveBeenCalled();
    expect(cardKey).not.toHaveBeenCalled();
  });

  it("no layer to count it for (or no handler): the text without a switch", () => {
    const noLayer = renderToStaticMarkup(
      <HeldBackLines code="ECON 3120" heldBack={[{ ...HELD, layerId: null }]} onCountFor={() => {}} />
    );
    expect(text(noLayer)).toContain("Counts for CS minor");
    expect(noLayer).not.toContain("<button");
    const noHandler = renderToStaticMarkup(<HeldBackLines code="ECON 3120" heldBack={[HELD]} />);
    expect(noHandler).not.toContain("<button");
  });
});

describe("HeldBackSwitches (compact cards)", () => {
  it("a small ↔ button, the whole sentence as its name and tooltip; it counts it for the held-from layer", () => {
    const onCountFor = vi.fn();
    const cardClick = vi.fn();
    act(() =>
      root.render(
        <div role="button" onClick={cardClick}>
          <HeldBackSwitches code="ECON 3120" heldBack={[HELD]} onCountFor={onCountFor} />
        </div>
      )
    );
    const btn = host.querySelector<HTMLButtonElement>('button[data-held-back-switch="economics"]')!;
    const sentence = "ECON 3120 counts for CS minor (overlap limit) · Count it for Economics instead";
    expect(btn.textContent).toBe("↔");
    expect(btn.getAttribute("aria-label")).toBe(sentence);
    expect(btn.getAttribute("data-tooltip")).toBe(sentence);
    act(() => btn.click());
    expect(onCountFor).toHaveBeenCalledTimes(1);
    expect(onCountFor.mock.calls[0][0]).toMatchObject({ courseId: "ECON-3120", layerId: "econ-ba" });
    expect(cardClick).not.toHaveBeenCalled();
    // No held-back line in compact mode: only the switch.
    expect(host.querySelector("[data-held-back-line]")).toBeNull();
  });

  it("renders nothing when no held-back course has a layer to count it for", () => {
    const html = renderToStaticMarkup(
      <HeldBackSwitches code="ECON 3120" heldBack={[{ ...HELD, layerId: null }]} onCountFor={() => {}} />
    );
    expect(html).toBe("");
  });
});
