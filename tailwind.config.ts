import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        ink: { 950: "#05070d", 900: "#0a0e18", 850: "#0e1320", 800: "#131a2a", 700: "#1c2538", 600: "#2a3550" },
        vital: { DEFAULT: "#2ef2b0", dim: "#1aa77a" },
        alarm: { DEFAULT: "#ff3b4e", dim: "#a51d2b" },
        amberx: { DEFAULT: "#ffb547" },
        cyanx: { DEFAULT: "#5cc8ff" },
      },
    },
  },
  plugins: [],
} satisfies Config;
