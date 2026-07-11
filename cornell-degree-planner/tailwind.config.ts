import type { Config } from "tailwindcss";

/**
 * Tailwind bridge — Phase 1 (spec 003 §2).
 *
 * Semantic token colors map to the CSS custom properties defined in
 * src/styles/tokens.css. Components write semantic classes (bg-surface,
 * text-ink-2, border-line, bg-complete-tint) instead of raw palette classes.
 *
 * The stock shadcn HSL variables (--background, --card, --muted, --border,
 * --ring, etc.) are kept alive in globals.css as a TEMPORARY aliasing bridge
 * pointing at these same tokens, so button.tsx / card.tsx keep rendering while
 * call sites migrate. Remove the bridge when no bg-card-style class remains.
 */
const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // --- Scholar's Vellum semantic tokens ---
        canvas: "var(--canvas)",
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
        },
        ink: {
          DEFAULT: "var(--text)",
          2: "var(--text-2)",
          3: "var(--text-3)",
          4: "var(--text-4)",
        },
        line: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
          faint: "var(--border-faint)",
        },
        complete: {
          DEFAULT: "var(--complete)",
          text: "var(--complete-text)",
          tint: "var(--complete-tint)",
        },
        available: {
          DEFAULT: "var(--available)",
          text: "var(--available-text)",
          tint: "var(--available-tint)",
        },
        waived: {
          DEFAULT: "var(--waived)",
          text: "var(--waived-text)",
          tint: "var(--waived-tint)",
        },
        drop: {
          DEFAULT: "var(--drop)",
          text: "var(--drop-text)",
          tint: "var(--drop-tint)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          text: "var(--destructive-text)",
          tint: "var(--destructive-tint)",
          // shadcn expects destructive-foreground; keep it mapped for button.tsx
          foreground: "var(--surface)",
        },

        // --- category accents (spec 006 §D1) — base + faint tint per category ---
        cat: {
          math: { DEFAULT: "var(--cat-math)", tint: "var(--cat-math-tint)" },
          science: { DEFAULT: "var(--cat-science)", tint: "var(--cat-science-tint)" },
          core: { DEFAULT: "var(--cat-core)", tint: "var(--cat-core-tint)" },
          liberal: { DEFAULT: "var(--cat-liberal)", tint: "var(--cat-liberal-tint)" },
          elective: { DEFAULT: "var(--cat-elective)", tint: "var(--cat-elective-tint)" },
          fws: { DEFAULT: "var(--cat-fws)", tint: "var(--cat-fws-tint)" },
          pe: { DEFAULT: "var(--cat-pe)", tint: "var(--cat-pe-tint)" },
        },

        // --- shadcn HSL bridge (TEMPORARY — see globals.css) ---
        border: "hsl(var(--border-hsl))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
      },
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "var(--r-sm)",
        md: "var(--r-md)",
        lg: "var(--r-lg)",
        xl: "var(--r-xl)",
        "2xl": "var(--r-2xl)",
        pill: "var(--r-pill)",
      },
      boxShadow: {
        md: "var(--shadow-md)",
        xl: "var(--shadow-xl)",
      },
      spacing: {
        "sp-xs": "var(--sp-xs)",
        "sp-sm": "var(--sp-sm)",
        "sp-md": "var(--sp-md)",
        "sp-lg": "var(--sp-lg)",
        "sp-xl": "var(--sp-xl)",
      },
    },
  },
  plugins: [],
};

export default config;
