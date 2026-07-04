import type { AnalysisResult, BillingModel } from 'shared'

import { formatEur, formatEur2, formatPercent } from '@/lib/format'
import { Num } from './num'

type Entry = AnalysisResult['perBattery'][number]

const billingModelLabel: Record<BillingModel, string> = {
  monthly_max_average: 'Mittel der 12 Monatshöchstwerte',
  annual_max: 'Jahreshöchstwert',
  monthly_max_sum: 'Summe der 12 Monatshöchstwerte',
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-1.5 text-sm last:border-b-0">
      <span className="text-text-muted">{label}</span>
      <Num className="font-medium text-ink">{value}</Num>
    </div>
  )
}

/**
 * Druck-only Snapshot der AKTUELL konfigurierten Annahmen (§6.2 Teil D) — bewusst KEINE
 * Wiederverwendung des editierbaren `AssumptionsPanel` (dessen Eingabefelder dürfen laut
 * Vorgabe nicht im Druck landen). Liest ausschließlich bereits vorhandene, nicht-editierbare
 * Werte aus `AnalysisResult` (`result.assumptions` + der aktuell angezeigten `perBattery`-
 * Empfehlung) — reflektiert damit automatisch jede Live-Neuberechnung (Prompt C), ohne den
 * internen Formular-State des Panels anzufassen. `hidden print:block`: unsichtbar am
 * Bildschirm, erscheint nur im Druck-Output.
 */
export function PrintAssumptionsSnapshot({
  assumptions,
  recommended,
}: {
  assumptions: AnalysisResult['assumptions']
  recommended?: Entry
}) {
  return (
    <div className="hidden rounded-lg border border-border bg-surface p-6 print:block print:break-inside-avoid">
      <p className="mb-3 text-sm font-medium text-ink">
        Annahmen &amp; Rechenweise — Stand dieser Berechnung
      </p>
      <div className="grid gap-x-8 sm:grid-cols-2">
        <div>
          <Row label="Abrechnungsmodell" value={billingModelLabel[assumptions.billingModel]} />
          <Row label="Betrachtungshorizont" value={`${assumptions.horizonYears} Jahre`} />
          <Row
            label="Arbeitspreis"
            value={`${formatEur2(assumptions.energyPriceCtPerKwh / 100)} / kWh`}
          />
          <Row
            label="Einspeisevergütung"
            value={`${formatEur2(assumptions.einspeiseverguetungCtPerKwh / 100)} / kWh`}
          />
        </div>
        {recommended && (
          <div>
            <Row label={`Wirkungsgrad (${recommended.battery.name})`} value={formatPercent(assumptions.roundTripEfficiency * 100)} />
            <Row
              label={`Batteriepreis (${recommended.battery.name})`}
              value={`${formatEur2(recommended.battery.pricePerKwh)} / kWh`}
            />
            <Row label="Gesamtinvestition" value={formatEur(recommended.totalInvestment)} />
            <Row
              label="Nettoinvestition (nach Förderung/Steuervorteil)"
              value={
                recommended.taxEffectsIncluded
                  ? formatEur(recommended.netInvestment)
                  : 'keine Angabe (nicht einbezogen)'
              }
            />
          </div>
        )}
      </div>
      <p className="mt-3 text-xs text-text-muted">
        Entladetiefe/Arbeitspreis/Einspeisevergütung sind nicht editierbar (§6.2-Scope, s.
        Annahmen-Panel im Bildschirm-Report). Diese Werte sind der Stand zum Zeitpunkt des
        Ausdrucks — spätere Änderungen im interaktiven Panel wirken sich erst nach erneutem
        Druck aus.
      </p>
    </div>
  )
}
