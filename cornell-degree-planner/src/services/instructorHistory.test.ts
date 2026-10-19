import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getInstructorHistory,
  __setInstructorHistoryLoaderForTests,
} from "./instructorHistory";
import type { CourseInstructorHistoryDoc } from "@/lib/schemas";

const DOC: CourseInstructorHistoryDoc = {
  courseId: "CS-2110",
  terms: [{ roster: "FA26", instructors: [{ netid: "abc1", name: "Ada Byron" }] }],
};

afterEach(() => __setInstructorHistoryLoaderForTests());

describe("getInstructorHistory — one read per course per session", () => {
  it("shares one load between concurrent and later callers", async () => {
    const load = vi.fn(async () => DOC);
    __setInstructorHistoryLoaderForTests(load);
    const [a, b] = await Promise.all([
      getInstructorHistory("CS-2110"),
      getInstructorHistory("CS-2110"),
    ]);
    const c = await getInstructorHistory("CS-2110");
    expect(a).toBe(DOC);
    expect(b).toBe(DOC);
    expect(c).toBe(DOC);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("caches a missing doc as null (never re-read)", async () => {
    const load = vi.fn(async () => null);
    __setInstructorHistoryLoaderForTests(load);
    expect(await getInstructorHistory("X-1")).toBeNull();
    expect(await getInstructorHistory("X-1")).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("a failed read resolves null and is retried on the next call", async () => {
    const load = vi
      .fn<(id: string) => Promise<CourseInstructorHistoryDoc | null>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(DOC);
    __setInstructorHistoryLoaderForTests(load);
    expect(await getInstructorHistory("CS-2110")).toBeNull();
    expect(await getInstructorHistory("CS-2110")).toBe(DOC);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("no course id → null without a read", async () => {
    const load = vi.fn(async () => DOC);
    __setInstructorHistoryLoaderForTests(load);
    expect(await getInstructorHistory(null)).toBeNull();
    expect(await getInstructorHistory("")).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
});
