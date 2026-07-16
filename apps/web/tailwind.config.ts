import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

// Scaffold-Stufe: BEWUSST ohne Farb-Tokens / Theme — Design-System kommt in
// einem späteren Schritt (eigene DESIGN.md, Pflichtenheft §7). Hier nur das
// technische Minimum: Content-Pfade, Inter als Basis-Font (Wert via next/font
// über --font-sans) und der shadcn/ui-kompatible animate-Plugin.
// `tabular-nums` ist eine Tailwind-Core-Utility und steht ohne Konfiguration bereit.
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [animate],
} satisfies Config
