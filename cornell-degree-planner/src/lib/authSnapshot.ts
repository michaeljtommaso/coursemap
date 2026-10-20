/**
 * The fields of the Firebase User the UI renders from, copied out of the User
 * object. Firebase MUTATES the same User in place when an anonymous account is
 * linked to Google (same uid, isAnonymous flips), so React state holding only
 * the User reference never changes and nothing re-renders. Snapshotting the
 * rendered fields gives React a value that does change.
 */
export type AuthUserLike = {
  uid: string;
  isAnonymous: boolean;
  displayName: string | null;
  /** Linked sign-in providers; a linked guest's name lives only here. */
  providerData?: ReadonlyArray<{ providerId: string; displayName: string | null }>;
};

export type AuthSnapshot<U extends AuthUserLike = AuthUserLike> = {
  user: U | null;
  uid: string | null;
  isAnonymous: boolean;
  displayName: string | null;
};

/**
 * The next snapshot for `user`. Returns `prev` unchanged when nothing rendered
 * changed (e.g. an hourly ID-token refresh), so state setters bail out and the
 * app doesn't re-render for nothing.
 */
export function nextAuthSnapshot<U extends AuthUserLike>(
  prev: AuthSnapshot<U> | null,
  user: U | null
): AuthSnapshot<U> {
  const next: AuthSnapshot<U> = {
    user,
    uid: user?.uid ?? null,
    isAnonymous: user?.isAnonymous ?? true,
    displayName:
      user?.displayName ||
      user?.providerData?.find((p) => p.providerId === "google.com")?.displayName ||
      null,
  };
  if (
    prev &&
    prev.user === next.user &&
    prev.uid === next.uid &&
    prev.isAnonymous === next.isAnonymous &&
    prev.displayName === next.displayName
  ) {
    return prev;
  }
  return next;
}

/** The User fields an account's identity is read from. */
export type IdentityUserLike = {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  providerData: ReadonlyArray<{
    providerId: string;
    displayName: string | null;
    email: string | null;
    photoURL: string | null;
  }>;
};

export type AccountIdentity = {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
};

/**
 * Name, email and photo for the account menu. When a guest is upgraded by
 * linking Google, Firebase leaves the account's own name and photo empty and
 * keeps them only on the linked Google entry (providerData), so fall back to
 * that entry field by field.
 */
export function accountIdentity(user: IdentityUserLike | null): AccountIdentity {
  const google = user?.providerData.find((p) => p.providerId === "google.com");
  return {
    displayName: user?.displayName || google?.displayName || null,
    email: user?.email || google?.email || null,
    photoURL: user?.photoURL || google?.photoURL || null,
  };
}

