'use server'

import type { PvDesignExtraction } from 'shared'

import { MAX_PV_DESIGN_FILE_BYTES } from './ai-client'
import { extractPvDesign } from './extract'

/**
 * B22c — DIE SERVER ACTION DES PV-AUSLEGUNGS-SCANS. Reine Verdrahtung.
 *
 * ── ⚠ HIER VERLÄSST EIN KUNDENDOKUMENT DAS GERÄT ──────────────────────────────────────────────
 * Prinzip 4 sagt: Verbrauchsdaten verlassen den Browser nicht. Für den LASTGANG gilt das
 * unverändert — er kommt hier nicht vor, und die Kopplung Verbrauch − Erzeugung geschieht
 * weiterhin im Browser (B22b). Für das PLANUNGSDOKUMENT gilt es nicht mehr, und das ist die
 * bewusste Entscheidung dieses Abschnitts. Der Preis ist offengelegt, nicht versteckt — und dafür
 * gilt die engste denkbare Fassung:
 *
 *   – Die Datei geht an GENAU EINEN Empfänger, für GENAU EINEN Zweck.
 *   – Sie wird NIRGENDS gespeichert: keine Datenbank, keine Datei, kein Zwischenstand, kein Log.
 *   – Die volle Modellantwort wird NICHT weitergereicht. Aus der Funktion kommen ausschliesslich
 *     die extrahierten Felder.
 *   – Nach dem Rücksprung hält nichts mehr eine Referenz auf den Inhalt.
 *
 * ⚠ Ein PV-Exposé trägt üblicherweise Name und Adresse des Kunden im Kopf. Der Hinweis darauf
 * gehört SICHTBAR an den Upload und steht dort (`pv-design-panel.tsx`) — nicht in einer Fussnote.
 *
 * ── WARUM EINE SERVER ACTION UND KEIN ROUTE HANDLER ────────────────────────────────────────────
 * Dieselbe Abwägung wie beim Rechnungs-Scan: ein Route Handler wäre ein zweiter ÖFFENTLICHER
 * Endpunkt mit stabiler Adresse, an dem jeder unabhängig vom Formular PDFs hochladen — und damit
 * Aufrufe auf fremde Rechnung auslösen — könnte.
 *
 * ⚠ Auch eine Server Action ist über ihre ID aufrufbar. Die Obergrenze unten ist deshalb eine
 * echte Sperre und keine Bedienhilfe.
 */

/** Die Antwort des Scans. `error` trägt einen Zustand, nie eine Meldung des Modells. */
export type PvDesignScanResponse =
  | { ok: true; extraction: PvDesignExtraction }
  | {
      ok: false
      error: 'no_file' | 'wrong_type' | 'too_large' | 'not_configured' | 'unreadable' | 'unavailable'
    }

const PDF_MEDIA_TYPE = 'application/pdf'

export async function scanPvDesign(file: File | null): Promise<PvDesignScanResponse> {
  /*
   * DIE PRÜFUNG LÄUFT VOR JEDEM EXTERNEN KONTAKT. Scheitert sie, entsteht KEIN Client und KEIN
   * Aufruf — nicht „die API lehnt ab", sondern sie wird gar nicht erst befragt. Sie ist zugleich
   * eine Kostenbremse: jeder Aufruf ist abrechenbar.
   */
  if (!file || file.size === 0) return { ok: false, error: 'no_file' }

  /*
   * Nur PDF. Der Medientyp kommt vom Browser und ist damit kein Beweis — die eigentliche Sperre
   * ist, dass die API den `document`-Block mit `media_type: 'application/pdf'` erwartet. Diese
   * Prüfung fängt den ehrlichen Irrtum („ich habe den Screenshot hochgeladen") ab, bevor er Geld
   * kostet.
   */
  if (file.type !== PDF_MEDIA_TYPE) return { ok: false, error: 'wrong_type' }

  if (file.size > MAX_PV_DESIGN_FILE_BYTES) return { ok: false, error: 'too_large' }

  // Der einzige Ort, an dem der Dateiinhalt in diesem Prozess existiert. Er lebt für die Dauer
  // dieses Aufrufs in zwei lokalen Variablen und wird danach nicht mehr referenziert.
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  const outcome = await extractPvDesign(base64)

  if (!outcome.ok) {
    /*
     * `not_configured` und `unreadable` reisen als eigene Zustände weiter — die Oberfläche muss
     * dafür etwas anderes sagen können als bei einem Fehlschlag („noch nicht eingerichtet" ist
     * kein Fehler des Kunden; „auf diesem Dokument war keine Modulfläche zu finden" ist keiner der
     * Technik, und es ist der Fall des eingescannten Bild-PDFs). `api_error` wird zu `unavailable`:
     * was genau schiefging, geht den Absender nichts an.
     */
    if (outcome.reason === 'not_configured') return { ok: false, error: 'not_configured' }
    if (outcome.reason === 'unreadable') return { ok: false, error: 'unreadable' }
    return { ok: false, error: 'unavailable' }
  }

  /*
   * NUR die extrahierten Felder. Kein Dateiname, keine Grösse, keine Token-Zahl, kein Roh-Text der
   * Antwort — was der Client nicht erfährt, kann er nicht weitergeben.
   */
  return { ok: true, extraction: outcome.extraction }
}
