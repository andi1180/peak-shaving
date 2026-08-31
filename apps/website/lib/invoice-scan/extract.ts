import 'server-only'

import {
  INVOICE_SCAN_JSON_SCHEMA,
  type InvoiceExtraction,
  invoiceExtractionIsEmpty,
  parseInvoiceExtraction,
} from 'shared'

import { INVOICE_SCAN_MODEL, createInvoiceScanClient } from './ai-client'

/**
 * Delta 9b-2a — DER EINZIGE EXTERNE KI-AUFRUF DIESER APP.
 *
 * ── DIE GANZE FLÄCHE IN EINER DATEI, UND SIE IST EIN AUFRUF GROSS ─────────────────────────────
 * Dieses Modul ist die einzige Stelle in `apps/website`, die den KI-Client benutzen darf
 * (ESLint-Allowlist im root `eslint.config.mjs` nennt genau diese Datei). Es macht GENAU EINEN
 * Aufruf und sonst nichts. Es gibt hier bewusst KEINE allgemeine, wiederverwendbare
 * API-Hilfsfunktion („frag das Modell dies") — eine solche wäre der Anfang einer zweiten,
 * unkontrollierten Fläche, auf der irgendwann Kundendaten landen, die hier nie vorkommen sollen.
 * Wer einen zweiten Anwendungsfall braucht, schreibt ihn sichtbar daneben.
 *
 * ── DAS MODELL LIEST DIE PDF SELBST — kein OCR, kein Parser, keine neue Bibliothek ────────────
 * Die Datei geht als `document`-Block direkt an die API. Ein eigener PDF-Textextraktor davor wäre
 * eine zusätzliche Abhängigkeit, die an genau dem scheitert, worum es hier geht: eine EINGESCANNTE
 * Rechnung enthält keinen Text, sondern ein Bild. Und ein Extraktor, der bei zwei Preisspalten die
 * Zuordnung verliert, liefert Zahlen ohne ihre Bedeutung — schlimmer als keine Zahlen.
 *
 * ── ⚠ WAS DIESE DATEI NICHT TUT ───────────────────────────────────────────────────────────────
 * Sie schreibt NICHTS: keine Datenbank, keine Datei, kein Log mit Inhalt. Weder die Rechnung noch
 * die volle Modellantwort verlassen die Funktion — heraus kommen ausschliesslich die extrahierten
 * Felder. Das ist keine Bequemlichkeit, sondern der Kern von Prinzip 4 an einer Stelle, an der zum
 * ersten Mal ein KUNDENDOKUMENT das Gerät verlässt: es geht an genau einen Empfänger, für genau
 * einen Zweck, und kommt als fünf Angaben zurück.
 */

/** Was aus einem Scan herauskommen kann. Diskriminiert — der Aufrufer muss verzweigen. */
export type InvoiceScanOutcome =
  | { ok: true; extraction: InvoiceExtraction }
  | { ok: false; reason: 'not_configured' | 'api_error' | 'unreadable' }

/**
 * Die Anweisung an das Modell.
 *
 * ── DER GANZE TEXT DIENT EINEM ZIEL: LIEBER NICHTS ALS GERATEN ────────────────────────────────
 * Prinzip 1 („Die Rechnung ist die Wahrheit") ist hier keine Metapher — genau dieses Dokument IST
 * die Quelle. Eine geschätzte Zahl aus einem Rechnungsbild wäre derselbe Fehler wie ein erfundener
 * Tarifsatz in B11, nur mit einem seriöseren Etikett. Deshalb steht die Regel dreimal, in drei
 * Formen: als Grundsatz, als Verbot des Erschliessens aus verwandten Angaben, und als ausdrückliche
 * Erlaubnis, alles auf `null` zu lassen.
 */
const SYSTEM_PROMPT = [
  'Du liest eine österreichische Strom- oder Netzrechnung und trägst die darin ausgewiesenen',
  'Angaben in das vorgegebene Schema ein. Du bist ein Ablesegerät, kein Schätzer.',
  '',
  'Die wichtigste Regel: Trage einen Wert NUR ein, wenn er auf dem Dokument tatsächlich steht.',
  'Steht er nicht da, ist das Feld null. Ein fehlender Wert ist ein vollkommen richtiges Ergebnis',
  'und wird ausdrücklich erwartet — eine geratene Zahl ist ein Schaden, weil sie später als',
  'abgelesen gilt und in eine Wirtschaftlichkeitsrechnung eingeht.',
  '',
  'Daraus folgt im Einzelnen:',
  '- Erschliesse nichts aus verwandten Angaben. Aus einer Anschlussleistung folgt keine Netzebene,',
  '  aus einem Monatsbetrag kein Jahresverbrauch, aus einem Gesamtbetrag kein Arbeitspreis.',
  '- Rechne nur um, wenn Einheit und Bezugszeitraum beide eindeutig auf dem Dokument stehen.',
  '- Achte auf die Einheiten: Leistungspreise stehen in Euro je kW und Jahr (manche Rechnungen',
  '  weisen sie je Monat aus), Arbeitspreise in Cent je kWh (manche in Euro je kWh — dann ×100).',
  '  Bist du dir bei einer Einheit nicht sicher, ist das Feld null.',
  '- Das Dezimaltrennzeichen ist auf österreichischen Rechnungen das Komma, der Tausenderpunkt der',
  '  Punkt: „1.234,56" ist eintausendzweihundertvierunddreissig Komma fünf sechs.',
  '- Bei getrenntem Hoch-/Niedertarif gehört der Hochtarif in energyPriceCtPerKwh und der',
  '  Niedertarif in energyPriceNightCtPerKwh.',
  '- Ist das Dokument keine Strom-/Netzrechnung, unlesbar oder leer, lass ALLE Felder null.',
].join('\n')

