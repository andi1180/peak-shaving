'use server'

import { isCurrentUserAdmin } from '../guard'
import { MAX_TARIFF_SHEET_FILE_BYTES, type TariffSheetExtraction } from '../tariff-sheet-scan'
import { extractTariffSheetData } from './extract'

/**
 * DIE SERVER ACTION DES TARIFBLATT-SCANS. Reine Verdrahtung — sie liest, sie schreibt nichts.
 *
 * ── ⚠ DIESE ACTION SCHREIBT KEINE ZEILE, UND DAS IST DER KERN DES ENTWURFS ────────────────────
 * Sie legt KEINEN Tarifstand an. Sie ruft `create_grid_tariff` nicht auf, sie fasst weder
 * `grid_tariffs` noch `grid_tariff_rate_windows` an, und sie braucht deshalb auch KEINEN
 * service_role-Client (die ESLint-Allowlist für ihn bleibt in diesem Schritt unverändert bei acht
 * Einträgen). Was sie liefert, sind Vorschläge für ein Formular.
 *
 * Der Grund ist der Schreibweg selbst: Ein Tarifstand ist nachträglich NICHT mehr änderbar — kein
 * Bearbeiten, kein Löschen, kein `delete`-Grant für irgendeine Rolle (B21-2b). Ein Scan, der
 * selbst anlegt, machte aus einem Lesefehler des Modells eine unumkehrbare Tatsache. Deshalb ist
 * die Bestätigungsstufe nicht eine Bequemlichkeit, sondern die Bedingung, unter der dieser Scan
 * überhaupt gebaut werden durfte: Der Mensch sieht jedes Feld, ändert was er will, und erst sein
 * Absenden geht durch den unveränderten Weg aus B21-2b.
 *
 * ── ⚠ DIE ROLLENPRÜFUNG STEHT HIER, NICHT NUR AM ABSENDEN ─────────────────────────────────────
 * Eine Server Action ist ein eigener, über ihre ID direkt adressierbarer Endpunkt. Dass die SEITE
 * davor `isCurrentUserAdmin()` prüft, schützt diesen Aufruf NICHT (dieselbe Lehre wie in B19 und
 * wortgleich die Begründung im Kopf von `../grid-tariffs-actions.ts`).
 *
 * Hier kommt ein zweiter Grund dazu, den die Schreib-Action nicht hat: Jeder Aufruf ist
 * ABRECHENBAR. Ohne Prüfung an dieser Stelle wäre die Action ein offener Endpunkt, über den ein
 * beliebiger angemeldeter Nutzer — oder mit der Action-ID auch ein nicht angemeldeter — PDFs auf
 * fremde Rechnung durch ein Sprachmodell schicken könnte. Die Prüfung läuft deshalb VOR jeder
 * anderen Arbeit und VOR jedem externen Kontakt; fail closed, alles ausser einem ausdrücklichen
 * `true` gilt als „kein Zugang".
 *
 * ── WARUM EINE SERVER ACTION UND KEIN ROUTE HANDLER ────────────────────────────────────────────
 * Dieselbe Abwägung wie beim Rechnungs-Scan: ein Route Handler wäre ein zweiter ÖFFENTLICHER
 * Endpunkt mit stabiler, ratbarer Adresse. Hier gibt es nichts, was er zusätzlich leisten müsste.
 */

/** Die Antwort des Scans. `error` trägt einen Zustand, nie eine Meldung des Modells. */
export type TariffSheetScanResponse =
  | { ok: true; extraction: TariffSheetExtraction }
  | {
      ok: false
      error:
        | 'forbidden'
        | 'no_file'
        | 'wrong_type'
        | 'too_large'
        | 'not_configured'
        | 'unreadable'
        | 'unavailable'
    }

const PDF_MEDIA_TYPE = 'application/pdf'

export async function scanTariffSheet(file: File | null): Promise<TariffSheetScanResponse> {
  /*
   * ZUERST die Rolle, dann alles andere. Wer keinen Zugang hat, soll weder einen Aufruf auslösen
   * noch erfahren, welche Dateien dieses Formular annimmt.
   */
  if (!(await isCurrentUserAdmin())) return { ok: false, error: 'forbidden' }

  /*
   * DIE PRÜFKETTE LÄUFT VOR JEDEM EXTERNEN KONTAKT. Scheitert sie, entsteht KEIN Client und KEIN
   * Aufruf — nicht „die API lehnt ab", sondern sie wird gar nicht erst befragt. Dieselbe Haltung
   * wie in `apps/web/lib/admin/analysis-upload.ts`. Sie ist hier zusätzlich eine Kostenbremse.
   */
  if (!file || file.size === 0) return { ok: false, error: 'no_file' }

  /*
   * Nur PDF. Der Medientyp kommt vom Browser und ist damit kein Beweis — die eigentliche Sperre
   * ist, dass die API den `document`-Block mit `media_type: 'application/pdf'` erwartet. Diese
   * Prüfung fängt den ehrlichen Irrtum ab, bevor er Geld kostet.
   */
  if (file.type !== PDF_MEDIA_TYPE) return { ok: false, error: 'wrong_type' }

  if (file.size > MAX_TARIFF_SHEET_FILE_BYTES) return { ok: false, error: 'too_large' }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  const outcome = await extractTariffSheetData(base64)

  if (!outcome.ok) {
    /*
     * `not_configured` und `unreadable` reisen als eigene Zustände weiter — die Oberfläche muss
     * dafür etwas anderes sagen können als bei einem Fehlschlag. `api_error` wird zu
     * `unavailable`: was genau schiefging, geht den Absender nichts an.
     */
    if (outcome.reason === 'not_configured') return { ok: false, error: 'not_configured' }
    if (outcome.reason === 'unreadable') return { ok: false, error: 'unreadable' }
    return { ok: false, error: 'unavailable' }
  }

  /* NUR die extrahierten Felder. Kein Dateiname, keine Grösse, keine Token-Zahl, kein Roh-Text. */
  return { ok: true, extraction: outcome.extraction }
}
