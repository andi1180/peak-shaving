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

/** Woraus die fehlenden Tage gefüllt wurden — der gemessene Block voller Mo–So-Wochen (`synthetic-year.ts`). */
export type AnnualScenarioFill = {
  /** Erster Tag des Blocks (Montag, lokal, `YYYY-MM-DD`, inklusiv). */
  blockFromDate: string
  /** Letzter Tag des Blocks (Sonntag, lokal, inklusiv). */
  blockToDate: string
  /** Volle Wochen im Block; ein fehlender Tag d bekommt die Werte von d + 7·`blockWeeks`·k. */
  blockWeeks: number
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
   * Weg 5 — was die Spitzenkappung im synthetischen Jahr bringt, in Euro pro Jahr: Leistungspreis
   * inkl. Gebrauchsabgabe plus EAG-Förderbeitrag Leistung (`peakShavingSavingPerYearOf`, dieselbe
   * Funktion wie im Hauptreport). `0` heisst „dieser Weg trifft nicht zu". Vor dem 01.10.2026 ohne
   * EAG-Anteil.
   */
  peakShavingSavingEur: number
  /** Der EAG-Anteil in `peakShavingSavingEur`. Fehlt bei Ergebnissen vor dem 01.10.2026. */
  peakShavingEagEur?: number
}

export type AnnualScenario = {
  /** Erster Kalendertag des Fensters (lokal, `YYYY-MM-DD`, inklusiv) — `windowToDate` − 364 Tage. */
  windowFromDate: string
  /** Letzter Kalendertag des Fensters (lokal, inklusiv) — der letzte GEMESSENE Tag, nie ein späterer. */
  windowToDate: string
  /**
   * Stichtag des Satzstands (`YYYY-MM-DD`, = `windowToDate`): Netzentgelte und Abgaben gelten in
   * diesem Stand über das ganze Fenster (`pinRatesToDate`), Marktpreise zum echten Datum. Fehlt bei
   * Ergebnissen vor dem 01.10.2026 — dort galten die Sätze zum jeweiligen Datum.
   */
  ratesAsOf?: string
  /**
   * Das Gerät des Hauptreports (`primaryBatteryEntry`), mit dem der Jahreslauf allein gerechnet
   * hat — kein Katalog-Neulauf. Fehlt bei Ergebnissen vor dem 01.10.2026.
   */
  device?: { batteryId: string; name: string }
  /** Kalendertage des Fensters mit echten Messwerten. */
  measuredDays: number
  /** Kalendertage des Fensters, die aus dem Block gefüllt wurden. */
  projectedDays: number
  fill: AnnualScenarioFill
  ways: AnnualScenarioWays
}
