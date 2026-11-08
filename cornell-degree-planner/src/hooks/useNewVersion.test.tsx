// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNewVersion } from "./useNewVersion";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let seen: (string | null)[] = [];

function Probe(props: Parameters<typeof useNewVersion>[0]) {
  seen.push(useNewVersion(props));
  return null;
}

async function mount(props: Parameters<typeof useNewVersion>[0]) {
  await act(async () => root.render(<Probe {...props} />));
}

const last = () => seen[seen.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
  seen = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("useNewVersion", () => {
  it("reports a newer live build after a check, then stops asking", async () => {
    const fetchVersion = vi.fn().mockResolvedValue({ build: "NEW" });
    await mount({ enabled: true, intervalMs: 1000, current: "OLD", fetchVersion });
    expect(last()).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(last()).toBe("NEW");
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(fetchVersion).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while the live build is this one, or the answer is unreadable or fails", async () => {
    const fetchVersion = vi
      .fn()
      .mockResolvedValueOnce({ build: "OLD" })
      .mockResolvedValueOnce({ nope: 1 })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ build: "OLD" });
    await mount({ enabled: true, intervalMs: 1000, current: "OLD", fetchVersion });
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(fetchVersion).toHaveBeenCalledTimes(4);
    expect(last()).toBeNull();
  });

  it("checks when the tab comes back into view", async () => {
    const fetchVersion = vi.fn().mockResolvedValue({ build: "NEW" });
    await mount({ enabled: true, intervalMs: 60_000, current: "OLD", fetchVersion });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchVersion).toHaveBeenCalledTimes(1);
    expect(last()).toBe("NEW");
  });

  it("never asks when disabled (development)", async () => {
    const fetchVersion = vi.fn().mockResolvedValue({ build: "NEW" });
    await mount({ enabled: false, intervalMs: 1000, current: "OLD", fetchVersion });
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(fetchVersion).not.toHaveBeenCalled();
    expect(last()).toBeNull();
  });
});
