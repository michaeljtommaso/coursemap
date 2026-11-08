// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareLinkPanel } from "./ShareLinkPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("ShareLinkPanel", () => {
  it("shows the link in a labelled read-only field with focus on it", () => {
    act(() => root.render(<ShareLinkPanel url="https://x.test/s/abc" onCopy={vi.fn()} onClose={vi.fn()} />));
    const input = host.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("https://x.test/s/abc");
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute("aria-label")).toBe("Share link");
    expect(document.activeElement).toBe(input);
  });

  it("Copy retries and reports the result; Esc and Close call onClose", async () => {
    const onCopy = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    act(() => root.render(<ShareLinkPanel url="https://x.test/s/abc" onCopy={onCopy} onClose={onClose} />));
    const copy = [...host.querySelectorAll("button")].find((b) => b.textContent === "Copy")!;
    await act(async () => copy.click());
    expect(onCopy).toHaveBeenCalled();
    expect(host.textContent).toContain("Link copied");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => (host.querySelector('button[aria-label="Close"]') as HTMLElement).click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
