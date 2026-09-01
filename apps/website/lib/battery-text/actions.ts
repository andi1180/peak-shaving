'use server'

import type { BatteryTextExtraction } from 'shared'

import { extractBatteryText } from './extract'
import { MAX_BATTERY_TEXT_CHARS } from './limits'

/**
 * Delta 17 Teil 2 — DIE SERVER ACTION DER BATTERIE-FREITEXTERFASSUNG. Reine Verdrahtung.
 *
 * ── ES GEHT AUSSCHLIESSLICH EIN SATZ HINAUS ───────────────────────────────────────────────────
 * Keine Datei, kein Lastgang, keine Rechnung. Prinzip 4 ist hier nicht berührt — was übertragen
 * wird, hat der Nutzer unmittelbar davor selbst getippt und sieht es vor sich.
 *
 * ── WARUM EINE SERVER ACTION UND KEIN ROUTE HANDLER ────────────────────────────────────────────
 * Dieselbe Abwägung wie bei den drei bestehenden Anbindungen: ein Route Handler wäre ein zweiter
 * ÖFFENTLICHER Endpunkt mit stabiler Adresse, an dem jeder unabhängig vom Formular Aufrufe auf
 * fremde Rechnung auslösen könnte.
 *
 * ⚠ Auch eine Server Action ist über ihre ID aufrufbar. Die Prüfkette unten läuft deshalb VOR
 * jedem externen Kontakt und ist eine echte Sperre, keine Bedienhilfe: jeder Aufruf ist abrechenbar.
 */

/** Die Antwort der Erfassung. `error` trägt einen Zustand, nie eine Meldung des Modells. */
export type BatteryTextResponse =
  | { ok: true; extraction: BatteryTextExtraction }
  | { ok: false; error: 'no_text' | 'not_configured' | 'unreadable' | 'unavailable' }

export async function readBatteryText(text: string): Promise<BatteryTextResponse> {
  /*
   * DIE PRÜFUNG LÄUFT VOR JEDEM EXTERNEN KONTAKT. Scheitert sie, entsteht KEIN Client und KEIN
   * Aufruf — nicht „die API lehnt ab", sondern sie wird gar nicht erst befragt.
   */
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return { ok: false, error: 'no_text' }

  const outcome = await extractBatteryText(trimmed.slice(0, MAX_BATTERY_TEXT_CHARS))

  if (!outcome.ok) {
    /*
     * `not_configured` und `unreadable` reisen als eigene Zustände weiter — die Oberfläche muss
     * dafür etwas anderes sagen können als bei einem Fehlschlag („noch nicht eingerichtet" ist kein
     * Fehler des Nutzers; „daraus liessen sich keine Kenndaten lesen" ist keiner der Technik).
     * `api_error` wird zu `unavailable`: was genau schiefging, geht den Absender nichts an.
     *
     * In ALLEN Fällen bleibt das Formular vollständig bedienbar — das Feld ist optional, und ohne
     * Vorschlag verhält sich der Rechner exakt wie vorher.
     */
    if (outcome.reason === 'not_configured') return { ok: false, error: 'not_configured' }
    if (outcome.reason === 'unreadable') return { ok: false, error: 'unreadable' }
    return { ok: false, error: 'unavailable' }
  }

  /* NUR die gelesenen Felder. Kein Roh-Text der Antwort, keine Token-Zahl. */
  return { ok: true, extraction: outcome.extraction }
}
