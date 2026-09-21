import type { BatteryCandidate, LoadProfile, TariffParams, TariffPricingInputs } from 'shared'
import { buildRealSavingBreakdown, sumCovered } from 'shared'

import { dailyPriceOrder, type DailyPriceOrder } from '../simulation/daily-price-order'
import { runCombinedDispatch } from '../simulation/dispatch'
import { drawSeries, intervalHours, startSoc, toPhysics } from '../simulation/helpers'
import { buildMonthlyTariffComparison } from '../simulation/monthly-tariff-comparison'
import { intervalTariffRates } from '../simulation/tou'
import {
  DEFAULT_CONSUMPTION_PATTERN_SCHEME,
  forecastDrawSeries,
  type ConsumptionPatternScheme,
} from './consumption-pattern'

/**
 * „Zahl 2" — der VORAUSSCHAUENDE `controlValueEur`
 * (`Pflichtenheft_Vorausschauende_Ladesteuerung.md`, Weg c aus der Bestandsaufnahme §3.4).
 *
 * ── ⚠ WOFÜR DIESE ZAHL DA IST, UND WOFÜR NICHT ─────────────────────────────────────────────────
 * Sie ist ein INTERNER Nachweis: was die Ladesteuerung erreicht hätte, wenn sie am Vorabend nur
 * gewusst hätte, was eine reale Steuerung weiss. Sie steht in KEINEM Report, in KEINER Oberfläche
 * und in KEINEM Analyse-Bündel — ob sie je kundenseitig erscheint, ist eine offene
 * Produktentscheidung (§2.6, §4). Sie ist ausserdem NICHT validiert: eine Gegenrechnung gegen den
 * eigenen historischen Lastgang sagt, wie gut das Verfahren auf VERGANGENEN Daten abgeschnitten
 * hätte, nicht was eine reale Anlage im nächsten Jahr erreicht (§3, fünfte Zeile). Der Marker
 * `basis: 'foresight_unvalidated'` reist deshalb mit der Zahl mit — Muster `energyPriceBasis`
 * (`invoice-scan.ts`): ein Vermerk, den niemand sieht, schützt niemanden.
 *
 * ── ES ENTSTEHT KEIN ZWEITER PLANER, ES WIRD EINE EINGABE GETAUSCHT (§1) ───────────────────────
 * Beide Läufe unten benutzen denselben `dailyPriceOrder` und denselben `runCombinedDispatch`.
 * Der einzige Unterschied ist, welche `draws` die Tages-Rangfolge SIEHT:
 *   • Rückblick-Lauf  — der gemessene Netzbezug des Tages (heutiges Produktivverhalten).
 *   • Vorausschau-Lauf — die Prognose aus dem eigenen Leave-one-out-Muster des Kunden.
 * AUSGEFÜHRT wird in beiden Fällen auf dem ECHTEN Lastgang: eine Steuerung plant mit ihrer
 * Erwartung, bezahlt aber die Wirklichkeit. Ein Dispatch über die Prognose selbst ergäbe Kosten
 * eines Jahres, das es nie gab.
 *
 * ── ⚠ AUSLÖSEBEDINGUNG: NUR OHNE LEISTUNGSPREIS (Weg c) ───────────────────────────────────────
 * `cap` und `socFloor` sind PERIODENgrössen — `cap` aus einer binären Suche über die ganze
 * Abrechnungsperiode, `socFloor` aus einem Rückwärts-Pass über das ganze Jahr. Eine Steuerung mit
 * Tageshorizont kann beide nicht kennen (§2.4). Welchen Wert ein vorausschauender Lauf bei einem
 * Kunden MIT Leistungspreis einsetzen müsste, ist im Pflichtenheft §4 ausdrücklich OFFEN
 * `[ANDREAS]`; hier wird deshalb nichts geraten, sondern mit benanntem Grund verweigert
 * (`demand_charge`) — dieselbe Haltung wie `peakShavingBlockers`.
 *
 * Bei `leistungspreisCostPerYear === 0` stellt sich die Frage gar nicht: der Blocker
 * `no_demand_charge` (Delta 3/9b-1) setzt den Produktivlauf für genau diese Kunden bereits auf
 * `cap = ∞` und `socFloor ≡ 0`. Weg c ist dort also keine Abweichung vom Produktivpfad, sondern
 * genau er — und die beiden Zahlen unten sind deshalb direkt vergleichbar.
 *
 * ── ⚠ DIE PV-SEITE STECKT BEREITS IN DER PROGNOSE — EIN ZWEITER PVGIS-LAUF WÜRDE DOPPELT ZÄHLEN ─
 * Der Lastgang ist der signierte NETZ-Lastgang am Anschlusspunkt; die Erzeugung einer vorhandenen
 * Anlage ist darin als gesenkter Bezug bereits enthalten (`load-profile.ts`, und seit dem
 * 19.09.2026 der Grund für `pv_already_in_grid_profile`). Das Eimermittel über gleichartige Tage
 * ist damit bereits eine PV-Klimatologie — die des KUNDENSTANDORTS, aus seinen eigenen Messwerten.
 * Die B22-Klimatologie ist unverändert wiederverwendbar (Bestandsaufnahme §1.1, null Zeilen
 * Änderung), aber hier zusätzlich aufzulegen hiesse, dieselbe Erzeugung zweimal abzuziehen. Ein
 * `PvProfile` ändert aus demselben Grund schon heute weder Dispatch noch Ersparnis
 * (`simulateBattery`, Kopf-Kommentar) und kann diese Zahl folglich nicht bewegen.
 */
