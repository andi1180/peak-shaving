import type { TariffCostObject } from '../types'

/**
 * Benannte, wiederverwendbare Tarif-Fixtures (Muster wie `engine/src/fixtures/profiles.ts`) —
 * reines Testmaterial, bewusst NICHT über den `packages/tariff-monitor`-Root-Barrel exportiert.
 *
 * Werte sind PLAUSIBEL für den österreichischen Haushaltsstrommarkt, aber ERFUNDEN — keine
 * echten Anbieterdaten (Datenschutz/ToS, analog zu den engine-Fixtures).
 */

/** Online-Wechseltarif: Bonus im ersten Jahr + 12 Monate Preisgarantie. */
export const bonusGuaranteeTariff: TariffCostObject = {
  providerName: 'Sonnenstrom Direkt',
  tariffName: 'Klick Strom Online',
  energyPriceCtPerKwh: 22.5,
  baseFeeEurPerYear: 96,
  bonusEur: 150,
  bonusConditionText: 'Einmaliger Wechselbonus, gültig im ersten Vertragsjahr',
  priceGuaranteeMonths: 12,
  contractCommitmentMonths: 0,
  billingCycle: 'monthly',
  greenEnergy: true,
  // requiresPrepayment bewusst weggelassen (undefined) — deckt den "fehlt = nein"-Default ab.
}

/** Klassischer Grundtarif ohne Bonus, ohne Preisgarantie, mit Bindung. */
export const noBonusNoGuaranteeTariff: TariffCostObject = {
  providerName: 'Basis Energie AG',
  tariffName: 'Strom Klassik',
  energyPriceCtPerKwh: 24.9,
  baseFeeEurPerYear: 110,
  bonusEur: 0,
  priceGuaranteeMonths: undefined,
  contractCommitmentMonths: 12,
  billingCycle: 'annual',
  greenEnergy: false,
  requiresPrepayment: true, // deckt den excludePrepayment-Präferenzfilter testbar ab
}

/** Referenzverbrauch Haushalt (typischer 2–3-Personen-Haushalt Österreich). */
export const HOUSEHOLD_CONSUMPTION_KWH = 3500

/** Referenzverbrauch Kleinbetrieb. */
export const SMALL_BUSINESS_CONSUMPTION_KWH = 8000
