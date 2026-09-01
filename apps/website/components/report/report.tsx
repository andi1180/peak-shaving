import { useState } from 'react'
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
import { DEFAULT_HORIZON_YEARS, LARGE_GAP_SLOTS_THRESHOLD } from '@/lib/constants'
import type { AnalysisRunInputs } from '@/lib/use-analysis'
import type { ExistingBatteryInput, RecomputeInput } from '@/components/flow/types'
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
  existingBattery,
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
   *
   * ⚠ Das GERECHNETE Ergebnis dazu steht im Contract (`result.existingBatteryAnalysis`) — hier
   * wird ausschliesslich gelesen, ob der Wirkungsgrad eine Annahme war. Diese eine Zahl stammt
   * nicht vom Kunden und darf im Report nicht als seine erscheinen.
   */
  existingBattery?: ExistingBatteryInput
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
   * ⚠ IMMER ein KATALOG-Kandidat, auch im Bestandsfall. Die Auswahl steuert das Annahmen-Panel
   * (Wirkungsgrad/Preis der angezeigten Batterie) und die Delta-18-Freitextanfrage — beide
   * arbeiten ausschliesslich auf Katalog-Geräten. Die bestehende Anlage des Kunden lässt sich dort
   * bewusst nicht bearbeiten: ihre Werte hat er in Schritt 2 angegeben, und sie sind keine
   * Annahme, an der man drehen könnte (s. Handover, offener Punkt).
   */
  const [selectedBatteryId, setSelectedBatteryId] = useState(result.recommendation.batteryId)

  /** Delta 18: erzwingt einen Neuaufbau des Annahmen-Panels nach einer Änderung per Freitext. */
  const [assumptionsKey, setAssumptionsKey] = useState(0)

  /*
   * Die Grundlinie des Annahmen-Panels: Vorbelegung seiner Felder UND das Ziel von „Zurücksetzen".
   *
   * Seit dem 01.09.2026 ist das schlicht der unveränderte Katalog. Bis dahin wurde hier ein
   * bestätigtes Batterie-Preset eingerechnet, weil der Speicher des Kunden ein Override auf einen
   * Katalog-Kandidaten war — er ist es nicht mehr (er wird daneben simuliert), und der Katalog ist
   * damit wieder das, was er auch vor Delta 17 Teil 2 war.
   */
  const baselineCatalog = DEMO_BATTERY_CATALOG

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
   * Hat der Kunde in Schritt 2 seinen eigenen Speicher angegeben, ist ER der primäre Block dieses
   * Reports — nicht eine Empfehlung, die er nicht braucht. Für ihn weist der Report weder
   * Investition noch Amortisation aus: die Anschaffung ist bezahlt, und beide Zahlen beantworten
   * eine Kaufentscheidung, die längst gefallen ist.
   *
   * ⚠ SEIT DEM 01.09.2026 KOMMT DAS ERGEBNIS AUS DEM CONTRACT, NICHT AUS EINER ABLEITUNG. Bis
   * dahin wurde der Bestandseintrag über die Kennung eines Overrides in `perBattery` gesucht — er
   * WAR ein Katalog-Kandidat, und der Kunde bekam dessen Kapazität vorgerechnet statt seiner. Der
   * Worker simuliert die Anlage jetzt mit ihren exakten Werten ausserhalb des Rankings
   * (`existingBatteryAnalysis`); es gibt hier nichts mehr zu suchen und nichts zuzuordnen.
   *
   * ⚠ Der KATALOG-Lauf (`perBattery`/`recommendation`) bleibt davon unberührt und liefert
   * unverändert alle fünf Kandidaten — er ist die Grundlage der Zusatzspeicher-Szenarien darunter.
   */
  const existingAnalysis = result.existingBatteryAnalysis
  const isExisting = existingAnalysis != null
  /** Der Block, der oben steht: die Anlage des Kunden, sonst die Empfehlung. */
  const primaryEntry = existingAnalysis?.entry ?? recommended

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
             * Ein Override betrifft ausschliesslich einen KATALOG-Kandidaten — die bestehende
             * Anlage des Kunden ist seit dem 01.09.2026 keiner mehr (sie wird ausserhalb von
             * `perBattery` simuliert und lässt sich hier gar nicht auswählen). `catalog_preset`
             * ist damit die einzige Herkunft, die noch entstehen kann; das Feld bleibt am Typ,
             * weil das Analyse-Bündel es seit Fassung 3 führt.
             */
            source: 'catalog_preset' as const,
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
   * ⚠ DER KOSTENVERGLEICH ENTFÄLLT IM BESTANDSFALL ERSATZLOS.
   *
   * Er zeigt kumulierte Kosten mit/ohne Batterie samt Break-even — und beide Linien BEGINNEN bei
   * `netInvestment` (s. `buildYearSeries` in `cost-chart.tsx`). Für ein Zusatzgerät wäre das die
   * falsche Kurvenform: verglichen würde dort nicht „mit gegen ohne Batterie", sondern „mit
   * gegen ohne ZUSATZgerät", also eine Differenz gegen eine Differenz. Diese Kurve gibt es nicht,
   * und eine mit der bestehenden Ersparnis vermischte wäre eine Kaufbegründung mit fremdem Geld.
   *
   * Eine Fassung „ohne Investitionsachse" wäre ebenfalls kein Ersatz: übrig blieben zwei Geraden
   * mit konstantem Abstand, also nichts, was die Jahresersparnis als Zahl nicht schon sagt. Der
   * Kasten bleibt deshalb an die Katalog-Empfehlung gebunden und erscheint nur dort, wo es diese
   * Empfehlung als primäre Aussage gibt — im Bestandsfall gar nicht.
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

  /*
   * ⚠ IM BESTANDSFALL ZEIGT DER ENERGIEFLUSS DIE ANLAGE DES KUNDEN, NICHT DEN KATALOG.
   *
   * Der Chart illustriert den primären Block darüber — und das ist dort SEIN Speicher. Ein
   * Tagesverlauf eines Geräts, das er erst kaufen müsste, wäre in seiner eigenen Auswertung die
   * falsche Kurve (dieselbe Überlegung wie bei der Kapp-Linie im Lastgang-Chart).
   *
   * Die Auswahlliste entfällt dabei: es gibt genau einen Eintrag, und `selectedBatteryId` bleibt
   * ein Katalog-Kandidat für das Annahmen-Panel (s. dort). Ein Dropdown, das diese Kennung
   * überschreiben könnte, würde das Panel auf einen Eintrag zeigen lassen, den es nicht führt.
   */
  const energyFlowBox = existingAnalysis ? (
    <EnergyFlowChart
      perBattery={[existingAnalysis.entry]}
      selectedBatteryId={existingAnalysis.entry.battery.id}
      onSelectBattery={setSelectedBatteryId}
      timeZone={loadProfile.timezoneMeta}
    />
  ) : (
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
        `recommendation.rationale` beschreibt den empfohlenen KAUF („spart X, amortisiert in Y").
        Neben einer bestehenden Anlage wäre das die Antwort auf eine andere Frage: dort ist nicht
        der Kauf EINES Speichers offen, sondern der eines ZUSÄTZLICHEN — und den beantwortet der
        Abschnitt darunter mit den inkrementellen Zahlen, nicht mit dieser Zeile.
      */}
      <p className="text-sm text-text-muted">
        {isExisting
          ? 'Ihr Speicher ist oben mit Ihren exakten Angaben durchgerechnet. Ob sich daneben ein zusätzliches Gerät lohnt, steht im Abschnitt darunter.'
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

  /*
   * ── LOHNT SICH EIN ZUSÄTZLICHER SPEICHER? (01.09.2026) ─────────────────────────────────────
   * Die Frage, die ein Bestandskunde tatsächlich hat — und die der Report bis heute nicht
   * beantwortet hat: er zeigte stattdessen eine Empfehlung für den Neukauf EINES Speichers, als
   * hätte der Kunde keinen.
   *
   * Gerechnet ist je Katalog-Kandidat ein KOMBINIERTER Speicher (Bestand + Gerät), ausgewiesen ist
   * die Differenz zum Bestand allein (s. Worker). Die Sortierung kommt aus dem Contract und folgt
   * derselben Regel wie das Katalog-Ranking.
   *
   * ⚠ SIND ALLE FÜNF DIFFERENZEN ≤ 0, STEHT DORT EIN SATZ UND KEINE KARTEN. Fünf Karten mit
   * „€ 0 zusätzlich" und „∞ Jahre" beantworten die Frage zwar formal richtig, verstecken die
   * Antwort aber in einer Tabelle, die aussieht, als sei etwas schiefgegangen. Der Satz sagt sie.
   */
  const positiveAddons = (existingAnalysis?.addonScenarios ?? []).filter(
    (scenario) => scenario.totalSavingPerYear > 0,
  )

  const addonSection = existingAnalysis ? (
    <section className="flex flex-col gap-4" data-testid="zusatzspeicher-sektion">
      <div>
        <h2 className="text-lg font-semibold text-ink">Lohnt sich ein zusätzlicher Speicher?</h2>
        <p className="mt-1 text-sm text-text-muted">
          Gerechnet wird Ihre bestehende Anlage <strong>gemeinsam</strong> mit je einem Gerät aus
          unserem Katalog — Kapazität und Leistung addiert. Ausgewiesen ist davon nur, was{' '}
          <strong>über Ihre bestehende Anlage hinaus</strong> herauskommt; die Investition ist die
          des neuen Geräts allein.
        </p>
      </div>
      {positiveAddons.length > 0 ? (
        <Accordion
          type="single"
          collapsible
          className="rounded-lg border border-border bg-surface px-4 print:hidden"
        >
          <AccordionItem value="addons" className="border-b-0">
            <AccordionTrigger>
              {positiveAddons.length}{' '}
              {positiveAddons.length === 1 ? 'Zusatzspeicher' : 'Zusatzspeicher'} ansehen
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid gap-4 pt-2 sm:grid-cols-2">
                {positiveAddons.map((scenario) => (
                  <RecommendationCard
                    key={scenario.battery.id}
                    entry={scenario}
                    variant="addon"
                  />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : (
        <Alert variant="default" data-testid="zusatzspeicher-lohnt-nicht">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Ein zusätzlicher Speicher lohnt sich derzeit nicht</AlertTitle>
          <AlertDescription>
            <p>
              Keines der Geräte aus unserem Katalog bringt neben Ihrer bestehenden Anlage eine
              zusätzliche Ersparnis. Ihr Speicher deckt bei diesem Verbrauch bereits ab, was
              wirtschaftlich zu holen ist — mehr Kapazität stünde die meiste Zeit ungenutzt da.
            </p>
            <p className="mt-2 text-xs">
              Das ist eine Aussage über <strong>diesen</strong> Lastgang und diese Tarifangaben.
              Wächst Ihr Verbrauch, ändert sich Ihr Tarif oder kommt PV dazu, kann die Antwort eine
              andere sein.
            </p>
          </AlertDescription>
        </Alert>
      )}
    </section>
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
            Der primäre Block: die bestehende Anlage des Kunden, sonst die Empfehlung.
            Ausgeschrieben in zwei Zweigen statt über eine berechnete `variant`-Prop, weil die
            beiden VERSCHIEDENE Eingangsdaten haben: die Anlage trägt keine Investition
            (`BatteryResultEntry`), der Katalog-Kandidat schon. Genau das setzt die diskriminierte
            Props-Union durch — eine Variable im `variant` würde sie umgehen.

            Ersparnis, Aufschlüsselung und Vorbehalte sind in beiden Fällen dieselben.
          */}
          {existingAnalysis ? (
            <RecommendationCard
              entry={existingAnalysis.entry}
              primary
              variant="existing"
              efficiencyAssumed={existingBattery?.efficiencyAssumed}
            />
          ) : (
            recommended && <RecommendationCard entry={recommended} primary />
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
        Im Bestandsfall: die Zusatzspeicher-Frage statt der Neuanschaffungs-Empfehlung. Die
        Alternativen-Aufklappliste des Katalog-Laufs entfällt dort — sie beantwortete „welchen
        Speicher soll ich kaufen", und diese Frage stellt sich einem Kunden mit Anlage nicht.
      */}
      {isExisting ? addonSection : alternativesAccordion}

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
              // Im Panel ist ausschliesslich ein Katalog-Gerät bearbeitbar (s. `selectedBatteryId`).
              batterySource="catalog_preset"
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
