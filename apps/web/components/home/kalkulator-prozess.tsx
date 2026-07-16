import * as React from 'react'
import { useTranslations } from 'next-intl'
import { ArrowRight, BatteryCharging, Cpu, FileUp, TrendingDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Num } from '@/components/ui/layout'

/*
 * GRAFIK 2 (Prompt 14) — 4-Schritt-Prozessdiagramm des Peak-Shaving Kalkulators
 * (Lastgang hochladen → Analyse → Speicherempfehlung → Ersparnis).
 *
 * PLATZIERUNG, bewusst „ergänzt" statt „ersetzt": Die bestehende Vorgehen-Sektion
 * (`components/home/vorgehen.tsx`, „So arbeiten wir") beschreibt den ALLGEMEINEN
 * Beratungsprozess (Potenzialanalyse → Business Cases → Partner & Umsetzung →
 * Tracking & Reporting) — eine andere, weiterhin gültige Aussage. Dieses Diagramm
 * ist NICHT dessen Ersatz, sondern ein eigener, klar abgesetzter Block direkt
 * darunter: der konkrete Ablauf des Flaggschiff-Werkzeugs, an der Stelle der
 * Seite, die unmittelbar vor der Kontakt-CTA liegt.
 *
 * INHALT NICHT ERFUNDEN: Die vier Schritte sind die verkürzte Fassung derselben
 * vier Schritte, die `components/peak-shaving/how-it-works.tsx`
 * (`PeakShavingCalculator.HowItWorks`) auf `/peak-shaving/kalkulator` ausführlich
 * zeigt — dort real 4 App-Schritte (Upload/Tarif & Ziel/Analyse/Ergebnis), hier
 * auf die von Prompt 14 vorgegebene Kurzfassung verdichtet. Deckt sich mit dem,
 * was die Engine tatsächlich tut (Root-`CLAUDE.md`: client-seitiges Parsen,
 * SoC-Simulation über alle Viertelstunden, Speicherempfehlung aus dem Katalog,
 * aufgeschlüsselte Ersparnis bis zur Amortisation) — keine neue Zusage (§9.5).
 *
 * FORM „McKinsey-Exhibit": dieselbe Nummerierung (`Num`, Akzentfarbe, zweistellig)
 * wie `vorgehen.tsx`/`how-it-works.tsx`, aber als FLEX-REIHE mit echten
 * Pfeil-Konnektoren zwischen den Schritten (ab `lg`) — das unterscheidet ein
 * „Prozessdiagramm" sichtbar von der reinen Karten-Liste darüber, ohne ein neues
 * Grundmuster zu erfinden. Auf Mobile fallen die Pfeile weg (kein Platz, keine
 * Aussage verloren — die Ziffern tragen die Reihenfolge bereits).
 *
 * ICONS: dieselben schlichten lucide-Line-Icons wie in `how-it-works.tsx`
 * (`FileUp`, `Cpu`) plus zwei passende Ergänzungen (`BatteryCharging`,
 * `TrendingDown`) — sie erhöhen hier tatsächlich die Klarheit, weil vier sehr
 * kurze Labels sonst nur an der Ziffer unterscheidbar wären.
 */
type Step = { title: string; text: string; icon: LucideIcon }

export function KalkulatorProzess() {
  const t = useTranslations('Home.Vorgehen')

  const steps: Step[] = [
    { title: t('k1Title'), text: t('k1Text'), icon: FileUp },
    { title: t('k2Title'), text: t('k2Text'), icon: Cpu },
    { title: t('k3Title'), text: t('k3Text'), icon: BatteryCharging },
    { title: t('k4Title'), text: t('k4Text'), icon: TrendingDown },
  ]

  return (
    <div className="mt-14 border-t border-line-strong pt-10">
      <p className="text-label uppercase text-text-muted">{t('kalkulatorEyebrow')}</p>
      <h3 className="mt-2 text-h3 text-ink">{t('kalkulatorTitle')}</h3>

      <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-0">
        {steps.map((step, i) => {
          const Icon = step.icon
          return (
            <React.Fragment key={step.title}>
              <div className="flex-1">
                <div className="flex items-center gap-2.5">
                  {/* tabular-nums: die vier Marker stehen exakt gleich breit (§7.4). */}
                  <Num className="text-label text-accent">{String(i + 1).padStart(2, '0')}</Num>
                  <Icon
                    className="h-4 w-4 shrink-0 text-text-muted"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-3 text-small font-semibold text-ink">{step.title}</p>
                <p className="mt-1 max-w-[16rem] text-caption text-text-muted">{step.text}</p>
              </div>

              {/* Pfeil-Konnektor — reines Dekor (Reihenfolge steht bereits in
                  der Ziffer), deshalb `aria-hidden` und nur ab `lg` sichtbar. */}
              {i < steps.length - 1 ? (
                <div
                  aria-hidden="true"
                  className="hidden shrink-0 items-center justify-center px-3 pt-1 lg:flex"
                >
                  <ArrowRight className="h-4 w-4 shrink-0 text-line-strong" strokeWidth={1.75} />
                </div>
              ) : null}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
