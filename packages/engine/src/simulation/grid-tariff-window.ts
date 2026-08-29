import type { GridTariffRowInput, GridTariffWindowInput } from 'shared'

/**
 * Netzentgelt-Seite des kombinierten Intervallpreises (Delta 4/Delta 5): welche Tarifzeile gilt an
 * einem Tag, und welches ihrer Zeitfenster gilt zu einer Uhrzeit?
 *
 * Eigene Datei, weil die Auswahlregeln fachliche Aussagen sind und keine Hilfsfunktionen: welche
 * Zeile ein Datum abdeckt, entscheidet über den Preis einer ganzen Jahreshälfte; welches Fenster
 * eine Stunde abdeckt, über die Bewertung jeder verschobenen kWh.
 */

const MINUTES_PER_DAY = 24 * 60

/** 'HH:MM' oder 'HH:MM:SS' → Minuten seit Mitternacht. `24:00:00` ergibt 1440 (Tagesende). */
export function parseClockMinutes(value: string): number {
  const [h, m] = value.split(':')
  return (Number(h) || 0) * 60 + (Number(m) || 0)
}

/**
 * Liegt `minuteOfDay` im Fenster [from, to)? Über Mitternacht laufende Fenster (from > to) werden
 * als Vereinigung [from, 24:00) ∪ [0, to) gelesen — dieselbe Regel wie bei den `timeOfUseWindows`
 * der Energiepreis-Seite (`tou.ts`), damit SNAP und HT/NT nicht zwei Lesarten haben.
 *
 * Ein Fenster `00:00–24:00` (ganztägig) ergibt from=0, to=1440 und trifft damit jede Minute.
 */
function inClockWindow(minuteOfDay: number, from: number, to: number): boolean {
  if (from <= to) return minuteOfDay >= from && minuteOfDay < to
  return minuteOfDay >= from || minuteOfDay < to
}

/** 'MM-DD' → Ordnungszahl im (nicht-Schalt-)Jahr, nur für Vergleich und Längenmessung. */
function monthDayOrdinal(monthDay: string): number {
  const [mm, dd] = monthDay.split('-')
  return (Number(mm) || 0) * 100 + (Number(dd) || 0)
}

/**
 * Liegt der Kalendertag in der (jahreslosen) Saison? `null` an einer der Grenzen heisst ganzjährig.
 * Über den Jahreswechsel laufende Saisons (10-01 … 03-31, der reale Winter-Fall) werden wie die
 * Uhrzeit-Fenster als Vereinigung gelesen — beide Grenzen INKLUSIV, denn eine Saison endet mit
 * ihrem letzten Tag und nicht am Vortag davon.
 */
function inSeason(month: number, day: number, from: string | null, to: string | null): boolean {
  if (from == null || to == null) return true
  const value = month * 100 + day
  const a = monthDayOrdinal(from)
  const b = monthDayOrdinal(to)
  if (a <= b) return value >= a && value <= b
  return value >= a || value <= b
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
function coverageScore(window: GridTariffWindowInput): number {
  const from = parseClockMinutes(window.timeFrom)
  const to = parseClockMinutes(window.timeTo)
  const minutes = from <= to ? to - from : MINUTES_PER_DAY - from + to
  const seasonDays = seasonLengthDays(window.monthDayFrom, window.monthDayTo)
  return seasonDays * minutes
}

/** Länge der Saison in Tagen (grob, nur als Ordnungsmass — 366 = ganzjährig). */
function seasonLengthDays(from: string | null, to: string | null): number {
  if (from == null || to == null) return 366
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const dayOfYear = (monthDay: string): number => {
    const [mm, dd] = monthDay.split('-')
    const month = Number(mm) || 1
    const day = Number(dd) || 1
    let n = day
    for (let m = 1; m < month; m++) n += days[m - 1]!
    return n
  }
  const a = dayOfYear(from)
  const b = dayOfYear(to)
  return a <= b ? b - a + 1 : 366 - a + b + 1
}

/**
 * Die Tarifzeile, die einen Kalendertag abdeckt — `null`, wenn keine ihn abdeckt.
 *
 * ⚠ `validUntil` ist INKLUSIV (B21-2b: `public.create_grid_tariff` schliesst die Vorgängerin mit
 * `valid_from - 1`, die Kette lautet `… → 2026-12-31` / `2027-01-01 → offen`). Halboffen gelesen
 * verlöre jeder Stand seinen letzten Tag, und bei einem Lastgang, der am 31.12. endet, wäre das der
 * ganze Treffer.
 *
 * Decken mehrere Zeilen denselben Tag ab (ein Zustand, den der Unique-Constraint aus B21-1 nicht
 * entstehen lässt, ein Eingriff von Hand aber schon), gewinnt die SPÄTER beginnende: sie ist der
 * neuere Stand derselben Kombination.
 */
export function findGridTariffRow(
  rows: GridTariffRowInput[],
  localDate: string,
): GridTariffRowInput | null {
  let best: GridTariffRowInput | null = null
  for (const row of rows) {
    if (row.validFrom > localDate) continue
    if (row.validUntil != null && row.validUntil < localDate) continue
    if (best === null || row.validFrom > best.validFrom) best = row
  }
  return best
}

/** Das Zeitfenster einer Tarifzeile, das den Zeitpunkt abdeckt — `null`, wenn keins passt. */
export function findGridTariffWindow(
  row: GridTariffRowInput,
  month: number,
  day: number,
  minuteOfDay: number,
): GridTariffWindowInput | null {
  let best: GridTariffWindowInput | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const window of row.windows) {
    if (!inSeason(month, day, window.monthDayFrom, window.monthDayTo)) continue
    const from = parseClockMinutes(window.timeFrom)
    const to = parseClockMinutes(window.timeTo)
    if (!inClockWindow(minuteOfDay, from, to)) continue
    const score = coverageScore(window)
    if (score < bestScore || (score === bestScore && best !== null && window.ctPerKwh > best.ctPerKwh)) {
      best = window
      bestScore = score
    }
  }
  return best
}
