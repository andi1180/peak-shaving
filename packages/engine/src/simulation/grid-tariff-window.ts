import type { GridTariffRowInput, GridTariffWindowInput } from 'shared'
import { findGridTariffRow, selectRateWindow } from 'shared'

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
 * ── ⚠ DIE DATIERUNG DER TARIFZEILE IST SEIT DEM 12.09.2026 EBENFALLS IN `shared` ──────────────
 * Dieser Absatz lautete bis dahin: „Die DATIERUNG der Tarifzeile (`findGridTariffRow`, unten) ist
 * davon unberührt und bleibt hier: sie beantwortet eine andere Frage (welcher Stand gilt an einem
 * Datum) und hat ausserhalb des Rechenkerns keinen Konsumenten." Der letzte Halbsatz stimmt nicht
 * mehr — die manuelle Tarif-Eingabe der Rechnungs-Station in `apps/web` schlägt Leistungspreis und
 * Mindestbemessung aus einer gepflegten Preisblatt-Zeile vor und muss dieselbe Zeile auswählen, mit
 * der die Engine später rechnet. `apps/web` kennt `engine` aber nicht (und soll es nicht: der
 * Admin- und Chat-Teil zieht den Rechenkern nicht mit).
 *
 * `findGridTariffRow` liegt deshalb in `packages/shared/src/grid-tariff-row.ts` — dieselbe Bewegung
 * und dieselbe Begründung wie bei der Fensterregel darüber. Sie wird hier UNVERÄNDERT
 * re-exportiert: für den Rechenkern und `apps/website` ändert sich keine Zeile.
 */

export { findGridTariffRow }

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
