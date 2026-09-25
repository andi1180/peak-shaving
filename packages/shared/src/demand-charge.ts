import { effectiveBillingModel, type BillingModel } from './tariff'

/**
 * Umrechnung abgerechneter kW-Wert → Jahreskosten eines kW-Satzes — die EINE Stelle dafür, benutzt
 * von der Engine (Ist-Kosten, Ersparnis, EAG-Grundpreis) und vom Report (Rückrechnung des Satzes).
 *
 * Der Satz ist in allen Modellen ein JAHRESsatz (€/kW·a), so beschriften ihn alle Eingabestellen
 * und so rechnen die Scans um (`Leistungspreis_Einheiten_Bestandsaufnahme.md`). Bei
 * `monthly_max_sum` ist `billedKw` aber die Summe der Monatsspitzen: jeder Monat wird mit Satz/12
 * abgerechnet, und die Summe deckt nur die BEOBACHTETEN Monate ab. Sie wird deshalb mit
 * 12/beobachtete Monate auf das Jahr gebracht — dieselbe Annahme, die `monthly_max_average`
 * implizit trifft, und nötig, weil die Engine den Leistungspreis-Anteil als Jahresgrösse führt und
 * NICHT über `annualizationFactor` hochrechnet (engine `savings/annualization.ts`).
 */

export const MONTHS_PER_YEAR = 12

/** Der kW-Wert, auf den der Jahressatz genau einmal angewandt wird. */
export function demandChargeKwPerYear(
  billedKw: number,
  billingModel: BillingModel | null,
  coveredMonths: number,
): number {
  if (effectiveBillingModel(billingModel) !== 'monthly_max_sum' || coveredMonths <= 0)
    return billedKw
  const overCoveredMonths = billedKw / MONTHS_PER_YEAR // Σ Monatsspitze × Satz/12, je kW Satz
  return overCoveredMonths * (MONTHS_PER_YEAR / coveredMonths)
}

/** Jahreskosten eines kW-Satzes (€/kW·a) beim gegebenen Abrechnungsmodell. */
export function demandChargePerYear(
  billedKw: number,
  rateEurPerKwYear: number,
  billingModel: BillingModel | null,
  coveredMonths: number,
): number {
  return rateEurPerKwYear * demandChargeKwPerYear(billedKw, billingModel, coveredMonths)
}
