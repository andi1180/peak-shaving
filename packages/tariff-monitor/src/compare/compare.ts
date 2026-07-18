import type {
  ComparisonPreferences,
  NormalizedYearlyCost,
  TariffComparisonResult,
  TariffCostObject,
  UserTariffInput,
} from '../types'
import { normalizeTariffCost } from '../normalize/normalize'

/**
 * Vergleich (§1.3/§3/§9): reihst JEDEN Kandidaten gegen den normalisierten Ist-Tarif des Nutzers,
 * KEINE Vorfilterung (Muster wie `engine/src/recommendation/rank.ts` — auch Kandidaten, die der
 * Präferenzfilter ablehnt, bekommen einen echten Eintrag samt Zahlen, Transparenz statt stilles
 * Weglassen). `alternatives` kommt vollständig zurück; die UI filtert/slice't (§9-Präferenzen
 * bestimmen nur, was als "besser" GILT, nicht was überhaupt sichtbar ist).
 *
 * `confidence` ist ein reines Label (Feld-Tiefe des `UserTariffInput`, §1.1/§3) und ändert KEINEN
 * Rechenzweig — der §3-Kernbeweis dazu sitzt in `src/compare/compare.test.ts`.
 */

/**
 * Bildet aus dem Ist-Zustand des Nutzers ein `TariffCostObject`, das `normalizeTariffCost`
 * (§5.4, unverändert wiederverwendet) verarbeiten kann. Fehlende Stufe-2-Felder werden auf ihre
 * neutralen Defaults gesetzt (0/"monthly"/false) — das ist der grobe Fall, KEIN Fehler (§5.1).
 * `providerName`/`tariffName` sind hier nur Buchhaltung (fließen nie in eine Rechnung ein).
 */
function userInputAsCostObject(userInput: UserTariffInput): TariffCostObject {
  return {
    providerName: userInput.providerName ?? '',
    tariffName: userInput.tariffName ?? '',
    energyPriceCtPerKwh: userInput.energyPriceCtPerKwh,
    baseFeeEurPerYear: userInput.baseFeeEurPerYear,
    bonusEur: userInput.bonusEur ?? 0,
    bonusConditionText: userInput.bonusConditionText,
    priceGuaranteeMonths: userInput.priceGuaranteeMonths,
    contractCommitmentMonths: userInput.contractCommitmentMonths ?? 0,
    billingCycle: userInput.billingCycle ?? 'monthly',
    greenEnergy: userInput.greenEnergy ?? false,
  }
}

/** §9-Präferenzfilter, UND-verknüpft. Keine Präferenzen gesetzt → jeder Kandidat passiert. */
function passesPreferenceFilter(tariff: TariffCostObject, preferences: ComparisonPreferences | undefined): boolean {
  if (!preferences) return true

  if (preferences.greenEnergyOnly && !tariff.greenEnergy) return false

  if (
    preferences.maxContractCommitmentMonths !== undefined &&
    tariff.contractCommitmentMonths > preferences.maxContractCommitmentMonths
  ) {
    return false
  }

  if (preferences.excludePrepayment && tariff.requiresPrepayment === true) return false

  return true
}

/**
 * Feld-Tiefe → Label (§1.1/§3): 'detailed' NUR wenn sowohl `bonusEur` als auch
 * `contractCommitmentMonths` explizit geliefert wurden — Bonus präzisiert die Headline-Ehrlichkeit
 * (Erstjahr vs. Dauerpreis), Bindung entscheidet, ob der Nutzer überhaupt wechseln kann. Beide
 * fehlen/fehlt eines → 'rough', der ehrliche Default.
 */
function determineConfidence(userInput: UserTariffInput): 'rough' | 'detailed' {
  return userInput.bonusEur !== undefined && userInput.contractCommitmentMonths !== undefined
    ? 'detailed'
    : 'rough'
}

/** Deterministischer Template-Satz — KEIN KI-Layer (Muster wie `engine/src/recommendation/rank.ts`). */
function buildRationale(entry: TariffComparisonResult['alternatives'][number]): string {
  const base =
    `Wechsel zu ${entry.tariff.providerName} ${entry.tariff.tariffName} spart ca. ` +
    `€${entry.savingOngoingEurPerYear.toFixed(0)}/Jahr beim Dauerpreis.`

  if (entry.tariff.bonusEur > 0) {
    return `${base} Zusätzlich einmaliger Wechselbonus von €${entry.tariff.bonusEur.toFixed(0)} im ersten Vertragsjahr.`
  }

  return base
}

function buildAlternative(
  annualConsumptionKwh: number,
  current: NormalizedYearlyCost,
  candidate: TariffCostObject,
  preferences: ComparisonPreferences | undefined,
): TariffComparisonResult['alternatives'][number] {
  const cost = normalizeTariffCost(candidate, annualConsumptionKwh)

  return {
    tariff: candidate,
    cost,
    // Headline-Basis ist der Dauerpreis (§1 Prinzip 3) — NIE firstYear.
    savingOngoingEurPerYear: current.ongoingYearlyCostEur - cost.ongoingYearlyCostEur,
    savingFirstYearEur: current.firstYearCostEur - cost.firstYearCostEur,
    passesPreferenceFilter: passesPreferenceFilter(candidate, preferences),
  }
}

export function compareTariffs(
  userInput: UserTariffInput,
  candidates: TariffCostObject[],
  preferences?: ComparisonPreferences,
): TariffComparisonResult {
  const currentCost = normalizeTariffCost(userInputAsCostObject(userInput), userInput.annualConsumptionKwh)
  const current: TariffComparisonResult['current'] = { ...currentCost, source: 'user_input' }

  const alternatives = candidates.map((candidate) =>
    buildAlternative(userInput.annualConsumptionKwh, current, candidate, preferences),
  )

  // [ANNAHME, fixiert] Sortierung: primär savingOngoing absteigend (Headline, §1.3), Tie-Break
  // savingFirstYear absteigend. Teurere Alternativen (negatives saving) bleiben im Array, sinken
  // nach unten — kein separates "besser/schlechter"-Feld, die UI slice't/filtert (§3.10-Analogon).
  alternatives.sort((a, b) =>
    b.savingOngoingEurPerYear !== a.savingOngoingEurPerYear
      ? b.savingOngoingEurPerYear - a.savingOngoingEurPerYear
      : b.savingFirstYearEur - a.savingFirstYearEur,
  )

  // Empfehlung: der oberste Kandidat, der BEIDES erfüllt — Präferenzfilter UND echte
  // Dauerpreis-Ersparnis (>0). Nie ein Wechsel, der beim Dauerpreis nichts spart oder teurer ist.
  const best = alternatives.find((alt) => alt.passesPreferenceFilter && alt.savingOngoingEurPerYear > 0)

  return {
    current,
    alternatives,
    recommendation: best ? { tariff: best.tariff, rationale: buildRationale(best) } : undefined,
    confidence: determineConfidence(userInput),
    // checkPlausibility bleibt Stub (T1-Teil 4/5) — hier bewusst noch nicht verdrahtet.
    plausibility: { warnings: [] },
  }
}
