import * as React from 'react'
import { useTranslations } from 'next-intl'
import { BatteryCharging, Factory, Sun, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Container, Eyebrow, Section } from '@/components/ui/layout'

/**
 * Energiefluss-Leiste (Sonne · Batterie · Verbraucher · Netz) — NATIV im
 * coolin.at-Design nachgebaut (kein Bild, kein iframe).
 *
 * Vorlage: `apps/website/components/marketing/energy-flow.tsx`. Bewusst RUHIGER
 * als das Original, weil hier andere Regeln gelten:
 * - Das Original animiert einen Punkt über die Leitung und legt einen
 *   `shadow-[0_0_8px_…]`-Glow unter die Knoten. Beides ist hier raus: Glow ist
 *   der Sache nach ein Verlauf (§7.2 „keine Gradienten"), und die Leiste ist
 *   Erklärgrafik, kein Blickfang.
 * - Das Original färbt ALLE vier Knoten im Akzent. Das wäre hier vier Mal
 *   Teal auf einer Seite, die den Akzent für den CTA reserviert
 *   (DESIGN.md: „ein Akzent, der überall steht, ist kein Akzent mehr").
 *
 * DESHALB trägt genau EIN Knoten den Akzent: die Batterie. Das ist keine
 * Kosmetik, sondern die Aussage der Seite — die Batterie ist das Einzige, was
 * der Kalkulator dimensioniert; die anderen drei Ströme sind gegeben. Farbe
 * trägt hier also Information (DESIGN.md), nicht Dekor.
 *
 * KEIN Signature-Motiv: Die Leiste borgt sich NICHT die Netzlinien-mit-Knoten
 * der Marke (`components/brand/signature.tsx`). Deren kanonischer und einziger
 * Ort ist der Footer — der läuft auf dieser Seite bereits mit, ein zweiter
 * Auftritt wäre ein Regelbruch (DESIGN.md „max. 1× pro Seitenansicht").
 */
type Node = { key: string; icon: LucideIcon; accent?: boolean }

const NODES: Node[] = [
  { key: 'nodeSun', icon: Sun },
  { key: 'nodeBattery', icon: BatteryCharging, accent: true },
  { key: 'nodeLoad', icon: Factory },
  { key: 'nodeGrid', icon: Zap },
]

/** Durchmesser der Knoten-Kreise. Die Leitung MUSS dieselbe Höhe bekommen — s. `Wire`. */
const NODE_SIZE = 'h-14 w-14'

/**
 * Die Verbindung zwischen zwei Knoten. Mobil senkrecht (die Leiste stapelt),
 * ab `sm` waagrecht und dehnbar — dieselbe Linie, nur gedreht.
 *
 * WARUM ein Wrapper statt einer nackten Linie mit `self-center`: `self-center`
 * zentriert in der ZEILE, und die Zeile ist so hoch wie Kreis + Abstand + Label.
 * Die Linie landete dadurch gemessene 14,2 px UNTER der Kreismitte und verband
 * die Knoten sichtbar nicht, sondern schwebte darunter.
 *
 * Deshalb: der Wrapper ist `sm:self-start` und exakt so hoch wie ein Knoten
 * (`h-14`, s. NODE_SIZE) und zentriert die Linie in SICH — damit sitzt sie
 * zwangsläufig auf der Kreismitte. Wer NODE_SIZE ändert, muss die `sm:h-14`
 * hier mitziehen; die beiden Höhen sind aneinander gebunden.
 */
function Wire() {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-px shrink-0 items-center justify-center sm:h-14 sm:w-auto sm:flex-1 sm:self-start"
    >
      <span className="h-full w-px bg-line-strong sm:h-px sm:w-full" />
    </span>
  )
}

export function EnergyFlow() {
  const t = useTranslations('PeakShavingCalculator.EnergyFlow')

  /*
   * tone default (weiß): Gegenstück zum `alt` von HowItWorks davor und der
   * Report-Galerie danach — der Grund-Wechsel der Produktseite bleibt so
   * erhalten, nachdem die Galerie ans Seitenende gezogen ist (Prompt 9).
   */
  return (
    <Section>
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>

        {/*
         * `role="img"` + `aria-label`: Für Screenreader ist die Leiste EINE
         * Grafik mit einer Textalternative — nicht vier lose Wörter ohne den
         * Zusammenhang „von … über … zum …", der die eigentliche Aussage ist.
         * Dieselbe Lösung wie in der Kalkulator-App.
         */}
        <div
          role="img"
          aria-label={t('ariaLabel')}
          className="mt-10 flex flex-col items-center gap-0 rounded-lg border border-line bg-surface p-6 sm:flex-row sm:justify-between sm:gap-4 sm:p-8"
        >
          {NODES.map((node, i) => (
            <React.Fragment key={node.key}>
              <span className="flex flex-col items-center gap-2.5">
                <span
                  className={cn(
                    'flex items-center justify-center rounded-full border',
                    NODE_SIZE,
                    node.accent
                      ? 'border-accent-border bg-accent-subtle text-accent'
                      : 'border-line-strong bg-surface-alt text-text-muted',
                  )}
                >
                  <node.icon className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
                </span>
                <span
                  className={cn(
                    'text-caption',
                    node.accent ? 'font-semibold text-ink' : 'text-text-muted',
                  )}
                >
                  {t(node.key)}
                </span>
              </span>
              {i < NODES.length - 1 ? <Wire /> : null}
            </React.Fragment>
          ))}
        </div>

        <p className="mt-6 max-w-prose text-small text-text-muted">{t('note')}</p>
      </Container>
    </Section>
  )
}
