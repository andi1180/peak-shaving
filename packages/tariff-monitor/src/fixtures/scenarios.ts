import type { TariffCostObject, UserTariffInput } from '../types'
import { HOUSEHOLD_CONSUMPTION_KWH, SMALL_BUSINESS_CONSUMPTION_KWH } from './tariffs'

/**
 * Zwei benannte End-to-End-Szenarien fürs T1-Gate (§14-DoD, integrierter Überbau über
 * `compareTariffs` + `checkPlausibility`, `../fixtures/t1-gate.test.ts`) — Muster wie
 * `./tariffs.ts`, aber auf Szenario-Ebene: ein `UserTariffInput` (Ist-Zustand, je zwei Varianten
 * grob/detailliert) + ein Kandidatensatz, so gebaut, dass §9-Präferenzen die Empfehlung
 * NACHWEISBAR verschieben (jeder Kandidat hat eine andere Kombination aus Preis/Bonus/
 * Vorauskasse/Ökostrom). Erfundene, aber plausible AT-Werte — keine echten Anbieterdaten
 * (Datenschutz/ToS, analog zu `./tariffs.ts`).
 *
 * Bewusst NICHT über den Root-Barrel exportiert (reines Test-Fixture).
 */

// ── HAUSHALT (~3500 kWh) ─────────────────────────────────────────────────────────────────────

/** Ist-Tarif, NUR Stufe-1-Pflichtfelder (§5.1) — der grobe, ehrliche Gratis-Check-Fall. */
export const HOUSEHOLD_CURRENT_ROUGH: UserTariffInput = {
  annualConsumptionKwh: HOUSEHOLD_CONSUMPTION_KWH,
  energyPriceCtPerKwh: 24.9,
  baseFeeEurPerYear: 110,
  postalCode: '1010',
}

/**
 * Derselbe Ist-Tarif, zusätzlich mit Stufe-2-Feldern (§5.1) — hebt `confidence` auf 'detailed'.
 * `ongoingYearlyCostEur` bleibt UNVERÄNDERT (nur `energyPriceCtPerKwh`/`baseFeeEurPerYear` fließen
 * dort ein, §5.4) — die Grundlage für den DoD-3-Beweis (Feld-Tiefe = Label, kein Rechenzweig).
 */
export const HOUSEHOLD_CURRENT_DETAILED: UserTariffInput = {
  ...HOUSEHOLD_CURRENT_ROUGH,
  providerName: 'Alt-Versorger AG',
  tariffName: 'Strom Classic',
  bonusEur: 0,
  contractCommitmentMonths: 12,
  billingCycle: 'monthly',
  greenEnergy: false,
}

/**
 * 4 Kandidaten, gebaut damit §9-Präferenzen die Empfehlung nachweisbar verschieben (Ranking nach
 * savingOngoing @3500 kWh: Blitz Prepaid 210 > Öko Vorkasse 165 > SparStrom Bonus 125 >
 * Komfort Fix −101):
 * - SparStrom Bonus: mittlere Ersparnis, Bonus, KEINE Vorauskasse, Ökostrom — gewinnt unter
 *   `excludePrepayment`.
 * - Komfort Fix: TEURER als der Ist-Tarif (negative Ersparnis) — darf NIE empfohlen werden.
 * - Blitz Prepaid: die höchste Ersparnis, aber Vorauskasse nötig — Baseline-Empfehlung ohne
 *   Präferenzen.
 * - Öko Vorkasse: zweithöchste Ersparnis, Ökostrom UND Vorauskasse — gewinnt unter
 *   `greenEnergyOnly` (schlägt SparStrom Bonus dort, weil beide grün sind, aber Öko Vorkasse mehr
 *   spart).
 */
