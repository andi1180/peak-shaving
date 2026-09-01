'use server'

import type { ReportRequestExtraction } from 'shared'

import { extractReportRequest } from './extract'
import { MAX_REPORT_REQUEST_CHARS } from './limits'

/**
 * Delta 18 — DIE SERVER ACTION DER REPORT-ANFRAGE. Reine Verdrahtung.
 *
 * ── ES GEHT AUSSCHLIESSLICH EIN SATZ HINAUS ───────────────────────────────────────────────────
 * Keine Datei, kein Lastgang, kein Ergebnis, keine berechnete Zahl. Prinzip 4 ist hier nicht
 * berührt — was übertragen wird, hat der Nutzer unmittelbar davor selbst getippt und sieht es
 * vor sich.
 *
 * ── WARUM EINE SERVER ACTION UND KEIN ROUTE HANDLER ────────────────────────────────────────────
 * Dieselbe Abwägung wie bei den vier bestehenden Anbindungen: ein Route Handler wäre ein zweiter
 * ÖFFENTLICHER Endpunkt mit stabiler Adresse, an dem jeder unabhängig vom Formular Aufrufe auf
 * fremde Rechnung auslösen könnte.
 *
 * ⚠ Auch eine Server Action ist über ihre ID aufrufbar. Die Prüfkette unten läuft deshalb VOR
 * jedem externen Kontakt und ist eine echte Sperre, keine Bedienhilfe: jeder Aufruf ist abrechenbar.
 */

/** Die Antwort der Übersetzung. `error` trägt einen Zustand, nie eine Meldung des Modells. */
export type ReportRequestResponse =
  | { ok: true; extraction: ReportRequestExtraction }
  | { ok: false; error: 'no_text' | 'not_configured' | 'unreadable' | 'unavailable' }

export async function readReportRequest(text: string): Promise<ReportRequestResponse> {
  /*
   * DIE PRÜFUNG LÄUFT VOR JEDEM EXTERNEN KONTAKT. Scheitert sie, entsteht KEIN Client und KEIN
   * Aufruf — nicht „die API lehnt ab", sondern sie wird gar nicht erst befragt.
   */
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return { ok: false, error: 'no_text' }

  const outcome = await extractReportRequest(trimmed.slice(0, MAX_REPORT_REQUEST_CHARS))

  if (!outcome.ok) {
    /*
     * `not_configured` und `unreadable` reisen als eigene Zustände weiter — die Oberfläche muss
     * dafür etwas anderes sagen können als bei einem Fehlschlag („noch nicht eingerichtet" ist kein
     * Fehler des Nutzers; „daraus liess sich kein Wunsch lesen" ist keiner der Technik).
     * `api_error` wird zu `unavailable`: was genau schiefging, geht den Absender nichts an.
     *
     * In ALLEN Fällen bleibt der Report vollständig bedienbar — das Feld ist ein Zusatz, und das
     * Annahmen-Panel daneben kann jede der acht Grössen unverändert von Hand setzen.
     */
    if (outcome.reason === 'not_configured') return { ok: false, error: 'not_configured' }
    if (outcome.reason === 'unreadable') return { ok: false, error: 'unreadable' }
    return { ok: false, error: 'unavailable' }
  }

  /* NUR die gelesenen Felder. Kein Roh-Text der Antwort, keine Token-Zahl. */
  return { ok: true, extraction: outcome.extraction }
}
