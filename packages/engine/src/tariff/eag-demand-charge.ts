import {
  demandChargePerYear,
  type BillingModel,
  type LevyPeriodInput,
  type LoadProfile,
  type TariffPricingInputs,
} from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { coveredMonthCount } from '../peaks/metrics'

/**
 * Der GRUNDPREIS-Teil des EAG-Förderbeitrags als JAHRESBETRAG — die zweite kW-gebundene
 * Jahresgrösse neben dem Leistungspreis (21.09.2026).
 *
 * ── ⚠ WARUM ER EINE JAHRESZAHL IST UND KEIN MONATSBALKEN ───────────────────────────────────────
 * `buildMonthlyTariffComparison` überspringt ihn in der Einheit `eur_per_kw_year` bewusst, wörtlich
 * aus demselben Grund, aus dem `annualFlatNetworkFeeEur` den Netz-Grundpreis derselben Einheit
 * überspringt: er hängt an einem kW-Wert, dessen Verteilung auf Kalendermonate genau die
 * Aufteilungsregel bräuchte, die weder Preisblatt noch Pflichtenheft hergeben. Er gehört damit
 * dorthin, wo der Leistungspreis steht — neben die Monatsreihen, nicht hinein. Ihn hier zu rechnen
 * UND dort einzuhängen wäre eine Doppelzählung derselben Kosten in derselben Auswertung.
 *
 * ── ⚠ ER IST NICHT DER LEISTUNGSPREIS ──────────────────────────────────────────────────────────
 * Beide sind €/kW·Jahr, und beide hängen am abgerechneten Leistungswert — aber der eine ist die
 * Netznutzung des Netzbetreibers und der andere eine gesetzliche Abgabe (EAG 2021, Preisblatt
 * EX104). Sie werden getrennt geführt und getrennt ausgewiesen; verschmolzen stünde im Report eine
 * Zahl, die auf keiner Netzrechnung so dasteht.
 *
 * Rein & deterministisch: die Abgabensätze kommen als PARAMETER herein (`TariffPricingInputs`),
 * kein I/O, keine Uhr — dieselbe Zusage wie im übrigen Rechenkern.
 */

/** Lokaler Kalendertag als `YYYY-MM-DD` — dieselbe Ableitung wie in `buildMonthlyTariffComparison`. */
function localDate(ts: string, timeZone: string): string {
  const { year, month, day } = utcMsToLocalFields(Date.parse(ts), timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Deckt der Abgabenzeitraum irgendeinen Tag zwischen `from` und `to` ab? (`validUntil` inklusiv.) */
function overlaps(period: LevyPeriodInput, from: string, to: string): boolean {
  if (period.validFrom > to) return false
  return period.validUntil === null || period.validUntil >= from
}

/**
 * Der Jahresbetrag, oder `undefined` — und `undefined` ist jedes Mal eine AUSSAGE, kein Rundungsrest:
 *
 *   • kein abgerechneter Leistungswert (`billedKw <= 0`) → es gibt nichts, woran der Satz hängt;
 *   • keine Abgabensätze übergeben oder keiner deckt den Zeitraum ab → Lücke, kein Nullsatz
 *     (dieselbe Haltung wie `buildLevySchedule`: was nicht belegt ist, wird nicht gerechnet);
 *   • der Satz ist ein fixer Jahresbetrag (`eur_per_year`, NE 7 OHNE Leistungsmessung) → er ist
 *     kein Leistungspreis und steckt bereits tagesanteilig in `MonthlyFixedCosts.eagFlatFeeEur`;
 *     ihn hier ein zweites Mal auszuweisen wäre genau die Doppelzählung, die dieses Modul vermeidet;
 *   • der Zeitraum überquert einen SATZWECHSEL (der Förderbeitrag wird je Tarifjahr neu festgesetzt)
 *     → dann gibt es keine EINE Jahreszahl, und die eines der beiden Jahre stellvertretend
 *     auszugeben wäre für den anderen Teil des Zeitraums schlicht falsch.
 *
 * ⚠ [ANNAHME] Bemessungsgrundlage ist `billedKw`, also derselbe abgerechnete Leistungswert wie
 * beim Leistungspreis (§3.5). Das Preisblatt führt den Posten als „Netznutzung Grundpreis"; eine
 * davon abweichende, vereinbarte Anschlussleistung erfasst der Contract heute nicht.
 */
export function eagDemandChargePerYear(
  loadProfile: LoadProfile,
  pricing: TariffPricingInputs | undefined,
  billedKw: number,
  billingModel: BillingModel,
): number | undefined {
  if (!(billedKw > 0)) return undefined

  const periods = pricing?.levies?.periods ?? []
  const readings = loadProfile.readings
  if (periods.length === 0 || readings.length === 0) return undefined

  const tz = loadProfile.timezoneMeta
  const from = localDate(readings[0]!.ts, tz)
  const to = localDate(readings[readings.length - 1]!.ts, tz)

  const rates = new Set<number>()
  for (const period of periods) {
    if (!overlaps(period, from, to)) continue
    if (period.eagFoerderbeitragGrundpreisUnit !== 'eur_per_kw_year') return undefined
    rates.add(period.eagFoerderbeitragGrundpreisAmount)
  }

  if (rates.size !== 1) return undefined
  const rate = [...rates][0]!
  return rate > 0
    ? demandChargePerYear(billedKw, rate, billingModel, coveredMonthCount(loadProfile))
    : undefined
}
