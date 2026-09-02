import type { GridTariffRowInput, GridTariffWindowInput } from 'shared'
import { selectRateWindow } from 'shared'

/**
 * Netzentgelt-Seite des kombinierten Intervallpreises (Delta 4/Delta 5): welche Tarifzeile gilt an
 * einem Tag, und welches ihrer Zeitfenster gilt zu einer Uhrzeit?
 *
 * Eigene Datei, weil die Auswahlregeln fachliche Aussagen sind und keine Hilfsfunktionen: welche
 * Zeile ein Datum abdeckt, entscheidet über den Preis einer ganzen Jahreshälfte; welches Fenster
 * eine Stunde abdeckt, über die Bewertung jeder verschobenen kWh.
 *
 * ── ⚠ DIE FENSTER-AUSWAHLREGEL LIEGT SEIT DEM 02.09.2026 IN `shared` ───────────────────────────
 * `inSeason`, `inClockWindow`, `coverageScore` und die Auswahl darüber sind nach
 * `packages/shared/src/tariff-window-rules.ts` gewandert und werden von dort importiert. Der Grund
 * ist ein ZWEITER Konsument, der `engine` nicht kennen darf: Der Admin-Pflegeweg in `apps/web`
 * warnt beim Hinzufügen eines Fensters, welches bestehende dadurch verdrängt würde — und diese
 * Warnung muss dieselbe Regel benutzen, nach der die Engine später rechnet. Ausgeschrieben wären es
 * zwei Regeln, die auseinanderlaufen können; die Warnung sagte dann etwas, das die Rechnung nicht
 * einhält. Begründung in voller Länge im Kopf der Datei dort.
 *
 * Die DATIERUNG der Tarifzeile (`findGridTariffRow`, unten) ist davon unberührt und bleibt hier:
 * sie beantwortet eine andere Frage (welcher Stand gilt an einem Datum) und hat ausserhalb des
 * Rechenkerns keinen Konsumenten.
 */

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

/**
 * Das Zeitfenster einer Tarifzeile, das den Zeitpunkt abdeckt — `null`, wenn keins passt.
 *
 * Reicht die Fensterliste an die geteilte Auswahlregel weiter (s. Kopf). Der Einstiegspunkt bleibt
 * hier, weil der Rechenkern in Tarifzeilen denkt und nicht in Fensterlisten.
 */
export function findGridTariffWindow(
  row: GridTariffRowInput,
  month: number,
  day: number,
  minuteOfDay: number,
): GridTariffWindowInput | null {
  return selectRateWindow(row.windows, month, day, minuteOfDay)
}
