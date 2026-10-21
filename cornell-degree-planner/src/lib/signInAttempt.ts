/**
 * The sign-in dialog's attempt rules, kept pure so they can be unit-tested.
 *
 * Closing the Google popup can take Firebase 10+ seconds to notice (its
 * popup-closed check is slow when the opener can't watch the popup window), so
 * the dialog offers a Cancel and steps back to its ready state on its own
 * shortly after the page regains focus. Neither touches the auth session:
 * they only detach the dialog from the attempt in flight. Whatever that attempt
 * later returns is applied by these rules.
 */

export type SignInStatus =
  /** The Google button, ready. */
  | "idle"
  /** The popup is open; Cancel is offered. */
  | "loading"
  /** The popup answered; the sign-in is finishing (no Cancel, no reset). */
  | "finishing"
  | "linked"
  | "error";

export type SignInOutcome = "cancelled" | "linked" | "error";

/** How long after the page regains focus, with the popup still unanswered,
 *  the dialog returns to its ready state. */
export const POPUP_FOCUS_GRACE_MS = 1500;

/**
 * The status a finished attempt leaves the dialog in, or null to leave the
 * dialog as it is. `current` is false once the student cancelled, the focus
 * grace reset the dialog, or a newer attempt started.
 *  - A success always shows: the account really is signed in, however late.
 *  - A cancel or failure from a detached attempt is ignored; the student has
 *    already moved on, and the dialog must not jump to an error under them.
 */
export function statusAfterAttempt(outcome: SignInOutcome, current: boolean): SignInStatus | null {
  if (outcome === "linked") return "linked";
  if (!current) return null;
  return outcome === "cancelled" ? "idle" : "error";
}

/** Whether regaining focus may (after the grace) return the dialog to ready:
 *  only while the popup itself is pending, never once it has answered. */
export function canResetOnFocus(status: SignInStatus): boolean {
  return status === "loading";
}

/** Whether the dialog may be dismissed (×, Esc, backdrop) in this status.
 *  While the popup is open, Cancel is the way out; while the sign-in is
 *  finishing, nothing interrupts it. */
export function canDismiss(status: SignInStatus): boolean {
  return status !== "loading" && status !== "finishing";
}
