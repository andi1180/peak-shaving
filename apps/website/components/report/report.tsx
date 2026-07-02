import { AlertCircle } from 'lucide-react'
import type { AnalysisResult, BillingModel } from 'shared'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { formatEur, formatPercent } from '@/lib/format'
import { ChartPlaceholder } from './chart-placeholder'
import { KeyMetric } from './key-metric'
import { LeadDialog } from './lead-dialog'
import { Num } from './num'
import { RecommendationCard } from './recommendation-card'

const billingModelLabel: Record<BillingModel, string> = {
  annual_max: 'Jahreshöchstwert',
  monthly_max_average: 'Mittel der 12 Monatshöchstwerte',
  monthly_max_sum: 'Summe der 12 Monatshöchstwerte',
}

function AssumptionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-text-muted">{label}</span>
      <Num className="font-medium text-ink">{value}</Num>
    </div>
  )
}

// Report — ruhig, datendicht, desktop-first, Tablet Pflicht (§6.2). Bewusst ANDERER
// Charakter als die Marketing-Seite. Charts sind hier noch Platzhalter (U2).
export function Report({ result }: { result: AnalysisResult }) {
  const recommended =
    result.perBattery.find((p) => p.battery.id === result.recommendation.batteryId) ??
    result.perBattery[0]
  const alternatives = result.perBattery.filter((p) => p !== recommended)
  const a = result.assumptions

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <KeyMetric current={result.current} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          {recommended && <RecommendationCard entry={recommended} primary />}
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:col-span-2">
          <ChartPlaceholder
            title="Lastgang mit Kapp-Linie"
            hint="Jahresverlauf, teuerste Spitzen markiert, Kapp-Schwelle eingezeichnet (anklickbar)"
          />
          <ChartPlaceholder
            title="Kostenvergleich mit/ohne Batterie"
            hint="Leistungspreis- und Eigenverbrauchsanteil über den Horizont"
          />
          <ChartPlaceholder
            title="Tages-Energiefluss"
            hint="Netz / PV / Batterie / Verbrauch über 24 h"
          />
          <div className="flex flex-col justify-center gap-3 rounded-lg border border-border bg-surface p-6">
            <p className="text-sm font-medium text-ink">Nächster Schritt</p>
            <p className="text-sm text-text-muted">{result.recommendation.rationale}</p>
            <LeadDialog />
          </div>
        </div>
      </div>

      {alternatives.length > 0 && (
        <Accordion
          type="single"
          collapsible
          className="rounded-lg border border-border bg-surface px-4"
        >
          <AccordionItem value="alternatives" className="border-b-0">
            <AccordionTrigger>{alternatives.length} Alternativen ansehen</AccordionTrigger>
            <AccordionContent>
              <div className="grid gap-4 pt-2 sm:grid-cols-2">
                {alternatives.map((entry) => (
                  <RecommendationCard key={entry.battery.id} entry={entry} />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      <Accordion
        type="single"
        collapsible
        className="rounded-lg border border-border bg-surface px-4"
      >
        <AccordionItem value="assumptions" className="border-b-0">
          <AccordionTrigger>Annahmen &amp; Rechenweise</AccordionTrigger>
          <AccordionContent>
            <div className="divide-y divide-border">
              <AssumptionRow label="Abrechnungsmodell" value={billingModelLabel[a.billingModel]} />
              <AssumptionRow label="Betrachtungshorizont" value={`${a.horizonYears} Jahre`} />
              <AssumptionRow
                label="Wirkungsgrad"
                value={formatPercent(a.roundTripEfficiency * 100)}
              />
              <AssumptionRow
                label="Arbeitspreis"
                value={`${formatEur(a.energyPriceCtPerKwh / 100)} / kWh`}
              />
              <AssumptionRow
                label="Einspeisevergütung"
                value={`${formatEur(a.einspeiseverguetungCtPerKwh / 100)} / kWh`}
              />
            </div>
            <p className="mt-3 text-xs text-text-muted">
              Editierbares Annahmen-Panel mit Live-Neuberechnung folgt in U2 (§6.2).
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {result.dataQuality.warnings.length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Datenqualität</AlertTitle>
          <AlertDescription>
            <p className="mb-1">
              Abgedeckt: <Num>{result.dataQuality.coveredDays}</Num> Tage · interpolierte Lücken:{' '}
              <Num>{result.dataQuality.gapsInterpolated}</Num>
            </p>
            <ul className="list-disc space-y-1 pl-4">
              {result.dataQuality.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <p className="text-xs text-text-muted">
        {/* Nicht verhandelbar (CLAUDE.md): keine ROI-Zahl als „echt", bevor gegen echten Lastgang validiert. */}
        Demo-Berechnung mit Beispieldaten. Zahlen sind noch nicht gegen einen echten Lastgang und
        eine echte Netzrechnung validiert.
      </p>
    </div>
  )
}
