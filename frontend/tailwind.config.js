/** @type {import('tailwindcss').Config} */
module.exports = {
  // Dark "Command Deck" theme is scoped to the workspace and admin shells:
  // a `.deck` wrapper turns on every `dark:` variant beneath it, so the
  // landing, auth and plan pages keep their light look untouched. The
  // workspace's white-background switch sets <html data-deck-theme="light">,
  // which turns the deck off; `.deck-fixed` (admin) stays dark regardless.
  darkMode: [
    "variant",
    "&:where(html:not([data-deck-theme=light]) .deck, html:not([data-deck-theme=light]) .deck *, .deck-fixed, .deck-fixed *)",
  ],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Single accent family for the whole product: Meta blue.
        // Colours read CSS variables so Admin > Landing / Workspace can
        // recolour a page; the fallbacks are the built-in values.
        meta: {
          50: "rgb(var(--meta-50-rgb, 231 240 255) / <alpha-value>)",
          100: "rgb(var(--meta-100-rgb, 204 224 255) / <alpha-value>)",
          200: "rgb(var(--meta-200-rgb, 153 194 255) / <alpha-value>)",
          300: "rgb(var(--meta-300-rgb, 102 163 255) / <alpha-value>)",
          400: "rgb(var(--meta-400-rgb, 51 133 255) / <alpha-value>)",
          500: "rgb(var(--meta-500-rgb, 8 102 255) / <alpha-value>)", // Meta / Facebook primary blue
          600: "rgb(var(--meta-600-rgb, 0 82 204) / <alpha-value>)",
          700: "rgb(var(--meta-700-rgb, 0 61 153) / <alpha-value>)",
          800: "rgb(var(--meta-800-rgb, 0 41 102) / <alpha-value>)",
          900: "rgb(var(--meta-900-rgb, 0 20 51) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink-rgb, 0 0 0) / <alpha-value>)",
          muted: "rgb(var(--ink-muted-rgb, 75 79 86) / <alpha-value>)",
          subtle: "rgb(var(--ink-subtle-rgb, 101 103 107) / <alpha-value>)",
          faint: "rgb(var(--ink-faint-rgb, 138 141 145) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "Times New Roman", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        "meta-sm": "0 0 10px -2px rgb(8 102 255 / 0.35)",
        meta: "0 0 22px -4px rgb(8 102 255 / 0.45), 0 8px 24px -12px rgb(8 102 255 / 0.4)",
        "meta-lg": "0 0 36px -6px rgb(8 102 255 / 0.5), 0 20px 48px -20px rgb(8 102 255 / 0.45)",
        card: "0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -16px rgb(0 0 0 / 0.16)",
        lifted: "0 2px 4px rgb(0 0 0 / 0.05), 0 18px 40px -20px rgb(0 0 0 / 0.22)",
      },
      keyframes: {
        "neon-sweep": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(300%)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
        "float-slow": {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "50%": { transform: "translate3d(0, -14px, 0)" },
        },
        "radar-ping": {
          "0%": { transform: "scale(0.3)", opacity: "1" },
          "18%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        eq: {
          "0%, 100%": { transform: "scaleY(1)" },
          "50%": { transform: "scaleY(0.45)" },
        },
        drift: {
          "0%": { transform: "translate3d(0, 0, 0)", opacity: "0" },
          "20%": { opacity: "1" },
          "100%": { transform: "translate3d(14px, 18px, 0)", opacity: "0" },
        },
        "logo-float": {
          "0%, 100%": { transform: "translateY(0) rotate(-3deg)" },
          "50%": { transform: "translateY(-3px) rotate(3deg)" },
        },
        shine: {
          "0%": { backgroundPosition: "100% 50%" },
          "100%": { backgroundPosition: "-150% 50%" },
        },
        "render-scan": {
          "0%": { backgroundPosition: "140% 50%" },
          "100%": { backgroundPosition: "-160% 50%" },
        },
        "render-pulse": {
          "0%, 100%": { opacity: "0.72", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.04)" },
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-100%)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translate3d(0, 12px, 0)" },
          to: { opacity: "1", transform: "translate3d(0, 0, 0)" },
        },
      },
      animation: {
        "neon-sweep": "neon-sweep 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "pulse-glow": "pulse-glow 2.8s ease-in-out infinite",
        "float-slow": "float-slow 9s ease-in-out infinite",
        "radar-ping": "radar-ping 6s linear infinite",
        eq: "eq 1.1s ease-in-out infinite",
        drift: "drift 3.5s linear infinite",
        "logo-float": "logo-float 4s ease-in-out infinite",
        shine: "shine 5s linear infinite",
        "render-scan": "render-scan 1.6s ease-in-out infinite",
        "render-pulse": "render-pulse 1.8s ease-in-out infinite",
        marquee: "marquee 28s linear infinite",
        "fade-up": "fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
