import 'server-only'

import {
  PV_DESIGN_SCAN_JSON_SCHEMA,
  type PvDesignExtraction,
  parsePvDesignExtraction,
  pvDesignExtractionIsEmpty,
} from 'shared'

import { PV_DESIGN_SCAN_MODEL, createPvDesignScanClient } from './ai-client'

/**
 * B22c — DER EINE EXTERNE AUFRUF DES PV-AUSLEGUNGS-SCANS.
 *
 * Dieses Modul ist die einzige Stelle, die den KI-Client dieser Anbindung benutzen darf
 * (ESLint-Allowlist im root `eslint.config.mjs` nennt genau diese Datei). Es macht GENAU EINEN
 * Aufruf und sonst nichts — keine allgemeine, wiederverwendbare Hilfsfunktion („frag das Modell
 * dies"), weil eine solche der Anfang einer zweiten, unkontrollierten Fläche wäre.
 *
 * ── DAS MODELL LIEST DIE PDF SELBST ───────────────────────────────────────────────────────────
 * Die Datei geht als `document`-Block direkt an die API. Ein eigener PDF-Textextraktor davor wäre
 * eine zusätzliche Abhängigkeit — und an genau diesen Dokumenten scheitert der naive Weg
 * nachweislich: Aspose.Words- und Word-Exporte legen ihre Texte als **Hex-Strings unter
 * Type0/CID-Fonts** ab, und mehrere Bild-Streams enthalten zufällig `BT`/`Tj`; beide üblichen
 * Eigenbau-Filter liefern Müll bzw. gar nichts (Bestandsaufnahme 3.1). Ein eingescanntes
 * Planungsdokument enthält ohnehin keinen Text, sondern ein Bild.
 *
 * ── ⚠ WAS DIESE DATEI NICHT TUT ───────────────────────────────────────────────────────────────
 * Sie schreibt NICHTS: keine Datenbank, keine Datei, kein Log mit Inhalt. Weder das Dokument noch
 * die volle Modellantwort verlassen die Funktion — heraus kommen ausschliesslich die extrahierten
 * Felder.
 */

/** Was aus einem Scan herauskommen kann. Diskriminiert — der Aufrufer muss verzweigen. */
export type PvDesignScanOutcome =
  | { ok: true; extraction: PvDesignExtraction }
  | { ok: false; reason: 'not_configured' | 'api_error' | 'unreadable' }

