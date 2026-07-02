import type { Config } from 'tailwindcss'

// Theme an die CSS-Variablen aus app/globals.css gebunden (DESIGN.md).
// Akzent NICHT hartkodiert → White-Label-Partner überschreiben nur --color-accent*.
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'var(--color-accent)',
          hover: 'var(--color-accent-hover)',
          subtle: 'var(--color-accent-subtle)',
        },
        ink: 'var(--color-ink)',
        text: {
          DEFAULT: 'var(--color-text)',
          muted: 'var(--color-text-muted)',
        },
        surface: {
          DEFAULT: 'var(--color-surface)',
          alt: 'var(--color-surface-alt)',
        },
        border: 'var(--color-border)',
        // Semantisch — nur für Zahlen mit Bedeutung (DESIGN.md), nicht als Dekor.
        positive: 'var(--color-positive)',
        negative: 'var(--color-negative)',
        warning: 'var(--color-warning)',
      },
      fontFamily: {
        // Werte kommen von next/font (app/layout.tsx) über --font-sans / --font-mono.
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
