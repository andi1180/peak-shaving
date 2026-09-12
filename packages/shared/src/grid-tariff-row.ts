/**
 * DIE DATIERUNGSREGEL DER NETZBETREIBER-TARIFZEILEN: welcher Stand gilt an einem Kalendertag?
 *
 * ── ⚠ WARUM SIE SEIT DEM 12.09.2026 HIER LIEGT UND NICHT MEHR IN `packages/engine` ────────────
 * Sie stand bis hierher in `packages/engine/src/simulation/grid-tariff-window.ts`, mit einem
 * ausdrücklichen Satz daneben, warum sie dort bleiben durfte: „sie beantwortet eine andere Frage
 * (welcher Stand gilt an einem Datum) und hat ausserhalb des Rechenkerns keinen Konsumenten".
 * Genau dieser Satz ist mit der manuellen Tarif-Eingabe der Rechnungs-Station falsch geworden —
 * der Admin-Wizard in `apps/web` schlägt dort Leistungspreis und Mindestbemessung aus einer
 * gepflegten Preisblatt-Zeile vor und muss dafür dieselbe Zeile auswählen, mit der die Engine
 * später rechnet.
 *
 * ⚠ UND `apps/web` DARF `engine` NICHT KENNEN. Das ist gemessen, nicht angenommen:
 * `apps/web/package.json` führt `shared` und `extractors`, aber kein `engine`, und
 * `apps/web/node_modules/` trägt entsprechend keinen Symlink — ein `from 'engine'` löst dort gar
 * nicht auf (pnpm ist strikt). Die Trennung ist zudem eine bewusste: der Chat- und Admin-Teil
 * soll den Rechenkern nicht mitziehen.
 *
 * Es blieben also drei Wege, und zwei davon sind schlechter:
 *   – `engine` als Abhängigkeit ergänzen  → bricht genau diese Trennung für eine einzige Funktion.
 *   – Die Regel in `apps/web` nachbauen   → zwei Fassungen derselben Auswahl. Der Fehlschlag wäre
 *                                           STILL: der Wizard schlüge den Satz einer Zeile vor,
 *                                           mit der die Engine gar nicht rechnet, und beide Zahlen
 *                                           sähen für sich plausibel aus.
 *   – Die Regel nach `shared` verschieben → EINE Definition, zwei Konsumenten.
 *
 * Der dritte ist gewählt, und er ist kein neues Muster: die FENSTER-Auswahlregel ist am 02.09.2026
 * aus derselben Datei und aus demselben Grund nach `tariff-window-rules.ts` gewandert (B21-2d
 * Teil A — ein zweiter Konsument in `apps/web`, der `engine` nicht kennen darf). `engine`
 * re-exportiert `findGridTariffRow` unverändert weiter; für `apps/website` und den Rechenkern
 * ändert sich damit keine Zeile.
 */
import type { GridTariffRowInput } from './tariff-pricing'

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
 *
 * `localDate` ist ein ISO-Datum (`YYYY-MM-DD`) und wird als ZEICHENKETTE verglichen — bei diesem
 * Format ist die lexikografische Ordnung die chronologische, und ein `Date` dazwischen brächte eine
 * Zeitzone ins Spiel, die ein Gültigkeitsdatum nicht hat.
 */
export function findGridTariffRow<T extends Pick<GridTariffRowInput, 'validFrom' | 'validUntil'>>(
  rows: readonly T[],
  localDate: string,
): T | null {
  let best: T | null = null
  for (const row of rows) {
    if (row.validFrom > localDate) continue
    if (row.validUntil != null && row.validUntil < localDate) continue
    if (best === null || row.validFrom > best.validFrom) best = row
  }
  return best
}
