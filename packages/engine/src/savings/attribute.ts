import {
  demandChargePerYear,
  type BatteryCandidate,
  type EnergySavingBasis,
  type LevySchedule,
  type LoadProfile,
  type TariffParams,
  type TariffPricingInputs,
} from 'shared'

import { energyCostEur } from '../simulation/energy-cost'
import { drawSeries, intervalHours } from '../simulation/helpers'
import { peakShavingBlockers } from '../simulation/peak-shaving'
import { simulateBattery, type BatterySimulationResult } from '../simulation/simulate'
import { intervalTariffRates } from '../simulation/tou'
import { feedInTariffCtPerKwh } from '../refusal'
import { coveredMonthCount } from '../peaks/metrics'
import { getTariffStrategy } from '../tariff/strategy'
import { usageLevyFactor } from '../tariff/usage-levy'
import { annualizationFactor, coveredDaysOf } from './annualization'

/**
 * Kombinierter Dispatch → Ersparnis (§3.7). EIN Simulationslauf (§3.6), zwei exakte Anteile:
 * Leistungspreis (ratenbasiert) und Energie (volle Kostendifferenz der Netzreihen ohne und mit
 * Speicher). `totalSavingPerYear === leistungspreis + energy` gilt per Konstruktion.
 */
export type BatterySavings = {
  /** ABGERECHNETER kW-Wert, wie er im Report ausgewiesen wird (bei `static` = alter Wert, s. controlType). */
  newBilledKw: number
  /** Leistungspreis-Ersparnis = (alter − neuer billedKw) × Leistungspreis. `static` → 0 (nicht kreditiert). */
  leistungspreisSavingPerYear: number
  /** Energie-Ersparnis pro Jahr: `energySavingOverCoveredPeriod × annualizationFactor`. */
  energySavingPerYear: number
  /**
   * Energiekosten ohne Speicher − mit Speicher über den abgedeckten Zeitraum (nicht hochgerechnet).
   * Enthält Kapp-Entladungen, Ladeverluste und den Ladestand an den Rändern; kann negativ sein.
   */
  energySavingOverCoveredPeriod: number
  /** Womit bewertet wurde — `energy_price_only` ist eine Einschränkung, s. `EnergySavingBasis`. */
  energySavingBasis: EnergySavingBasis
  /** `365 / coveredDays` bei einem echten Teilzeitraum-Lastgang, sonst exakt `1` (s. `annualizationFactor`). */
  annualizationFactor: number
  /** Abgedeckte Tage des Lastgangs — die Bezugsgrösse des Faktors, damit der Report sie benennen kann. */
  coveredDays: number
  /** Leistungspreis- plus Energie-Anteil aus DEMSELBEN Fahrplan. */
  totalSavingPerYear: number
  /** Contract-Warnungen (z.B. static-Steuerung: Spitzenkappung nicht kreditiert). */
  warnings: string[]
}