export const HOUSEHOLD_CANDIDATES: TariffCostObject[] = [
  {
    providerName: 'SparStrom Direkt',
    tariffName: 'SparStrom Bonus',
    energyPriceCtPerKwh: 21.9,
    baseFeeEurPerYear: 90,
    bonusEur: 120,
    bonusConditionText: 'Einmaliger Wechselbonus, gültig im ersten Vertragsjahr',
    contractCommitmentMonths: 0,
    billingCycle: 'monthly',
    greenEnergy: true,
  },
  {
    providerName: 'Komfort Energie',
    tariffName: 'Komfort Fix',
    energyPriceCtPerKwh: 27.5,
    baseFeeEurPerYear: 120,
    bonusEur: 0,
    contractCommitmentMonths: 0,
    billingCycle: 'monthly',
    greenEnergy: false,
  },
  {
    providerName: 'Blitz Energie',
    tariffName: 'Blitz Prepaid',
    energyPriceCtPerKwh: 19.9,
    baseFeeEurPerYear: 75,
    bonusEur: 0,
    contractCommitmentMonths: 0,
    billingCycle: 'monthly',
    greenEnergy: false,
    requiresPrepayment: true,
  },
  {
    providerName: 'Öko Energie',
    tariffName: 'Öko Vorkasse',
    energyPriceCtPerKwh: 20.9,
    baseFeeEurPerYear: 85,
    bonusEur: 0,
    contractCommitmentMonths: 0,
    billingCycle: 'monthly',
    greenEnergy: true,
    requiresPrepayment: true,
  },
]

// ── KLEINBETRIEB (~8000 kWh) ─────────────────────────────────────────────────────────────────

/** Ist-Tarif, NUR Stufe-1-Pflichtfelder (§5.1) — der grobe, ehrliche Gratis-Check-Fall. */
export const SMALL_BUSINESS_CURRENT_ROUGH: UserTariffInput = {
  annualConsumptionKwh: SMALL_BUSINESS_CONSUMPTION_KWH,
  energyPriceCtPerKwh: 23.9,
  baseFeeEurPerYear: 180,
  postalCode: '4020',
}

/** Wie oben, plus Stufe-2-Felder (hebt `confidence` auf 'detailed', ändert `ongoing` nicht). */
export const SMALL_BUSINESS_CURRENT_DETAILED: UserTariffInput = {
  ...SMALL_BUSINESS_CURRENT_ROUGH,
  providerName: 'Gewerbe-Versorger AG',
  tariffName: 'Business Classic',
  bonusEur: 0,
  contractCommitmentMonths: 24,
  billingCycle: 'monthly',
  greenEnergy: false,
}

/**
 * Analog zu `HOUSEHOLD_CANDIDATES` (Ranking @8000 kWh: Blitz Gewerbe Prepaid 460 > Öko Gewerbe
 * Vorkasse 370 > Gewerbe Spar Bonus 270 > Gewerbe Komfort −228).
 */
export const SMALL_BUSINESS_CANDIDATES: TariffCostObject[] = [
  {
    providerName: 'SparStrom Gewerbe',
    tariffName: 'Gewerbe Spar Bonus',
    energyPriceCtPerKwh: 20.9,
    baseFeeEurPerYear: 150,
    bonusEur: 300,
    bonusConditionText: 'Einmaliger Wechselbonus, gültig im ersten Vertragsjahr',
    contractCommitmentMonths: 0,
    billingCycle: 'monthly',
    greenEnergy: true,
  },
  {
    providerName: 'Komfort Energie Gewerbe',
    tariffName: 'Gewerbe Komfort',
    energyPriceCtPerKwh: 26.5,
    baseFeeEurPerYear: 200,
    bonusEur: 0,
    contractCommitmentMonths: 0,
    billingCycle: 'monthly',
    greenEnergy: false,
  },
  {
    providerName: 'Blitz Energie Gewerbe',
    tariffName: 'Blitz Gewerbe Prepaid',
    energyPriceCtPerKwh: 18.9,
    baseFeeEurPerYear: 120,
    bonusEur: 0,
    contractCommitmentMonths: 0,
    billingCycle: 'monthly',
    greenEnergy: false,
    requiresPrepayment: true,
  },
  {
    providerName: 'Öko Energie Gewerbe',
    tariffName: 'Öko Gewerbe Vorkasse',
    energyPriceCtPerKwh: 19.9,
    baseFeeEurPerYear: 130,
    bonusEur: 0,
    contractCommitmentMonths: 0,
    billingCycle: 'monthly',
    greenEnergy: true,
    requiresPrepayment: true,
  },
]
