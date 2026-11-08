// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "./Tooltip";

// The shared tooltip (spec 041), rendered for real.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const render = (node: React.ReactNode) => act(() => root.render(node));
const button = () => container.querySelector("button")!;
const tip = () => document.querySelector('[role="tooltip"]');
const fire = (el: Element, type: string, init: EventInit = { bubbles: true }) =>
  act(() => {
    el.dispatchEvent(new Event(type, init));
  });
// React listens for mouseover/mouseout to synthesize mouseenter/leave.
const hover = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
  });
const unhover = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  });
const focus = (el: Element) =>
  act(() => {
    (el as HTMLElement).focus();
  });

describe("Tooltip (spec 041)", () => {
  it("renders the child with no bubble until asked", () => {
    render(
      <Tooltip content="Rename your plan">
        <button>Plan</button>
      </Tooltip>
    );
    expect(button().textContent).toBe("Plan");
    expect(tip()).toBeNull();
  });

  it("opens after the hover delay and closes on leave", () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Compare">
        <button aria-label="Compare">+</button>
      </Tooltip>
    );
    hover(button());
    expect(tip()).toBeNull();
    act(() => vi.advanceTimersByTime(400));
    expect(tip()?.textContent).toBe("Compare");
    unhover(button());
    expect(tip()).toBeNull();
  });

  it("opens at once on keyboard focus, links aria-describedby, and Escape closes it", () => {
    render(
      <Tooltip content="Mark completed">
        <button aria-label="Completed">✓</button>
      </Tooltip>
    );
    focus(button());
    const bubble = tip();
    expect(bubble?.textContent).toBe("Mark completed");
    expect(button().getAttribute("aria-describedby")).toContain(bubble!.id);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(tip()).toBeNull();
  });

  it("a press closes it (drags on the board must not carry it along)", () => {
    render(
      <Tooltip content="Course actions">
        <button>⋯</button>
      </Tooltip>
    );
    focus(button());
    expect(tip()).not.toBeNull();
    fire(button(), "pointerdown");
    expect(tip()).toBeNull();
  });

  it("keeps the child's own handlers and ref", () => {
    const onFocus = vi.fn();
    const onMouseEnter = vi.fn();
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <Tooltip content="Hi" delay={0}>
        <button ref={ref} onFocus={onFocus} onMouseEnter={onMouseEnter}>
          x
        </button>
      </Tooltip>
    );
    focus(button());
    hover(button());
    expect(onFocus).toHaveBeenCalled();
    expect(onMouseEnter).toHaveBeenCalled();
    expect(ref.current).toBe(button());
  });

  it("no content renders the child untouched", () => {
    render(
      <Tooltip content={undefined}>
        <button>x</button>
      </Tooltip>
    );
    focus(button());
    expect(tip()).toBeNull();
    expect(button().hasAttribute("aria-describedby")).toBe(false);
    expect(button().hasAttribute("data-tooltip")).toBe(false);
  });

  it("a disabled child is wrapped so hover still reaches it", () => {
    render(
      <Tooltip content="Pin at least two courses to compare" delay={0}>
        <button disabled>Compare</button>
      </Tooltip>
    );
    const wrapper = button().parentElement!;
    expect(wrapper.tagName).toBe("SPAN");
    hover(wrapper);
    expect(tip()?.textContent).toBe("Pin at least two courses to compare");
  });

  it("truncatedOnly opens only when the text is cut off", () => {
    render(
      <Tooltip content="A very long requirement name" delay={0} truncatedOnly>
        <button className="truncate">A very long…</button>
      </Tooltip>
    );
    const b = button();
    Object.defineProperty(b, "clientWidth", { configurable: true, value: 100 });
    Object.defineProperty(b, "scrollWidth", { configurable: true, value: 100 });
    hover(b);
    expect(tip()).toBeNull();
    unhover(b);
    Object.defineProperty(b, "scrollWidth", { configurable: true, value: 180 });
    hover(b);
    expect(tip()?.textContent).toBe("A very long requirement name");
  });

  it("a string tooltip is on the trigger as data-tooltip (static markup and browser tests)", () => {
    const html = renderToStaticMarkup(
      <Tooltip content="Rename your plan">
        <button>Plan</button>
      </Tooltip>
    );
    expect(html).toContain('data-tooltip="Rename your plan"');
  });
});