/**
 * Die Anweisung an das Modell.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DER GANZE MITTELTEIL DIENT EINER EINZIGEN GEFAHR: DER AZIMUT-KONVENTION
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * PV*SOL zählt vom Norden, PVGIS vom Süden. „Ausrichtung Südosten 133 °" ist als PVGIS-`aspect`
 * −47; ungeprüft übernommen zeigt die Anlage nach Nordwesten, und die ausgewiesene
 * Eigenverbrauchs-Ersparnis fällt gemessen um **56 %** — bei einer Zahl, die völlig plausibel
 * aussieht (Bestandsaufnahme 3.3). Es ist dasselbe Muster wie der Faktor-10-Leistungspreis in
 * B21-2a und die Eur/MWh-Prüfung des aWATTar-Abrufs: ein Fehler, der wie ein Ergebnis aussieht.
 *
 * Die Anweisung fängt ihn in drei Schritten, und ausdrücklich NICHT dadurch, dass das Modell
 * rechnet:
 *
 *   1. Die HIMMELSRICHTUNG wird als Wort gelesen und darf NICHT aus der Gradzahl erschlossen
 *      werden — sonst wäre sie kein Kreuzcheck, sondern eine zweite Schreibweise derselben Zahl.
 *   2. Die GRADZAHL wird roh übernommen, ohne jede Umrechnung.
 *   3. Die ZÄHLWEISE ist ein eigenes Feld. Sie zu erkennen ist eine Leseaufgabe („trägt eine als
 *      Südosten bezeichnete Fläche rund 135° oder rund −45°?"), keine Rechenaufgabe.
 *
 * Zusammengeführt werden die drei erst in `pvDesignArrayPrefill` (`shared/pv-design-scan.ts`), und
 * dort läuft jeder Kandidat durch `compassDegreeFitsDirection`. Ein Modell, das selbst umrechnete,
 * lieferte eine Zahl, die zur Himmelsrichtung passt und trotzdem falsch ist — der Kreuzcheck wäre
 * damit wirkungslos, ohne dass es jemandem auffiele.
 *
 * ── ⚠ DIE NEIGUNG WIRD ROH ÜBERNOMMEN, AUCH WENN SIE UNSINNIG WIRKT ───────────────────────────
 * Das vorliegende Dokument nennt `Neigung 90 °` bei gleichzeitig `Einbausituation: Dachparallel`
 * und dem Titel „PV am Hausdach". Der Widerspruch ist aus dem Dokument NICHT auflösbar
 * (Pflichtenheft §4, offener Punkt — beim Planer nachfragen, nicht ableiten). Ein Modell, das ihn
 * auf eine „plausible" Dachneigung glättete, verschöbe die Erzeugungskurve und niemand wüsste,
 * dass es geschehen ist. Markiert wird der Wert in der Vorschau (`PV_DESIGN_STEEP_SLOPE_DEG`),
 * nicht hier korrigiert.
 *
 * ── ⚠ DIE BEISPIELZAHLEN SIND ERFUNDEN ────────────────────────────────────────────────────────
 * Sie stammen aus keinem Kundendokument. Auch eine Anlagenauslegung ist die Angabe über das Haus
 * eines Menschen und gehört nicht in den Bestand.
 */
