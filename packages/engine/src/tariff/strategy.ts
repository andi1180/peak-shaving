import type { BillingModel, LoadProfile, TariffParams } from 'shared'

import { positiveAnnualPeakKw, positiveMonthlyPeaksKw } from '../peaks/metrics'

/**
 * Tarif-Strategy-Interface (§3.5, Kern von Prinzip 1). Liefert den ABGERECHNETEN
 * kW-Wert aus einem (ggf. batterie-modifizierten) Lastgang. Austauschbar — kein
 * hartkodierter Jahreshöchstwert im Rechenkern.
 *
 * `benutzungsdauerModel` (§3.1/§3.5) ist hier bewusst NICHT verdrahtet: die exakte
 * Umschaltlogik (Schwelle → andere Preisspalte) ist fachlich offen und wartet auf
 * Martins Tarif-Systematik (OP#3). Alle drei Strategien nehmen einen konstanten
 * `leistungspreisEurPerKwYear` an.
 */
export interface TariffStrategy {
  billedKw(loadProfile: LoadProfile, params: TariffParams): number
}

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length

const sum = (values: number[]): number => values.reduce((total, v) => total + v, 0)

/** Mindestleistung IMMER zuletzt (§3.5): eine perfekte Batterie kann den Sockel nicht unterschreiten. */
const withMinimum = (computedKw: number, minBillableKw: number): number =>
  Math.max(computedKw, minBillableKw)

/** `annual_max`: ein Jahreshöchstwert bestimmt alles. */
export const annualMaxStrategy: TariffStrategy = {
  billedKw(loadProfile, params) {
    return withMinimum(positiveAnnualPeakKw(loadProfile), params.minBillableKw)
  },
}

/**
 * `monthly_max_average`: je Monat den Höchstwert bilden, dann die 12 mitteln.
 * [ANNAHME] AT-Default (Wiener-Netze-Definition) — vor Auslieferung an echten
 * Rechnungen zu validieren (§3.5, OP#1/#3).
 */
export const monthlyMaxAverageStrategy: TariffStrategy = {
  billedKw(loadProfile, params) {
    return withMinimum(average(positiveMonthlyPeaksKw(loadProfile)), params.minBillableKw)
  },
}

/** `monthly_max_sum`: je Monat den Höchstwert bilden, dann summieren. */
export const monthlyMaxSumStrategy: TariffStrategy = {
  billedKw(loadProfile, params) {
    return withMinimum(sum(positiveMonthlyPeaksKw(loadProfile)), params.minBillableKw)
  },
}

export const tariffStrategies: Record<BillingModel, TariffStrategy> = {
  annual_max: annualMaxStrategy,
  monthly_max_average: monthlyMaxAverageStrategy,
  monthly_max_sum: monthlyMaxSumStrategy,
}

/** Wählt die TariffStrategy passend zum `billingModel` aus der Netzrechnung (§3.1: „Die Rechnung ist die Wahrheit"). */
export function getTariffStrategy(billingModel: BillingModel): TariffStrategy {
  return tariffStrategies[billingModel]
}
