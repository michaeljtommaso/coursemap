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
    fetchProfile.mockResolvedValue(
      accountProfile({ college: "engineering", entryTerm: "FA24", transfer: "none" })
    );
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

describe("carryGuestInto — spec 020 answers and course marks", () => {
  const AEM = "studentFact:acceptedToProgram:cals-aem";
  const HONORS = "studentFact:honorsProgram:cas-linguistics";

  it("fills the guest's student facts into the account's answers map", async () => {
    fetchProfile.mockResolvedValue(accountProfile({ answers: { [HONORS]: "no" } }));
    await carryGuestInto("acct", { plans: [], profile: guestProfile({ answers: { [AEM]: "yes", [HONORS]: "yes" } }) });
    expect(updatePrefs).toHaveBeenCalledWith("acct", { answers: { [HONORS]: "no", [AEM]: "yes" } });
  });

  it("copies each carried plan with its course marks", async () => {
    fetchProfile.mockResolvedValue(accountProfile());
    createPlan.mockResolvedValue(undefined);
    const courseMarks = { "usedAs:cas-college/fws@ENGL-2880": "yes" as const };
    await carryGuestInto("acct", {
      plans: [
        {
          id: "g1",
          createdAtMs: 1,
          updatedAtMs: 2,
          legacy: false,
          content: {
            name: "English",
            programId: "cas-english-ba",
            placements: [{ id: "p1", courseId: "ENGL-2880", sem: 1, order: 0 }],
            courseSnapshots: {},
            completedIds: [],
            inProgressIds: [],
            waivedRequirementIds: [],
            courseMarks,
          },
        },
      ],
      profile: guestProfile(undefined),
    });
    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(createPlan.mock.calls[0][2].courseMarks).toEqual(courseMarks);
  });
});

describe("retryStashedCarryOver — retired program ids (spec 019 D12)", () => {
  it("writes a stashed copy saved under an old id under the current id, waivers translated", async () => {
    localStorage.setItem(
      "cornell-planner-carryover:acct",
      JSON.stringify({
        copies: [
          {
            fromId: "g1",
            newId: "n1",
            input: {
              name: "Comm",
              programId: "cornell-comm-bs-2025",
              placements: [{ id: "p1", courseId: "COMM-1101", sem: 1, order: 0 }],
              courseSnapshots: {},
              completedIds: [],
              inProgressIds: [],
              waivedRequirementIds: ["comm-s1-comm1101", "liberal-studies"],
            },
          },
        ],
        guestProfile: null,
        activePlanId: null,
      })
    );
    createPlan.mockResolvedValue(undefined);
    expect(await retryStashedCarryOver("acct")).toEqual({ copied: 1, pending: 0 });
    expect(createPlan).toHaveBeenCalledWith(
      "acct",
      "n1",
      expect.objectContaining({
        programId: "cornell-communication-bs-2026",
        waivedRequirementIds: ["cornell-communication-bs-2026:found-intro-comm"],
      })
    );
  });
});

