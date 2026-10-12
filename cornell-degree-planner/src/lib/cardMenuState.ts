/**
 * cardMenuState — a tiny shared signal: "some card's Course actions menu is
 * open." CourseCard's overflow menu registers itself while open; the hover
 * cluster of unlock suggestions (UnlocksGhosts) reads it and stays closed,
 * so a cluster never floats beside an open menu (U-12).
 *
 * Why a signal rather than the cluster's own outside-press dismissal: the
 * dismissal is recorded against whichever card the cluster is anchored to at
 * pointer-down. When the pointer reaches another card and opens its menu in
 * the same beat, the anchor has not caught up yet, so the dismissal lands on
 * the old card and the new card's cluster opens beside the menu. Gating on
 * the menu itself has no such race.
 *
 * Each open menu holds its own token, so overlapping open/close transitions
 * (one menu closing as another opens) can never leave the count stuck.
 */

type Listener = () => void;

const open = new Set<symbol>();
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export const cardMenuState = {
  /** Mark a menu open; returns the function that marks it closed again. */
  hold(): () => void {
    const token = Symbol("card-menu");
    open.add(token);
    emit();
    return () => {
      if (open.delete(token)) emit();
    };
  },
  /** Whether any card's actions menu is currently open. */
  isOpen(): boolean {
    return open.size > 0;
  },
  /** useSyncExternalStore-compatible subscription. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
