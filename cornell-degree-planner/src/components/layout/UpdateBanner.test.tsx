// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useNewVersion", () => ({ useNewVersion: () => null }));
const { UpdateBanner } = await import("./UpdateBanner");

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("UpdateBanner", () => {
  it("shows nothing while this tab runs the live build", async () => {
    await act(async () => root.render(<UpdateBanner />));
    expect(host.querySelector("[data-update-banner]")).toBeNull();
  });

  it("offers a reload when a newer build is live, and Later hides it", async () => {
    await act(async () => root.render(<UpdateBanner live="NEW" />));
    const banner = host.querySelector("[data-update-banner]");
    expect(banner?.textContent).toContain("Coursemap was updated");
    expect(banner?.textContent).toContain("Your plan is saved.");
    const later = [...host.querySelectorAll("button")].find((b) => b.textContent === "Later")!;
    await act(async () => later.click());
    expect(host.querySelector("[data-update-banner]")).toBeNull();
  });

  it("removes the reload's version parameter from the address", async () => {
    window.history.replaceState(null, "", "/requirements?v=NEW&q=1");
    await act(async () => root.render(<UpdateBanner />));
    expect(window.location.pathname + window.location.search).toBe("/requirements?q=1");
  });
});