export const PREDICTIVE_CONTROL_VALUE_BASIS = 'foresight_unvalidated' as const

export type PredictiveControlValueBlocker =
  /** Der Tarif hat einen Leistungspreis — `cap`/`socFloor` sind für einen Tageshorizont offen (§4). */
  | 'demand_charge'
  /** Synthetischer Lastgang: Muster und Wahrheit wären dieselbe Formel (§0.2). */
  | 'standard_profile'
  /** Ohne echte Preiskurve gibt es innerhalb eines Tages gar keine Rangfolge (§0.2). */
  | 'price_curve_not_computable'
  /** Kein einziger Kalendertag hat unter Leave-one-out einen Vergleichswert (§2.2). */
  | 'no_pattern'
  /** Der Monatsvergleich kam nicht zustande — ohne ihn gibt es keine Kassen-Grösse. */
  | 'comparison_unavailable'

export type PredictiveControlValueResult =
  | {
      ok: true
      /** ⚠ Unvalidiert, interner Nachweis — s. Modulkopf. */
      basis: typeof PREDICTIVE_CONTROL_VALUE_BASIS
      /** Zahl 2: der Beitrag der Ladesteuerung, mit den am Vorabend bekannten Eingaben (€). */
      predictiveControlValueEur: number
      /** Zahl 1: derselbe Beitrag mit vollem Rückblick — das heutige `controlValueEur` (€). */
      hindsightControlValueEur: number
      /**
       * Zahl 2 ÷ Zahl 1. `null`, wenn Zahl 1 nicht positiv ist (dann gibt es nichts zu erreichen).
       * ⚠ Über 1 kann sie nicht liegen, ohne dass etwas falsch ist — eine Steuerung ohne Rückblick
       * kann die Bestmarke nicht übertreffen (§5 Punkt 4).
       */
      realizationRatio: number | null
      /** Welches Eimer-Schema gerechnet wurde — die Wahl ist vorläufig (§4). */
      scheme: ConsumptionPatternScheme
      /** Kalendertage mit bzw. ohne Muster. Letztere planen gar nicht, statt ersatzweise zu planen. */
      patternDays: number
      daysWithoutPattern: number
    }
  | { ok: false; reason: PredictiveControlValueBlocker }

export type PredictiveControlValueInputs = {
  loadProfile: LoadProfile
  battery: BatteryCandidate
  tariffParams: TariffParams
  pricing: TariffPricingInputs
  /** Aus `analyzeCurrentPeaks` (§3.4) — die Auslösebedingung, s. Modulkopf. */
  leistungspreisCostPerYear: number
  scheme?: ConsumptionPatternScheme
}

/**
 * Tage ohne Muster bekommen KEINE Schranken — nicht ersatzweise die des Rückblick-Laufs.
 *
 * Das ist der Zustand „heute liegt kein Plan vor" und damit genau das, was eine reale Steuerung an
 * einem solchen Tag hätte; `daily-price-order.ts` liest ein Intervall ohne Tagesbezug bereits
 * ebenso (volle Kapazität, keine Untergrenze). Ein Rückfall auf den Gesamtmittelwert oder auf die
 * gemessenen Werte ist ausgeschlossen (§2.2).
 */