const USER_PROMPT =
  'Lies aus dieser Rechnung die Angaben nach Schema aus. Lass jedes Feld null, das nicht ' +
  'eindeutig auf dem Dokument steht.'

/**
 * Extrahiert die Tarif- und Verbrauchsangaben aus einer Rechnung.
 *
 * @param pdfBase64 Die Rechnung als base64-kodierte PDF (ohne `data:`-Präfix, ohne Zeilenumbrüche).
 *
 * ── DIE DREI AUSGÄNGE, UND WARUM ES DREI SIND ─────────────────────────────────────────────────
 *   `not_configured`  Der Schlüssel fehlt. Kein Aufruf. Ein eigener Zustand, weil die Oberfläche
 *                     dafür etwas anderes sagen muss als bei einem Fehlschlag („noch nicht
 *                     eingerichtet" ist kein Fehler des Kunden und keiner der Rechnung).
 *   `api_error`       Der Aufruf ist gescheitert (Netz, Kontingent, Ablehnung). Wiederholbar.
 *   `unreadable`      Der Aufruf lief, aber es wurde NICHTS gefunden. Das ist ein BEFUND, kein
 *                     Fehler — und ausdrücklich der Fall einer leeren oder unlesbaren PDF. Er
 *                     kommt hier als eigener Ausgang zurück, damit der Aufrufer nicht ein leeres
 *                     Formular vorlegt und so tut, als hätte der Scan funktioniert.
 *
 * Es gibt bewusst KEINEN vierten Ausgang für „teilweise erkannt": ein Ergebnis mit drei von zehn
 * Feldern ist ein normaler Erfolg. Welche Felder fehlen, steht im Ergebnis selbst.
 */
export async function extractInvoiceData(pdfBase64: string): Promise<InvoiceScanOutcome> {
  let client
  try {
    client = createInvoiceScanClient()
  } catch {
    /*
     * Der Wurf kommt aus `requireEnv` und trägt nur den Variablennamen — er wird hier trotzdem
     * nicht weitergereicht: die Oberfläche bekommt einen Zustand, keinen Stacktrace.
     */
    return { ok: false, reason: 'not_configured' }
  }

  let raw: unknown
  try {
    const response = await client.messages.create({
      model: INVOICE_SCAN_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      /*
       * Das Schema wird von der API erzwungen (`json_schema` mit `additionalProperties: false` und
       * vollständigen `required`-Listen, s. `shared/invoice-scan.ts`). Die Antwort ist damit
       * strukturell garantiert — der Inhalt der Felder selbstverständlich nicht, deshalb läuft sie
       * unten trotzdem durch `parseInvoiceExtraction`.
       */
      output_config: { format: { type: 'json_schema', schema: INVOICE_SCAN_JSON_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            /*
             * Das Dokument steht VOR dem Text — die von Anthropic dokumentierte Reihenfolge für
             * Dokument-Eingaben.
             */
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            },
            { type: 'text', text: USER_PROMPT },
          ],
        },
      ],
    })

    const text = response.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('')

    raw = JSON.parse(text)
  } catch (cause) {
    /*
     * ⚠ HIER STEHT WEDER DIE RECHNUNG NOCH DIE ANTWORT IM LOG. Ein Fehlerlog ist kein zulässiger
     * zweiter Speicherort für ein Kundendokument (dieselbe Regel wie beim Personenbezug in
     * `report-gate/actions.ts`). Protokolliert wird die Ursache des Fehlschlags — sie enthält bei
     * einem SDK-Fehler Statuscode und Meldung, nicht die gesendete Nutzlast.
     *
     * Ein unbrauchbarer JSON-Text landet ebenfalls hier: `JSON.parse` wirft. Das ist richtig — die
     * API hat dann etwas geliefert, das ihr eigenes Schema verletzt, und das ist ein Fehler des
     * Aufrufs, kein Befund über die Rechnung.
     */
    console.error('[invoice-scan] Extraktion fehlgeschlagen:', cause)
    return { ok: false, reason: 'api_error' }
  }

  const extraction = parseInvoiceExtraction(raw)

  /*
   * NICHTS gefunden ist ein eigener Ausgang, kein leerer Erfolg. Ein leeres Ergebnis als `ok: true`
   * zurückzugeben zwänge jeden Aufrufer, die Leere selbst zu bemerken — und der erste, der es
   * vergisst, legt dem Kunden ein leeres Formular vor und behauptet damit, die Rechnung sei
   * gelesen worden. Genau das ist der Fall der leeren oder unlesbaren PDF.
   */
  if (invoiceExtractionIsEmpty(extraction)) return { ok: false, reason: 'unreadable' }

  return { ok: true, extraction }
}
