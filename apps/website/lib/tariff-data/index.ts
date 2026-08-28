/**
 * Der Lesezugang des Kalkulators auf die Referenzdaten (B21-3a).
 *
 * NUR SELECT — `apps/website` hat auf keine Tabelle ein Schreibrecht und soll auch keins bekommen:
 * die Netzbetreiber-Tarife pflegt der Admin-Bereich (B21-2b), die Spotpreise füllt der Cron
 * (B21-2a). Beides läuft in `apps/web`, mit einer Rolle, die dieser Client nicht hat.
 */
export {
  createTariffDataClient,
  isTariffDataConfigured,
  type TariffDataClient,
  type TariffDataFailure,
} from './client'
export {
  fetchGridTariffs,
  type GridTariffFetchResult,
  type GridTariffRateWindow,
  type GridTariffWithWindows,
} from './grid-tariffs'
export {
  SPOT_PRICE_PROVIDER,
  analysisWindowToPriceRange,
  fetchSpotPrices,
  findMissingRanges,
  type MissingRange,
  type SpotPrice,
  type SpotPriceFetchResult,
} from './spot-prices'
