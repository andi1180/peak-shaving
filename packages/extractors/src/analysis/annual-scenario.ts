import {
  AnalysisRefusedError,
  buildSyntheticYearProfile,
  computeAnalysis,
  type SyntheticYearBlocker,
} from 'engine'
import type { CalculatorPayload } from 'engine'
import {
  SPOT_PRICE_ANCHOR_DATE,
  analysisWindow,
  peakShavingSavingPerYearOf,
  pinRatesToDate,
  primaryBatteryEntry,
  tariffWayCosts,
  type AnalysisResult,
  type AnalysisWindow,
  type AnnualScenario,
  type TariffPricingInputs,
} from 'shared'

/**
 * D6 Teil 3 — „WAS WÄRE, WENN WIR EIN GANZES JAHR HÄTTEN?"
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES IST EIN ZWEITER LAUF DERSELBEN RECHNUNG, KEINE ZWEITE RECHNUNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Gerechnet wird mit dem UNVERÄNDERTEN `computeAnalysis` (Prinzip 2: ein Dispatch, eine ehrliche
 * Zahl) — nur auf einem anderen Lastgang. Getauscht sind genau zwei Dinge im Payload: das
 * Lastprofil (365 Tage statt der gemessenen) samt mitgewachsener Brutto-PV-Reihe, und die
 * Preisseiten (dasselbe Fenster wie der neue Lastgang). Alles Übrige — Tarif, Bestandsbatterie,
 * Finanzierung — reist unverändert mit. Eine eigene Jahres-Formel für Batterie oder Spitzenkappung
 * gibt es hier nicht und darf es nicht geben: sie liefe beim nächsten Engine-Ausbau von der
 * gemessenen Rechnung weg, und der Unterschied sähe aus wie ein Jahresgang.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WAS NICHT BELEGT IST, WIRD NICHT GERECHNET, SONDERN VERWEIGERT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Für das Jahresfenster werden dieselben Preisseiten gelesen wie für den gemessenen Zeitraum, aus
 * demselben gepflegten Bestand. Fehlt darin etwas — eine Netzentgelt-Zeile, die den früheren
 * Zeitraum nicht abdeckt, eine Preislücke, ein Abgabensatz —, meldet die Engine das wie immer als
 * nicht berechenbar, und dieses Kapitel ENTFÄLLT mit benanntem Grund. Es wird ausdrücklich NICHTS
 * nachgeladen und nichts genähert: dafür gibt es den anderen, parallelen Weg
 * (`projectAnnualTariffComparison`, D6 Teil 2b), und die beiden Zahlen antworten auf verschiedene
 * Fragen.
 *
 * ⚠ Ohne `import 'server-only'`: alles kommt durch den Port herein, der Paket-Barrel trägt die
 * Markierung ohnehin — dieselbe Lage wie bei `gap-market-prices.ts`.
 */

/** Warum kein Jahres-Szenario entstanden ist. */
export type AnnualScenarioBlocker =
  | SyntheticYearBlocker
  /** Der Jahreslauf selbst ist nicht berechenbar — Netzentgelte, Preise oder Abgaben decken ihn nicht ab. */
  | 'not_computable'
  /** Der Hauptreport nennt kein Gerät — ohne es gibt es keinen Weg 4 und keine Kappung. */
  | 'no_device'

export type AnnualScenarioResult =
  | { ok: true; value: AnnualScenario }
  | { ok: false; blocker: AnnualScenarioBlocker }

/** Der Port: dieselben zwei Preisseiten, nur für ein anderes Fenster. */
export type AnnualScenarioPricingReader = (request: {
  window: AnalysisWindow
  intervalMinutes: number
}) => Promise<TariffPricingInputs>

export type AnnualScenarioOptions = {
  /** Der Payload des GEMESSENEN Laufs — er wird gelesen, nie verändert. */
  payload: CalculatorPayload
  horizonYears: number
  /** Das Ergebnis des gemessenen Laufs — sein primäres Gerät ist das einzige, das gerechnet wird. */
  measured: Pick<AnalysisResult, 'perBattery' | 'recommendation' | 'existingBatteryAnalysis'>
  fetchTariffPricing: AnnualScenarioPricingReader
}

/**
 * Das Jahres-Szenario bauen — oder benennen, warum nicht.
 *
 * ── DER ABLAUF ────────────────────────────────────────────────────────────────────────────────
 *  1. Synthetischer Jahres-Lastgang aus dem gemessenen Wochenblock (`buildSyntheticYearProfile`).
 *  2. Preisseiten für dessen Fenster über den Port.
 *  3. `computeAnalysis` auf dem neuen Payload — die GANZE Kette, Dispatch eingeschlossen.
 *  4. Aus dem Ergebnis die fünf Wege ablesen: vier Tarifwege über `tariffWayCosts` (dieselbe
 *     Auswahl wie im gemessenen Kapitel) und die Spitzenkappung aus dem primären Speicher.
 *
 * ⚠ DIE `dataQuality` DES SYNTHETISCHEN LAUFS WIRD NEU GEBILDET und nicht vom echten übernommen:
 * sie beschreibt einen Lastgang, den es so nicht gibt. Gelesen wird sie von diesem Weg nirgends —
 * sie in den Payload zu schreiben, als beschriebe sie 209 gemessene Tage, wäre trotzdem eine
 * Behauptung, die beim nächsten Leser ankommt.
 */
