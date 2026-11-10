import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Geist", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "Geist Mono", "ui-monospace", "monospace"],
      },
      colors: {
        bg: "var(--bg)", subtle: "var(--bg-subtle)", muted: "var(--bg-muted)",
        line: "var(--line)", strong: "var(--line-strong)",
        fg: "var(--fg)", fg2: "var(--fg-2)", fg3: "var(--fg-3)",
        danger: "var(--danger)", "danger-bg": "var(--danger-bg)", "danger-line": "var(--danger-line)",
        ok: "var(--ok)", "ok-bg": "var(--ok-bg)", warn: "var(--warn)", "warn-bg": "var(--warn-bg)", info: "var(--info)",
      },
      borderColor: { DEFAULT: "var(--line)" },
    },
  },
  plugins: [],
} satisfies Config;
