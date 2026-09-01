'use server'

import type { UploadDocumentType } from 'shared'

import { MAX_UPLOAD_CLASSIFICATION_FILE_BYTES, MAX_UPLOAD_LABEL_CHARS } from './limits'
import { classifyDocument } from './extract'

/**
 * Delta 17 — DIE SERVER ACTION DER DOKUMENT-ZUORDNUNG. Reine Verdrahtung.
 *
 * ── ⚠ SIE NIMMT AUSSCHLIESSLICH PDF ENTGEGEN, UND DAS IST DIE PRINZIP-4-GRENZE ────────────────
 * Der öffentliche Rechner sagt zu: Verbrauchsdaten verlassen den Browser nicht. Für die RECHNUNG
 * ist diese Zusage seit Delta 9b-2a offengelegt aufgehoben; für den LASTGANG gilt sie unverändert.
 * Eine Zuordnung, die zum Einordnen jede Datei hochlädt, hätte sie beiläufig gebrochen — für eine
 * Vorsortierung, die den Nutzer eine Zeile Tipparbeit spart.
 *
 * Deshalb die Arbeitsteilung, die diese Datei durchsetzt: CSV/XLSX werden vollständig IM BROWSER
 * eingeordnet (der Parser selbst sagt, ob es ein Lastgang ist — eine gemessene Aussage, keine
 * Vermutung), und nur PDF erreicht diesen Weg. Die Prüfung `wrong_type` unten ist damit keine
 * Bedienhilfe wie beim Rechnungs-Scan, sondern die Stelle, an der die Zusage steht: ein Aufruf mit
 * einer CSV wird abgewiesen, auch wenn ihn jemand an der Oberfläche vorbei absetzt.
 *
 * ── ⚠ DIE BEZEICHNUNG IST DER ERSTE NUTZER-FREITEXT, DER EIN MODELL ERREICHT ──────────────────
 * Sie wird hier gekürzt, bevor sie das Haus verlässt. Die eigentliche Sperre ist die Form der
 * Antwort (drei Wahrheitswerte, kein Freitextfeld) und die Bestätigungsstufe danach — ein
 * Vorschlag wird NIE automatisch übernommen. Begründung ausführlich im Kopf von `extract.ts`.
 *
 * ── WARUM EINE SERVER ACTION UND KEIN ROUTE HANDLER ────────────────────────────────────────────
 * Dieselbe Abwägung wie beim Rechnungs-Scan: ein Route Handler wäre ein zweiter ÖFFENTLICHER
 * Endpunkt mit stabiler Adresse, an dem jeder unabhängig vom Formular Dateien hochladen — und
 * damit Aufrufe auf fremde Rechnung auslösen — könnte.
 *
 * ⚠ Auch eine Server Action ist über ihre ID aufrufbar. Die Prüfkette unten läuft deshalb VOR
 * jedem externen Kontakt und ist eine echte Sperre, keine Bedienhilfe: jeder Aufruf ist abrechenbar.
 */

/** Die Antwort der Zuordnung. `error` trägt einen Zustand, nie eine Meldung des Modells. */
export type UploadClassificationResponse =
  | { ok: true; type: UploadDocumentType }
  | { ok: false; error: 'no_file' | 'wrong_type' | 'too_large' | 'not_configured' | 'unavailable' }

const PDF_MEDIA_TYPE = 'application/pdf'

export async function classifyUpload(
  file: File | null,
  label: string,
): Promise<UploadClassificationResponse> {
  /*
   * DIE PRÜFKETTE LÄUFT VOR JEDEM EXTERNEN KONTAKT. Scheitert sie, entsteht KEIN Client und KEIN
   * Aufruf — nicht „die API lehnt ab", sondern sie wird gar nicht erst befragt.
   */
  if (!file || file.size === 0) return { ok: false, error: 'no_file' }

  // Die Prinzip-4-Grenze, s. Kopf. Nicht verhandelbar und nicht an der Oberfläche vorbei zu umgehen.
  if (file.type !== PDF_MEDIA_TYPE) return { ok: false, error: 'wrong_type' }

  if (file.size > MAX_UPLOAD_CLASSIFICATION_FILE_BYTES) return { ok: false, error: 'too_large' }

  /*
   * Der einzige Ort, an dem der Dateiinhalt in diesem Prozess existiert. Er lebt für die Dauer
   * dieses Aufrufs in einer lokalen Variablen und wird danach nicht mehr referenziert. Er wird
   * NIRGENDS gespeichert: keine Datenbank, keine Datei, kein Zwischenstand, kein Log.
   */
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  const outcome = await classifyDocument(base64, String(label ?? '').slice(0, MAX_UPLOAD_LABEL_CHARS))

  if (!outcome.ok) {
    /*
     * `not_configured` reist als eigener Zustand weiter — die Oberfläche muss dafür etwas anderes
     * sagen können als bei einem Fehlschlag („noch nicht eingerichtet" ist kein Fehler des
     * Nutzers). `api_error` wird zu `unavailable`: was genau schiefging, geht den Absender nichts
     * an. In BEIDEN Fällen bleibt die Zeile bedienbar — der Nutzer wählt die Art dann selbst; das
     * ist der Unterschied zu den beiden Scans, bei denen ein Fehlschlag den Einstieg beendet.
     */
    if (outcome.reason === 'not_configured') return { ok: false, error: 'not_configured' }
    return { ok: false, error: 'unavailable' }
  }

  /* NUR die Art. Kein Dateiname, keine Grösse, keine Token-Zahl, kein Roh-Text der Antwort. */
  return { ok: true, type: outcome.type }
}
