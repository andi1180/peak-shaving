import type { NormalizedYearlyCost, TariffCostObject } from '../types'

/**
 * Normalisierung eines Tarif-Kosten-Objekts auf Jahreskosten für einen gegebenen Jahresverbrauch
 * (§5.4). `ongoingYearlyCostEur` ist der Dauerpreis OHNE jeden Bonus — die einzige Headline-Basis
 * (§1 Prinzip 3). Der Bonus wirkt NUR im ersten Jahr und NUR dort (`firstYearCostEur`).
 *
 * `billingCycle` fließt bewusst NICHT in die Jahressumme ein — monatlich vs. jährlich zahlen
 * ändert die Jahreskosten nicht, nur die Zahlungsraten. Falls unterjährige Abschläge o. Ä. das
 * doch beeinflussen sollten, ist das ungeklärt und wird hier nicht spekulativ eingebaut.
 * [OFFEN: billingCycle-Effekt?]
 */
export function normalizeTariffCost(
  tariff: TariffCostObject,
  annualConsumptionKwh: number,
): NormalizedYearlyCost {
  const ongoingYearlyCostEur =
    (tariff.energyPriceCtPerKwh / 100) * annualConsumptionKwh + tariff.baseFeeEurPerYear

  return {
    ongoingYearlyCostEur,
    firstYearCostEur: Math.max(0, ongoingYearlyCostEur - tariff.bonusEur),
    bonusEur: tariff.bonusEur,
    priceGuaranteeMonths: tariff.priceGuaranteeMonths,
  }
}
