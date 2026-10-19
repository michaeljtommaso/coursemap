import { describe, expect, it } from "vitest";
import { nextAuthSnapshot, type AuthUserLike } from "./authSnapshot";

/** Firebase mutates the SAME User object in place when an anonymous account is
 *  linked to Google, so a test double that mutates mirrors the real shape. */
function anonUser(): AuthUserLike {
  return { uid: "u1", isAnonymous: true, displayName: null };
}

describe("nextAuthSnapshot", () => {
  it("builds a snapshot from the first user", () => {
    const u = anonUser();
    const snap = nextAuthSnapshot(null, u);
    expect(snap).toEqual({ user: u, uid: "u1", isAnonymous: true, displayName: null });
  });

  it("yields a NEW snapshot when the same user object is linked to Google in place", () => {
    const u = anonUser();
    const before = nextAuthSnapshot(null, u);
    // linkWithPopup: same object, same uid, now a Google account.
    Object.assign(u, { isAnonymous: false, displayName: "Ada Lovelace" });
    const after = nextAuthSnapshot(before, u);
    expect(after).not.toBe(before);
    expect(after.isAnonymous).toBe(false);
    expect(after.displayName).toBe("Ada Lovelace");
    expect(after.uid).toBe("u1");
  });

  it("keeps the previous snapshot on a plain token refresh (no re-render)", () => {
    const u = anonUser();
    const before = nextAuthSnapshot(null, u);
    expect(nextAuthSnapshot(before, u)).toBe(before);
  });

  it("yields a new snapshot when the user switches (sign-in fallback, sign-out)", () => {
    const before = nextAuthSnapshot(null, anonUser());
    const google: AuthUserLike = { uid: "u2", isAnonymous: false, displayName: "Ada" };
    expect(nextAuthSnapshot(before, google)).toEqual({
      user: google,
      uid: "u2",
      isAnonymous: false,
      displayName: "Ada",
    });
    expect(nextAuthSnapshot(before, null)).toEqual({
      user: null,
      uid: null,
      isAnonymous: true,
      displayName: null,
    });
  });
});
