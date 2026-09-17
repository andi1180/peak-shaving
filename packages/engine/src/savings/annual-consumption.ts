import type { LoadProfile } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { DAYS_PER_YEAR, coveredDaysOf } from './annualization'

/**
 * D6 Teil 1 — die JAHRESVERBRAUCHS-Hochrechnung über eine Referenzperiode (§3.7, Delta
 * Report-Baukasten D6).
 *
 * ── ⚠ SIE IST NICHT `annualizationFactor`, UND SIE ERSETZT SIE AUCH NICHT ──────────────────────
 * Die beiden beantworten verschiedene Fragen und stehen deshalb nebeneinander:
 *
 *  • `annualizationFactor` (nebenan) skaliert ERSPARNIS-Töpfe mit einem einzigen Faktor
 *    `365 / coveredDays`. Die Annahme dahinter steht dort ausgeschrieben: die nicht abgedeckten
 *    Tage verhalten sich im Mittel wie die abgedeckten — „bei einem Sommer-Halbjahr mit PV
 *    nachweislich zu optimistisch und bei einem Winter-Halbjahr zu pessimistisch".
 *
 *  • Diese Funktion schätzt die VERBRAUCHSMENGE des Jahres und macht genau den Unterschied, den
 *    der Faktor nicht macht: Sie bewertet die fehlenden Tage nicht mit dem Gesamtdurchschnitt,
 *    sondern mit einer Rate aus der kältesten VERFÜGBAREN echten Periode. Bei einem Lastgang, dem
 *    ausgerechnet der Winter fehlt, ist das der Unterschied zwischen einer plausiblen und einer
 *    systematisch zu niedrigen Jahresmenge.
 *
 * `annualizationFactor` bleibt unverändert und behält ihre Aufrufer. Zwei Rechenwege für zwei
 * Grössen — nicht zwei Wahrheiten über dieselbe.
 *
 * ── ⚠ DAS ERGEBNIS IST EINE SCHÄTZUNG UND MUSS ALS SOLCHE SICHTBAR BLEIBEN ────────────────────
 * Deshalb gibt die Funktion nicht eine Zahl zurück, sondern die Zahl MIT ihrer Herkunft: welche
 * Methode griff, welche Kalendermonate die Referenz trugen, über welche Zeitspannen, und wie viele
 * Tage damit bewertet wurden. Ein Report, der nur den Endwert bekäme, könnte die Pflicht aus D6
 * („Schätzung, sichtbar gekennzeichnet") gar nicht erfüllen — er wüsste nicht, was er kennzeichnen
 * soll.
 *
 * ⚠ KEIN NETZWERK, KEINE DATENBANK, KEIN WETTERDIENST. Die Kälte-Auswahl ist ein KALENDER-Proxy
 * (s. `WINTER_REFERENCE_MONTHS`) und keine Temperaturmessung. Die Marktpreis-Nachladung für den
 * Lückenzeitraum — die zweite Hälfte von D6 — liegt in der App-Schicht und ausdrücklich nicht hier.
 */

/**
 * Die Kalendermonate, die als „kälteste verfügbare Periode" gelten.
 *
 * `[ANNAHME]` — Dezember, Januar, Februar als KALENDARISCHER Kälte-Proxy. Die Alternative wäre, die
 * Referenzperiode an echten Temperaturen zu wählen; das hiesse ein Wetterdatum je Tag und damit
 * einen Netzaufruf in einer Funktion, die keinen haben darf (Engine-Regel: rein und isomorph). Der
 * Proxy ist grob — ein milder Dezember und ein kalter März fallen ihm zum Opfer —, aber er ist
 * nachvollziehbar, deterministisch und in jeder Zeitzone gleich.
 *
 * ⚠ ER IST BEWUSST NICHT „HEIZPERIODE" (Oktober–April): je weiter das Fenster, desto mehr
 * Übergangstage verdünnen die Rate, und die Hochrechnung fiele wieder Richtung Gesamtdurchschnitt
 * zurück — also genau dorthin, wovon diese Funktion sich unterscheiden soll.
 */
export const WINTER_REFERENCE_MONTHS: readonly number[] = [12, 1, 2]

/**
 * Wie die Jahresmenge zustande kam. Ein eigenes Feld und ausdrücklich KEIN Sonderwert in einer der
 * Zahlen: ein `null`-Datum oder eine Rate von 0 als Kennzeichen liesse „nicht hochgerechnet" und
 * „hochgerechnet mit 0" zusammenfallen.
 */
