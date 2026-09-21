import type { BatteryCandidate, LoadProfile, TariffParams, TariffPricingInputs } from 'shared'
import { buildRealSavingBreakdown, sumCovered } from 'shared'

import { dailyPriceOrder, type DailyPriceOrder } from '../simulation/daily-price-order'
import { runCombinedDispatch } from '../simulation/dispatch'
import { drawSeries, intervalHours, startSoc, toPhysics } from '../simulation/helpers'
import { buildMonthlyTariffComparison } from '../simulation/monthly-tariff-comparison'
import { peakConstraints } from '../simulation/peak-constraints'
import { intervalTariffRates } from '../simulation/tou'
import {
  DEFAULT_CONSUMPTION_PATTERN_SCHEME,
  forecastDrawSeries,
  type ConsumptionPatternScheme,
} from './consumption-pattern'

/**
 * „Zahl 2" — der VORAUSSCHAUENDE `controlValueEur`
 * (`Pflichtenheft_Vorausschauende_Ladesteuerung.md`, Weg a aus §4 — s. den `cap`/`socFloor`-Block).
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
 * ── `cap`/`socFloor`: WEG a — AUS DEM RÜCKBLICK-LAUF ÜBERNOMMEN (Andreas, 21.09.2026) ─────────
 * Beide sind PERIODENgrössen — `cap` aus einer binären Suche über die ganze Abrechnungsperiode,
 * `socFloor` aus einem Rückwärts-Pass über das ganze Jahr (§2.4). Eine Steuerung mit Tageshorizont
 * kann sie nicht kennen. Von den drei in §4 genannten Wegen ist **Weg a** gewählt: dieselben
 * Schranken wie im Rückblick-Lauf, gebildet über `peakConstraints` — also genau die, die
 * `simulateBattery` für denselben Kunden und denselben Zeitraum bildet (EINE Definition, deshalb
 * das eigene Modul). Vorher war ausschliesslich **Weg c** gebaut (`cap = ∞`, `socFloor ≡ 0`) und
 * der Fall „Leistungspreis > 0" mit dem Grund `demand_charge` verweigert; dieser Blocker ist damit
 * entfallen, die Zahl gilt jetzt für ALLE Kunden mit echter Preiskurve und echtem Lastgang.
 *
 * **⚠ UND DAS MUSS DASTEHEN (§4, Wortlaut von Weg a): der Lauf ist damit nur zur HÄLFTE
 * vorausschauend.** Die Spitzenschutz-Seite ist perfektes Wissen — simuliert, nicht prognostiziert.
 * Vorausschauend ist allein die Verbrauchserwartung (`draws`). Der Marker
 * `basis: 'foresight_unvalidated'` bleibt deshalb unverändert an der Zahl; was sich mit Weg a
 * ändert, ist ihr Geltungsbereich, nicht ihre Belastbarkeit.
 *
 * Für Kunden ohne Leistungspreis ändert sich dabei NICHTS: dort setzt der Blocker
 * `no_demand_charge` (Delta 3/9b-1) dieselben Schranken auf `cap = ∞`/`socFloor ≡ 0`, die Weg c
 * von Hand gesetzt hat — der bisherige Pfad ist ein Sonderfall von Weg a geworden.
 *
 * **⚠ GEMESSENE NEBENWIRKUNG VON WEG a, die beim Lesen der Zahl mitgedacht gehört:** `searchCaps`
 * liefert die NIEDRIGSTE tragbare Schwelle, und je breiter die zu kappende Spitze ist, desto mehr
 * Kapazität bindet die daraus folgende Reserve. Bindet sie fast alles, wird die Zahl gegenüber der
 * Prognose UNEMPFINDLICH — an einer synthetischen Fünf-Stunden-Plateau-Last (30 kWh/10 kW,
 * `socFloor` max 25,8 kWh, in 468 von 480 Intervallen > 0) unterscheiden sich die beiden Läufe in
 * 420 Intervallen in `priceFloorKwh`, der Fahrplan danach aber in KEINEM: `realizationRatio` ist
 * exakt 1,000. Mit einer kurzen Spitze statt des Plateaus (`socFloor` max 8,0 kWh) schlägt dieselbe
 * Prognose durch: 0,955. Ein Verhältnis von 1,000 bei einem Leistungspreis-Kunden ist also nicht
 * automatisch eine perfekte Prognose, sondern zuerst ein Hinweis auf eine gebundene Batterie.
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
      /**
       * Die Spitzenschutz-Schranken, unter denen BEIDE Läufe geplant und ausgeführt wurden — aus
       * dem Rückblick-Lauf übernommen (Weg a, s. Modulkopf). Herausgereicht, damit der Nachweis
       * belegen kann, dass sie tatsächlich von dort stammen und nicht konstant `∞`/0 sind.
       * `capKwByPeriod` hat Contract-Länge 1 (`annual_max`) bzw. 12 (`monthly_*`).
       */
      capKwByPeriod: number[]
      socFloorKwh: number[]
      /**
       * Die Monatsreihe des VORAUSSCHAUENDEN Laufs — dieselbe Grösse wie
       * `MonthlyTariffComparison.spotWithBatteryEur`, nur aus diesem Fahrplan.
       *
       * ⚠ Sie wird hier ohnehin gebildet (die Kassen-Grösse entsteht aus ihr); herausgereicht
       * wird sie, damit der Report Weg 4 zeigen kann, ohne die Reihe ein zweites Mal zu rechnen.
       */
      predictiveMonthlyEur: (number | null)[]
    }
  | { ok: false; reason: PredictiveControlValueBlocker }

