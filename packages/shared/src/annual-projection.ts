/**
 * D6 — DIE JAHRES-HOCHRECHNUNG ALS CONTRACT.
 *
 * Hier stehen die Typen der drei D6-Bausteine zusammen: die Herkunft der Referenzrate (Teil 1,
 * gerechnet in `packages/engine`), die Herkunft der Marktpreise (Teil 2a, beschafft in
 * `packages/extractors`) und die Jahres-KOSTEN-Zeilen, die aus beiden entstehen (Teil 2b).
 *
 * ── WARUM SIE IN `shared` LIEGEN UND NICHT DORT, WO SIE ENTSTEHEN ──────────────────────────────
 * `AnalysisResult.annualProjection` trägt sie. `shared` ist die unterste Schicht — ein Contract-Typ
 * kann nicht in `engine` oder `extractors` wohnen, ohne dass `shared` von dort importieren müsste.
 * Dieselbe Aufteilung und dieselbe Begründung wie bei `tariff-pricing.ts`: die Typen beschreiben,
 * was hereinkommt und was herausfällt; gerechnet wird woanders.
 *
 * Teil 1 und Teil 2a haben ihre Typen deshalb hierher abgegeben und re-exportieren sie unter den
 * bisherigen Namen weiter — es gibt weiterhin GENAU EINE Definition je Typ.
 */

import type { TariffPriceRange } from './tariff-pricing'

/* ── TEIL 1: WIE DIE JAHRES-VERBRAUCHSMENGE ZUSTANDE KAM ────────────────────────────────────── */

/**
 * Wie die Jahresmenge zustande kam. Ein eigenes Feld und ausdrücklich KEIN Sonderwert in einer der
 * Zahlen: ein `null`-Datum oder eine Rate von 0 als Kennzeichen liesse „nicht hochgerechnet" und
 * „hochgerechnet mit 0" zusammenfallen.
 */
export type AnnualConsumptionMethod =
  /** Der Lastgang deckt ein volles Jahr (oder mehr) ab — es wird NICHT hochgerechnet, und auch nicht nach unten skaliert. */
  | 'full_period'
  /** Synthetisches Standardprofil — es trägt seinen Jahresverbrauch bereits als Eingabe. */
  | 'synthetic_profile'
  /** Leerer oder unbrauchbarer Lastgang — es gibt nichts zu schätzen. */
  | 'no_data'
  /** Der Regelfall: Rate aus den abgedeckten Dezember-/Januar-/Februar-Tagen. */
  | 'winter_reference'
  /** Die Rückfallregel: kein Wintertag abgedeckt — Rate aus dem Monat mit dem höchsten Tagesdurchschnitt. */
  | 'month_maximum'

/** Ein Kalendermonat, der die Referenzrate mitgetragen hat — je Monat EIN Eintrag, mit seiner Spanne. */
export type ReferenceSegment = {
  year: number
  /** 1–12, Ortszeit des Lastgangs. */
  month: number
  /**
   * Abgedeckte Tage dieses Monats, als BRUCHZAHL (Intervalle ÷ Intervalle-pro-Tag).
   *
   * ⚠ Kein ganzzahliges Zählen belegter Kalendertage: ein Lastgang, der am 26. Jänner mittags
   * beginnt, hätte sonst einen halben Tag als ganzen gezählt und die Rate dieses Tages halbiert.
   */
  days: number
  /** Zeitstempel des ERSTEN Intervalls dieses Monats im Lastgang (UTC-ISO, Intervall-Start). */
  fromIso: string
  /** Zeitstempel des LETZTEN Intervalls dieses Monats im Lastgang (UTC-ISO, Intervall-Start). */
  toIso: string
  /** Bezugsenergie dieses Monats in kWh — nur die Bezugs-Komponente. */
  consumptionKwh: number
}

export type AnnualConsumptionEstimate = {
  method: AnnualConsumptionMethod
  /** Abgedeckte Tage des Lastgangs — dieselbe Ableitung wie in `annualizationFactor` (`coveredDaysOf`). */
  coveredDays: number
  /** Tatsächlich gemessene Bezugsenergie über den abgedeckten Zeitraum, in kWh. */
  measuredConsumptionKwh: number
  /** `365 − coveredDays`, nie negativ. `0` heisst: es wurde nichts hochgerechnet. */
  missingDays: number
  /**
   * Die Rate, mit der die fehlenden Tage bewertet wurden, in kWh/Tag. `null` in allen Fällen, in
   * denen nicht hochgerechnet wurde — dort gibt es keine Rate, und eine 0 stünde als gerechneter
   * Wert da.
   */
  referenceRateKwhPerDay: number | null
  /** Die Monate hinter der Rate, chronologisch. Leer, wenn nicht hochgerechnet wurde. */
  referenceSegments: ReferenceSegment[]
  /** `measuredConsumptionKwh + referenceRateKwhPerDay × missingDays`. */
  estimatedAnnualConsumptionKwh: number
}

/* ── TEIL 2a: WOHER DIE MARKTPREISE STAMMEN ─────────────────────────────────────────────────── */

