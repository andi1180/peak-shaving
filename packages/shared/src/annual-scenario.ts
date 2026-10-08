import type { LoadProfile } from './load-profile'
import type { MonthlyTariffComparison } from './tariff-pricing'
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

/** Die zwei Anteile der Jahres-Ersparnis eines Geräts, wie die Hauptzahl sie zusammensetzt. */
export type AnnualScenarioDevice = {
  batteryId: string
  /** Energie-Anteil im synthetischen Jahr (`energySavingPerYear` des Jahreslaufs). */
  energySavingPerYear: number
  /** Leistungs-Anteil inkl. EAG (`peakShavingSavingPerYearOf`) — wie `ways.peakShavingSavingEur`. */
  peakShavingSavingEur: number
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
   * Das Gerät, dessen Weg 4/5 `ways` trägt: Rang 1 des Jahreslaufs über den ganzen Katalog (seit
   * Fassung 17), im Bestandsfall der Bestandsspeicher. Fehlt bei Ergebnissen vor dem 01.10.2026.
   */
  device?: { batteryId: string; name: string }
  /**
   * Jahreswerte JEDES Katalog-Geräts in der Reihung des Jahreslaufs, beste zuerst. Gesetzt genau
   * dann, wenn das Jahreskapitel steht (`annualBasisApplies`) — dann sind Reihung, Empfehlung
   * (= `device`) und „Speichergrösse und Gerätewahl" auf Jahresbasis. Fehlt sonst und vor Fassung 17.
   */
  devices?: AnnualScenarioDevice[]
  /** Kalendertage des Fensters mit echten Messwerten. */
  measuredDays: number
  /** Kalendertage des Fensters, die aus dem Block gefüllt wurden. */
  projectedDays: number
  fill: AnnualScenarioFill
  ways: AnnualScenarioWays
}

/**
 * Kapitel „Hochrechnung auf ein ganzes Jahr" (D6 Teil 3) an/aus. Seit E2 (07.10.2026) auch ein
 * RECHENschalter: aus heisst Reihung und Empfehlung linear (`annualBasisApplies`).
 */
export const SHOW_ANNUAL_SCENARIO_CHAPTER = true

export type AnnualBasisPvInput = {
  hasPv?: boolean | null
  estimatedPv?: unknown
  loadProfile: Pick<LoadProfile, 'source' | 'pvSource'>
}

/**
 * PV in der Rechnung: die Füllung trägt Tage einer Jahreszeit in eine andere, und mit PV wandert
 * dabei die Erzeugung mit (zu wenig Bezug im Winter) — dann gibt es das Kapitel nicht.
 */
export function annualScenarioInvolvesPv(input: AnnualBasisPvInput): boolean {
  const source = input.loadProfile.source
  return (
    input.hasPv === true ||
    input.estimatedPv != null ||
    input.loadProfile.pvSource === 'estimated' ||
    source === 'net_signed' ||
    source === 'import_export_split'
  )
}

/**
 * Steht das Jahreskapitel? EINE Bedingung für den Report (Kapitel, Hauptzahl, Seite 17) und den
 * Wizard-Lauf (Reihung auf Jahresbasis) — zwei Fassungen liessen Empfehlung und Kapitel auseinanderlaufen.
 * `measuredComparison` ist der Monatsvergleich des gemessenen Laufs (nur bei `computable === true`).
 */
export function annualBasisApplies(
  scenario: AnnualScenario | undefined,
  measuredComparison: MonthlyTariffComparison | undefined,
  pv: AnnualBasisPvInput,
): boolean {
  return measuredComparison?.currentTariffEur != null && annualScenarioCarriesChapter(scenario, pv)
}

/** Der Teil von `annualBasisApplies`, der ohne den gemessenen Lauf entscheidbar ist (der Lauf braucht ihn vorher). */
export function annualScenarioCarriesChapter(
  scenario: AnnualScenario | undefined,
  pv: AnnualBasisPvInput,
): boolean {
  if (!SHOW_ANNUAL_SCENARIO_CHAPTER) return false
  if (!scenario || scenario.projectedDays <= 0 || !scenario.device) return false
  if (annualScenarioInvolvesPv(pv)) return false
  return scenario.ways.currentTariffEur !== null && scenario.ways.controlledEur !== null
}