describe("carry-over — spec 028 tried classes (D12)", () => {
  it("copies each carried plan with its tried classes", async () => {
    fetchProfile.mockResolvedValue(accountProfile());
    createPlan.mockResolvedValue(undefined);
    await carryGuestInto("acct", {
      plans: [
        {
          id: "g1",
          createdAtMs: 1,
          updatedAtMs: 2,
          legacy: false,
          content: {
            name: "English",
            programId: "cas-english-ba",
            placements: [{ id: "p1", courseId: "ENGL-2880", sem: 1, order: 0 }],
            courseSnapshots: {},
            completedIds: [],
            inProgressIds: [],
            waivedRequirementIds: [],
            triedCourseIds: ["ENGL-3000"],
          },
        },
      ],
      profile: guestProfile(undefined),
    });
    expect(createPlan.mock.calls[0][2].triedCourseIds).toEqual(["ENGL-3000"]);
  });

  it("copies a plan whose board is empty but holds tried classes (audit F3)", async () => {
    fetchProfile.mockResolvedValue(accountProfile());
    createPlan.mockResolvedValue(undefined);
    await carryGuestInto("acct-empty", {
      plans: [
        {
          id: "g1",
          createdAtMs: 1,
          updatedAtMs: 2,
          legacy: false,
          content: {
            name: "History",
            programId: "cas-history-ba",
            placements: [],
            courseSnapshots: {},
            completedIds: [],
            inProgressIds: [],
            waivedRequirementIds: [],
            triedCourseIds: ["HIST-1530"],
            courseMarks: { "creditsTaken:CHEM-2070": 4 },
          },
        },
      ],
      profile: guestProfile(undefined),
    });
    expect(createPlan).toHaveBeenCalledTimes(1);
    const input = createPlan.mock.calls[0][2];
    expect(input.triedCourseIds).toEqual(["HIST-1530"]);
    expect(input.courseMarks).toEqual({ "creditsTaken:CHEM-2070": 4 });
  });

  it("a failed copy is stashed with its tried classes, and the retry writes them", async () => {
    listPlans.mockResolvedValue([]);
    fetchProfile.mockResolvedValue(accountProfile());
    createPlan.mockRejectedValueOnce(new Error("offline"));
    const result = await carryGuestInto("acct-t", {
      plans: [
        {
          id: "g1",
          createdAtMs: 1,
          updatedAtMs: 2,
          legacy: false,
          content: {
            name: "Comm",
            programId: "cornell-comm-bs-2025",
            placements: [{ id: "p1", courseId: "COMM-1101", sem: 1, order: 0 }],
            courseSnapshots: {},
            completedIds: [],
            inProgressIds: [],
            waivedRequirementIds: [],
            triedCourseIds: ["COMM-2010"],
          },
        },
      ],
      profile: null,
    });
    expect(result.pending).toBe(1);
    createPlan.mockReset().mockResolvedValue(undefined);
    expect(await retryStashedCarryOver("acct-t")).toEqual({ copied: 1, pending: 0 });
    expect(createPlan.mock.calls[0][2]).toMatchObject({
      programId: "cornell-communication-bs-2026",
      triedCourseIds: ["COMM-2010"],
    });
  });
});

describe("carry-over — spec 042 short terms (D4)", () => {
  const content = (extra: Record<string, unknown>) => ({
    name: "Psych",
    programId: "cas-psychology-ba",
    placements: [] as { id: string; courseId: string; sem: number; order: number; shortTerm?: true }[],
    courseSnapshots: {},
    completedIds: [],
    inProgressIds: [],
    waivedRequirementIds: [],
    ...extra,
  });

  it("copies a plan with its short-term classes and its added columns", async () => {
    fetchProfile.mockResolvedValue(accountProfile());
    createPlan.mockResolvedValue(undefined);
    const winter = { id: "p1", courseId: "PSYCH-1101", sem: 2, order: 0, shortTerm: true as const };
    await carryGuestInto("acct-st", {
      plans: [
        {
          id: "g1",
          createdAtMs: 1,
          updatedAtMs: 2,
          legacy: false,
          content: content({ placements: [winter], shortTerms: [2, 5] }),
        },
      ],
      profile: guestProfile(undefined),
    });
    const input = createPlan.mock.calls[0][2];
    expect(input.shortTerms).toEqual([2, 5]);
    expect(input.placements).toEqual([winter]);
  });

  it("copies an edited plan whose only content is an added (empty) short term", async () => {
    fetchProfile.mockResolvedValue(accountProfile());
    createPlan.mockResolvedValue(undefined);
    await carryGuestInto("acct-st2", {
      plans: [
        { id: "g1", createdAtMs: 1, updatedAtMs: 2, legacy: false, content: content({ shortTerms: [1] }) },
        { id: "g2", createdAtMs: 1, updatedAtMs: 2, legacy: false, content: content({ shortTerms: [] }) },
      ],
      profile: guestProfile(undefined),
    });
    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(createPlan.mock.calls[0][2].shortTerms).toEqual([1]);
  });

  it("a failed copy is stashed with its short terms, and the retry writes them", async () => {
    fetchProfile.mockResolvedValue(accountProfile());
    createPlan.mockRejectedValueOnce(new Error("offline"));
    const result = await carryGuestInto("acct-st3", {
      plans: [
        { id: "g1", createdAtMs: 1, updatedAtMs: 2, legacy: false, content: content({ shortTerms: [7] }) },
      ],
      profile: null,
    });
    expect(result.pending).toBe(1);
    createPlan.mockReset().mockResolvedValue(undefined);
    expect(await retryStashedCarryOver("acct-st3")).toEqual({ copied: 1, pending: 0 });
    expect(createPlan.mock.calls[0][2].shortTerms).toEqual([7]);
  });
});
