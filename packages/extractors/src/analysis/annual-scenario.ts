import { buildSyntheticYearProfile, computeAnalysis, type SyntheticYearBlocker } from 'engine'
import type { CalculatorPayload } from 'engine'
import {
  SPOT_PRICE_ANCHOR_DATE,
  analysisWindow,
  primaryBatteryEntry,
  tariffWayCosts,
  type AnalysisWindow,
  type AnnualScenario,
  type BatteryCandidate,
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
  catalog: BatteryCandidate[]
  fetchTariffPricing: AnnualScenarioPricingReader
  /**
   * Der Tag, an dem gerechnet wird — die obere Kante des Jahresfensters ist der Tag DAVOR.
   *
   * ⚠ Ein Pflichtparameter ohne Vorgabewert, dieselbe Haltung wie bei `formatPrintedAt` und
   * `startsBeforeSpotPriceAnchor`: eine stillschweigend gelesene Uhr machte aus einer reinen
   * Funktion eine, deren Ergebnis vom Zeitpunkt des Testlaufs abhängt.
   */
  today: Date
}

/**
 * Das Jahres-Szenario bauen — oder benennen, warum nicht.
 *
 * ── DER ABLAUF ────────────────────────────────────────────────────────────────────────────────
 *  1. Synthetischer Jahres-Lastgang aus der Referenzwoche (`buildSyntheticYearProfile`).
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
  const { payload, horizonYears, catalog } = options

  /*
   * ⚠ DIE GRENZEN DES FENSTERS KOMMEN VON HIER UND NICHT AUS DEM RECHENKERN. Unten der Anker, ab
   * dem `public.spot_prices` überhaupt geführt wird (Delta 15 Regel B); oben der GESTRIGE Tag —
   * der heutige ist noch nicht zu Ende und hätte keine vollständige Preiskurve.
   */
  const bounds = {
    earliestDate: SPOT_PRICE_ANCHOR_DATE,
    latestDate: localDateKey(
      new Date(options.today.getTime() - DAY_MS),
      payload.load.profile.timezoneMeta,
    ),
  }

  const synthetic = buildSyntheticYearProfile(payload.load.profile, bounds, payload.pv?.profile)
  if (!synthetic.ok) return { ok: false, blocker: synthetic.blocker }
  const year = synthetic.value

  const window = analysisWindow(year.profile)
  if (window === null) return { ok: false, blocker: 'no_data' }

  const tariffPricing = await options.fetchTariffPricing({
    window,
    intervalMinutes: year.profile.intervalMinutes,
  })

  const result = computeAnalysis(
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

  return {
    ok: true,
    value: {
      windowFromDate: year.windowFromDate,
      windowToDate: year.windowToDate,
      measuredDays: year.measuredDays,
      projectedDays: year.projectedDays,
      reference: {
        fromDate: year.reference.fromDate,
        toDate: year.reference.toDate,
        consumptionKwh: year.reference.consumptionKwh,
        rateKwhPerDay: year.reference.rateKwhPerDay,
      },
      ways: {
        ...ways,
        /*
         * Weg 5 aus DEMSELBEN Eintrag, den der gemessene Report als „Ihren Speicher" bezeichnet
         * (`primaryBatteryEntry`, `shared`) — sonst zeigte das Jahreskapitel die Kappung eines
         * anderen Geräts als das Kapitel darüber. `0` heisst „dieser Weg trifft nicht zu".
         */
        peakShavingSavingEur: primaryBatteryEntry(result)?.leistungspreisSavingPerYear ?? 0,
      },
    },
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Lokaler Kalendertag als `YYYY-MM-DD` — `en-CA` liefert genau dieses Format (s. `analysis-window.ts`). */
function localDateKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}
