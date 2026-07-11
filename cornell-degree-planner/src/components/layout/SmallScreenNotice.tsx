import { LogoMark } from "@/components/brand/LogoMark";

/**
 * SmallScreenNotice (spec 004 §7) — honest desktop-only posture for the beta.
 * Rendered via CSS only (lg:hidden), so no matchMedia listeners are needed;
 * the app shell stays mounted behind it and appears the moment the viewport
 * can hold the roadmap.
 */
export function SmallScreenNotice() {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-canvas px-8 text-center lg:hidden">
      <LogoMark size={32} />
      <div className="flex flex-col gap-1.5">
        <p className="t-headline">Your roadmap deserves a bigger canvas.</p>
        <p className="t-body max-w-xs text-ink-2">
          The planner is built for a laptop right now — four years of courses
          don&apos;t fit on a phone yet. Open this page on a bigger screen and
          your plan will be waiting.
        </p>
      </div>
      <p className="t-meta text-ink-4">A phone-friendly view is on the roadmap. Fittingly.</p>
    </div>
  );
}
