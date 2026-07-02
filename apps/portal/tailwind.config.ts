import type { Config } from 'tailwindcss'

// Grundgerüst — das ruhige, desktop-first Report/Portal-Theme (DESIGN.md, §6.1)
// wird ausgebaut, wenn das Portal (M4) drankommt. Vorerst nur Font-Anbindung.
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
