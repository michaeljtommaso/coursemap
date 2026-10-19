import type { CreditEntry } from "@/lib/schemas";
import type { Placement } from "@/types/plan";

/**
 * Guest carry-over decisions (spec 018), pure. When a guest signs into a Google
 * account that already exists, their edited plans are copied into it and their
 * profile fills the account's gaps. The services layer reads and writes; this
 * module only decides what to copy and what to call it.
 */

/** Client mirror of the firestore.rules favorites cap (favoriteCourseIds ≤ 200). */
export const MAX_FAVORITES = 200;
/** Compare-tray product cap (spec 013 §2): up to 4 pins side by side. */
export const MAX_PINS = 4;
/** rules: plan name.size() <= 80 — keep in sync with firestore.rules */
const MAX_PLAN_NAME = 80;

/** A plan's content, in the shape createPlan takes. */
export type CarryPlanContent = {
  name: string;
  programId: string;
  placements: Placement[];
  courseSnapshots: Record<string, unknown>;
  completedIds: string[];
  inProgressIds: string[];
  waivedRequirementIds: string[];
};

/** A guest plan as read for carrying over. */
export type CarryPlan = {
  id: string;
  /** Server times in ms, or null when the doc has none. */
  createdAtMs: number | null;
  updatedAtMs: number | null;
  /** A retired slot-shape doc (schemaVersion < 3): read as empty, never copied. */
  legacy: boolean;
  content: CarryPlanContent;
};

/** The profile fields carry-over reads (guest) or fills (account). */
export type CarryProfile = {
  activePlanId: string | null;
  favoriteCourseIds: string[];
  pinnedCourseIds: string[];
  creditProfile: CreditEntry[];
  enteringYear: number | null;
};

export type CarryCopy = { fromId: string; newId: string; input: CarryPlanContent };

export type ProfileCarryPatch = Partial<{
  favoriteCourseIds: string[];
  pinnedCourseIds: string[];
  creditProfile: CreditEntry[];
  enteringYear: number;
}>;

/**
 * Worth copying (spec 018 D3): has courses, and was saved after being created.
 * A starter board rides in the create itself, so an untouched one has equal
 * created/updated times. A missing time counts as edited (copy rather than lose).
 */
export function shouldCarry(p: CarryPlan): boolean {
  if (p.legacy || p.content.placements.length === 0) return false;
  if (p.createdAtMs === null || p.updatedAtMs === null) return true;
  return p.updatedAtMs !== p.createdAtMs;
}

/** The copy's name (spec 018 D4): unchanged when free, else labeled and numbered. */
export function carryName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? " (from guest)" : ` (from guest ${n})`;
    const candidate = name.slice(0, MAX_PLAN_NAME - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The copies to write, in the guest's order, named against the account's plans
 *  and each other. */
export function planCopies(
  guestPlans: CarryPlan[],
  accountPlanNames: string[],
  newId: () => string
): CarryCopy[] {
  const taken = new Set(accountPlanNames);
  const copies: CarryCopy[] = [];
  for (const p of guestPlans) {
    if (!shouldCarry(p)) continue;
    const name = carryName(p.content.name, taken);
    taken.add(name);
    copies.push({ fromId: p.id, newId: newId(), input: { ...p.content, name } });
  }
  return copies;
}

/** The account's next active plan (spec 018 D2): the copy of the plan the guest
 *  was editing, or null to leave the account's choice alone. */
export function activePlanAfterCarry(
  guestActivePlanId: string | null,
  copies: CarryCopy[]
): string | null {
  if (!guestActivePlanId) return null;
  return copies.find((c) => c.fromId === guestActivePlanId)?.newId ?? null;
}

function unionCapped(first: string[], second: string[], cap: number): string[] {
  const out = [...first];
  for (const id of second) {
    if (out.length >= cap) break;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The account's profile patch (spec 018 D5): favorites and pins unioned (the
 * account's first, capped); credits and start year only where the account has
 * none. Only fields that actually change are present.
 */
export function profileGapFill(account: CarryProfile, guest: CarryProfile): ProfileCarryPatch {
  const patch: ProfileCarryPatch = {};
  const favorites = unionCapped(account.favoriteCourseIds, guest.favoriteCourseIds, MAX_FAVORITES);
  if (favorites.length > account.favoriteCourseIds.length) patch.favoriteCourseIds = favorites;
  const pins = unionCapped(account.pinnedCourseIds, guest.pinnedCourseIds, MAX_PINS);
  if (pins.length > account.pinnedCourseIds.length) patch.pinnedCourseIds = pins;
  if (account.creditProfile.length === 0 && guest.creditProfile.length > 0) {
    patch.creditProfile = guest.creditProfile;
  }
  if (account.enteringYear === null && guest.enteringYear !== null) {
    patch.enteringYear = guest.enteringYear;
  }
  return patch;
}