export type AnnualConsumptionMethod =
  /** Der Lastgang deckt ein volles Jahr (oder mehr) ab — es wird NICHT hochgerechnet, und auch nicht nach unten skaliert. */
  | 'full_period'
  /** Synthetisches Standardprofil — es trägt seinen Jahresverbrauch bereits als Eingabe (s. unten). */
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
  /** Bezugsenergie dieses Monats in kWh — nur die Bezugs-Komponente, s. `consumptionKwhOf`. */
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

type MonthTally = {
  year: number
  month: number
  intervals: number
  consumptionKwh: number
  firstMs: number
  lastMs: number
  firstIso: string
  lastIso: string
}

/**
 * Die BEZUGS-Komponente eines Intervalls in kWh.
 *
 * ⚠ Einspeisung zählt NICHT als negativer Verbrauch. `gridPowerKw` ist signiert, und dieselbe
 * Trennung bei `>= 0` macht die Kostenrechnung (`intervalCostEur`, `monthly-tariff-comparison.ts`):
 * bezogene und eingespeiste kWh haben verschiedene Preise und sind verschiedene Mengen. Gegenzurechnen
 * hiesse, einen sonnigen Mittag als Verbrauchsminderung auszuweisen — die Jahresmenge eines Betriebs
 * mit grosser PV fiele dadurch beliebig klein aus.
 */
function consumptionKwhOf(gridPowerKw: number, intervalHours: number): number {
  return Math.max(0, gridPowerKw) * intervalHours
}

function tallyByMonth(loadProfile: LoadProfile): MonthTally[] {
  const intervalHours = loadProfile.intervalMinutes / 60
  const tallies = new Map<string, MonthTally>()

  for (const reading of loadProfile.readings) {
    const ms = Date.parse(reading.ts)
    const { year, month } = utcMsToLocalFields(ms, loadProfile.timezoneMeta)
    const key = `${year}-${month}`
    const kwh = consumptionKwhOf(reading.gridPowerKw, intervalHours)

    const tally = tallies.get(key)
    if (!tally) {
      tallies.set(key, {
        year,
        month,
        intervals: 1,
        consumptionKwh: kwh,
        firstMs: ms,
        lastMs: ms,
        firstIso: reading.ts,
        lastIso: reading.ts,
      })
      continue
    }

    tally.intervals += 1
    tally.consumptionKwh += kwh
    /* ⚠ Nach ZEIT und nicht nach Reihenfolge: ein Lastgang muss nicht sortiert hereinkommen. */
    if (ms < tally.firstMs) {
      tally.firstMs = ms
      tally.firstIso = reading.ts
    }
    if (ms > tally.lastMs) {
      tally.lastMs = ms
      tally.lastIso = reading.ts
    }
  }

  return [...tallies.values()].sort((a, b) => a.year - b.year || a.month - b.month)
}

function segmentOf(tally: MonthTally, slotsPerDay: number): ReferenceSegment {
  return {
    year: tally.year,
    month: tally.month,
    days: tally.intervals / slotsPerDay,
    fromIso: tally.firstIso,
    toIso: tally.lastIso,
    consumptionKwh: tally.consumptionKwh,
  }
}