export type PredictiveControlValueInputs = {
  loadProfile: LoadProfile
  battery: BatteryCandidate
  tariffParams: TariffParams
  pricing: TariffPricingInputs
  scheme?: ConsumptionPatternScheme
}

/**
 * Tage ohne Muster bekommen KEINE Preis-Rangfolge — nicht ersatzweise die des Rückblick-Laufs.
 *
 * ⚠ Gemeint sind allein die beiden Schranken von `dailyPriceOrder` (`chargeCeilingKwh`,
 * `priceFloorKwh`), die aus der Verbrauchserwartung entstehen. `cap`/`socFloor` bleiben auch an
 * diesen Tagen die des Rückblick-Laufs — sie sind der Spitzenschutz und hängen an keiner Prognose
 * (Weg a, s. Modulkopf).
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
  const { loadProfile, battery, tariffParams, pricing } = inputs
  const scheme = inputs.scheme ?? DEFAULT_CONSUMPTION_PATTERN_SCHEME

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
  // Weg a: die Schranken des Rückblick-Laufs, gebildet von derselben Funktion, die
  // `simulateBattery` benutzt — perfektes Wissen auf der Spitzenschutz-Seite (s. Modulkopf).
  const { capKwByPeriod, capForInterval, socFloorKwh } = peakConstraints(
    loadProfile,
    battery,
    tariffParams,
  )

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
  const runFor = (
    order: DailyPriceOrder,
  ): { controlValueEur: number; monthlyEur: (number | null)[] } | undefined => {
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
    return {
      controlValueEur: buildRealSavingBreakdown({
        currentTariffEur: sumCovered(comparison.currentTariffEur),
        spotWithoutControlEur: sumCovered(comparison.spotWithoutControlEur),
        spotWithBatteryEur: sumCovered(comparison.spotWithBatteryEur),
      }).controlValueEur,
      monthlyEur: comparison.spotWithBatteryEur,
    }
  }

  const hindsight = runFor(orderFor(measuredDraws))
  const predictive = runFor(
    withoutPlanOnDaysMissingPattern(
      orderFor(forecast.forecastKw),
      forecast.hasPattern,
      physics.usableCapacityKwh,
    ),
  )
  if (hindsight === undefined || predictive === undefined) {
    return { ok: false, reason: 'comparison_unavailable' }
  }
  const hindsightControlValueEur = hindsight.controlValueEur
  const predictiveControlValueEur = predictive.controlValueEur

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
    capKwByPeriod,
    socFloorKwh,
    predictiveMonthlyEur: predictive.monthlyEur,
  }
}
