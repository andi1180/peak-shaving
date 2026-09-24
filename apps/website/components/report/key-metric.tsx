import type { AnalysisResult } from 'shared'

import { formatEur, formatKw } from '@/lib/format'
import { Num } from './num'

// Kern-Kennzahl „die weh tut" (§6.2): teuerste Spitze + Mehrkosten/Jahr.
export function KeyMetric({
  current,
  levyLocationAssumed,
}: {
  current: AnalysisResult['current']
  levyLocationAssumed?: AnalysisResult['assumptions']['levyLocationAssumed']
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 sm:p-8">
      <p className="text-sm font-medium uppercase tracking-wide text-text-muted">
        Ihre teuerste Lastspitze
      </p>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-10">
        <div>
          <Num className="text-4xl font-semibold text-ink sm:text-5xl">
            {formatKw(current.annualPeakKw)}
          </Num>
          <p className="mt-1 text-sm text-text-muted">Jahreshöchstwert im Netzbezug</p>
        </div>
        <div>
          <Num className="text-4xl font-semibold text-negative sm:text-5xl">
            {formatEur(current.leistungspreisCostPerYear)}
          </Num>
          <p className="mt-1 text-sm text-text-muted">
            Leistungspreis-Kosten pro Jahr (abgerechnet: <Num>{formatKw(current.billedKw)}</Num>)
          </p>
        </div>
      </div>
      {levyLocationAssumed === 'vienna' && (
        // Dieselbe Annahme, die der PDF-Report unter „Annahmen und Datengrundlage“ ausweist.
        <p data-testid="levy-location-assumed" className="mt-4 text-sm text-text-muted">
          Gebrauchsabgabe Wien angenommen — Standort nicht angegeben. Sie fällt nur für Anschlüsse
          im Wiener Gemeindegebiet an und ist in der Ersparnis und den Kostenvergleichen enthalten.
        </p>
      )}
    </div>
  )
}
