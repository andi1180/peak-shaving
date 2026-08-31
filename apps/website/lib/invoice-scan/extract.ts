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
 *
 * ── ⚠ DER ABSCHNITT ZU MEHRFACH-ZEITRÄUMEN IST EINE NACHBESSERUNG (31.08.2026) ────────────────
 * Ohne ihn gab es für den HÄUFIGSTEN Fall einer österreichischen Jahresabrechnung — derselbe Posten
 * mehrfach, je Zeitabschnitt ein eigener Betrag — gar keine Regel. Das Modell entschied deshalb
 * jedes Mal neu: an derselben Datei lieferte es in einem Lauf `null`, im nächsten den letzten Satz.
 * Jede der beiden Antworten war für sich vertretbar; die UNBESTIMMTHEIT ist es nicht. Dieselbe
 * Rechnung muss dasselbe Formular ergeben, sonst ist der Scan keine Ablesung, sondern ein Würfel.
 *
 * Entschieden ist der ZULETZT endende Abschnitt, nicht `null`: bei einem Tarifwechsel ist genau
 * dieser Wert der heute gültige, und ihn zu verschweigen liesse den Nutzer eine Zahl abtippen, die
 * klar auf dem Papier steht.
 *
 * ⚠ Bei einem VARIABLEN Tarif (ein eigener Preis je Monat) ist damit der letzte Monat der
 * ausgewiesene Wert. Das ist die Folge derselben Regel und bewusst in Kauf genommen — ein
 * Jahresmittel wäre eine GERECHNETE Zahl, die nirgends auf dem Dokument steht, und die Grundregel
 * „lieber nichts als geraten" verbietet sie. Der Wert bleibt in Schritt 2 editierbar; dass ein
 * Sommermonat als Grundlage einer Jahresrechnung zu niedrig sein kann, steht als offener Punkt in
 * `DEPLOYMENT.md` §1-Website-c.
 *
 * ⚠ Die Zahlen in den Beispielen des Prompts sind ERFUNDEN und bewusst keine echten Werte aus einer
 * Kundenrechnung — auch ein Tarifsatz samt Abrechnungszeitraum ist ein Datum aus dem Vertrag eines
 * Menschen und gehört nicht in den Bestand.
 *
 * ── ⚠ ZWEI WEITERE ABSÄTZE STAMMEN AUS DERSELBEN MESSREIHE, UND SIE SIND KEINE ZEITRAUM-FRAGE ──
 * Nach der Zeitraum-Regel blieben an den echten Rechnungen zwei Felder unbeständig. Beide Ursachen
 * sind mit einer Sonde auf die ROHE Modellantwort gemessen worden, nicht erraten:
 *
 *   1. VORZEICHEN. Das Modell lieferte die Einspeisevergütung mal als `4.56`, mal als `-4.56` —
 *      es übernahm das Minuszeichen der Gutschriftzeile. `parseInvoiceExtraction` weist negative
 *      Werte ab, aus `-4.56` wurde also `null`. Von aussen sah das aus wie „mal erkannt, mal
 *      nicht"; tatsächlich war es jedes Mal erkannt und einmal weggeworfen.
 *   2. BEZUG GEGEN EINSPEISUNG. Auf einer reinen Einspeise-Teilabrechnung steht unter den
 *      Netzentgelten „(Rest-)Einspeisung Erzeuger … 0,00 ct/kWh". Das Modell trug diese 0 als
 *      Netz-Arbeitspreis ein — eine Rechnung ohne jeden Netzbezug hätte damit „Netzentgelt =
 *      0 ct/kWh" behauptet. Nicht sichtbar falsch, aber still falsch, und genau die Sorte Zahl,
 *      die in einer Wirtschaftlichkeitsrechnung als gutes Ergebnis erscheint statt als Fehler.
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
  '',
  'Mehrere Werte für denselben Posten (Tarifwechsel, Preisanpassung, monatlich wechselnder Preis):',
  'Österreichische Jahresabrechnungen weisen denselben Posten oft MEHRFACH aus, je Zeitabschnitt',
  'einen eigenen Betrag — etwa „01.01.20-30.06.20: 3,10 ct/kWh" und „01.07.20-31.12.20: 3,90',
  'ct/kWh", oder bei einem variablen Tarif einen eigenen Preis je Monat.',
  '',
  'In diesem Fall gilt der Wert des ZULETZT endenden Zeitabschnitts — also der jüngste, aktuellste',
  'Satz. Dieser eine Wert gehört in das Feld.',
  '',
  '- Trage NICHT null ein. Mehrere Werte sind kein Grund zu schweigen: der Posten steht auf der',
  '  Rechnung, und welcher Satz zuletzt galt, ist ablesbar.',
  '- Nimm NICHT den ersten und NICHT den grössten, sondern den mit dem spätesten Zeitraum.',
  '- Bilde KEINEN Durchschnitt und rechne nicht zusammen. Ein Mittelwert steht nirgends auf dem',
  '  Dokument und wäre eine gerechnete Zahl, keine abgelesene.',
  '- Steht bei den Abschnitten kein Datum, sodass sich der jüngste nicht bestimmen lässt, ist das',
  '  Feld null. Nur dann.',
  '- Das gilt für alle Zahlenfelder gleichermassen, insbesondere für Arbeitspreis, Netz-Arbeitspreis',
  '  und Einspeisevergütung.',
  '',
  'Vorzeichen: Gutschriften stehen auf Rechnungen mit einem Minuszeichen (die Einspeisevergütung',
  'etwa als „-9,90 ct/kWh", weil sie dem Kunden gutgeschrieben wird). Trage trotzdem den Betrag',
  'OHNE Vorzeichen ein, also 9,90. Alle Felder dieses Schemas sind Beträge, keine Buchungen — ein',
  'negativer Wert ist kein gültiges Ergebnis und geht verloren.',
  '',
  'Abgrenzung Bezug/Einspeisung: arbeitspreisNetzCtPerKwh ist ausschliesslich der Arbeitspreis der',
  'Netznutzung für BEZOGENE Energie (Positionen wie „Netznutzung", „Netznutzungsentgelt").',
  'Positionen, die sich auf Einspeisung oder Erzeugung beziehen — etwa „(Rest-)Einspeisung',
  'Erzeuger" —, gehören NICHT in dieses Feld, auch dann nicht, wenn sie mit 0,00 ct/kWh ausgewiesen',
  'sind. Weist eine Rechnung gar keine Netznutzung für Bezug aus, ist das Feld null.',
].join('\n')

/*
 * ⚠ Der zweite Satz war bis zum 31.08.2026 „Lass jedes Feld null, das nicht EINDEUTIG auf dem
 * Dokument steht." Das stand ab der Mehrfach-Zeitraum-Regel im System-Prompt in direktem
 * Widerspruch zu ihr: mehrere Sätze für denselben Posten sind ja gerade nicht „eindeutig", und die
 * beiden Anweisungen hätten einander aufgehoben — die Unbestimmtheit wäre nur verschoben gewesen.
 * Massgeblich ist jetzt „steht nicht darauf", und für das Mehrfach-Vorkommen gilt die Regel oben.
 */
const USER_PROMPT =
  'Lies aus dieser Rechnung die Angaben nach Schema aus. Lass jedes Feld null, das auf dem ' +
  'Dokument nicht steht. Steht ein Posten mehrfach für verschiedene Zeitabschnitte, gilt der ' +
  'Wert des zuletzt endenden Abschnitts.'

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
