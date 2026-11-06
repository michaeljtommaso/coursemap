import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogRetryButton } from "./CatalogRetryButton";
import { retryCatalogLoad } from "./catalogRetry";

describe("CatalogRetryButton — the catalog failed to load", () => {
  it("retrying reloads the page, so a tab running an older build picks up the current one", () => {
    // A tab opened before a deploy keeps the old bundle; refetching inside it
    // fails the same way every time (2026-11-06: an old schema cap rejected
    // the new CS/ME/ECE lists). Only a reload loads the new code.
    const reload = vi.fn();
    retryCatalogLoad(reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows the error and the retry action as one button", () => {
    const html = renderToStaticMarkup(<CatalogRetryButton />);
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)];
    expect(buttons).toHaveLength(1);
    expect(buttons[0][1].replace(/<[^>]+>/g, "").trim()).toBe("Couldn’t load — Retry");
    expect(html).toContain("your plan is safe");
  });
});
