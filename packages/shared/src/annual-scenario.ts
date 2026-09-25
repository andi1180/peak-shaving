import type { ControlVariant } from './tariff-ways'

/**
 * D6 Teil 3 — „WAS WÄRE, WENN WIR EIN GANZES JAHR HÄTTEN?" ALS CONTRACT.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ GESCHÄTZT IST DER LASTGANG, NICHT DAS ERGEBNIS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Zahlen hier stammen aus einem ZWEITEN, vollständigen `computeAnalysis`-Lauf über einen
 * synthetischen 365-Tage-Lastgang (`buildSyntheticYearProfile`, `packages/engine`) — derselbe
 * SoC-Durchlauf, derselbe Dispatch, dieselbe Spitzenkappung wie im gemessenen Report. Es ist
 * ausdrücklich KEINE Streckung der fertigen Ersparnis-Zahlen mit `365 / coveredDays`: eine
 * Batterie ist keine lineare Funktion ihrer Betriebstage, und ein hochgerechneter abgerechneter
 * Leistungswert wäre eine erfundene Spitze (Prinzip 3).
 *
 * ── ⚠ SIE GEHÖREN IN KEINE SPANNE DER ZUSAMMENFASSUNG (D8) ────────────────────────────────────
 * Die Kopfzahlen des Reports beziehen sich auf den GEMESSENEN Zeitraum. Diese hier auf 365 Tage.
 * Nebeneinander in einer Spanne stünden zwei verschiedene Bezugszeiträume unter einer Zahl —
 * genau die Vermischung, vor der der Report an jeder anderen Stelle warnt. Das Kapitel ist
 * deshalb eine eigene, benannte Sektion mit eigener Zahl; `summary.ts` liest dieses Feld nicht.
 *
 * ── ⚠ DIE BEIDEN BEZUGSGRÖSSEN SIND HIER AUSNAHMSWEISE GLEICH ─────────────────────────────────
 * Im gemessenen Kapitel ist Weg 5 (Spitzenkappung) eine JAHRESgrösse neben Balken über den
 * Messzeitraum und darf deshalb nicht addiert werden. In diesem Kapitel sind ALLE Wege
 * Jahresgrössen — die Addition „bester Tarifweg + Spitzenkappung" ist hier also zulässig, und sie
 * ist der einzige Ort im Report, an dem sie es ist.
 */

/** Woher die Rate für die fehlenden Tage stammt — die „höchste gemessene Wochenrate". */
export type AnnualScenarioReference = {
  /** Erster Tag der Referenzwoche (lokal, `YYYY-MM-DD`, inklusiv). */
  fromDate: string
  /** Letzter Tag der Referenzwoche (lokal, inklusiv). */
  toDate: string
  /** Bezugsenergie der sieben Tage in kWh. */
  consumptionKwh: number
  /** `consumptionKwh / 7` — die Rate, mit der die fehlenden Tage belegt wurden. */
  rateKwhPerDay: number
}

/**
 * Die Jahreskosten je Weg — dieselbe Auswahl wie im gemessenen Kapitel (`tariffWayCosts`), nur auf
 * dem synthetischen Jahreslauf.
 *
 * ⚠ Ein Weg, den der Jahreslauf nicht rechnen konnte, steht hier NICHT mit 0, sondern gar nicht:
 * `comparisonTariffEur` ist `null`, wenn es den Vergleichstarif nicht gibt. Eine 0 sähe aus wie
 * „dieser Weg kostet nichts".
 */
export type AnnualScenarioWays = {
  /** `null` bei unbekanntem Liefertarif — wie `TariffWayCosts.currentTariffEur`. */
  currentTariffEur: number | null
  comparisonTariffEur: number | null
  comparisonSupplier: string | null
  spotWithoutControlEur: number
  /* K3b-2: `null` = ohne Speicher gerechnet, der Weg entfällt — wie `comparisonTariffEur` oben. */
  controlledEur: number | null
  controlVariant: ControlVariant | null
  /**
   * Weg 5 — was die Spitzenkappung im synthetischen Jahr bringt, in Euro pro Jahr. `0` heisst
   * „dieser Weg trifft nicht zu" (kein Leistungspreis, oder ein Blocker aus `peakShavingBlockers`)
   * — dieselbe Lesart wie `peakShavingSavingOf` im gemessenen Kapitel.
   */
  peakShavingSavingEur: number
}

export type AnnualScenario = {
  /** Erster Kalendertag des Fensters (lokal, `YYYY-MM-DD`, inklusiv). */
  windowFromDate: string
  /** Letzter Kalendertag des Fensters (lokal, inklusiv) — der letzte GEMESSENE Tag. */
  windowToDate: string
  /** Kalendertage des Fensters mit echten Messwerten. */
  measuredDays: number
  /** Kalendertage des Fensters, die aus der Referenzwoche gefüllt wurden. */
  projectedDays: number
  reference: AnnualScenarioReference
  ways: AnnualScenarioWays
}