/**
 * Woher ein Stück der Preisreihe stammt.
 *
 * `assumed` ist die einzige NICHT gemessene Herkunft und trägt deshalb als einzige eine Begründung
 * mit (s. `MarketPriceCoverage.assumption`).
 */
export type MarketPriceOrigin = 'database' | 'fetched' | 'assumed'

/** Ein zusammenhängendes Stück des Zeitraums mit EINER Herkunft. */
export type MarketPriceCoverage = {
  origin: MarketPriceOrigin
  fromIso: string
  toIso: string
  hours: number
  /** Nur bei `assumed`: welcher Monat die Näherung getragen hat und mit welchem Durchschnitt. */
  assumption?: { year: number; month: number; ctPerKwh: number }
}

/** Stunden je Herkunft — die Kurzfassung von `MarketPriceCoverage[]` für eine Kennzeichnung. */
export type MarketPriceHoursByOrigin = { database: number; fetched: number; assumed: number }

/* ── TEIL 2b: DIE JAHRES-KOSTENZEILE ────────────────────────────────────────────────────────── */

/**
 * Eine Jahreskosten-Zeile, aufgeteilt in ihren gemessenen und ihren geschätzten Anteil.
 *
 * ⚠ Die Aufteilung IST der Zweck dieses Typs. Eine blosse Jahressumme könnte die
 * Kennzeichnungspflicht aus D6 („Schätzung, sichtbar gekennzeichnet") nicht erfüllen: der Report
 * muss sagen können, welcher Teil der Zahl gemessen und welcher hochgerechnet ist.
 */
export type AnnualProjectedAmount = {
  /** Der Wert des bekannten Zeitraums, unverändert aus der bestehenden Berechnung. */
  measuredEur: number
  /** Der Wert des synthetischen Lückenausschnitts — die Schätzung. `0`, wenn nichts fehlte. */
  projectedEur: number
  /** `measuredEur + projectedEur`. */
  totalEur: number
}

/**
 * Die auf ein Jahr hochgerechneten Kosten für GENAU ZWEI Wege — „Ihr Tarif heute" und
 * „aWATTar ungesteuert" (D6 Teil 2b).
 *
 * ── ⚠ WARUM NUR DIESE ZWEI UND KEINE DRITTE ZEILE ─────────────────────────────────────────────
 * Die beiden Ladesteuerungs-Zeilen des Reports bleiben bei `annualizationFactor`
 * (`savings/attribute.ts`) und werden hier ausdrücklich nicht angefasst. Sie beruhen auf einem
 * simulierten Fahrplan; ein Fahrplan über erfundene, flach verteilte Tage wäre keine Hochrechnung
 * mehr, sondern eine zweite Simulation über Daten, die es nicht gibt.
 *
 * ── ⚠ DAS IST EIN EIGENER, PARALLELER WEG — KEIN ERSATZ FÜR `tariffOptimization` ───────────────
 * Die nachgeladenen Marktpreise des Lückenausschnitts landen NIE in den `TariffPricingInputs` der
 * bestehenden Tarifoptimierung. Deren `complete === false`-Blocker (Delta 15 Regel C) gilt für den
 * echten Zeitraum unverändert weiter: dort wird nicht genähert, hier wird die Näherung benannt.
 */
export type AnnualTariffProjection = {
  /** „Ihr Tarif heute" über die 365 Tage des Hochrechnungsfensters. */
  currentTariffEur: AnnualProjectedAmount
  /** „aWATTar ungesteuert" über dieselben 365 Tage — roher Lastgang, kein Dispatch. */
  spotWithoutControlEur: AnnualProjectedAmount
  /** Erster Kalendertag des Fensters (Ortszeit, `YYYY-MM-DD`, inklusiv). */
  windowFromDate: string
  /** Letzter Kalendertag des Fensters (Ortszeit, `YYYY-MM-DD`, inklusiv). */
  windowToDate: string
  /** Kalendertage des Fensters mit echten Messwerten. */
  measuredDays: number
  /**
   * Kalendertage des Fensters, die synthetisch bewertet wurden.
   *
   * ⚠ NICHT zwangsläufig gleich `consumption.missingDays`: dort ist es `365 − round(Intervalle/96)`,
   * hier die Zahl der tatsächlich unbelegten KALENDERTAGE. Ein am Vormittag endender Lastgang
   * berührt einen Kalendertag mehr, als er volle Tage enthält — dieselbe Unterscheidung wie
   * zwischen `BatterySavings.coveredDays` und `MonthlyFixedCosts.coveredDays`.
   */
  projectedDays: number
  /** Teil 1: woher die Tagesrate stammt, mit der die fehlenden Tage bewertet wurden. */
  consumption: {
    method: AnnualConsumptionMethod
    missingDays: number
    referenceRateKwhPerDay: number | null
    referenceSegments: ReferenceSegment[]
    estimatedAnnualConsumptionKwh: number
  }
  /** Teil 2a: woher die Marktpreise des Lückenausschnitts stammen. Leer, wenn nichts fehlte. */
  marketPrices: {
    coverage: MarketPriceCoverage[]
    hoursByOrigin: MarketPriceHoursByOrigin
    /** Was auch nach Nachladen und Näherung offen blieb — leer im Regelfall. */
    missingRanges: TariffPriceRange[]
  }
}
