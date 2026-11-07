/**
 * Which major to bring back for a signed-in student whose browser has no saved
 * selection (a new device or browser, cleared site data, or a new address like
 * cucoursemap.app). The selection lives in local storage, which is per site;
 * the account's plans and its active plan are not. The active plan's major
 * wins; otherwise the first plan that has one. Null = no plans: first run.
 */
export function programToRestore(
  activePlanId: string | null | undefined,
  plans: { id: string; programId: string }[]
): string | null {
  const active = activePlanId ? plans.find((p) => p.id === activePlanId && p.programId) : undefined;
  const pick = active ?? plans.find((p) => p.programId);
  return pick ? pick.programId : null;
}