function withoutPlanOnDaysMissingPattern(
  order: DailyPriceOrder,
  hasPattern: boolean[],
  usableCapacityKwh: number,
): DailyPriceOrder {
  return {
    chargeCeilingKwh: order.chargeCeilingKwh.map((v, i) =>
      hasPattern[i] ? v : usableCapacityKwh,
    ),
    priceFloorKwh: order.priceFloorKwh.map((v, i) => (hasPattern[i] ? v : 0)),
  }
}

export function computePredictiveControlValue(
  inputs: PredictiveControlValueInputs,
): PredictiveControlValueResult {
  const { loadProfile, battery, tariffParams, pricing, leistungspreisCostPerYear } = inputs
  const scheme = inputs.scheme ?? DEFAULT_CONSUMPTION_PATTERN_SCHEME

  if (leistungspreisCostPerYear !== 0) return { ok: false, reason: 'demand_charge' }
  if (loadProfile.source === 'standard_profile') return { ok: false, reason: 'standard_profile' }

  const rates = intervalTariffRates(loadProfile, tariffParams, pricing)
  if (rates.tariffOptimization?.computable !== true) {
    return { ok: false, reason: 'price_curve_not_computable' }
  }

  const forecast = forecastDrawSeries(loadProfile, scheme)
  if (forecast.patternDays === 0) return { ok: false, reason: 'no_pattern' }

  const physics = toPhysics(battery)
  const deltaH = intervalHours(loadProfile)
  const measuredDraws = drawSeries(loadProfile)
  // Weg c: keine Kappschwelle, keine Spitzen-Reserve — identisch zur Konfiguration, die
  // `simulateBattery` für diese Kunden ohnehin wählt (Blocker `no_demand_charge`).
  const capForInterval = new Array<number>(measuredDraws.length).fill(Infinity)
  const socFloorKwh = new Array<number>(measuredDraws.length).fill(0)

  const orderFor = (draws: number[]): DailyPriceOrder =>
    dailyPriceOrder({
      loadProfile,
      rateCtPerKwh: rates.rateCtPerKwh,
      preferChargeInterval: rates.isCheapWindow,
      capForInterval,
      draws,
      physics,
      deltaH,
    })

  // Ausgeführt wird IMMER auf dem echten Lastgang — nur der Plan unterscheidet sich.
  const controlValueFor = (order: DailyPriceOrder): number | undefined => {
    const dispatch = runCombinedDispatch(
      measuredDraws,
      capForInterval,
      socFloorKwh,
      physics,
      startSoc(physics),
      deltaH,
      rates.isCheapWindow,
      order,
    )
    const comparison = buildMonthlyTariffComparison(
      loadProfile,
      tariffParams,
      pricing,
      dispatch.gridAfterKw,
    )
    if (!comparison) return undefined
    // Dieselbe EINE Definition wie die Kopfkarte des Reports (`real-saving.ts`) — kein zweiter
    // Reducer, der beim nächsten Ausbau davon abliefe.
    return buildRealSavingBreakdown({
      currentTariffEur: sumCovered(comparison.currentTariffEur),
      spotWithoutControlEur: sumCovered(comparison.spotWithoutControlEur),
      spotWithBatteryEur: sumCovered(comparison.spotWithBatteryEur),
    }).controlValueEur
  }

  const hindsightControlValueEur = controlValueFor(orderFor(measuredDraws))
  const predictiveControlValueEur = controlValueFor(
    withoutPlanOnDaysMissingPattern(
      orderFor(forecast.forecastKw),
      forecast.hasPattern,
      physics.usableCapacityKwh,
    ),
  )
  if (hindsightControlValueEur === undefined || predictiveControlValueEur === undefined) {
    return { ok: false, reason: 'comparison_unavailable' }
  }

  return {
    ok: true,
    basis: PREDICTIVE_CONTROL_VALUE_BASIS,
    predictiveControlValueEur,
    hindsightControlValueEur,
    realizationRatio:
      hindsightControlValueEur > 0
        ? predictiveControlValueEur / hindsightControlValueEur
        : null,
    scheme,
    patternDays: forecast.patternDays,
    daysWithoutPattern: forecast.daysWithoutPattern,
  }
}