export async function buildAnnualScenario(
  options: AnnualScenarioOptions,
): Promise<AnnualScenarioResult> {
  const { payload, horizonYears, measured } = options

  // Das Gerät des Hauptreports und nur dieses: ein Katalog-Neulauf auf dem verlängerten Lastgang
  // könnte ein anderes Gerät empfehlen, und das Jahreskapitel spräche dann von einem fremden Speicher.
  const device = primaryBatteryEntry(measured)
  if (!device) return { ok: false, blocker: 'no_device' }
  // Ein Bestandsspeicher reist im Payload mit (`existingBattery`); der Katalog bleibt dann leer.
  const catalog = measured.existingBatteryAnalysis ? [] : [device.battery]

  /*
   * Das Fenster endet am LETZTEN MESSTAG (das Jahr bis zur jüngsten Messung, keine Tage danach);
   * unten begrenzt es der Anker, ab dem `public.spot_prices` geführt wird (Delta 15 Regel B).
   */
  const lastMeasuredDate = lastLocalDateOf(payload.load.profile)
  if (lastMeasuredDate === null) return { ok: false, blocker: 'no_data' }
  const bounds = { earliestDate: SPOT_PRICE_ANCHOR_DATE, latestDate: lastMeasuredDate }

  const synthetic = buildSyntheticYearProfile(payload.load.profile, bounds, payload.pv?.profile)
  if (!synthetic.ok) return { ok: false, blocker: synthetic.blocker }
  const year = synthetic.value

  const window = analysisWindow(year.profile)
  if (window === null) return { ok: false, blocker: 'no_data' }

  // Netzentgelte und Abgaben im Stand des letzten Messtags über das ganze Fenster.
  const ratesAsOf = year.windowToDate
  const tariffPricing = pinRatesToDate(
    await options.fetchTariffPricing({ window, intervalMinutes: year.profile.intervalMinutes }),
    ratesAsOf,
    { fromDate: year.windowFromDate, toDate: year.windowToDate },
  )

  const result = computeYearOrRefusal(
    {
      ...payload,
      load: {
        ...payload.load,
        profile: year.profile,
        dataQuality: {
          coveredDays: year.measuredDays + year.projectedDays,
          coveredMonths: 12,
          gapsInterpolated: 0,
          largestGapSlots: 0,
          warnings: [],
        },
      },
      ...(year.pvProfile && payload.pv
        ? { pv: { ...payload.pv, profile: year.pvProfile } }
        : {}),
      tariffPricing,
    },
    horizonYears,
    catalog,
  )
  if (result === null) return { ok: false, blocker: 'not_computable' }

  /*
   * ⚠ `computable === true` allein reicht nicht: der Monatsvergleich ist im Contract auch dort
   * optional (`TariffOptimizationStatus`), und ohne ihn gäbe es keine der vier Tarifzeilen.
   */
  const comparison =
    result.tariffOptimization?.computable === true
      ? result.tariffOptimization.monthlyComparison
      : undefined
  if (!comparison) return { ok: false, blocker: 'not_computable' }
  const ways = tariffWayCosts(comparison)
  const entry = primaryBatteryEntry(result)
  const peakShavingSavingEur = peakShavingSavingPerYearOf(entry)

  return {
    ok: true,
    value: {
      windowFromDate: year.windowFromDate,
      windowToDate: year.windowToDate,
      ratesAsOf,
      device: { batteryId: device.battery.id, name: device.battery.name },
      measuredDays: year.measuredDays,
      projectedDays: year.projectedDays,
      fill: {
        blockFromDate: year.block.fromDate,
        blockToDate: year.block.toDate,
        blockWeeks: year.block.weeks,
      },
      ways: {
        ...ways,
        // Weg 5 wie im Hauptreport: Leistungspreis inkl. Gebrauchsabgabe plus EAG-Förderbeitrag Leistung.
        peakShavingSavingEur,
        peakShavingEagEur: peakShavingSavingEur > 0 ? (entry?.eagDemandSavingPerYear ?? 0) : 0,
      },
    },
  }
}

/** Der lokale Kalendertag des letzten Intervalls (`YYYY-MM-DD`) — `null` ohne lesbaren Zeitstempel. */
function lastLocalDateOf(profile: CalculatorPayload['load']['profile']): string | null {
  let lastMs = Number.NEGATIVE_INFINITY
  for (const reading of profile.readings) {
    const ms = Date.parse(reading.ts)
    if (ms > lastMs) lastMs = ms
  }
  if (!Number.isFinite(lastMs)) return null
  // `en-CA` liefert genau `YYYY-MM-DD` (s. `analysis-window.ts`).
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: profile.timezoneMeta,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(lastMs))
}

/**
 * Ein unbekannter Liefertarif ohne rechenbaren Preisbestand im Jahresfenster wird verweigert
 * (`AnalysisRefusedError`) — das Kapitel entfällt dann wie bei jedem nicht rechenbaren Jahreslauf.
 */
function computeYearOrRefusal(
  ...args: Parameters<typeof computeAnalysis>
): ReturnType<typeof computeAnalysis> | null {
  try {
    return computeAnalysis(...args)
  } catch (error) {
    if (error instanceof AnalysisRefusedError) return null
    throw error
  }
}
