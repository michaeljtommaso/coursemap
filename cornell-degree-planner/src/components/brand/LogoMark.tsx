/**
 * LogoMark — the Coursemap brand mark (claude-design-2026-07-11, logo
 * option 4: "converging web"). Three course blocks flow along curved tracks
 * into the emerald "next course" block; a dashed emerald overlay animates
 * left-to-right along each track (static under prefers-reduced-motion).
 *
 * Recreated first-party from the winning prototype's structure — colors come
 * from the app's tokens, never hardcoded hex, so light/dark theming is free:
 *   tracks        → --border-strong   done blocks → --text
 *   fading block  → --text-4          flow + target block → --complete
 *
 * Self-contained: keyframes + reduced-motion handling live in the component's
 * own <style> tag (cm-lm-* prefix; duplicate <style> instances are inert).
 */

const MARK_VIEWBOX_W = 52;
const MARK_VIEWBOX_H = 40;

interface LogoMarkProps {
  /** Mark height in px. Topbar ~20–24; hero larger (e.g. 44–56). */
  size?: number;
  /** Render the "Coursemap" wordmark next to the mark. */
  wordmark?: boolean;
  /** Stack the wordmark under the mark (hero treatment) instead of beside it. */
  stacked?: boolean;
  className?: string;
}

export function LogoMark({
  size = 24,
  wordmark = false,
  stacked = false,
  className,
}: LogoMarkProps) {
  const width = (size * MARK_VIEWBOX_W) / MARK_VIEWBOX_H;
  // Row wordmark sits optically on the mark's midline; stacked (hero) runs larger.
  const wordmarkSize = Math.round(size * (stacked ? 0.75 : 0.82));

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        flexDirection: stacked ? "column" : "row",
        alignItems: "center",
        gap: Math.round(size * (stacked ? 0.35 : 0.4)),
      }}
    >
      <style>{`
        .cm-lm-flow {
          stroke-dasharray: 4 11;
          animation: cm-lm-flow 1.5s linear infinite;
        }
        @keyframes cm-lm-flow { to { stroke-dashoffset: -15; } }
        @media (prefers-reduced-motion: reduce) {
          .cm-lm-flow { animation: none; opacity: 0; }
        }
        /* Prototype's dark-theme variant thickens strokes for contrast. */
        .dark .cm-lm-track, .dark .cm-lm-flow { stroke-width: 2.2; }
      `}</style>
      <svg
        width={width}
        height={size}
        viewBox={`0 0 ${MARK_VIEWBOX_W} ${MARK_VIEWBOX_H}`}
        fill="none"
        {...(wordmark
          ? { "aria-hidden": true }
          : { role: "img", "aria-label": "Coursemap" })}
      >
        {/* Static tracks */}
        <path className="cm-lm-track" d="M10 8 C26 8 30 17 42 19" stroke="var(--border-strong)" strokeWidth="1.8" fill="none" />
        <path className="cm-lm-track" d="M10 20 L42 20" stroke="var(--border-strong)" strokeWidth="1.8" fill="none" />
        <path className="cm-lm-track" d="M10 32 C26 32 30 23 42 21" stroke="var(--border-strong)" strokeWidth="1.8" fill="none" />
        {/* Animated emerald flow overlays (staggered) */}
        <path className="cm-lm-flow" d="M10 8 C26 8 30 17 42 19" stroke="var(--complete)" strokeWidth="1.8" fill="none" />
        <path className="cm-lm-flow" d="M10 20 L42 20" stroke="var(--complete)" strokeWidth="1.8" fill="none" style={{ animationDelay: "-.5s" }} />
        <path className="cm-lm-flow" d="M10 32 C26 32 30 23 42 21" stroke="var(--complete)" strokeWidth="1.8" fill="none" style={{ animationDelay: "-1s" }} />
        {/* Course blocks → emerald "next course" block */}
        <rect x="1" y="3" width="10" height="10" rx="3" fill="var(--text)" />
        <rect x="1" y="15" width="10" height="10" rx="3" fill="var(--text)" />
        <rect x="1" y="27" width="10" height="10" rx="3" fill="var(--text-4)" />
        <rect x="40" y="14" width="12" height="12" rx="4" fill="var(--complete)" />
      </svg>
      {wordmark && (
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontWeight: 800,
            fontSize: wordmarkSize,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            color: "var(--text)",
          }}
        >
          Coursemap
        </span>
      )}
    </span>
  );
}
