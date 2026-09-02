/**
 * Die Auswahlregel der Netzentgelt-Zeitfenster (Delta 5): WELCHES Fenster einer Tarifzeile gilt zu
 * einem Zeitpunkt?
 *
 * ── WARUM DIESE REGEL IN `shared` STEHT UND NICHT (MEHR) IN `engine` ───────────────────────────
 * Sie hat seit dem 02.09.2026 ZWEI Konsumenten, und die liegen in verschiedenen Paketen:
 *
 *   1. der Rechenkern — `packages/engine/src/simulation/grid-tariff-window.ts` bildet daraus den
 *      Netzentgelt-Anteil jedes Intervallpreises (Delta 4);
 *   2. der Admin-Pflegeweg — `apps/web` warnt beim Hinzufügen eines Fensters, WELCHES bestehende
 *      Fenster dadurch in welchem Teilzeitraum verdrängt würde (`tariff-window-collision.ts`).
 *
 * `apps/web` kennt `engine` nicht und soll es nicht kennenlernen (es ist der Rechenkern des
 * Kalkulators, nicht eine Werkzeugkiste). Die naheliegende Alternative — die Regel im Admin-Bereich
 * ein zweites Mal auszuschreiben oder in SQL nachzubauen — ist genau der Fehler, den dieses Repo
 * sonst konsequent vermeidet: Die Warnung sagte dann etwas anderes, als die Engine später rechnet,
 * und der Admin bekäme eine Zusage, die niemand hält. **Eine Definition, zwei Konsumenten.**
 *
 * Dieselbe Aufteilung wie bei `tariff-catalog.ts` und `tariff-pricing.ts`: die REGELN und die
 * TYPEN liegen in `shared`, die Engine importiert sie — nicht umgekehrt. Sie hängt ohnehin an
 * `shared` und bleibt dadurch weiterhin frei von jeder Datenschicht (Wächter in
 * `packages/engine/src/tariff/`).
 *
 * Die Datei ist bewusst frei von Anzeige-Text: Sie beantwortet „wer gewinnt", nicht „wie sagt man
 * das". Die Formulierung der Warnung gehört in die Oberfläche, die sie zeigt.
 */

import type { GridTariffWindowInput } from './tariff-pricing'

export const MINUTES_PER_DAY = 24 * 60

/**
 * Tageslängen eines Bezugsjahres MIT dem 29. Februar.
 *
 * Ein Saisonwert ist jahreslos (`MM-DD`) und muss den 29.02. darstellen können — ein Bezugsjahr
 * ohne ihn liesse ausgerechnet den Tag aus, der in einer Saisongrenze stehen darf. Die Zahlen
 * dienen nur als Ordnungs- und Längenmass, nie als Kalenderrechnung.
 */
export const MONTH_LENGTHS: readonly number[] = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** 'HH:MM' oder 'HH:MM:SS' → Minuten seit Mitternacht. `24:00:00` ergibt 1440 (Tagesende). */
export function parseClockMinutes(value: string): number {
  const [h, m] = value.split(':')
  return (Number(h) || 0) * 60 + (Number(m) || 0)
}

/**
 * Liegt `minuteOfDay` im Fenster [from, to)? Über Mitternacht laufende Fenster (from > to) werden
 * als Vereinigung [from, 24:00) ∪ [0, to) gelesen — dieselbe Regel wie bei den `timeOfUseWindows`
 * der Energiepreis-Seite (`engine/src/simulation/tou.ts`), damit SNAP und HT/NT nicht zwei Lesarten
 * haben.
 *
 * Ein Fenster `00:00–24:00` (ganztägig) ergibt from=0, to=1440 und trifft damit jede Minute.
 */
export function inClockWindow(minuteOfDay: number, from: number, to: number): boolean {
  if (from <= to) return minuteOfDay >= from && minuteOfDay < to
  return minuteOfDay >= from || minuteOfDay < to
}

/** 'MM-DD' → Ordnungszahl im Jahr, nur für Vergleich und Längenmessung. */
export function monthDayOrdinal(monthDay: string): number {
  const [mm, dd] = monthDay.split('-')
  return (Number(mm) || 0) * 100 + (Number(dd) || 0)
}

/**
 * Liegt der Kalendertag in der (jahreslosen) Saison? `null` an einer der Grenzen heisst ganzjährig.
 * Über den Jahreswechsel laufende Saisons (10-01 … 03-31, der reale Winter-Fall) werden wie die
 * Uhrzeit-Fenster als Vereinigung gelesen — beide Grenzen INKLUSIV, denn eine Saison endet mit
 * ihrem letzten Tag und nicht am Vortag davon.
 */
export function inSeason(
  month: number,
  day: number,
  from: string | null,
  to: string | null,
): boolean {
  if (from == null || to == null) return true
  const value = month * 100 + day
  const a = monthDayOrdinal(from)
  const b = monthDayOrdinal(to)
  if (a <= b) return value >= a && value <= b
  return value >= a || value <= b
}