const SYSTEM_PROMPT = [
  'Du liest ein Dokument zur Auslegung einer Photovoltaik-Anlage (etwa aus PV*SOL, PVsyst,',
  'Polysun oder einem Hersteller-Konfigurator) und trägst die darin ausgewiesenen Angaben in das',
  'vorgegebene Schema ein. Du bist ein Ablesegerät, kein Schätzer und kein Planer.',
  '',
  'Die wichtigste Regel: Trage einen Wert NUR ein, wenn er auf dem Dokument tatsächlich steht.',
  'Steht er nicht da, ist das Feld null. Ein fehlender Wert ist ein vollkommen richtiges Ergebnis',
  'und wird ausdrücklich erwartet — eine geratene Zahl ist ein Schaden, weil sie danach als',
  'abgelesen gilt und in eine Wirtschaftlichkeitsrechnung eingeht.',
  '',
  'Daraus folgt im Einzelnen:',
  '- Erschliesse nichts aus verwandten Angaben. Aus einem Modultyp folgt keine Neigung, aus einer',
  '  Dachform keine Ausrichtung, aus einem Jahresertrag keine Nennleistung.',
  '- Rechne nur um, wenn Einheit und Bezug beide eindeutig dastehen: 425 Wp je Modul × 10 Module',
  '  sind 4,25 kWp. Bist du dir bei einer Einheit nicht sicher, ist das Feld null.',
  '- Das Dezimaltrennzeichen ist auf deutschsprachigen Dokumenten das Komma, der Tausenderpunkt',
  '  der Punkt: „1.234,56" ist eintausendzweihundertvierunddreissig Komma fünf sechs.',
  '- Ist das Dokument keine PV-Auslegung, unlesbar oder leer, gib eine LEERE Liste zurück und lass',
  '  alle übrigen Felder null. Erfinde in diesem Fall nichts.',
  '',
  'Mehrere Modulflächen — der Normalfall, nicht die Ausnahme:',
  'Eine Anlage besteht oft aus zwei oder mehr Teilflächen mit eigener Neigung, Ausrichtung und',
  'Nennleistung (Ost-West-Dach, Hauptdach plus Garage). Trage JEDE Fläche als eigenen Eintrag ein,',
  'in der Reihenfolge des Dokuments.',
  '',
  '- Fasse Flächen NIEMALS zusammen und bilde keine Mittelwerte. Eine „mittlere Ausrichtung" steht',
  '  nirgends im Dokument und ergäbe eine Tagesform, die es an diesem Dach nicht gibt.',
  '- Nenne die Gesamtleistung der Anlage NICHT als Nennleistung einer einzelnen Fläche. Weist das',
  '  Dokument die Leistung je Fläche aus, gehört je Fläche ihr eigener Wert ins Feld.',
  '- Führt das Dokument nur eine einzige, ungeteilte Anlage, ist das genau ein Eintrag.',
  '',
  'Die Ausrichtung — hier liegt die teuerste Verwechslung, lies diesen Abschnitt genau:',
  'Planungswerkzeuge zählen den Ausrichtungswinkel unterschiedlich. Manche zählen ihn vom NORDEN',
  'im Uhrzeigersinn (0° = Norden, 90° = Osten, 180° = Süden, 270° = Westen) — dann trägt eine als',
  '„Südosten" bezeichnete Fläche rund 135°. Andere zählen ihn vom SÜDEN (0° = Süden, −90° = Osten,',
  '+90° = Westen) — dann trägt derselbe Südosten rund −45°.',
  '',
  'Deine Aufgabe ist es, BEIDES getrennt zu berichten und NICHTS umzurechnen:',
  '',
  '- direction: die Himmelsrichtung, wie das Dokument sie als WORT ausschreibt („Südosten" → SO,',
  '  „Süd-West" → SW, „Ost" → O). Erschliesse sie NICHT aus der Gradzahl. Steht keine',
  '  Himmelsrichtung als Wort da, ist das Feld null — auch dann, wenn eine Gradzahl dasteht.',
  '- azimuthDeg: die Gradzahl exakt so, wie sie gedruckt ist. Bei „Ausrichtung Südosten 133 °"',
  '  also 133. Nicht drehen, nicht spiegeln, kein Vorzeichen ändern, nicht auf eine andere',
  '  Zählweise umrechnen — auch dann nicht, wenn sie dir zur Himmelsrichtung nicht zu passen',
  '  scheint. Gerade dieser Fall ist wichtig und wird weiter hinten geprüft.',
  '- azimuthConvention: welche der beiden Zählweisen das Dokument benutzt. Erkenne sie am',
  '  Zusammenspiel von Wort und Zahl (steht neben „Südosten" eine 133, zählt das Dokument vom',
  '  Norden; steht dort −47, zählt es vom Süden) oder an einer ausdrücklichen Angabe im Dokument.',
  '  Lässt sich das nicht sicher sagen, ist das Feld null. Rate NICHT.',
  '',
  'Die Neigung:',
  'Übernimm sie so, wie sie dasteht — auch wenn sie ungewöhnlich wirkt. Ein Dokument kann 90°',
  'nennen (eine Fassadenanlage) und gleichzeitig von einem Dach sprechen; diesen Widerspruch',
  'aufzulösen ist NICHT deine Aufgabe. Rechne die Neigung nicht auf einen plausiblen Dachwert um',
  'und ersetze sie nicht durch einen üblichen Wert. Steht keine Neigung da, ist das Feld null.',
  '',
  'Der Standort:',
  'Gib die Ortsangabe WORTWÖRTLICH so wieder, wie das Dokument sie beschriftet — etwa die',
  'Bezeichnung des verwendeten Klimadatensatzes („Wien 11, AUT (1996 - 2015)") oder eine',
  'Ortsangabe im Kopf des Dokuments. Schreibe keine eigene Beschreibung, keine Zusammenfassung',
  'und keine Einschätzung. Leite daraus KEINE Postleitzahl und KEINE Koordinate ab: die trägt der',
  'Nutzer selbst ein, und eine geratene Ortsangabe verschöbe die ganze Erzeugungsrechnung.',
  '',
  'Was NICHT in dieses Schema gehört und wonach du nicht suchen sollst: Jahresertrag, spezifischer',
  'Ertrag, Autarkiegrad, Wechselrichter, Batterie, Verbrauch, Preise. Sie stehen vielleicht im',
  'Dokument, sind hier aber nicht gefragt.',
].join('\n')