/**
 * Die geschätzte Jahres-Bezugsmenge eines Lastgangs, der weniger als ein Jahr abdeckt.
 *
 * ── DER RECHENWEG ─────────────────────────────────────────────────────────────────────────────
 *  1. Gemessene Bezugsenergie und abgedeckte Tage aus den vorhandenen Messwerten.
 *  2. Referenzrate = Bezugsenergie der abgedeckten Dezember-/Januar-/Februar-Tage ÷ deren Tageszahl.
 *  3. Fehlende Tage = `365 − coveredDays`.
 *  4. Jahresmenge = gemessene Menge + Rate × fehlende Tage.
 *
 * ── ⚠ DIE RÜCKFALLREGEL, UND WARUM SIE DEN HÖCHSTEN UND NICHT DEN MITTLEREN MONAT NIMMT ───────
 * Deckt der Lastgang keinen einzigen Wintertag ab (ein reiner Sommer-Halbjahres-Export etwa), gibt
 * es die Referenzperiode nicht, an der die ganze Methode hängt. Dann greift der Monat mit dem
 * HÖCHSTEN abgedeckten Tagesdurchschnitt — nicht der Durchschnitt über alle Monate, denn der wäre
 * wieder `annualizationFactor` mit mehr Schritten. Die Wahl ist bewusst die obere Schranke der
 * vorliegenden Daten: Wer die Batterie nach einer zu NIEDRIG geschätzten Jahresmenge auslegt,
 * bekommt eine Anlage, die im Winter nicht trägt; die umgekehrte Richtung kostet Geld, aber keine
 * Funktion (Prinzip 7).
 *
 * ⚠ SIE IST DAMIT AUSDRÜCKLICH EMPFINDLICH GEGEN EINEN DÜNN BELEGTEN MONAT: ein Rand-Monat mit
 * zwei Tagen Daten kann sie gewinnen. Eine Mindest-Tageszahl ist hier bewusst NICHT eingebaut —
 * sie könnte dazu führen, dass gar kein Kandidat übrig bleibt, und ein stillschweigendes
 * Zurückfallen auf einen zweiten Rückfall wäre schwerer zu erklären als das Ergebnis selbst. Der
 * Rückgabewert trägt die Segmente mit ihrer Tageszahl; wer die Schätzung zeigt, kann die dünne
 * Grundlage damit benennen.
 *
 * ── DREI FÄLLE RECHNEN NICHT HOCH, UND JEDER SAGT WARUM ───────────────────────────────────────
 *  • `full_period` — `coveredDays >= 365`. Es wird nie nach UNTEN skaliert, dieselbe Regel und
 *    dieselbe Begründung wie in `annualizationFactor`: ein 366-Tage-Lastgang beruht auf Messung.
 *  • `synthetic_profile` — ein Standardlastprofil trägt seinen Jahresverbrauch bereits als EINGABE
 *    (`generateStandardLoadProfile`); eine Hochrechnung darauf wäre entweder wirkungslos oder sie
 *    verstärkte einen Erzeugungsfehler. An der HERKUNFT ausgeschlossen und nicht über die
 *    Tageszahl — dieselbe Trennlinie wie nebenan.
 *  • `no_data` — kein abgedeckter Tag. Die Division hätte kein Ergebnis, und `0 kWh/Jahr` als
 *    Antwort sähe aus wie eine Messung.
 */
export function estimateAnnualConsumption(loadProfile: LoadProfile): AnnualConsumptionEstimate {
  const slotsPerDay = (24 * 60) / loadProfile.intervalMinutes
  const intervalHours = loadProfile.intervalMinutes / 60
  const coveredDays = coveredDaysOf(loadProfile)

  const measuredConsumptionKwh = loadProfile.readings.reduce(
    (sum, r) => sum + consumptionKwhOf(r.gridPowerKw, intervalHours),
    0,
  )

  /** Der Rückgabewert der drei Fälle ohne Hochrechnung — die gemessene Menge steht für sich. */
  const asMeasured = (method: AnnualConsumptionMethod): AnnualConsumptionEstimate => ({
    method,
    coveredDays,
    measuredConsumptionKwh,
    missingDays: 0,
    referenceRateKwhPerDay: null,
    referenceSegments: [],
    estimatedAnnualConsumptionKwh: measuredConsumptionKwh,
  })

  if (loadProfile.source === 'standard_profile') return asMeasured('synthetic_profile')
  if (coveredDays <= 0) return asMeasured('no_data')
  if (coveredDays >= DAYS_PER_YEAR) return asMeasured('full_period')

  const tallies = tallyByMonth(loadProfile)
  const winter = tallies.filter((t) => WINTER_REFERENCE_MONTHS.includes(t.month))

  let method: AnnualConsumptionMethod
  let chosen: MonthTally[]

  if (winter.length > 0) {
    method = 'winter_reference'
    chosen = winter
  } else {
    method = 'month_maximum'
    /*
     * ⚠ Strikt grösser, damit bei Gleichstand der FRÜHERE Monat gewinnt — `tallies` ist
     * chronologisch sortiert, das Ergebnis also auch bei identischen Durchschnitten eindeutig.
     */
    const best = tallies.reduce((a, b) =>
      b.consumptionKwh / b.intervals > a.consumptionKwh / a.intervals ? b : a,
    )
    chosen = [best]
  }

  const referenceDays = chosen.reduce((sum, t) => sum + t.intervals, 0) / slotsPerDay
  const referenceKwh = chosen.reduce((sum, t) => sum + t.consumptionKwh, 0)
  const referenceRateKwhPerDay = referenceKwh / referenceDays
  const missingDays = DAYS_PER_YEAR - coveredDays

  return {
    method,
    coveredDays,
    measuredConsumptionKwh,
    missingDays,
    referenceRateKwhPerDay,
    referenceSegments: chosen.map((t) => segmentOf(t, slotsPerDay)),
    estimatedAnnualConsumptionKwh: measuredConsumptionKwh + referenceRateKwhPerDay * missingDays,
  }
}