/** Länge der Saison in Tagen (grob, nur als Ordnungsmass — 366 = ganzjährig). */
export function seasonLengthDays(from: string | null, to: string | null): number {
  if (from == null || to == null) return 366
  const dayOfYear = (monthDay: string): number => {
    const [mm, dd] = monthDay.split('-')
    const month = Number(mm) || 1
    const day = Number(dd) || 1
    let n = day
    for (let m = 1; m < month; m++) n += MONTH_LENGTHS[m - 1]!
    return n
  }
  const a = dayOfYear(from)
  const b = dayOfYear(to)
  return a <= b ? b - a + 1 : 366 - a + b + 1
}

/**
 * Wie „eng" ist ein Fenster? Kleinere Zahl = spezifischer.
 *
 * ── WARUM ES DIESE ORDNUNG ÜBERHAUPT BRAUCHT ───────────────────────────────────────────────────
 * Überlappende Fenster sind der REGELFALL, nicht der Ausnahmefall: ein Preisblatt führt ein
 * ganztägiges Grundfenster (`normal`, 00:00–24:00) UND darin ausgeschnittene Hochlastfenster
 * (`snap`, 17:00–20:00, saisonal). Genau so ist es in B21-2b gegen die Cloud eingegeben worden.
 * Ohne Ordnung entschiede die Sortierreihenfolge der Abfrage, welcher Preis gilt — derselbe
 * Zustand, den der `nulls not distinct`-Constraint aus B21-1 auf der Zeilenebene ausschliesst.
 *
 * Gewählt ist die ENGERE Abdeckung, weil ein ausgeschnittenes Fenster fachlich die Ausnahme von
 * der Regel ist. Bei exakt gleicher Abdeckung gewinnt der HÖHERE Preis: zwei gleich enge Fenster
 * sind ein Pflegefehler, und die teurere Lesart weist eine zu HOHE statt einer zu niedrigen
 * Vergleichszahl aus — eine zu niedrige fiele niemandem als Fehler auf, sondern als Ergebnis.
 */
export function coverageScore(window: GridTariffWindowInput): number {
  const from = parseClockMinutes(window.timeFrom)
  const to = parseClockMinutes(window.timeTo)
  const minutes = from <= to ? to - from : MINUTES_PER_DAY - from + to
  const seasonDays = seasonLengthDays(window.monthDayFrom, window.monthDayTo)
  return seasonDays * minutes
}

/**
 * Der Index des Fensters, das den Zeitpunkt abdeckt — `-1`, wenn keines passt.
 *
 * ── ⚠ WARUM DIE INDEX-FASSUNG DIE TRAGENDE IST UND NICHT DIE BEQUEME ──────────────────────────
 * Zwei Fenster derselben Tarifzeile können strukturell IDENTISCH sein (ein Pflegefehler, den weder
 * Schema noch Formular ausschliessen — es gibt keinen Unique-Constraint über die Fensterfelder).
 * Die Kollisionsprüfung muss dann trotzdem sagen können, WELCHE der beiden Zeilen verdrängt wird;
 * über den zurückgegebenen Wert allein wären sie nicht auseinanderzuhalten. Deshalb entscheidet
 * hier der Index, und `selectRateWindow` ist der Einzeiler darüber.
 *
 * Die Reihenfolge der Liste ist Teil der Regel: Bei vollständigem Gleichstand (gleiche Abdeckung
 * UND gleicher Preis) gewinnt das ZUERST genannte Fenster. Das ist kein Zufall der Schleife,
 * sondern die einzige Wahl, die ohne eine erfundene zweite Ordnung auskommt.
 */
export function selectRateWindowIndex(
  windows: readonly GridTariffWindowInput[],
  month: number,
  day: number,
  minuteOfDay: number,
): number {
  let best = -1
  let bestScore = Number.POSITIVE_INFINITY
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i]!
    if (!inSeason(month, day, window.monthDayFrom, window.monthDayTo)) continue
    const from = parseClockMinutes(window.timeFrom)
    const to = parseClockMinutes(window.timeTo)
    if (!inClockWindow(minuteOfDay, from, to)) continue
    const score = coverageScore(window)
    if (score < bestScore || (score === bestScore && best >= 0 && window.ctPerKwh > windows[best]!.ctPerKwh)) {
      best = i
      bestScore = score
    }
  }
  return best
}

/** Das Fenster, das den Zeitpunkt abdeckt — `null`, wenn keines passt. */
export function selectRateWindow(
  windows: readonly GridTariffWindowInput[],
  month: number,
  day: number,
  minuteOfDay: number,
): GridTariffWindowInput | null {
  const index = selectRateWindowIndex(windows, month, day, minuteOfDay)
  return index < 0 ? null : windows[index]!
}