const USER_PROMPT =
  'Lies aus diesem Dokument die Auslegung der PV-Anlage nach Schema aus: je Modulfläche ' +
  'Nennleistung, Neigung, Himmelsrichtung als Wort und die gedruckte Gradzahl, dazu die im ' +
  'Dokument verwendete Zählweise der Gradzahl und die Ortsangabe. Lass jedes Feld null, das auf ' +
  'dem Dokument nicht steht, und rechne keine Gradzahl um.'

/**
 * Extrahiert die PV-Auslegung aus einem Planungsdokument.
 *
 * @param pdfBase64 Das Dokument als base64-kodierte PDF (ohne `data:`-Präfix, ohne Zeilenumbrüche).
 *
 * ── DIE DREI AUSGÄNGE, UND WARUM ES DREI SIND ─────────────────────────────────────────────────
 *   `not_configured`  Der Schlüssel fehlt. Kein Aufruf. Ein eigener Zustand, weil die Oberfläche
 *                     dafür etwas anderes sagen muss als bei einem Fehlschlag.
 *   `api_error`       Der Aufruf ist gescheitert (Netz, Kontingent, Ablehnung). Wiederholbar.
 *   `unreadable`      Der Aufruf lief, aber es war keine Modulfläche zu finden — der Fall eines
 *                     gescannten Bild-PDFs, eines fremden Dokuments oder einer leeren Datei. Er
 *                     kommt als eigener Ausgang zurück, damit der Aufrufer nicht ein leeres
 *                     Formular vorlegt und so tut, als sei das Dokument gelesen worden.
 */
export async function extractPvDesign(pdfBase64: string): Promise<PvDesignScanOutcome> {
  let client
  try {
    client = createPvDesignScanClient()
  } catch {
    // Der Wurf aus `requireEnv` trägt nur den Variablennamen und wird trotzdem nicht
    // weitergereicht: die Oberfläche bekommt einen Zustand, keinen Stacktrace.
    return { ok: false, reason: 'not_configured' }
  }

  let raw: unknown
  try {
    const response = await client.messages.create({
      model: PV_DESIGN_SCAN_MODEL,
      /*
       * Grösser als beim Rechnungs-Scan (4096): die Antwort trägt eine LISTE von Modulflächen mit
       * je fünf Feldern. Ein Dach mit sechs Teilflächen bleibt damit weit innerhalb der Grenze;
       * eine abgeschnittene Antwort wäre kein Teilergebnis, sondern ungültiges JSON und landete
       * als `api_error`, ohne dass jemand die Ursache sähe (die Lehre aus B21-2b).
       */
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: PV_DESIGN_SCAN_JSON_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            // Das Dokument steht VOR dem Text — die dokumentierte Reihenfolge für Dokument-Eingaben.
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
     * ⚠ HIER STEHT WEDER DAS DOKUMENT NOCH DIE ANTWORT IM LOG. Ein Fehlerlog ist kein zulässiger
     * zweiter Speicherort für ein Kundendokument. Protokolliert wird die Ursache des Fehlschlags —
     * sie enthält bei einem SDK-Fehler Statuscode und Meldung, nicht die gesendete Nutzlast.
     */
    console.error('[pv-design-scan] Extraktion fehlgeschlagen:', cause)
    return { ok: false, reason: 'api_error' }
  }

  const extraction = parsePvDesignExtraction(raw)

  // Keine Modulfläche heisst: es gibt nichts vorzubelegen. Das als leerer Erfolg zurückzugeben
  // zwänge jeden Aufrufer, die Leere selbst zu bemerken — und der erste, der es vergisst, legt dem
  // Kunden ein leeres Formular vor und behauptet, das Dokument sei gelesen worden.
  if (pvDesignExtractionIsEmpty(extraction)) return { ok: false, reason: 'unreadable' }

  return { ok: true, extraction }
}
