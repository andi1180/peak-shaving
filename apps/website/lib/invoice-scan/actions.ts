'use server'

import type { InvoiceExtraction } from 'shared'

import { MAX_INVOICE_FILE_BYTES } from './ai-client'
import { extractInvoiceData } from './extract'

/**
 * Delta 9b-2a — DIE SERVER ACTION DES RECHNUNGS-SCANS. Reine Verdrahtung.
 *
 * ── ⚠ DAS IST DER ERSTE WEG, AUF DEM EIN KUNDENDOKUMENT DIESES GERÄT VERLÄSST ─────────────────
 * Prinzip 4 sagt: Verbrauchsdaten verlassen den Browser nicht. Für den LASTGANG gilt das
 * unverändert — er kommt hier nicht vor. Für die RECHNUNG gilt es nicht mehr, und das ist die
 * bewusste Entscheidung dieses Abschnitts: eine PDF im Browser auszulesen hiesse, ein OCR mit
 * eigenen Fehlern in ein 400-kB-Bündel zu packen, und ein eingescanntes Blatt bekäme es ohnehin
 * nicht auf. Der Preis ist offengelegt, nicht versteckt — und dafür gilt hier die engste denkbare
 * Fassung:
 *
 *   – Die Datei geht an GENAU EINEN Empfänger, für GENAU EINEN Zweck.
 *   – Sie wird NIRGENDS gespeichert: keine Datenbank, keine Datei, kein Zwischenstand, kein Log.
 *   – Die volle Modellantwort wird NICHT weitergereicht. Aus der Funktion kommen ausschliesslich
 *     die extrahierten Felder heraus.
 *   – Nach dem Rücksprung hält nichts mehr eine Referenz auf den Inhalt.
 *
 * Der Hinweis an den Kunden, dass die Rechnung dafür übertragen wird, gehört zur Oberfläche und
 * ist ausdrücklich Teil von 9b-2b — nicht dieses Moduls.
 *
 * ── WARUM EINE SERVER ACTION UND KEIN ROUTE HANDLER ────────────────────────────────────────────
 * Dieselbe Abwägung wie in `lib/report-gate/actions.ts`: ein Route Handler wäre ein zweiter
 * ÖFFENTLICHER Endpunkt mit stabiler Adresse, an dem jeder unabhängig vom Formular PDFs
 * hochladen — und damit Aufrufe auf fremde Rechnung auslösen — könnte. Hier gibt es nichts, was
 * ein solcher Endpunkt zusätzlich leisten müsste.
 *
 * ⚠ Auch eine Server Action ist über ihre ID aufrufbar. Die Obergrenze unten ist deshalb eine
 * echte Sperre und keine Bedienhilfe.
 */

/** Die Antwort des Scans. `error` trägt einen Zustand, nie eine Meldung des Modells. */
export type InvoiceScanResponse =
  | { ok: true; extraction: InvoiceExtraction }
  | { ok: false; error: 'no_file' | 'wrong_type' | 'too_large' | 'not_configured' | 'unreadable' | 'unavailable' }

const PDF_MEDIA_TYPE = 'application/pdf'

export async function scanInvoice(file: File | null): Promise<InvoiceScanResponse> {
  /*
   * DIE PRÜFUNG LÄUFT VOR JEDEM EXTERNEN KONTAKT. Scheitert sie, entsteht KEIN Client und KEIN
   * Aufruf — nicht „die API lehnt ab", sondern sie wird gar nicht erst befragt. Dieselbe Haltung
   * wie in `report-gate/actions.ts` und `apps/web/lib/admin/analysis-upload.ts`. Sie ist hier
   * zusätzlich eine Kostenbremse: jeder Aufruf ist abrechenbar.
   */
  if (!file || file.size === 0) return { ok: false, error: 'no_file' }

  /*
   * Nur PDF. Der Medientyp kommt vom Browser und ist damit kein Beweis — die eigentliche Sperre
   * ist, dass die API den `document`-Block mit `media_type: 'application/pdf'` erwartet und eine
   * Datei anderen Inhalts dort ablehnt. Diese Prüfung fängt den ehrlichen Irrtum („ich habe mein
   * Foto hochgeladen") ab, bevor er Geld kostet.
   */
  if (file.type !== PDF_MEDIA_TYPE) return { ok: false, error: 'wrong_type' }

  if (file.size > MAX_INVOICE_FILE_BYTES) return { ok: false, error: 'too_large' }

  /*
   * Der einzige Ort, an dem der Dateiinhalt in diesem Prozess existiert. Er lebt für die Dauer
   * dieses Aufrufs in zwei lokalen Variablen und wird danach nicht mehr referenziert.
   */
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  const outcome = await extractInvoiceData(base64)

  if (!outcome.ok) {
    /*
     * `not_configured` und `unreadable` reisen als eigene Zustände weiter — die Oberfläche muss
     * dafür etwas anderes sagen können als bei einem Fehlschlag („noch nicht eingerichtet" ist
     * kein Fehler des Kunden; „auf dieser Rechnung war nichts zu finden" ist keiner der Technik).
     * `api_error` wird zu `unavailable`: was genau schiefging, geht den Absender nichts an.
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
