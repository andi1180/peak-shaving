import { sumCovered } from './real-saving'
import type { MonthlyTariffComparison } from './tariff-pricing'

/**
 * WELCHE REIHE DES MONATSVERGLEICHS WELCHER WEG IST — an genau einer Stelle beantwortet.
 *
 * ── ⚠ WARUM DIESE AUSWAHL EINE EIGENE HEIMAT HAT ──────────────────────────────────────────────
 * Die Zuordnung „Reihe → Weg" ist nicht offensichtlich und hat zwei Sonderregeln: Weg 2 entfällt
 * ganz, wenn der Kunde keinen Vergleichstarif genannt hat, und Weg 4 liest die VORAUSSCHAUENDE
 * Reihe, sobald es sie gibt, sonst die einfache — und der Report muss sagen können, welche der
 * beiden er zeigt. Seit der Jahres-Hochrechnung (D6 Teil 3) gibt es zwei Konsumenten dieser
 * Auswahl: den Report für den gemessenen Zeitraum (`summaryWaysOf`) und die Hochrechnung für den
 * synthetischen Jahreslauf. Zweimal geschrieben liefen sie irgendwann auseinander — und der
 * Unterschied sähe aus wie ein Jahresgang, wäre aber eine andere Lesart derselben Reihen.
 *
 * ⚠ HIER WIRD NICHT GERECHNET, SONDERN AUSGEWÄHLT UND SUMMIERT. Ersparnisse entstehen daraus
 * anderswo (`buildRealSavingBreakdown`); diese Funktion kennt nur Kosten.
 */

/** Welche Ladesteuerung Weg 4 trägt. */
export type ControlVariant = 'predictive' | 'simple'

/** Die Kosten der vier TARIFwege über den Zeitraum des Monatsvergleichs, in Euro. */
export type TariffWayCosts = {
  /** Weg 1 — „Ihr Tarif heute", die Bezugsgrösse. */
  currentTariffEur: number
  /** Weg 2 — der selbst gefundene Vergleichstarif. `null` = der Weg entfällt (s. Modulkopf). */
  comparisonTariffEur: number | null
  /** Der Lieferant zu Weg 2 — `null`, wenn es den Weg nicht gibt. */
  comparisonSupplier: string | null
  /** Weg 3 — aWATTar auf den rohen Lastgang. */
  spotWithoutControlEur: number
  /**
   * Weg 4 — aWATTar mit Ladesteuerung; welche, sagt `controlVariant`.
   *
   * ⚠ K3b-2: `null` heisst „es gibt keinen Speicher" (leerer Katalog, kein Bestand) — dann fehlt
   * die Reihe im Vergleich, und der Weg entfällt ganz, wie Weg 2 ohne Vergleichstarif.
   * `controlVariant` ist dann gemeinsam `null`: beide gesetzt oder beide weg.
   */
  controlledEur: number | null
  controlVariant: ControlVariant | null
}

export function tariffWayCosts(comparison: MonthlyTariffComparison): TariffWayCosts {
  const comparisonSeries = comparison.comparisonTariffEur
  const predictiveSeries = comparison.spotWithPredictiveControlEur
  const controlledSeries = predictiveSeries ?? comparison.spotWithBatteryEur

  return {
    currentTariffEur: sumCovered(comparison.currentTariffEur),
    comparisonTariffEur: comparisonSeries ? sumCovered(comparisonSeries) : null,
    comparisonSupplier: comparison.comparisonSupplier ?? null,
    spotWithoutControlEur: sumCovered(comparison.spotWithoutControlEur),
    controlledEur: controlledSeries ? sumCovered(controlledSeries) : null,
    controlVariant: controlledSeries ? (predictiveSeries ? 'predictive' : 'simple') : null,
  }
}
