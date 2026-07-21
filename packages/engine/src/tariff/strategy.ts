import type { BillingModel, LoadProfile, TariffParams } from 'shared'

import { coveredMonthlyPeaksKw, positiveAnnualPeakKw } from '../peaks/metrics'

/**
 * Tarif-Strategy-Interface (§3.5, Kern von Prinzip 1). Liefert den ABGERECHNETEN
 * kW-Wert aus einem (ggf. batterie-modifizierten) Lastgang. Austauschbar — kein
 * hartkodierter Jahreshöchstwert im Rechenkern.
 *
 * ── KONFIGURATION AN DEN RÄNDERN, DETERMINISMUS IM KERN (B11) ──────────────────
 * Die Tarifsätze kommen als PARAMETER herein (`TariffParams`) und werden hier
 * niemals nachgeschlagen. Seit B11 gibt es eine Tarifsatz-Datenschicht
 * (`packages/shared/src/tariff-catalog.ts`) — sie belegt die Oberfläche vor, und
 * die Engine kennt sie nicht. Das ist das Gegenstück zur Regel „KI an den
 * Rändern": eine Engine, die ihre eigenen Sätze holt, ist nicht mehr allein aus
 * ihren Eingaben nachvollziehbar, und genau diese Nachvollziehbarkeit ist die
 * Voraussetzung dafür, dass eine eingefrorene Baseline (B14) 2027 noch etwas
 * belegt: dieselben Eingaben müssen dasselbe Ergebnis liefern, ohne dass jemand
 * den Stand einer Konfiguration von damals rekonstruieren muss.
 * Abgesichert durch `./no-catalog-dependency.test.ts` (prüft die Importe, nicht
 * die Absicht).
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
 * `monthly_max_average`: je Monat den Höchstwert bilden, dann über die BELEGTEN Monate mitteln.
 * Nur Monate MIT Daten gehen in die Mittelung ein (`coveredMonthlyPeaksKw`) — ein Monat ohne
 * einen einzigen Messwert ist „keine Angabe", nicht „Spitze = 0". Sonst verdünnt ein
 * Teiljahres-Datensatz (z. B. 7 Tage) den realen Peak durch die leeren Monate auf ~1/12 (§3.5-Fix).
 * [ANNAHME] AT-Default (Wiener-Netze-Definition) — vor Auslieferung an echten Rechnungen zu
 * validieren (§3.5, OP#1/#3).
 */
export const monthlyMaxAverageStrategy: TariffStrategy = {
  billedKw(loadProfile, params) {
    return withMinimum(average(coveredMonthlyPeaksKw(loadProfile)), params.minBillableKw)
  },
}

/**
 * `monthly_max_sum`: je Monat den Höchstwert bilden, dann über die BELEGTEN Monate summieren.
 * Leere Monate (= 0) tragen zur Summe ohnehin nichts bei, der Wert ändert sich also gegenüber
 * „alle 12" nicht — die Semantik bleibt aber konsistent „nur belegte Monate zählen". Eine Summe
 * über 1 von 12 Monaten ist bei Teildaten fachlich fragwürdig; das flankiert die Teiljahres-Warnung
 * (§3.5), NICHT eine erfundene Hochrechnung auf ein Jahr.
 */
export const monthlyMaxSumStrategy: TariffStrategy = {
  billedKw(loadProfile, params) {
    return withMinimum(sum(coveredMonthlyPeaksKw(loadProfile)), params.minBillableKw)
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
