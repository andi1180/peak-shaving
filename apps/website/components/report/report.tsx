import { useState } from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import {
  DEMO_BATTERY_CATALOG,
  type AnalysisResult,
  type FinancialParams,
  type LoadProfile,
  type TariffParams,
  type TariffSourceRef,
} from 'shared'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DEFAULT_HORIZON_YEARS } from '@/lib/constants'
import type { RecomputeInput } from '@/components/flow/types'
import { AssumptionsPanel } from './assumptions-panel'
import { CostChart } from './cost-chart'
import { EnergyFlowChart } from './energy-flow-chart'
import { KeyMetric } from './key-metric'
import { LeadDialog } from './lead-dialog'
import { LoadChart } from './load-chart'
import { Num } from './num'
import { PrintAssumptionsSnapshot } from './print-assumptions-snapshot'
import { PrintMethodology } from './print-methodology'
import { RecommendationCard } from './recommendation-card'
import { TariffOptimizationCard } from './tariff-optimization-card'
import { TariffSourceNote } from './tariff-source-note'

// Report — ruhig, datendicht, desktop-first, Tablet Pflicht (§6.2). Bewusst ANDERER
// Charakter als die Marketing-Seite. `loadProfile` ist der rohe, client-seitig geparste Lastgang
// (Prinzip 4 — verlässt den Browser nie): die U2-Charts brauchen ihn für die Jahresübersicht, da
// `AnalysisResult.dispatchTrace` bewusst keine Rohreihe trägt (s. `DispatchTrace`-Kommentar).
//
// `result` ist seit U2 Prompt C der aktuell ANGEZEIGTE Stand (`analysis.displayResult` =
// `liveResult ?? result` im Hook) — nach einer Annahmen-Änderung also das live neu berechnete
// Ergebnis. `originalTariff`/`originalFinancial` bleiben die vom Tarif-Schritt (§5) unveränderten
// Werte (für die Formular-Defaults + den Reset-Vergleich im Annahmen-Panel).
export function Report({
  result,
  loadProfile,
  tariffSource,
  originalTariff,
  originalFinancial,
  recomputing,
  recomputeError,
  isLive,
  onRecompute,
  onResetAssumptions,
}: {
  result: AnalysisResult
  loadProfile: LoadProfile
  /** B11: Herkunft der Tarifsätze zum ANGEZEIGTEN Lauf; `null` ohne Netzbetreiber-Auswahl. */
  tariffSource: TariffSourceRef | null
  originalTariff: TariffParams
  originalFinancial?: FinancialParams
  recomputing: boolean
  recomputeError: string | null
  isLive: boolean
  onRecompute: (input: RecomputeInput) => void
  onResetAssumptions: () => void
}) {
  // Batterie, deren Energiefluss-Chart + Annahmen-Panel-Felder (Wirkungsgrad/Preis) gerade
  // angezeigt werden (§6.2 „aktuell angezeigte Batterie") — unabhängig von der Empfehlung, per
  // Dropdown im Chart wählbar (auch eine `static`-Alternative, um den Fallback zu sehen).
  const [selectedBatteryId, setSelectedBatteryId] = useState(result.recommendation.batteryId)

  const recommended =
    result.perBattery.find((p) => p.battery.id === result.recommendation.batteryId) ??
    result.perBattery[0]
  // 2–3 Alternativen (Pflichtenheft §3.8/§6.2), nicht der komplette Katalog-Rest — `perBattery`
  // ist bereits vollständig nach `netSavingOverHorizon` sortiert (§3.8), also sind das die
  // nächstbesten Kandidaten direkt hinter der Empfehlung.
  const alternatives = result.perBattery.filter((p) => p !== recommended).slice(0, 3)
  const a = result.assumptions

  // Teiljahres-Verzerrung der KERN-Kennzahl (§3.5): ein `monthly_*`-Modell mittelt/summiert über die
  // 12 Monate — bei < 12 belegten Monaten ist der abgerechnete Leistungswert oben nicht aussagekräftig
  // (leere Monate flossen früher als 0 in die Mittelung, verdünnten den realen Peak auf ~1/12; die
  // Engine nimmt sie jetzt aus der Mittelung, doch eine Mittelung über 1 von 12 Monaten bleibt fachlich
  // schwach). Wird PROMINENT oben neben der Kennzahl gezeigt (nicht nur in der Datenqualitäts-Box, die
  // beim Live-Test überscrollt wurde). Rein abgeleitet aus dem Contract (`coveredMonths` + `billingModel`)
  // — kein zweiter Zustand: verschwindet automatisch, sobald `billingModel` (via Shortcut ODER
  // Annahmen-Panel) auf `annual_max` wechselt.
  const showPartialYearWarning =
    a.billingModel.startsWith('monthly') && result.dataQuality.coveredMonths < 12

  /*
   * Delta 8 / 9b-1 — der Lastgang ist SYNTHETISCH (Standardprofil aus einer Verbrauchsangabe).
   *
   * Der Hinweis steht direkt unter der Kern-Kennzahl und nicht in der Datenqualitäts-Box weiter
   * unten, aus demselben Grund wie die Teiljahres-Warnung: er QUALIFIZIERT genau die Zahl darüber.
   * Der abgerechnete Leistungswert ist hier die Spitze einer Durchschnittskurve, also keine
   * gemessene Spitze — das muss neben ihr stehen, nicht drei Bildschirmhöhen darunter.
   *
   * Abgeleitet aus `loadProfile.source` und damit aus derselben Eigenschaft, an der die Engine die
   * Spitzenkappung abschaltet (`peakShavingBlockers`) — kein zweiter Zustand, der auseinanderlaufen
   * könnte. Sichtbar am Bildschirm UND im Druck: auf einem weitergereichten Blatt ist die Herkunft
   * der Zahlen die wichtigste Angabe überhaupt.
   */
  const isStandardProfile = loadProfile.source === 'standard_profile'

  // Shortcut „Mit Jahreshöchstwert rechnen": GENAU derselbe Recompute-Pfad wie das Annahmen-Panel
  // (§6.2, Prompt C) — `onRecompute` → Worker `recompute`. KEIN zweiter Umschalt-Mechanismus: der
  // neue `billingModel` fließt über das Ergebnis zurück und das Panel spiegelt ihn (liveBillingModel).
  // Horizont bleibt der aktuell angezeigte; der Rest = Original-Annahmen (Fresh-Report-Fall).
  function handleSwitchToAnnualMax() {
    onRecompute({
      tariff: { ...originalTariff, billingModel: 'annual_max' },
      financial: originalFinancial,
      horizonYears: a.horizonYears,
    })
  }

  // [ABGELEITET, keine Contract-Zahl] Roher Leistungspreis-Satz (€/kW·a) direkt aus den Ist-Kosten:
  // `leistungspreisCostPerYear / billedKw` (analyzeCurrentPeaks setzt Ersteres = Satz × billedKw,
  // §3.4) → exakt der €/kW·a-Satz, unabhängig vom Abrechnungsmodell und von der Batterie. Basis für
  // die KONTRAFAKTISCHE Kostengröße je angeklickter Spitze in Chart 1 (was diese Spitze allein an
  // Leistungsentgelt trüge, wäre sie der abgerechnete Höchstwert ihrer Periode) — bewusst NICHT die
  // Ersparnis (die richtet sich je Periode nur nach der höchsten Spitze; s. LoadChart-Popover). Die
  // perioden-spezifische Umrechnung (monthly_max_average → ÷12) macht das Chart selbst am
  // `billingModel`. `null` bei billedKw = 0 (leeres/rein einspeisendes Profil) — dann keine Spitzen.
  const leistungspreisRatePerKwYear =
    result.current.billedKw > 0
      ? result.current.leistungspreisCostPerYear / result.current.billedKw
      : null

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="print:break-inside-avoid">
        <KeyMetric current={result.current} />
      </div>

      {isStandardProfile && (
        <Alert className="print:break-inside-avoid">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Auf Basis eines Standardlastprofils — keine gemessenen Werte</AlertTitle>
          <AlertDescription>
            <p className="text-text">
              Diese Analyse rechnet mit einem <strong>synthetischen Durchschnittsprofil</strong>,
              das aus Ihrer Jahresverbrauchs-Angabe gebildet wurde. Für den Tarifvergleich reicht
              das: dafür zählt, wann im Tagesverlauf Strom verbraucht wird. Die oben gezeigten
              Leistungswerte sind dagegen die Spitzen dieser Durchschnittskurve und{' '}
              <strong>keine gemessene Lastspitze</strong> — eine Ersparnis beim Leistungspreis wird
              deshalb gar nicht erst ausgewiesen, statt sie zu schätzen.{' '}
              <strong>
                Für die Leistungspreis-Dimension: echten Lastgang hochladen (Viertelstundenwerte
                Ihres Netzbetreibers).
              </strong>
            </p>
          </AlertDescription>
        </Alert>
      )}

      {showPartialYearWarning && (
        <Alert variant="warning" className="print:break-inside-avoid">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            Nur <Num>{result.dataQuality.coveredMonths}</Num> von 12 Monaten mit Daten
          </AlertTitle>
          <AlertDescription>
            <p className="mb-3 text-text">
              Der abgerechnete Leistungswert oben unter dem Modell „Mittelwert der Monatsspitzen"
              ist damit nicht aussagekräftig — die{' '}
              <Num>{12 - result.dataQuality.coveredMonths}</Num> Monate ohne Daten kann das Modell
              nicht mitteln. „Jahreshöchstwert" als Abrechnungsmodell liefert für diesen Datensatz
              eine belastbarere Zahl.
            </p>
            <Button size="sm" onClick={handleSwitchToAnnualMax} disabled={recomputing}>
              {recomputing ? 'Rechnet neu …' : 'Mit Jahreshöchstwert rechnen'}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-1">
          {recommended && <RecommendationCard entry={recommended} primary />}
          {/*
            Delta 9a — der Tarifoptimierungs-Hebel steht DANEBEN, nicht darin: er ist eine eigene
            Aussage über eine eigene Datengrundlage, und wenn er ausfällt, bleibt die
            Peak-Shaving-Karte darüber unverändert stehen und sichtbar. Ohne angeforderten Hebel
            rendert die Karte gar nichts.
          */}
          <TariffOptimizationCard
            status={result.tariffOptimization}
            recommended={recommended}
            timeZone={loadProfile.timezoneMeta}
          />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div className="rounded-lg border border-border bg-surface p-6 print:break-inside-avoid">
            <p className="mb-1 text-sm font-medium text-ink">Lastgang mit Kapp-Linie</p>
            <p className="mb-3 text-xs text-text-muted">
              Jahresverlauf, teuerste abgefangene Spitzen markiert (anklickbar) — Kapp-Schwelle der
              empfohlenen Batterie eingezeichnet
            </p>
            <LoadChart
              loadProfile={loadProfile}
              dispatchTrace={recommended?.dispatchTrace}
              billingModel={a.billingModel}
              leistungspreisRatePerKwYear={leistungspreisRatePerKwYear}
            />
          </div>
          {/*
            Im DRUCK einspaltig: A4 minus Rand ergibt rund 700 px Inhaltsbreite — dort ist `sm:`
            noch aktiv, und Kostenvergleich und Energiefluss stünden zu zweit auf halber Breite.
            Ein Chart, das auf Papier auf 340 px gequetscht wird, ist keine Abbildung mehr.
            Betrifft ausschliesslich die Anordnung; die Charts selbst sind unverändert.
          */}
          <div className="grid gap-6 sm:grid-cols-2 print:grid-cols-1">
            <div className="rounded-lg border border-border bg-surface p-6 print:break-inside-avoid">
              <p className="mb-1 text-sm font-medium text-ink">Kostenvergleich mit/ohne Batterie</p>
              <p className="mb-3 text-xs text-text-muted">
                Kumulierte Kosten über {a.horizonYears} Jahre, Ersparnis nach Kategorie
              </p>
              {recommended && (
                <CostChart
                  entry={recommended}
                  currentLeistungspreisCostPerYear={result.current.leistungspreisCostPerYear}
                  horizonYears={a.horizonYears}
                />
              )}
            </div>
            <div className="flex flex-col gap-6">
              <EnergyFlowChart
                perBattery={result.perBattery}
                selectedBatteryId={selectedBatteryId}
                onSelectBattery={setSelectedBatteryId}
                timeZone={loadProfile.timezoneMeta}
              />
              <div className="flex flex-col justify-center gap-3 rounded-lg border border-border bg-surface p-6 print:break-inside-avoid">
                <p className="text-sm font-medium text-ink">Nächster Schritt</p>
                <p className="text-sm text-text-muted">{result.recommendation.rationale}</p>
                <div className="print:hidden">
                  <LeadDialog />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {alternatives.length > 0 && (
        <Accordion
          type="single"
          collapsible
          className="rounded-lg border border-border bg-surface px-4 print:hidden"
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
        className="rounded-lg border border-border bg-surface px-4 print:hidden"
      >
        <AccordionItem value="assumptions" className="border-b-0">
          <AccordionTrigger>Annahmen &amp; Rechenweise</AccordionTrigger>
          <AccordionContent>
            <AssumptionsPanel
              originalTariff={originalTariff}
              originalFinancial={originalFinancial}
              originalHorizonYears={DEFAULT_HORIZON_YEARS}
              liveBillingModel={a.billingModel}
              originalBattery={
                DEMO_BATTERY_CATALOG.find((b) => b.id === selectedBatteryId) ??
                DEMO_BATTERY_CATALOG[0]!
              }
              selectedBatteryName={
                result.perBattery.find((p) => p.battery.id === selectedBatteryId)?.battery.name ??
                selectedBatteryId
              }
              isEdited={isLive}
              recomputing={recomputing}
              recomputeError={recomputeError}
              onRecompute={onRecompute}
              onReset={onResetAssumptions}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Druck-Pendant zur Accordion oben — Snapshot statt Eingabefelder (§6.2 Teil D). */}
      <PrintAssumptionsSnapshot assumptions={a} recommended={recommended} />

      {/*
        Delta 16a — Methodik & Vorbehalte, nur im Druck. Steht bewusst NACH den Zahlen und den
        Annahmen: wer das Blatt aufschlägt, soll zuerst sein Ergebnis sehen. Die Komponente setzt
        selbst einen Seitenumbruch davor, damit das Kapitel nicht als Rest einer Zahlenseite
        beginnt.
      */}
      <PrintMethodology />

      {result.dataQuality.warnings.length > 0 && (
        <Alert className="print:break-inside-avoid">
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

      {/* B11: dauerhaft sichtbar, auch im Druck — ohne diese Angabe ist die Baseline später nicht
          einzuordnen (s. Kommentar in der Komponente). */}
      <TariffSourceNote source={tariffSource} />

      <p className="text-xs text-text-muted">
        {/* Nicht verhandelbar (CLAUDE.md): keine ROI-Zahl als „echt", bevor gegen echten Lastgang validiert. */}
        Demo-Berechnung mit Beispieldaten. Zahlen sind noch nicht gegen einen echten Lastgang und
        eine echte Netzrechnung validiert.
      </p>
    </div>
  )
}
