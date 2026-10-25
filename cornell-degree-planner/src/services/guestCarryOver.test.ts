import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Profile } from "@/services/profile";
import type { CarryProfile } from "@/lib/guestCarryOver";

// The service composes the plans and profile services; stub both so no
// Firebase app boots, and keep the pure decisions (lib/guestCarryOver) real.
const { listPlans, createPlan, fetchProfile, applyCarryOverToProfile, updatePrefs } = vi.hoisted(() => ({
  listPlans: vi.fn(),
  createPlan: vi.fn(),
  fetchProfile: vi.fn(),
  applyCarryOverToProfile: vi.fn(),
  updatePrefs: vi.fn(),
}));
vi.mock("@/services/plans", () => ({
  listPlans,
  createPlan,
  readPlansForCarryOver: vi.fn(),
}));
vi.mock("@/services/profile", () => ({ fetchProfile, applyCarryOverToProfile, updatePrefs }));

import { carryGuestInto, retryStashedCarryOver } from "./guestCarryOver";

function accountProfile(prefs: Profile["prefs"] = {}): Profile {
  return {
    createdAt: null,
    displayName: "Ada",
    authProvider: "google",
    prefs,
    activePlanId: null,
    importedLocalPlan: false,
    favoriteCourseIds: [],
    pinnedCourseIds: [],
    creditProfile: [],
  };
}

function guestProfile(studentPrefs: CarryProfile["studentPrefs"]): CarryProfile {
  return {
    activePlanId: null,
    favoriteCourseIds: [],
    pinnedCourseIds: [],
    creditProfile: [],
    enteringYear: 2025,
    studentPrefs,
  };
}

const ANSWERED = {
  entryTerm: "FA25",
  transfer: "external" as const,
  transferStanding: "sophomore" as const,
  college: "cas" as const,
};

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const m of [listPlans, createPlan, fetchProfile, applyCarryOverToProfile, updatePrefs]) m.mockReset();
  listPlans.mockResolvedValue([]);
  applyCarryOverToProfile.mockResolvedValue(undefined);
  updatePrefs.mockResolvedValue(undefined);
});

describe("carryGuestInto — student prefs (spec 019)", () => {
  it("fills the start-at-Cornell answers and college into an account with none, beside the start year", async () => {
    fetchProfile.mockResolvedValue(accountProfile());
    await carryGuestInto("acct", { plans: [], profile: guestProfile(ANSWERED) });
    expect(applyCarryOverToProfile).toHaveBeenCalledWith("acct", { enteringYear: 2025 }, null);
    expect(updatePrefs).toHaveBeenCalledWith("acct", ANSWERED);
  });

  it("leaves an account's own answers alone", async () => {
    fetchProfile.mockResolvedValue(accountProfile({ college: "engineering" }));
    await carryGuestInto("acct", { plans: [], profile: guestProfile(ANSWERED) });
    expect(updatePrefs).not.toHaveBeenCalled();
  });

  it("writes nothing extra when the guest answered nothing", async () => {
    fetchProfile.mockResolvedValue(accountProfile());
    await carryGuestInto("acct", { plans: [], profile: guestProfile(undefined) });
    expect(updatePrefs).not.toHaveBeenCalled();
  });

  it("keeps the guest profile for a retry when the prefs write fails, and the retry fills it", async () => {
    fetchProfile.mockResolvedValue(accountProfile());
    updatePrefs.mockRejectedValueOnce(new Error("offline"));
    await carryGuestInto("acct", { plans: [], profile: guestProfile(ANSWERED) });
    expect(updatePrefs).toHaveBeenCalledTimes(1);

    const retried = await retryStashedCarryOver("acct");
    expect(retried).toEqual({ copied: 0, pending: 0 });
    expect(updatePrefs).toHaveBeenCalledTimes(2);
    expect(updatePrefs).toHaveBeenLastCalledWith("acct", ANSWERED);
    expect(await retryStashedCarryOver("acct")).toBeNull();
  });
});
