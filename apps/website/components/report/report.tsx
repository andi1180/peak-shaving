import { useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import {
  DEMO_BATTERY_CATALOG,
  type AnalysisResult,
  type BillingModel,
  type FinancialParams,
  type LoadProfile,
  type ProposedChange,
  type ReportRequestCurrent,
  type ReportRequestField,
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
import { applyBatteryOverride, overrideSourceFor } from '@/lib/battery-override'
import { DEFAULT_HORIZON_YEARS, LARGE_GAP_SLOTS_THRESHOLD } from '@/lib/constants'
import type { AnalysisRunInputs } from '@/lib/use-analysis'
import type { BatteryPreset, RecomputeInput } from '@/components/flow/types'
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
import { ReportRequestPanel } from './report-request-panel'
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
  batteryPreset,
  effectiveInputs,
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
  /**
   * Delta 17 Teil 2: der in Schritt 2 bestätigte Speicher des Kunden. `undefined` = keine Angabe,
   * dann verhält sich der Report Zeile für Zeile wie vorher.
   */
  batteryPreset?: BatteryPreset
  /**
   * Delta 18: die Eingangsgrössen GENAU des angezeigten Laufs (`displayInputs` aus `useAnalysis`).
   *
   * ── ⚠ WARUM DAS FREITEXTFELD DIESEN STAND BRAUCHT UND NICHT `originalTariff`/`originalFinancial`
   * Die beiden `original*` sind der Stand aus Schritt 2 und zugleich das Ziel von „Zurücksetzen".
   * Für eine VORSCHAU wären sie der falsche Bezugspunkt: sie zeigte dann Änderungen gegenüber
   * etwas, das der Nutzer gar nicht mehr vor sich hat. Schlimmer noch — hätte er zuvor im
   * Annahmen-Panel etwas eingestellt, baute eine daraus abgeleitete Neuberechnung genau diese
   * Einstellung still wieder ab. Dieselbe Klasse von stillem Verlust wie beim Batterie-Preset
   * (Nachtrag zu Delta 17 Teil 2).
   *
   * `null` nur theoretisch (der Hook füllt es im selben Schritt, in dem das Ergebnis entsteht) —
   * dann sind die Werte aus Schritt 2 die beste verfügbare Aussage.
   */
  effectiveInputs: AnalysisRunInputs | null
  onRecompute: (input: RecomputeInput) => void
  onResetAssumptions: () => void
}) {
  // Batterie, deren Energiefluss-Chart + Annahmen-Panel-Felder (Wirkungsgrad/Preis) gerade
  // angezeigt werden (§6.2 „aktuell angezeigte Batterie") — unabhängig von der Empfehlung, per
  // Dropdown im Chart wählbar (auch eine `static`-Alternative, um den Fallback zu sehen).
  /*
   * Delta 17 Teil 2 — hat der Kunde seinen eigenen Speicher bestätigt, startet die Ansicht auf
   * IHM und nicht auf der Empfehlung: Energiefluss-Chart und Annahmen-Panel zeigen dann seine
   * Anlage. Die Empfehlung selbst bleibt unangetastet und steht unverändert oben — der Rechner
   * vergleicht weiterhin den vollen Katalog, er beginnt nur an einer anderen Stelle.
   *
   * Fällt die Kennung nicht auf einen gerechneten Kandidaten (sie kommt aus dem festen Katalog,
   * also praktisch immer), bleibt es bei der Empfehlung — kein leerer Zustand.
   */
  const [selectedBatteryId, setSelectedBatteryId] = useState(
    batteryPreset && result.perBattery.some((p) => p.battery.id === batteryPreset.batteryId)
      ? batteryPreset.batteryId
      : result.recommendation.batteryId,
  )

  /*
   * ⚠ DER KATALOG-STAND, GEGEN DEN DIESER REPORT ENTSTANDEN IST — und NICHT der unveränderte.
   *
   * Das Annahmen-Panel benutzt ihn doppelt: als Vorbelegung seiner Felder UND als Grundlinie, auf
   * die „Zurücksetzen" zurückführt. Beides muss zu dem passen, was tatsächlich GERECHNET wurde:
   * hat der Kunde in Schritt 2 seinen Speicher mit 90 % Wirkungsgrad bestätigt, lief der Erstlauf
   * mit 90 %. Stünde im Panel der Katalogwert (91 %), zeigte es eine Zahl an, mit der nichts
   * gerechnet wurde — und die nächste Live-Neuberechnung schickte sie zurück und verwürfe damit
   * still die Angabe des Kunden. Beim Live-Lauf gemessen, bevor diese Zeile stand.
   *
   * Es ist ausdrücklich das PRESET und nicht der zuletzt angezeigte Lauf: die Grundlinie darf einer
   * laufenden Änderung im Panel nicht nachwandern, sonst gäbe es nichts mehr zurückzusetzen.
   */
  /** Delta 18: erzwingt einen Neuaufbau des Annahmen-Panels nach einer Änderung per Freitext. */
  const [assumptionsKey, setAssumptionsKey] = useState(0)

  const baselineCatalog = useMemo(
    () => applyBatteryOverride(DEMO_BATTERY_CATALOG, batteryPreset),
    [batteryPreset],
  )

  const recommended =
    result.perBattery.find((p) => p.battery.id === result.recommendation.batteryId) ??
    result.perBattery[0]
  // 2–3 Alternativen (Pflichtenheft §3.8/§6.2), nicht der komplette Katalog-Rest — `perBattery`
  // ist bereits vollständig nach `netSavingOverHorizon` sortiert (§3.8), also sind das die
  // nächstbesten Kandidaten direkt hinter der Empfehlung.
  const alternatives = result.perBattery.filter((p) => p !== recommended).slice(0, 3)
  const a = result.assumptions

  /*
   * ── DIE BESTANDSANLAGE DES KUNDEN ──────────────────────────────────────────────────────────────
   * Hat der Kunde in Schritt 2 seinen eigenen Speicher bestätigt (`source: 'existing'`), ist ER der
   * primäre Block dieses Reports — nicht eine Empfehlung, die er nicht braucht. Für ihn weist der
   * Report weder Investition noch Amortisation aus: die Anschaffung ist bezahlt, und beide Zahlen
   * beantworten eine Kaufentscheidung, die längst gefallen ist.
   *
   * ⚠ DIE EMPFEHLUNG BLEIBT DAVON UNBERÜHRT. `recommendBattery` läuft unverändert über den vollen
   * Katalog (Architektur-Vorgabe, s. `rank.ts`) — sie wandert nur in einen eigenen, klar als
   * Neuanschaffung gerahmten Abschnitt darunter. Damit beantwortet der Report weiterhin die Frage,
   * die ein Bestandskunde tatsächlich hat: lohnt sich zusätzlich ein grösseres Gerät?
   *
   * Der wirksame Override des ANGEZEIGTEN Laufs entscheidet, nicht der Stand aus Schritt 2: eine
   * Live-Neuberechnung kann ihn verschoben haben (`resolveBatteryOverride` hält `existing` dabei
   * fest, solange dieselbe Anlage gemeint ist). `batteryPreset` ist nur der theoretische Rückfall,
   * solange `effectiveInputs` noch nicht steht — dieselbe Vorrangregel wie bei `effectiveTariff`.
   *
   * Findet die Kennung keinen gerechneten Kandidaten (praktisch unmöglich, sie stammt aus dem
   * festen Katalog), bleibt es beim heutigen Verhalten — kein leerer primärer Block.
   */
  const activeOverride = effectiveInputs?.batteryOverride ?? batteryPreset
  const existingEntry =
    activeOverride?.source === 'existing'
      ? result.perBattery.find((p) => p.battery.id === activeOverride.batteryId)
      : undefined
  const isExisting = existingEntry != null
  /** Der Block, der oben steht: die Anlage des Kunden, sonst die Empfehlung. */
  const primaryEntry = existingEntry ?? recommended

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
   * Grosse zusammenhängende Datenlücke (§3.3) — ein EIGENER Hinweis neben der Teiljahres-Warnung
   * darüber, und ausdrücklich nicht derselbe Satz.
   *
   * Die beiden sagen Verschiedenes: dort FEHLT ein Zeitraum (< 12 belegte Monate, das Modell kann
   * nicht mitteln, was es nicht hat), hier sieht der Zeitraum VOLLSTÄNDIG aus und hat trotzdem
   * keine Substanz — die Slots existieren, ihre Werte sind aber linear zwischen den Rändern
   * aufgefüllt. Genau das ist die gefährlichere Lage: eine Lastspitze innerhalb der Lücke kann in
   * keiner Zahl dieses Reports auftauchen, und nichts an der Kern-Kennzahl sieht danach aus.
   * Zusammengelegt bekäme der Nutzer für zwei verschiedene Datenmängel eine Meldung, aus der er
   * nicht ableiten kann, was er tun soll (anderer Zeitraum vs. vollständiger Lastgang).
   *
   * Rein aus dem Contract abgeleitet (`dataQuality.largestGapSlots`) — dieselbe Zahl, die der
   * Parser beim Interpolieren gemessen hat, keine zweite Rechnung. Die Schwelle ist VORLÄUFIG und
   * steht als einzelne Konstante (s. `LARGE_GAP_SLOTS_THRESHOLD`, Delta 14 Punkt 9). Ein älteres
   * Ergebnis ohne das Feld (`undefined`) fällt hier still durch — kein Hinweis statt eines Fehlers.
   */
  const largestGapSlots = result.dataQuality.largestGapSlots
  const showLargeGapWarning = largestGapSlots > LARGE_GAP_SLOTS_THRESHOLD
  const largestGapDays = Math.round(largestGapSlots / 96)

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

  /*
   * ── Delta 18: DER AKTUELL WIRKSAME STAND ────────────────────────────────────────────────────
   * Bezugspunkt der Vorschau UND Grundlage jeder daraus gebauten Neuberechnung. Er kommt aus dem
   * ANGEZEIGTEN Lauf, nicht aus Schritt 2 (s. `effectiveInputs`): `assumptions` sagt, womit der
   * Worker gerechnet hat, `perBattery[…].battery` ist der tatsächlich benutzte Katalog-Eintrag
   * (inklusive Preset und Panel-Änderung), und `financial` steht nur in den Eingaben.
   */
  const effectiveTariff = effectiveInputs?.tariff ?? originalTariff
  const effectiveFinancial = effectiveInputs?.financial ?? originalFinancial
  const selectedEntry =
    result.perBattery.find((p) => p.battery.id === selectedBatteryId) ?? recommended
  const selectedBattery =
    selectedEntry?.battery ??
    baselineCatalog.find((b) => b.id === selectedBatteryId) ??
    baselineCatalog[0]!

  const requestCurrent: ReportRequestCurrent = {
    billingModel: a.billingModel,
    horizonYears: a.horizonYears,
    subsidyPercent: effectiveFinancial?.subsidyPercent ?? null,
    fixedSubsidyEur: effectiveFinancial?.fixedSubsidyEur ?? null,
    depreciationYears: effectiveFinancial?.depreciationYears ?? null,
    taxRatePercent: effectiveFinancial?.taxRatePercent ?? null,
    roundTripEfficiencyPercent: selectedBattery.roundTripEfficiency * 100,
    pricePerKwh: selectedBattery.pricePerKwh,
  }

  /*
   * ── Delta 18: DIE ÜBERSETZUNG IN EINE NEUBERECHNUNG ─────────────────────────────────────────
   * Es entsteht KEIN neuer Mechanismus: gebaut wird dasselbe `RecomputeInput`, das auch das
   * Annahmen-Panel liefert, und es geht durch denselben `onRecompute`. Alles, was der Satz nicht
   * erwähnt, reist unverändert mit — ein Feld wegzulassen hiesse, es still auf den Stand von
   * Schritt 2 zurückzusetzen.
   */
  function applyReportRequest(changes: ProposedChange[]) {
    const numberFor = (field: ReportRequestField): number | undefined => {
      const hit = changes.find((c) => c.field === field)
      return typeof hit?.to === 'number' ? hit.to : undefined
    }
    const billing = changes.find((c) => c.field === 'billingModel')?.to as BillingModel | undefined

    const subsidyPercent = numberFor('subsidyPercent')
    const fixedSubsidyEur = numberFor('fixedSubsidyEur')
    const depreciationYears = numberFor('depreciationYears')
    const taxRatePercent = numberFor('taxRatePercent')
    /*
     * Auf dem wirksamen Stand aufgesetzt, nicht auf `originalFinancial`. `investitionsfreibetrag-
     * Percent` und `note` reisen dadurch von selbst mit — sie sind in keinem der beiden Wege
     * editierbar und dürfen trotzdem nicht verschwinden.
     *
     * Eine erneute zod-Prüfung findet hier bewusst NICHT statt: die Grenzen (0–100 %, positiv)
     * stehen bereits in `parseReportRequestExtraction` und sind wortgleich die aus
     * `financialParamsSchema`; die unveränderten Felder stammen aus einem bereits geprüften Stand.
     * Eine zweite Prüfung mit stillem Rückfall fügte einen Pfad hinzu, auf dem eine Angabe des
     * Nutzers lautlos verschwände, ohne Sicherheit hinzuzufügen.
     */
    const touchesFinancial =
      subsidyPercent !== undefined ||
      fixedSubsidyEur !== undefined ||
      depreciationYears !== undefined ||
      taxRatePercent !== undefined
    const financial: FinancialParams | undefined =
      touchesFinancial || effectiveFinancial
        ? {
            ...effectiveFinancial,
            ...(subsidyPercent !== undefined ? { subsidyPercent } : {}),
            ...(fixedSubsidyEur !== undefined ? { fixedSubsidyEur } : {}),
            ...(depreciationYears !== undefined ? { depreciationYears } : {}),
            ...(taxRatePercent !== undefined ? { taxRatePercent } : {}),
          }
        : undefined

    const efficiencyPercent = numberFor('roundTripEfficiencyPercent')
    const pricePerKwh = numberFor('pricePerKwh')
    /*
     * ⚠ DIE EINZIGE STELLE, AN DER PROZENT ZU BRUCHTEIL WIRD — wie in `battery-text-panel.tsx`
     * und aus demselben Grund: zweimal umgerechnet wäre der Wirkungsgrad 0,9 %, eine Zahl, die
     * durch jede Schemaprüfung liefe und die Ersparnis lautlos vernichtete.
     *
     * Nennt der Satz keine der beiden Batteriegrössen, reist der WIRKSAME Override unverändert
     * mit — nicht `undefined`. Sonst verlöre dieser Weg ein bestätigtes Preset und eine
     * Panel-Änderung, also genau der Defekt, der im Nachtrag zu Delta 17 Teil 2 behoben wurde.
     */
    const batteryOverride =
      efficiencyPercent !== undefined || pricePerKwh !== undefined
        ? {
            batteryId: selectedBattery.id,
            roundTripEfficiency:
              (efficiencyPercent ?? requestCurrent.roundTripEfficiencyPercent) / 100,
            pricePerKwh: pricePerKwh ?? requestCurrent.pricePerKwh,
            /*
             * Korrigierte Zahlen ändern nicht, WEM das Gerät gehört: betrifft die Anfrage die
             * bestätigte Bestandsanlage, bleibt sie eine — sonst forderte der Report nach einem
             * Satz wie „rechne mit 85 % Wirkungsgrad" plötzlich wieder eine Investition für einen
             * Speicher, der längst an der Wand hängt. Dieselbe Regel hält
             * `resolveBatteryOverride` zusätzlich zentral fest.
             */
            source: overrideSourceFor(selectedBattery.id, activeOverride),
          }
        : effectiveInputs?.batteryOverride

    onRecompute({
      tariff: billing ? { ...effectiveTariff, billingModel: billing } : effectiveTariff,
      financial,
      horizonYears: numberFor('horizonYears') ?? a.horizonYears,
      batteryOverride,
    })
    /*
     * Das Annahmen-Panel hält seine Felder in lokalem Zustand, der aus den Werten beim MOUNTEN
     * stammt. Nach einer Änderung von hier zeigte es sonst weiter die alten Zahlen — und der
     * nächste Klick dort schickte sie zurück und machte diese Änderung still rückgängig. Der
     * Schlüsselwechsel baut es neu auf, mit den jetzt wirksamen Werten als Vorbelegung; sein
     * Ziel für „Zurücksetzen" bleibt davon unberührt (`original*`).
     */
    setAssumptionsKey((n) => n + 1)
  }

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

  /*
   * ── DREI KÄSTEN, DIE JE NACH FALL AN VERSCHIEDENEN STELLEN STEHEN ──────────────────────────────
   * Als Konstanten und nicht zweimal ausgeschrieben: die beiden Anordnungen unterscheiden sich in
   * der PLATZIERUNG, nicht im Inhalt — zwei Kopien liefen beim nächsten Umbau auseinander, und
   * dann sähe derselbe Kunde je nach Fall zwei verschiedene Charts.
   */

  /*
   * ⚠ DER KOSTENVERGLEICH GEHÖRT ZUR NEUANSCHAFFUNG UND WANDERT MIT IHR NACH UNTEN.
   *
   * Er zeigt kumulierte Kosten mit/ohne Batterie samt Break-even — und beide Linien BEGINNEN bei
   * `netInvestment` (s. `buildYearSeries` in `cost-chart.tsx`). Genau diese Investition ist bei
   * einer bestehenden Anlage bereits ausgegeben; auf sie einen Break-even zu zeichnen hiesse, die
   * Amortisation durch die Hintertür wieder aufzumachen, die der primäre Block gerade weglässt.
   *
   * Eine Fassung „ohne Investitionsachse" wäre kein Ersatz: übrig blieben zwei Geraden mit
   * konstantem Abstand, also nichts, was die Jahresersparnis als Zahl nicht schon sagt. Deshalb
   * bleibt der Kasten unverändert an die Empfehlung gebunden und steht dort, wo er hingehört —
   * im Neuanschaffungs-Abschnitt.
   */
  const costChartBox = (
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
  )

  const energyFlowBox = (
    <EnergyFlowChart
      perBattery={result.perBattery}
      selectedBatteryId={selectedBatteryId}
      onSelectBattery={setSelectedBatteryId}
      timeZone={loadProfile.timezoneMeta}
    />
  )

  const nextStepBox = (
    <div className="flex flex-col justify-center gap-3 rounded-lg border border-border bg-surface p-6 print:break-inside-avoid">
      <p className="text-sm font-medium text-ink">Nächster Schritt</p>
      {/*
        `recommendation.rationale` beschreibt den empfohlenen KAUF („spart X, amortisiert in Y") —
        neben der bestehenden Anlage wäre das die Antwort auf eine andere Frage, und sie steht
        unverändert im Neuanschaffungs-Abschnitt darunter.
      */}
      <p className="text-sm text-text-muted">
        {isExisting
          ? 'Ihr Speicher ist oben mit Ihren Angaben durchgerechnet. Ob sich daneben ein neues Gerät lohnt, zeigt der Vergleich darunter.'
          : result.recommendation.rationale}
      </p>
      <div className="print:hidden">
        <LeadDialog />
      </div>
    </div>
  )

  const alternativesAccordion =
    alternatives.length > 0 ? (
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
    ) : null

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

      {showLargeGapWarning && (
        <Alert variant="warning" className="print:break-inside-avoid">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            Grosse Datenlücke: <Num>{largestGapDays}</Num> Tage am Stück ohne Messwerte
          </AlertTitle>
          <AlertDescription>
            <p className="text-text">
              Der Zeitraum ist zwar durchgehend abgedeckt, in diesem Abschnitt stammen die Werte
              aber <strong>nicht aus einer Messung</strong> — sie wurden linear zwischen dem letzten
              und dem nächsten bekannten Wert aufgefüllt. Eine Lastspitze, die in diesen{' '}
              <Num>{largestGapDays}</Num> Tagen aufgetreten ist, kann in keiner Zahl dieses Reports
              vorkommen: der abgerechnete Leistungswert oben und die daraus abgeleitete Ersparnis
              sind für diesen Datensatz eher zu niedrig als zu hoch.{' '}
              <strong>
                Bitte den vollständigen Lastgang beim Netzbetreiber anfordern (Viertelstundenwerte
                ohne Lücke).
              </strong>
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-1">
          {/*
            Der primäre Block: die bestehende Anlage des Kunden, sonst die Empfehlung. Die Variante
            entscheidet allein darüber, ob Investition und Amortisation dastehen — Ersparnis,
            Aufschlüsselung und Vorbehalte sind in beiden Fällen dieselben, aus derselben
            `perBattery`-Zeile derselben EINEN Rechnung.
          */}
          {primaryEntry && (
            <RecommendationCard
              entry={primaryEntry}
              primary
              variant={isExisting ? 'existing' : 'catalog'}
            />
          )}
          {/*
            Delta 9a — der Tarifoptimierungs-Hebel steht DANEBEN, nicht darin: er ist eine eigene
            Aussage über eine eigene Datengrundlage, und wenn er ausfällt, bleibt die
            Peak-Shaving-Karte darüber unverändert stehen und sichtbar. Ohne angeforderten Hebel
            rendert die Karte gar nichts.

            Er trägt die Zahl DESSELBEN Geräts wie der Block darüber: eine Lastverschiebungs-
            Ersparnis, die zu einer anderen Batterie gehört, stünde sonst unerklärt in derselben
            Spalte neben der des Kunden.
          */}
          <TariffOptimizationCard
            status={result.tariffOptimization}
            recommended={primaryEntry}
            timeZone={loadProfile.timezoneMeta}
          />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div className="rounded-lg border border-border bg-surface p-6 print:break-inside-avoid">
            <p className="mb-1 text-sm font-medium text-ink">Lastgang mit Kapp-Linie</p>
            {/*
              Die Kapp-Linie gehört zum primären Block darüber. Bei einem Bestandskunden ist das
              SEINE Anlage — eine Schwelle, die ein Gerät zöge, das er erst kaufen müsste, wäre im
              Hauptdiagramm seiner eigenen Auswertung die falsche Linie.
            */}
            <p className="mb-3 text-xs text-text-muted">
              Jahresverlauf, teuerste abgefangene Spitzen markiert (anklickbar) — Kapp-Schwelle{' '}
              {isExisting ? 'Ihres Speichers' : 'der empfohlenen Batterie'} eingezeichnet
            </p>
            <LoadChart
              loadProfile={loadProfile}
              dispatchTrace={primaryEntry?.dispatchTrace}
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
            {isExisting ? (
              <>
                {energyFlowBox}
                {nextStepBox}
              </>
            ) : (
              <>
                {costChartBox}
                <div className="flex flex-col gap-6">
                  {energyFlowBox}
                  {nextStepBox}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/*
        ── DER NEUANSCHAFFUNGS-VERGLEICH ────────────────────────────────────────────────────────
        Das Ranking ist unverändert (voller Katalog, `rank.ts` unangetastet) — nur die RAHMUNG ist
        eine andere: für jemanden, der bereits einen Speicher hat, ist die Empfehlung keine Antwort
        auf „was soll ich tun", sondern auf „was brächte ein neues Gerät zusätzlich". Genau das
        sagt die Überschrift, und deshalb tragen ausschliesslich diese Karten Investition und
        Amortisation.

        Die Alternativen-Aufklappliste steht INNERHALB des Abschnitts, nicht bloss darunter: sie
        gehört zur selben Frage, und die Zugehörigkeit soll aus der Struktur folgen und nicht aus
        der zufälligen Reihenfolge zweier Nachbarn.
      */}
      {isExisting ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              Falls Sie stattdessen neu kaufen würden
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Der Rechner vergleicht unverändert den vollen Katalog. Hier steht, was ein{' '}
              <strong>neu angeschaffter</strong> Speicher an diesem Lastgang leisten würde — diese
              Zahlen tragen deshalb Investition und Amortisation, Ihre bestehende Anlage oben trägt
              beides nicht.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-1">
              {recommended && <RecommendationCard entry={recommended} primary />}
            </div>
            <div className="lg:col-span-2">{costChartBox}</div>
          </div>
          {alternativesAccordion}
        </section>
      ) : (
        alternativesAccordion
      )}

      {/*
        ── Delta 18: die Report-Anfrage in eigenen Worten ────────────────────────────────────────
        Steht ABSICHTLICH hier: unmittelbar über „Annahmen & Rechenweise", weil es genau dessen
        acht Grössen bedient und nichts darüber hinaus — und AUSSERHALB der Accordion, weil eine
        Abkürzung, die man erst aufklappen muss, keine ist. `print:hidden` wie die beiden
        Accordions: ein Eingabefeld gehört nicht ins gedruckte Dokument.
      */}
      <ReportRequestPanel
        current={requestCurrent}
        batteryName={selectedBattery.name}
        recomputing={recomputing}
        onApply={applyReportRequest}
      />

      <Accordion
        type="single"
        collapsible
        className="rounded-lg border border-border bg-surface px-4 print:hidden"
      >
        <AccordionItem value="assumptions" className="border-b-0">
          <AccordionTrigger>Annahmen &amp; Rechenweise</AccordionTrigger>
          <AccordionContent>
            <AssumptionsPanel
              key={assumptionsKey}
              originalTariff={originalTariff}
              originalFinancial={originalFinancial}
              originalHorizonYears={DEFAULT_HORIZON_YEARS}
              /*
               * Delta 18: die Felder starten auf dem WIRKSAMEN Stand, „Zurücksetzen" führt
               * weiterhin auf `original*`. Ohne diese Trennung zeigte das Panel nach einer
               * Änderung per Freitext die alten Zahlen — und machte sie beim nächsten Klick
               * still rückgängig.
               */
              effectiveFinancial={effectiveFinancial}
              effectiveHorizonYears={a.horizonYears}
              liveBillingModel={a.billingModel}
              originalBattery={
                baselineCatalog.find((b) => b.id === selectedBatteryId) ?? baselineCatalog[0]!
              }
              selectedBatteryName={
                result.perBattery.find((p) => p.battery.id === selectedBatteryId)?.battery.name ??
                selectedBatteryId
              }
              /*
               * Die Herkunft der gerade bearbeiteten Batterie — abgeleitet, nicht im Panel
               * erfunden: dort ist nur ein Katalog-Eintrag sichtbar, und ob der dem Kunden
               * bereits gehört, steht ausschliesslich im wirksamen Override.
               */
              batterySource={overrideSourceFor(selectedBatteryId, activeOverride)}
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
