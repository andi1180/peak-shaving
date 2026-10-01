import { findGridTariffRow } from './grid-tariff-row'
import { findLevyPeriod } from './levies'
import type { TariffPricingInputs } from './tariff-pricing'

/**
 * Satzstand zum Stichtag für die Jahres-Hochrechnung: die Netzentgelt-Zeile und der Abgabenzeitraum,
 * die am `ratesAsOf` gelten, werden über das ganze Fenster gelegt; Marktpreise bleiben zum echten
 * Datum.
 *
 * Gilt am Stichtag keine Zeile bzw. kein Abgabensatz, bleibt die Seite leer und die Engine verweigert
 * — kein Rückfall auf eine ältere oder neuere Zeile.
 */
export function pinRatesToDate(
  pricing: TariffPricingInputs,
  ratesAsOf: string,
  window: { fromDate: string; toDate: string },
): TariffPricingInputs {
  const span = { validFrom: window.fromDate, validUntil: window.toDate }

  const row = pricing.gridTariffRows && findGridTariffRow(pricing.gridTariffRows, ratesAsOf)
  const period = pricing.levies && findLevyPeriod(pricing.levies.periods, ratesAsOf)

  return {
    ...pricing,
    gridTariffRows: pricing.gridTariffRows && (row ? [{ ...row, ...span }] : []),
    levies: pricing.levies && {
      ...pricing.levies,
      periods: period ? [{ ...period, ...span }] : [],
    },
  }
}
