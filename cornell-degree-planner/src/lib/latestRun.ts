/**
 * A run counter for async work where only the newest run may publish its
 * result. Each start() supersedes every earlier run; isCurrent(run) tells a
 * finishing run whether it is still the latest.
 *
 * Unlike an effect-cleanup "cancelled" flag, re-rendering or re-running an
 * effect that does NOT start new work never orphans the run in flight, so a
 * loading flag that run owns always settles.
 */
export type RunCounter = {
  start(): number;
  isCurrent(run: number): boolean;
};

export function createRunCounter(): RunCounter {
  let current = 0;
  return {
    start() {
      current += 1;
      return current;
    },
    isCurrent(run) {
      return run === current;
    },
  };
}
