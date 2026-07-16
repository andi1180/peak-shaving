import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

// Alle Farben zeigen auf CSS-Variablen aus app/globals.css (DESIGN.md ist die Wahrheit).
// „Marke"-Namen für unsere Semantik, „Bridge"-Namen für die shadcn/ui-Konvention.
// Gleiches Muster wie apps/website (Kalkulator) — ein Produkt, ein Token-Modell.
// BEWUSST KEINE Gradienten-Utilities/Keyframes (Pflichtenheft §7.2: „Keine Gradienten").
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // — Marke / DESIGN.md —
        navy: {
          DEFAULT: 'var(--color-navy)',
          hover: 'var(--color-navy-hover)',
          foreground: 'var(--color-on-navy)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          hover: 'var(--color-accent-hover)',
          subtle: 'var(--color-accent-subtle)',
          border: 'var(--color-accent-border)',
          foreground: 'var(--color-on-accent)',
        },
        node: 'var(--color-node)',
        ink: 'var(--color-ink)',
        text: {
          DEFAULT: 'var(--color-text)',
          muted: 'var(--color-text-muted)',
        },
        surface: {
          DEFAULT: 'var(--color-surface)',
          alt: 'var(--color-surface-alt)',
          sunken: 'var(--color-surface-sunken)',
        },
        line: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
        },
        // Semantik: Textfarbe + eigene getönte Fläche. KEIN /alpha auf diesen
        // Tokens — Tailwind verwirft das bei var()-Hex-Farben still (s. globals.css).
        positive: {
          DEFAULT: 'var(--color-positive)',
          subtle: 'var(--color-positive-subtle)',
        },
        negative: {
          DEFAULT: 'var(--color-negative)',
          subtle: 'var(--color-negative-subtle)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          subtle: 'var(--color-warning-subtle)',
        },

        // — shadcn/ui-Bridge (mappt auf dieselben DESIGN-Tokens) —
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        border: 'var(--border-ui)',
        input: 'var(--input)',
        ring: 'var(--ring)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        // Werte kommen von next/font (app/layout.tsx).
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        // Optionale Display-Alternative für Überschriften — Entscheidung offen
        // (DESIGN.md „Offene Auswahlpunkte"). Nur über `font-display` nutzbar,
        // NICHT global gesetzt: Inter-only bleibt der Default.
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      fontSize: {
        // Typo-Skala aus DESIGN.md: [Größe, { line-height, letter-spacing, weight }]
        caption: ['0.8125rem', { lineHeight: '1.15rem' }], // 13px
        label: ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.08em', fontWeight: '600' }], // 12px Eyebrow
        small: ['0.875rem', { lineHeight: '1.375rem' }], // 14px
        body: ['1rem', { lineHeight: '1.65rem' }], // 16px
        lead: ['1.125rem', { lineHeight: '1.85rem' }], // 18px
        h4: ['1.125rem', { lineHeight: '1.6rem', letterSpacing: '-0.005em', fontWeight: '600' }],
        h3: ['1.375rem', { lineHeight: '1.85rem', letterSpacing: '-0.01em', fontWeight: '600' }],
        h2: ['1.875rem', { lineHeight: '2.35rem', letterSpacing: '-0.015em', fontWeight: '600' }],
        h1: ['2.5rem', { lineHeight: '2.9rem', letterSpacing: '-0.022em', fontWeight: '650' }],
      },
      maxWidth: {
        // Fließtext bei ~65–75 Zeichen halten (Lesbarkeit, DESIGN.md).
        prose: '68ch',
        container: '72rem', // 1152px – Seitenbreite
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
} satisfies Config
