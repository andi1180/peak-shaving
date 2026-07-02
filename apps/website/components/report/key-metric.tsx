import type { AnalysisResult } from 'shared'

import { formatEur, formatKw } from '@/lib/format'
import { Num } from './num'

// Kern-Kennzahl „die weh tut" (§6.2): teuerste Spitze + Mehrkosten/Jahr.
export function KeyMetric({ current }: { current: AnalysisResult['current'] }) {
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
    </div>
  )
}
