import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * CALLOUT — der hervorgehobene Kasten im Fließtext (§6.5 „Callout mit den
 * Kern-Eckdaten", §10.1 Rich-MDX-Bausteine).
 *
 * DESIGN.md-konform, und das ist hier eine echte Einschränkung, keine Floskel:
 *
 *   1. KEINE ICONS. Weder Emoji (§7.3 verbietet sie ausdrücklich) noch ein
 *      lucide-Symbol. Ein Callout ist an seiner Fläche und seiner Überschrift
 *      erkennbar; ein ⚠️ daneben wäre genau der verspielte Ton, den §7.3
 *      abstellt — und ein Icon, das nur wiederholt, was die Überschrift sagt,
 *      ist Dekor.
 *   2. SEMANTISCHE FARBEN NUR FÜR BEDEUTUNG. `warning` (Bernstein) und
 *      `negative` (Rot) sind in DESIGN.md für Zahlen/Sachverhalte MIT
 *      Signalwirkung reserviert. Deshalb gibt es hier bewusst NUR drei Varianten
 *      und keine bunte Auswahl:
 *        `info`    – neutraler Kasten (Sunken-Fläche). Der Normalfall.
 *        `accent`  – die Kern-Eckdaten. Teal = „das ist der Punkt".
 *        `warning` – ein echter Vorbehalt (z. B. „das ist ein Entwurf, keine
 *                    geltende Rechtslage"). NICHT für Betonung.
 *      Kein `success`/`tip` — es gäbe keinen Sachverhalt, der ihn bräuchte, und
 *      Grün ist für Ersparnis reserviert.
 *   3. KEINE `/alpha`-Flächen. Die Tokens sind `var(--x)`-Hex — `bg-warning/10`
 *      schlägt STILL fehl (DESIGN.md „Kein /alpha auf Token-Farben"). Deshalb
 *      die `*-subtle`-Tokens.
 *
 * `title` ist optional und wird als `<p>` gesetzt, NICHT als Überschrift: Ein
 * Callout mitten im Text darf die H2/H3-Hierarchie des Artikels nicht
 * durchbrechen (§6.4 „saubere Heading-Hierarchie") — ein `<h4>` im Kasten würde
 * in einer Gliederungsansicht wie ein Abschnitt aussehen, den es nicht gibt.
 */
const calloutVariants = cva('rounded-lg border p-5 sm:p-6', {
  variants: {
    variant: {
      info: 'border-line bg-surface-sunken',
      accent: 'border-accent-border bg-accent-subtle',
      warning: 'border-warning-border bg-warning-subtle',
    },
  },
  defaultVariants: { variant: 'info' },
})

const titleTone: Record<string, string> = {
  info: 'text-ink',
  accent: 'text-ink',
  // Der Bernstein-Ton trägt hier die Bedeutung („Vorbehalt") — er steht auf
  // warning-subtle mit 4,84:1 (DESIGN.md, gemessen), also AA.
  warning: 'text-warning',
}

export type CalloutProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof calloutVariants> & { title?: string }

export function Callout({ className, variant, title, children, ...props }: CalloutProps) {
  const tone = titleTone[variant ?? 'info'] ?? 'text-ink'

  return (
    <div className={cn(calloutVariants({ variant }), className)} {...props}>
      {title ? <p className={cn('text-h4', tone)}>{title}</p> : null}
      {/*
       * `[&>*+*]:mt-3`: Der Callout bekommt in MDX ganze Absätze und Listen
       * hereingereicht. Die Prose-Map (mdx-components.tsx) setzt deren Abstände
       * über den Fließtext-Rhythmus — im Kasten wäre der zu groß. Abstand aus dem
       * Layout, nicht aus Einzel-Margins (DESIGN.md).
       */}
      <div className={cn('text-body text-text [&>*+*]:mt-3', title && 'mt-3')}>{children}</div>
    </div>
  )
}
