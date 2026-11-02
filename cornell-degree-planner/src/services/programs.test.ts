import { describe, it, expect, vi, beforeEach } from "vitest";

// The service reads through firebase/firestore; stub the SDK calls and the app
// module so no Firebase app boots under test.
const getDoc = vi.fn();
const getDocs = vi.fn();
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  getDoc: (ref: unknown) => getDoc(ref),
  getDocs: (ref: unknown) => getDocs(ref),
}));
vi.mock("@/lib/firebase", () => ({ db: {} }));

import { fetchProgramIndex, __resetProgramIndexWarningForTests } from "./programs";

function snap(data: unknown) {
  return { exists: () => data != null, data: () => data };
}

const ENTRY_FULL = {
  id: "test-cas-major",
  name: "Test Major (Arts & Sciences)",
  shortName: "Test A&S",
  college: "College of Arts and Sciences",
  collegeId: "cas",
  family: "cas",
  twins: ["cornell-cs-bs-2026"],
  url: "https://www.cs.cornell.edu/",
  status: "hidden",
  catalogYear: 2026,
  totalCredits: null,
};
// Only the required fields: twins / url / status / totalCredits default.
const ENTRY_MIN = {
  id: "cornell-cs-bs-2026",
  name: "Computer Science, B.S.",
  shortName: "CS",
  college: "College of Engineering",
  collegeId: "engineering",
  family: "engineering",
  catalogYear: 2026,
};

// A program doc as the fallback path reads it.
const PROGRAM_DOC = {
  id: "test-cals-doc",
  name: "Test Program, B.S.",
  shortName: "Test CALS",
  college: "College of Agriculture and Life Sciences",
  catalogYear: 2025,
  totalCredits: null,
  affiliationText: null,
  electiveGroups: [],
  slots: [],
  edges: [],
};
const BLANK_DOC = { ...PROGRAM_DOC, id: "blank", name: "Start from scratch", shortName: "Blank", college: "Your own plan" };

function programDocs(...docs: Record<string, unknown>[]) {
  return { docs: docs.map((d) => ({ id: d.id, data: () => d })) };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  getDoc.mockReset();
  getDocs.mockReset();
  __resetProgramIndexWarningForTests();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  warn.mockClear(); // spyOn returns the same spy each run; count per test
});

describe("fetchProgramIndex — catalog/programIndex (spec 019 D11)", () => {
  it("reads the one index doc and maps entries to Programs, sorted by name", async () => {
    getDoc.mockResolvedValue(snap({ entries: [ENTRY_FULL, ENTRY_MIN] }));
    const programs = await fetchProgramIndex();
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(getDoc.mock.calls[0][0]).toEqual({ path: "catalog/programIndex" });
    expect(getDocs).not.toHaveBeenCalled();
    expect(programs.map((p) => p.id)).toEqual(["cornell-cs-bs-2026", "test-cas-major"]);
    expect(programs[1]).toMatchObject({
      id: "test-cas-major",
      name: "Test Major (Arts & Sciences)",
      short_name: "Test A&S",
      college: "College of Arts and Sciences",
      catalog_year: 2026,
      total_credits: null,
      affiliation_text: null,
      collegeId: "cas",
      family: "cas",
      twins: ["cornell-cs-bs-2026"],
      url: "https://www.cs.cornell.edu/",
      status: "hidden",
    });
  });

  it("fills the schema defaults for absent optional fields", async () => {
    getDoc.mockResolvedValue(snap({ entries: [ENTRY_MIN] }));
    const [p] = await fetchProgramIndex();
    expect(p).toMatchObject({ twins: [], url: null, status: "visible", total_credits: null, family: "engineering" });
  });

  it("keeps hidden programs in the list (readers filter with programIsVisible)", async () => {
    getDoc.mockResolvedValue(snap({ entries: [ENTRY_FULL] }));
    const programs = await fetchProgramIndex();
    expect(programs).toHaveLength(1);
    expect(programs[0].status).toBe("hidden");
  });
});

describe("fetchProgramIndex — fallback to every program doc", () => {
  it("a missing index reads programs/* with collegeId from the college name and the Engineering family", async () => {
    getDoc.mockResolvedValue(snap(null));
    getDocs.mockResolvedValue(programDocs(PROGRAM_DOC, BLANK_DOC));
    const programs = await fetchProgramIndex();
    expect(getDocs).toHaveBeenCalledTimes(1);
    expect(getDocs.mock.calls[0][0]).toEqual({ path: "programs" });
    const cals = programs.find((p) => p.id === "test-cals-doc")!;
    expect(cals).toMatchObject({ collegeId: "cals", family: "engineering", short_name: "Test CALS" });
    expect(programs.find((p) => p.id === "blank")!.collegeId).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("an index that fails to parse falls back too", async () => {
    getDoc.mockResolvedValue(snap({ entries: [{ ...ENTRY_MIN, family: "law" }] }));
    getDocs.mockResolvedValue(programDocs(PROGRAM_DOC));
    const programs = await fetchProgramIndex();
    expect(programs.map((p) => p.id)).toEqual(["test-cals-doc"]);
    expect(warn).toHaveBeenCalled();
  });

  it("never lists a retired program doc (spec 019 D12)", async () => {
    getDoc.mockResolvedValue(snap(null));
    getDocs.mockResolvedValue(
      programDocs(PROGRAM_DOC, { ...PROGRAM_DOC, id: "cornell-comm-bs-2025", name: "Communication, B.S." })
    );
    const programs = await fetchProgramIndex();
    expect(programs.map((p) => p.id)).toEqual(["test-cals-doc"]);
  });

  it("one malformed entry drops only itself, not the whole index (review F8)", async () => {
    getDoc.mockResolvedValue(
      snap({ entries: [{ ...ENTRY_MIN, id: "bad", family: "law" }, ENTRY_MIN] })
    );
    const programs = await fetchProgramIndex();
    expect(programs.map((p) => p.id)).toEqual([ENTRY_MIN.id]);
    expect(getDocs).not.toHaveBeenCalled();
  });

  it("an index url must be https (it becomes a link)", async () => {
    getDoc.mockResolvedValue(
      snap({ entries: [{ ...ENTRY_MIN, id: "js", url: "javascript:alert(1)" }, ENTRY_MIN] })
    );
    const programs = await fetchProgramIndex();
    expect(programs.map((p) => p.id)).toEqual([ENTRY_MIN.id]);
  });

  it("an unreadable index falls back too", async () => {
    getDoc.mockRejectedValue(new Error("unavailable"));
    getDocs.mockResolvedValue(programDocs(PROGRAM_DOC));
    const programs = await fetchProgramIndex();
    expect(programs).toHaveLength(1);
  });

  it("warns once per session, not once per call", async () => {
    getDoc.mockResolvedValue(snap(null));
    getDocs.mockResolvedValue(programDocs(PROGRAM_DOC));
    await fetchProgramIndex();
    await fetchProgramIndex();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a failed fallback read surfaces the error (the list's retry UI)", async () => {
    getDoc.mockResolvedValue(snap(null));
    getDocs.mockRejectedValue(new Error("offline"));
    await expect(fetchProgramIndex()).rejects.toThrow("offline");
  });
});
