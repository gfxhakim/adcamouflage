/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        neon: {
          cyan: "#22d3ee",
          blue: "#38bdf8",
          violet: "#a855f7",
          pink: "#ec4899",
          lime: "#a3e635",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        "neon-sm": "0 0 12px -2px rgb(34 211 238 / 0.45)",
        neon: "0 0 24px -4px rgb(34 211 238 / 0.55), 0 0 48px -12px rgb(168 85 247 / 0.45)",
        "neon-lg": "0 0 40px -6px rgb(34 211 238 / 0.6), 0 0 80px -16px rgb(236 72 153 / 0.5)",
        panel: "0 24px 64px -32px rgb(0 0 0 / 0.9)",
      },
      backgroundImage: {
        "grid-fade":
          "linear-gradient(to bottom, rgb(2 6 23 / 0), rgb(2 6 23 / 0.85) 70%, rgb(2 6 23) 100%)",
      },
      keyframes: {
        "neon-sweep": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(300%)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.45" },
          "50%": { opacity: "1" },
        },
        "float-slow": {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "50%": { transform: "translate3d(0, -14px, 0)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translate3d(0, 12px, 0)" },
          to: { opacity: "1", transform: "translate3d(0, 0, 0)" },
        },
        "scan-line": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(1200%)" },
        },
      },
      animation: {
        "neon-sweep": "neon-sweep 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "pulse-glow": "pulse-glow 2.8s ease-in-out infinite",
        "float-slow": "float-slow 9s ease-in-out infinite",
        "fade-up": "fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "scan-line": "scan-line 7s linear infinite",
      },
    },
  },
  plugins: [],
};