export function computeBatterySavings(
  loadProfile: LoadProfile,
  battery: BatteryCandidate,
  tariffParams: TariffParams,
  precomputed?: BatterySimulationResult,
  pricing?: TariffPricingInputs,
  /** Abgabenplan für die Gebrauchsabgabe auf den Leistungspreis, auch ohne Tarifvergleich. */
  levies?: LevySchedule | null,
): BatterySavings {
  const sim = precomputed ?? simulateBattery(loadProfile, battery, tariffParams, undefined, pricing)

  const strategy = getTariffStrategy(tariffParams.billingModel)
  const oldBilledKw = strategy.billedKw(loadProfile, tariffParams)

  /*
   * Bewertet wird mit derselben Preisreihe, gegen die der Fahrplan geladen hat: mit rechenbaren
   * Preisdaten der volle Intervallpreis (Energie, Netz, Abgaben — dieselbe Reihe wie „aWATTar" im
   * Monatsvergleich), sonst Arbeitspreis/Nachttarif.
   */
  const rates = intervalTariffRates(loadProfile, tariffParams, pricing)
  const prices = {
    drawCtPerKwh: rates.rateCtPerKwh,
    feedInCtPerKwh: feedInTariffCtPerKwh(loadProfile, tariffParams),
    deltaHours: intervalHours(loadProfile),
  }
  const energySavingOverCoveredPeriod =
    energyCostEur(drawSeries(loadProfile), prices).totalEur -
    energyCostEur(sim.dispatch.gridAfterKw, prices).totalEur
  const energySavingBasis: EnergySavingBasis =
    rates.tariffOptimization?.computable === true ? 'full_price' : 'energy_price_only'
  // Der Leistungspreis-Anteil ist bereits eine Jahresgrösse; hochgerechnet wird nur die Energie.
  const factor = annualizationFactor(loadProfile)
  const energySavingPerYear = energySavingOverCoveredPeriod * factor

  // ── Zuschreibung der Spitzenkappung (§3.6/§3.7; Martins Semantik OP#5, Delta 3/8) ───────────────
  // controlType ist eine Frage der STEUERUNGS-Konfiguration, nicht der Batteriezelle.
  //  • 'dynamic' → Spitzenkappung: voller Leistungspreis-Anteil kreditiert (newBilledKw = gekappt).
  //  • 'static'  → NUR Energie-Anteil, KEINE Spitzenkappung: `leistungspreisSaving = 0`
  //    und newBilledKw = alter (ungekappter) Wert. Der zugrunde liegende Fahrplan ist bereits
  //    reserve-frei simuliert (`simulateBattery`, cap = ∞ / socFloor ≡ 0 für static) → Eigenverbrauch
  //    nutzt die volle Kapazität. Der Energie-Anteil oben stammt aus GENAU diesem Fahrplan.
  //  • Delta 8 (9b-1): derselbe Zweig gilt für ein SYNTHETISCHES Standardlastprofil, auch bei einer
  //    'dynamic'-Batterie und auch bei einem Leistungspreis > 0. Ohne diese Zurücknahme entstünde
  //    aus dem reserve-freien Fahrplan eine Differenz zum ungekappten `billedKw` — mal positiv, mal
  //    negativ — und die würde als Spitzenkappungs-Ersparnis auf eine erfundene Spitze kreditiert.
  //  • Delta 3 (erste Anwendung): ebenso bei einem Tarif OHNE Leistungspreis. Rechnerisch ändert der
  //    Zweig hier nichts (der `else`-Ausdruck ergäbe × 0 = 0); seine Wirkung liegt in der
  //    SIMULATION, die dadurch reserve-frei läuft — und genau deshalb MUSS die Zuschreibung
  //    denselben Zweig nehmen: derselbe reserve-freie Fahrplan verschiebt `sim.newBilledKw`
  //    gegenüber dem ungekappten Wert, und `newBilledKw` ist eine ausgewiesene Report-Zahl, keine
  //    blosse Zwischengrösse. Sie dürfte nicht behaupten, die Batterie senke den abgerechneten
  //    Leistungswert, wenn gar nicht gekappt wurde.
  //    Die Bedingung selbst steht in `peakShavingBlockers`, damit Simulation und Zuschreibung
  //    nicht getrennt voneinander entscheiden können.
  const warnings: string[] = []
  let newBilledKw: number
  let leistungspreisSavingPerYear: number
  const blockers = peakShavingBlockers(loadProfile, battery, tariffParams)
  if (blockers.length > 0) {
    newBilledKw = oldBilledKw
    leistungspreisSavingPerYear = 0
    /*
     * Je Grund ein eigener Satz, und alle zutreffenden nebeneinander: „statische Steuerung" erklärt
     * einem Kunden mit synthetischem Lastgang nicht, warum auch die dynamische Batterie daneben
     * nichts kappt — und umgekehrt. Ein gemeinsamer, allgemeiner Satz („keine Spitzenkappung")
     * verlöre genau die Information, die den Unterschied ausmacht: der eine Grund ist mit anderer
     * Hardware behebbar, der zweite mit einem echten Lastgang, der dritte gar nicht — dort ist
     * nichts zu beheben, weil nichts fehlt.
     */
    if (blockers.includes('static_control')) {
      warnings.push(
        'Statische Steuerung: nur Eigenverbrauch/Lastverschiebung, keine Spitzenkappung — der ' +
          'Leistungspreis-Anteil wird nicht kreditiert. Mit zusätzlicher Steuerungshardware ' +
          '(z. B. Smartfox/iHome Manager) auf Peak-Shaving aufrüstbar; die Kostenmodellierung dieser ' +
          'Aufrüstung ist offen bis zum realen Katalog (OP#2).',
      )
    }
    if (blockers.includes('standard_profile')) {
      warnings.push(
        'Synthetisches Standardlastprofil: die Spitzenkappung wird nicht gerechnet und nicht ' +
          'kreditiert — ein Durchschnittsprofil trägt keine individuelle Lastspitze, und eine ' +
          'daraus geschätzte Leistungspreis-Ersparnis wäre eine erfundene Zahl. Für diese ' +
          'Dimension bitte einen echten Lastgang hochladen.',
      )
    }
    /*
     * B22 — der Satz nennt AUSDRÜCKLICH beide Hälften: was geschätzt ist (die Erzeugung) und was
     * dadurch nicht mehr beurteilbar ist (die Spitze). „Die PV ist geschätzt" allein liesse offen,
     * warum daraus eine ganze Ersparnis-Dimension entfällt — und genau das ist die Information, die
     * ein Kunde braucht, um zu entscheiden, ob er sich den echten Lastgang besorgt.
     */
    if (blockers.includes('estimated_pv')) {
      warnings.push(
        'Geschätzte PV-Erzeugung: die Erzeugungskurve stammt nicht aus Ihrer Anlage, sondern aus ' +
          'einem Zehn-Jahres-Mittel des EU-Dienstes PVGIS für Ihren Standort und Ihre Auslegung. ' +
          'Sie wurde vom Verbrauch abgezogen — damit ist jede Lastspitze dieses Lastgangs zur ' +
          'Hälfte eine Schätzung, und die Spitzenkappung wird deshalb nicht gerechnet und nicht ' +
          'kreditiert. Eigenverbrauch und Lastverschiebung bleiben aussagekräftig, sind aber ' +
          'ebenfalls eine Schätzung. Für die Leistungspreis-Dimension bitte einen Lastgang mit ' +
          'gemessener Einspeisung hochladen.',
      )
    }
    /*
     * Anders als die beiden Gründe darüber benennt dieser KEINEN Mangel: es fehlt weder Hardware
     * noch ein Messwert, der Tarif hat den Posten schlicht nicht. Der Satz sagt deshalb, dass das
     * Ergebnis vollständig ist, statt zu einer Nachbesserung aufzufordern — und er erklärt die 0 in
     * der Ersparnis-Aufschlüsselung, die sonst wie ein Rechenfehler aussähe. Zugleich ist er der
     * Hinweis darauf, dass die volle Kapazität dem Eigenverbrauch zugutekommt.
     */
    if (blockers.includes('no_demand_charge')) {
      warnings.push(
        'Tarif ohne Leistungspreis: es gibt keinen Leistungspreis-Anteil, der sich kappen liesse — ' +
          'die Spitzenkappung wird deshalb nicht gerechnet und nicht kreditiert. Das ist kein ' +
          'fehlender Wert, sondern eine Eigenschaft Ihrer Abrechnung; die volle Batteriekapazität ' +
          'steht dafür dem Eigenverbrauch und der Lastverschiebung zur Verfügung.',
      )
    }
  } else {
    newBilledKw = sim.newBilledKw
    // Die Gebrauchsabgabe fällt auch auf den Leistungspreis an (WGAG Tarif C Post 1).
    leistungspreisSavingPerYear =
      demandChargePerYear(
        oldBilledKw - newBilledKw,
        tariffParams.leistungspreisEurPerKwYear,
        tariffParams.billingModel,
        coveredMonthCount(loadProfile),
      ) * usageLevyFactor(loadProfile, levies ?? pricing?.levies)
  }

  const totalSavingPerYear = leistungspreisSavingPerYear + energySavingPerYear

  return {
    newBilledKw,
    leistungspreisSavingPerYear,
    energySavingPerYear,
    energySavingOverCoveredPeriod,
    energySavingBasis,
    annualizationFactor: factor,
    coveredDays: coveredDaysOf(loadProfile),
    totalSavingPerYear,
    warnings,
  }
}
