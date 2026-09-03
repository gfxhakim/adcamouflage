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
        // Single accent family for the whole product: Meta blue.
        meta: {
          50: "#E7F0FF",
          100: "#CCE0FF",
          200: "#99C2FF",
          300: "#66A3FF",
          400: "#3385FF",
          500: "#0866FF", // Meta / Facebook primary blue
          600: "#0052CC",
          700: "#003D99",
          800: "#002966",
          900: "#001433",
        },
        ink: {
          DEFAULT: "#000000",
          muted: "#4B4F56",
          subtle: "#65676B",
          faint: "#8A8D91",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
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
        "fade-up": {
          from: { opacity: "0", transform: "translate3d(0, 12px, 0)" },
          to: { opacity: "1", transform: "translate3d(0, 0, 0)" },
        },
      },
      animation: {
        "neon-sweep": "neon-sweep 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "pulse-glow": "pulse-glow 2.8s ease-in-out infinite",
        "float-slow": "float-slow 9s ease-in-out infinite",
        "fade-up": "fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
