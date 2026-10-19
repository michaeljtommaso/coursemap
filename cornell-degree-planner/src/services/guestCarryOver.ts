import { createPlan, listPlans, readPlansForCarryOver } from "@/services/plans";
import { applyCarryOverToProfile, fetchProfile, type Profile } from "@/services/profile";
import {
  activePlanAfterCarry,
  planCopies,
  profileGapFill,
  type CarryCopy,
  type CarryPlan,
  type CarryProfile,
} from "@/lib/guestCarryOver";

/**
 * Guest carry-over (spec 018): when a guest signs into a Google account that
 * already exists, copy their edited plans into it and fill the account's
 * profile gaps. The guest's data is read BEFORE the session switches (rules let
 * only the owner read it); the writes happen after, as the account. Composes
 * the plans and profile services; decisions live in lib/guestCarryOver.
 *
 * Copies that fail are stashed in this browser under the account's uid and
 * retried on the next boot as that account (D7). The guest's own docs are never
 * deleted.
 */

export type GuestData = { plans: CarryPlan[]; profile: CarryProfile | null };

/** What a carry-over wrote, and what is left for a retry. */
export type CarryResult = { copied: number; pending: number };

/** Leftover work for a retry: copies not yet written (ids fixed, so a retry is
 *  an idempotent overwrite) and a guest profile not yet merged. */
type CarryWork = {
  copies: CarryCopy[];
  guestProfile: CarryProfile | null;
  activePlanId: string | null;
};

const STASH_PREFIX = "cornell-planner-carryover:";

function toCarryProfile(p: Profile): CarryProfile {
  return {
    activePlanId: p.activePlanId,
    favoriteCourseIds: p.favoriteCourseIds,
    pinnedCourseIds: p.pinnedCourseIds,
    creditProfile: p.creditProfile,
    enteringYear: p.prefs.enteringYear ?? null,
  };
}

/** Read a guest's plans and profile. Call while still signed in as the guest. */
export async function readGuestData(guestUid: string): Promise<GuestData> {
  const [plans, profile] = await Promise.all([
    readPlansForCarryOver(guestUid),
    fetchProfile(guestUid),
  ]);
  return { plans, profile: profile ? toCarryProfile(profile) : null };
}

/** Write what it can; return the leftover work, or null when all of it landed. */
async function applyWork(uid: string, work: CarryWork): Promise<{ copied: number; leftover: CarryWork | null }> {
  const failed: CarryCopy[] = [];
  let copied = 0;
  for (const c of work.copies) {
    try {
      await createPlan(uid, c.newId, c.input);
      copied++;
    } catch (err) {
      console.warn("[carry-over] plan copy failed", c.fromId, err);
      failed.push(c);
    }
  }

  let guestProfile = work.guestProfile;
  const activeLanded =
    work.activePlanId !== null && !failed.some((c) => c.newId === work.activePlanId);
  const activePlanId = activeLanded ? work.activePlanId : null;
  if (guestProfile || activePlanId) {
    try {
      const account = await fetchProfile(uid);
      const patch =
        guestProfile && account ? profileGapFill(toCarryProfile(account), guestProfile) : {};
      await applyCarryOverToProfile(uid, patch, activePlanId);
      guestProfile = null;
    } catch (err) {
      console.warn("[carry-over] profile merge failed", err);
    }
  }

  const leftover: CarryWork | null =
    failed.length > 0 || guestProfile
      ? {
          copies: failed,
          guestProfile,
          // A failed active copy is still the plan to show once it lands.
          activePlanId: activeLanded ? null : work.activePlanId,
        }
      : null;
  return { copied, leftover };
}

function stashKey(uid: string) {
  return STASH_PREFIX + uid;
}

function writeStash(uid: string, work: CarryWork | null) {
  try {
    if (work) localStorage.setItem(stashKey(uid), JSON.stringify(work));
    else localStorage.removeItem(stashKey(uid));
  } catch (err) {
    console.warn("[carry-over] could not save the retry for later", err);
  }
}

function readStash(uid: string): CarryWork | null {
  try {
    const raw = localStorage.getItem(stashKey(uid));
    if (!raw) return null;
    const work = JSON.parse(raw) as CarryWork;
    return Array.isArray(work?.copies) ? work : null;
  } catch {
    return null;
  }
}

/**
 * Copy a guest's edited plans into `uid` (the account just signed into) and
 * fill its profile gaps. Never throws: failures are stashed for a retry and
 * reported as `pending`.
 */
export async function carryGuestInto(uid: string, guest: GuestData): Promise<CarryResult> {
  try {
    const existing = await listPlans(uid);
    const copies = planCopies(
      guest.plans,
      existing.map((p) => p.name),
      () => crypto.randomUUID()
    );
    const work: CarryWork = {
      copies,
      guestProfile: guest.profile,
      activePlanId: activePlanAfterCarry(guest.profile?.activePlanId ?? null, copies),
    };
    const { copied, leftover } = await applyWork(uid, work);
    writeStash(uid, leftover);
    return { copied, pending: leftover?.copies.length ?? 0 };
  } catch (err) {
    // Couldn't even list the account's plans: keep everything for a retry.
    console.warn("[carry-over] failed; saved for a retry", err);
    const copies = planCopies(guest.plans, [], () => crypto.randomUUID());
    writeStash(uid, {
      copies,
      guestProfile: guest.profile,
      activePlanId: activePlanAfterCarry(guest.profile?.activePlanId ?? null, copies),
    });
    return { copied: 0, pending: copies.length };
  }
}

/** Retry a stashed carry-over for `uid`, if this browser has one. Never throws. */
export async function retryStashedCarryOver(uid: string): Promise<CarryResult | null> {
  const work = readStash(uid);
  if (!work) return null;
  try {
    const { copied, leftover } = await applyWork(uid, work);
    writeStash(uid, leftover);
    return { copied, pending: leftover?.copies.length ?? 0 };
  } catch (err) {
    console.warn("[carry-over] retry failed; will try again next time", err);
    return { copied: 0, pending: work.copies.length };
  }
}
