import 'server-only'

import {
  TARIFF_SHEET_SCAN_JSON_SCHEMA,
  type TariffSheetExtraction,
  parseTariffSheetExtraction,
  tariffSheetExtractionIsEmpty,
} from '../tariff-sheet-scan'
import { TARIFF_SHEET_SCAN_MODEL, createTariffSheetScanClient } from './ai-client'

/**
 * DER EINZIGE EXTERNE KI-AUFRUF DIESER APP.
 *
 * ── DIE GANZE FLÄCHE IN EINER DATEI, UND SIE IST EIN AUFRUF GROSS ─────────────────────────────
 * Dieses Modul ist die einzige Stelle in `apps/web`, die den KI-Client benutzen darf
 * (ESLint-Allowlist im root `eslint.config.mjs` nennt genau diese Datei). Es macht GENAU EINEN
 * Aufruf und sonst nichts. Es gibt hier bewusst KEINE allgemeine, wiederverwendbare
 * API-Hilfsfunktion („frag das Modell dies") — eine solche wäre der Anfang einer zweiten,
 * unkontrollierten Fläche, auf der irgendwann Kundendaten landen, die hier nie vorkommen sollen.
 * Wer einen zweiten Anwendungsfall braucht, schreibt ihn sichtbar daneben.
 *
 * ── ⚠ HIER GEHT KEIN KUNDENDOKUMENT HINAUS — DER UNTERSCHIED ZUM RECHNUNGS-SCAN ───────────────
 * Der Rechnungs-Scan (Delta 9b-2a) ist die eine bewusste Ausnahme von Prinzip 4: dort verlässt das
 * Dokument EINES KUNDEN das Gerät. Hier ist das nicht der Fall, und das ist keine Kleinigkeit,
 * sondern der Grund, warum dieser Schritt datenschutzrechtlich unauffällig ist: Ein Preisblatt ist
 * ein VERÖFFENTLICHTES Dokument des Netzbetreibers, ohne jeden Personenbezug. Es gibt hier
 * niemanden aufzuklären und nichts zu erlauben.
 *
 * Was trotzdem unverändert gilt: Es wird NICHTS geschrieben — keine Datenbank, keine Datei, kein
 * Log mit Inhalt. Aus der Funktion kommen ausschliesslich die extrahierten Felder.
 *
 * ── DAS MODELL LIEST DIE PDF SELBST — kein OCR, kein Parser, keine neue Bibliothek ────────────
 * Die Datei geht als `document`-Block direkt an die API. Ein eigener PDF-Textextraktor davor wäre
 * eine zusätzliche Abhängigkeit, die an genau dem scheitert, worum es hier geht: ein Preisblatt
 * ist eine TABELLE, und ein Extraktor, der Spalten verliert, liefert Zahlen ohne ihre Bedeutung.
 */

/** Was aus einem Scan herauskommen kann. Diskriminiert — der Aufrufer muss verzweigen. */
export type TariffSheetScanOutcome =
  | { ok: true; extraction: TariffSheetExtraction }
  | { ok: false; reason: 'not_configured' | 'api_error' | 'unreadable' }

/**
 * Die Anweisung an das Modell.
 *
 * ── DER GANZE TEXT DIENT EINEM ZIEL: LIEBER NICHTS ALS GERATEN ────────────────────────────────
 * Prinzip 1 („Die Rechnung ist die Wahrheit") gilt hier für das Preisblatt, und der Einsatz ist
 * höher als beim Rechnungs-Scan: Ein hier angelegter Tarifstand ist NACHTRÄGLICH NICHT MEHR
 * ÄNDERBAR (B21-2b: kein `delete`-Grant, keine Update-Funktion) und geht in JEDE künftige Analyse
 * dieser Netzebene ein — nicht nur in die eines einzelnen Kunden.
 *
 * ── ⚠ VIER ABSÄTZE SIND AUS DEN ZWEI RECHNUNGS-SCAN-NACHTRÄGEN VOM 31.08.2026 ÜBERNOMMEN ──────
 * Sie stehen dort nicht aus Vorsicht, sondern weil jeder von ihnen einen an echten Dokumenten
 * GEMESSENEN Fehler behebt. Alle vier treten hier genauso auf, drei davon sogar häufiger:
 *
 *   1. MEHRERE GÜLTIGKEITSZEITRÄUME. Auf einer Rechnung ist das der Tarifwechsel mitten im Jahr;
 *      auf einem Preisblatt stehen „bisher" und „neu" oft NEBENEINANDER in zwei Spalten. Ohne
 *      Regel entschied das Modell jedes Mal neu — dieselbe Datei ergab mal den einen, mal den
 *      anderen Satz. Die Unbestimmtheit war das Problem, nicht die einzelne Antwort.
 *   2. BEZUG GEGEN EINSPEISUNG. Auf der Rechnung führte „(Rest-)Einspeisung Erzeuger … 0,00
 *      ct/kWh" dazu, dass eine 0 als Netz-Arbeitspreis eingetragen wurde. Auf einem Preisblatt ist
 *      die Gefahr GRÖSSER: dort steht ein ganzer Abschnitt für Einspeiser neben dem für Bezug.
 *   3. VORZEICHEN. Beträge mit Minuszeichen (Gutschriften, Rabattzeilen) gehen durch
 *      `parseTariffSheetExtraction` verloren, weil negative Werte abgewiesen werden — von aussen
 *      sieht das aus wie „nicht erkannt".
 *   4. `meteringVariant`. Kein österreichisches Dokument benutzt die Codewörter des Schemas; es
 *      umschreibt sie. Die tragende Verwechslung ist dieselbe: das blosse Wort „Leistung" ist KEIN
 *      Hinweis auf eine Leistungsmessung — entscheidend ist die Bezugsgrösse (je kW gegen je Tag).
 *
 * ── ⚠ DIE MEHR-EBENEN-REGEL IST DIE EINE STELLE, AN DER DIESER SCAN BEWUSST SCHWACH IST ───────
 * Ein Preisblatt führt typischerweise ALLE Netzebenen in einer Tabelle. Das Formular legt aber
 * genau EINEN Tarifstand für GENAU EINE Netzebene an. Das Modell müsste also eine Zeile auswählen
 * — und jede Auswahl wäre geraten. Deshalb: Behandelt das Blatt mehrere Ebenen gleichrangig, sind
 * die ebenenabhängigen Felder `null`, und der Admin trägt sie ab. Das kostet Tipparbeit; die
 * Gegenrichtung kostete einen falschen Leistungspreis für jeden künftigen Kunden dieser Ebene, in
 * einer Tabelle, die kein Bearbeiten kennt.
 *
 * Der naheliegende Ausweg — dem Modell die im Formular gewählte Netzebene als Hinweis mitgeben —
 * ist bewusst NICHT gebaut: er machte die Antwort von einem Formularzustand abhängig, den der
 * Admin womöglich gar nicht bewusst gesetzt hat. Er steht als benannter nächster Schritt in
 * `DEPLOYMENT.md` §1l.
 *
 * ⚠ Die Zahlen und Formulierungen in den Beispielen sind branchenüblich bzw. erfunden und stammen
 * nicht aus einem bestimmten Preisblatt.
 */
const SYSTEM_PROMPT = [
  'Du liest das veröffentlichte Preisblatt eines österreichischen Stromnetzbetreibers und trägst',
  'die darin ausgewiesenen Entgelte in das vorgegebene Schema ein. Du bist ein Ablesegerät, kein',
  'Schätzer.',
  '',
  'Die wichtigste Regel: Trage einen Wert NUR ein, wenn er auf dem Dokument tatsächlich steht.',
  'Steht er nicht da, ist das Feld null. Ein fehlender Wert ist ein vollkommen richtiges Ergebnis',
  'und wird ausdrücklich erwartet — eine geratene Zahl ist ein Schaden, weil sie später als',
  'abgelesen gilt und dauerhaft in die Wirtschaftlichkeitsrechnung fremder Kunden eingeht. Ein',
  'einmal eingetragener Tarifstand lässt sich nicht mehr korrigieren.',
  '',
  'Daraus folgt im Einzelnen:',
  '- Erschliesse nichts aus verwandten Angaben. Aus einer Netzebene folgt kein Preis, aus einem',
  '  Jahr im Titel kein Gültigkeitsbeginn, aus einem Gesamtentgelt kein Arbeitspreis.',
  '- Rechne nur um, wenn Einheit und Bezugszeitraum beide eindeutig auf dem Dokument stehen.',
  '- Achte auf die Einheiten: Leistungspreise stehen in Euro je kW und Jahr (manche Blätter weisen',
  '  sie je kW und MONAT aus — dann ×12), Arbeitspreise in Cent je kWh (manche in Euro je kWh —',
  '  dann ×100). Bist du dir bei einer Einheit nicht sicher, ist das Feld null.',
  '- Das Dezimaltrennzeichen ist auf österreichischen Dokumenten das Komma, der Tausenderpunkt der',
  '  Punkt: „1.234,56" ist eintausendzweihundertvierunddreissig Komma fünf sechs.',
  '- Ist das Dokument kein Netz-Preisblatt, unlesbar oder leer, lass ALLE Felder null und die',
  '  Fensterliste leer.',
  '',
  'MEHRERE NETZEBENEN AUF EINEM BLATT — der wichtigste Sonderfall:',
  'Viele Preisblätter führen alle Netzebenen nebeneinander, meist als Tabelle mit einer Zeile oder',
  'Spalte je Ebene. Dieses Schema beschreibt aber GENAU EINE Netzebene.',
  '',
  '- Behandelt das Blatt erkennbar GENAU EINE Netzebene (sie steht im Titel, in der Überschrift',
  '  des Abschnitts oder es gibt nur eine), trage sie ein und lies alle Werte für sie.',
  '- Behandelt das Blatt MEHRERE Ebenen gleichrangig, ohne dass eine erkennbar gemeint ist, dann',
  '  ist netzebene null — und ebenso jeder Wert, der von der Ebene abhängt: grundpreisAmount,',
  '  grundpreisUnit, netzverlustCtPerKwh und die gesamte Fensterliste (leeres Array).',
  '  Wähle in diesem Fall KEINE Ebene aus, auch nicht die erste, die grösste oder die',
  '  vollständigste. Trage dann nur die blattweiten Angaben ein: operatorName, validFrom und',
  '  priceBasis.',
  '',
  'MEHRERE GÜLTIGKEITSZEITRÄUME:',
  'Preisblätter stellen häufig den bisherigen und den neuen Satz nebeneinander („gültig bis',
  '31.12.2025" / „gültig ab 01.01.2026"), oder ein Blatt führt mehrere Zeitabschnitte auf.',
  '',
  'In diesem Fall gilt durchgehend der Satz des ZULETZT beginnenden Zeitraums — also der jüngste,',
  'aktuellste. Sein Beginn gehört in validFrom, und alle Beträge gehören zu genau diesem Zeitraum.',
  '',
  '- Trage NICHT null ein. Mehrere Werte sind kein Grund zu schweigen: der Posten steht auf dem',
  '  Blatt, und welcher Satz zuletzt gilt, ist ablesbar.',
  '- Nimm NICHT den ersten und NICHT den grössten, sondern den mit dem spätesten Beginn.',
  '- Mische NICHT: nimm nicht den Grundpreis aus dem einen und den Arbeitspreis aus dem anderen',
  '  Zeitraum. Alle Werte stammen aus demselben, dem jüngsten.',
  '- Bilde KEINEN Durchschnitt und rechne nicht zusammen. Ein Mittelwert steht nirgends auf dem',
  '  Dokument und wäre eine gerechnete Zahl, keine abgelesene.',
  '- Lässt sich der jüngste Zeitraum nicht bestimmen, weil kein Datum dabeisteht, ist validFrom',
  '  null. Die Beträge bleiben dann trotzdem eintragbar, wenn es nur einen Satz gibt.',
  '',
  'ABGRENZUNG BEZUG GEGEN EINSPEISUNG — hier wird am häufigsten das Falsche gelesen:',
  'Preisblätter führen neben den Entgelten für BEZOGENE Energie oft einen eigenen Abschnitt für',
  'Einspeiser und Erzeuger (Überschriften wie „Einspeisung", „Erzeuger", „Netzzutrittsentgelt für',
  'Erzeugungsanlagen", „(Rest-)Einspeisung").',
  '',
  'Alle Felder dieses Schemas beziehen sich AUSSCHLIESSLICH auf den BEZUG. Werte aus einem',
  'Einspeise- oder Erzeuger-Abschnitt gehören in KEINES der Felder — auch dann nicht, wenn sie mit',
  '0,00 ausgewiesen sind, und auch dann nicht, wenn im Bezugsabschnitt nichts Vergleichbares steht.',
  'Ein leeres Feld ist richtig; eine übernommene Einspeise-Null behauptete ein Netzentgelt von',
  'null und fiele niemandem als Fehler auf.',
  '',
  'VORZEICHEN:',
  'Stehen Beträge mit einem Minuszeichen (Gutschriften, Abschläge, Rabattzeilen), trage den Betrag',
  'OHNE Vorzeichen ein. Alle Felder dieses Schemas sind Beträge, keine Buchungen — ein negativer',
  'Wert ist kein gültiges Ergebnis und geht verloren.',
  '',
  'grundpreisAmount UND grundpreisUnit — nur gemeinsam:',
  'Der Grundpreis der Netznutzung wird auf zwei grundsätzlich verschiedene Arten abgerechnet, und',
  'die Unterscheidung ist die wichtigste Zahl dieses ganzen Blattes:',
  '',
  '- „eur_per_kw_year": ein Betrag JE KILOWATT und Jahr, der auf eine Leistung angewandt wird',
  '  („44,00 EUR/kW/a", „3,21 EUR je kW und Monat"). Das ist ein echter Leistungspreis.',
  '- „eur_per_year": eine reine PAUSCHALE ohne kW-Bezug, etwa eine Jahres- oder Monatspauschale',
  '  („120,00 EUR/Jahr", „0,082500 EUR je Tag"). Sie hat keinen Leistungsbezug.',
  '',
  'Trage beide Felder nur GEMEINSAM ein. Kannst du die Einheit nicht eindeutig bestimmen, lass',
  'BEIDE null — ein Betrag ohne gesicherte Einheit wird sonst als Leistungspreis verstanden, und',
  'der Unterschied entscheidet darüber, ob überhaupt eine Spitzenkappung gerechnet wird.',
  'Ist eine Pauschale je Tag oder je Monat ausgewiesen, rechne sie auf das Jahr um (×365 bzw. ×12)',
  'und nimm „eur_per_year" — aber nur, wenn der Bezugszeitraum eindeutig dasteht.',
  '',
  'netzverlustCtPerKwh:',
  'Das Netzverlustentgelt ist ein EIGENER Posten und NICHT der Arbeitspreis der Netznutzung.',
  'Österreichische Blätter führen beide getrennt: „Netznutzungsentgelt (Arbeit)" bzw. „Arbeitspreis',
  'Netznutzung" auf der einen Seite, „Netzverlustentgelt" auf der anderen. Der Arbeitspreis der',
  'Netznutzung gehört in die Fensterliste, nicht in dieses Feld. Findest du keinen ausdrücklich als',
  'Netzverlustentgelt bezeichneten Posten, ist das Feld null.',
  '',
  'DIE FENSTERLISTE (windows) — die zeitabhängigen Arbeitspreise der Netznutzung:',
  'Jeder Arbeitspreis der Netznutzung wird ein Eintrag. Weist das Blatt einen einzigen,',
  'ganztägigen Arbeitspreis aus, ist das GENAU EIN Eintrag mit timeFrom „00:00", timeTo „24:00"',
  'und ohne Saison (beide Saisonfelder null).',
  '',
  'Weist das Blatt zeitlich oder saisonal unterschiedene Arbeitspreise aus, wird jeder davon ein',
  'eigener Eintrag:',
  '- Der Regel-/Grundpreis, der ausserhalb der besonderen Zeiten gilt, heisst „normal" und deckt',
  '  in der Regel den ganzen Tag ab (00:00 bis 24:00) und das ganze Jahr.',
  '- Ein Hochlastfenster heisst „snap". Blätter nennen es „Hochlastzeitfenster", „Spitzenzeit",',
  '  „Hochtarif", „HT" oder „Lastspitzenzeit". Es gilt meist nur an bestimmten Tageszeiten und oft',
  '  nur im Winterhalbjahr.',
  '- Ein Fenster, das nur eine Jahreszeit betrifft, heisst „winter" (bzw. „sommer").',
  '- Nennt das Blatt einen anderen Namen, nimm ihn in Kleinbuchstaben.',
  '',
  'Zu jedem Eintrag:',
  '- timeFrom und timeTo als HH:MM. Das Tagesende ist „24:00", nicht „23:59" und nicht „00:00".',
  '- Die Saison als MM-TT ohne Jahreszahl, etwa monthDayFrom „10-01" und monthDayTo „03-31" für',
  '  Oktober bis März. Gilt das Fenster ganzjährig, sind BEIDE Saisonfelder null.',
  '- Gib die Saison vollständig an oder gar nicht. Eine halbe Saisonangabe ist unbrauchbar.',
  '- Kannst du für einen Arbeitspreis die Uhrzeiten oder den Betrag nicht sicher lesen, lass den',
  '  ganzen Eintrag weg. Erfinde keine Uhrzeit und setze keine Standardzeit ein — ein Fenster mit',
  '  geratener Zeit gilt sonst rund um die Uhr.',
  '- Nimm in die Liste NUR Arbeitspreise der Netznutzung für BEZUG auf. Keine Energiepreise eines',
  '  Lieferanten, keine Steuern und Abgaben, keine Einspeise-Entgelte, kein Netzverlustentgelt und',
  '  keinen Leistungspreis.',
  '',
  'meteringVariant — wie du sie erkennst:',
  'Österreichische Dokumente schreiben diese Wörter NIE so hin, wie das Schema sie nennt. Sie',
  'umschreiben sie. Schliesse deshalb aus den folgenden Formulierungen, und zwar NUR aus ihnen:',
  '',
  '„mit_leistungsmessung" — Hinweise sind zum Beispiel:',
  '  „mit Leistungsmessung", „gemessene Leistung", „Höchstleistung", „Monatshöchstleistung",',
  '  „registrierende Leistungsmessung", „RLM", „Lastprofilzähler", „viertelstündliche Messung" —',
  '  oder ein Leistungsentgelt, das auf einen GEMESSENEN kW-Wert angewandt wird.',
  '',
  '„ohne_leistungsmessung" — Hinweise sind zum Beispiel:',
  '  „pauschale Leistung", „nicht gemessene Leistung", „nicht lastprofilgemessen",',
  '  „Standardlastprofil", „SLP", ein Lastprofil-Code für den Bezug (H0, G0 bis G6 und ähnliche) —',
  '  oder eine Netzleistung/Grundgebühr, die je TAG oder je MONAT pauschal abgerechnet wird statt',
  '  je kW.',
  '',
  '„unterbrechbar" — Hinweise sind zum Beispiel:',
  '  „unterbrechbar", „unterbrechbare Lieferung", „unterbrechbarer Netzzugang", „abschaltbar",',
  '  „Sperrzeiten".',
  '',
  'Wenn Muster einander zu widersprechen scheinen, gilt:',
  '- Das blosse Wort „Leistung", „Netzleistung" oder „Leistungspreis" ist für sich KEIN Hinweis auf',
  '  eine Leistungsmessung. Entscheidend ist die Bezugsgrösse: je kW heisst gemessen, je Tag oder',
  '  je Monat pauschal heisst nicht gemessen.',
  '- Ein Zusatz wie „pauschal" oder „nicht gemessen" schlägt das blosse Wort „Leistung".',
  '',
  'Unterscheidet das Blatt gar nicht nach Messvariante — was auf höheren Netzebenen der Regelfall',
  'ist, weil dort ohnehin gemessen wird —, ist das Feld null. Das ist ein richtiges Ergebnis und',
  'kein Versäumnis. Rate die Variante NICHT aus der Netzebene.',
  '',
  'validFrom:',
  'Der Tag, ab dem das Blatt gilt, als JJJJ-MM-TT. Er steht meist als „gültig ab 1. Jänner 2026"',
  'oder „Stand 01.01.2026" auf dem Blatt. Ein blosses Jahr im Titel oder Dateinamen ist KEIN',
  'Gültigkeitsbeginn — rechne daraus nichts zurück; dann ist das Feld null.',
].join('\n')

/*
 * Der Auftrag in einem Satz, plus die zwei Regeln, die am ehesten übersehen werden. Bewusst KEIN
 * „lass jedes Feld null, das nicht eindeutig dasteht": das stünde im direkten Widerspruch zur
 * Mehrfach-Zeitraum-Regel oben (mehrere Sätze sind ja gerade nicht eindeutig), und zwei
 * Anweisungen, die einander aufheben, verschieben die Unbestimmtheit nur — genau der Fehler, den
 * der Rechnungs-Scan am 31.08.2026 korrigieren musste.
 */
const USER_PROMPT =
  'Lies aus diesem Preisblatt die Entgelte nach Schema aus. Lass jedes Feld null, das auf dem ' +
  'Dokument nicht steht. Stehen mehrere Gültigkeitszeiträume nebeneinander, gilt durchgehend der ' +
  'zuletzt beginnende. Behandelt das Blatt mehrere Netzebenen gleichrangig, lass die ' +
  'ebenenabhängigen Felder null und die Fensterliste leer.'

/**
 * Extrahiert einen Tarifstand aus einem Preisblatt.
 *
 * @param pdfBase64 Das Preisblatt als base64-kodierte PDF (ohne `data:`-Präfix, ohne Umbrüche).
 *
 * ── DIE DREI AUSGÄNGE, UND WARUM ES DREI SIND ─────────────────────────────────────────────────
 *   `not_configured`  Der Schlüssel fehlt. Kein Aufruf. Ein eigener Zustand, weil die Oberfläche
 *                     dafür etwas anderes sagen muss als bei einem Fehlschlag — „noch nicht
 *                     eingerichtet" ist kein Fehler und schon gar keine Aussage über das Blatt.
 *                     ⚠ In `peak-shaving-web` ist der Schlüssel derzeit NICHT gesetzt; das ist
 *                     bis auf Weiteres der zu erwartende Zustand in Produktion.
 *   `api_error`       Der Aufruf ist gescheitert (Netz, Kontingent, Ablehnung). Wiederholbar.
 *   `unreadable`      Der Aufruf lief, aber es wurde NICHTS gefunden. Das ist ein BEFUND, kein
 *                     Fehler. Er kommt als eigener Ausgang zurück, damit der Aufrufer nicht ein
 *                     unverändertes Formular vorlegt und so tut, als hätte der Scan funktioniert.
 *
 * Es gibt bewusst KEINEN vierten Ausgang für „teilweise erkannt": ein Ergebnis mit drei von neun
 * Feldern ist ein normaler Erfolg — bei einem Mehr-Ebenen-Blatt sogar der vorgesehene. Welche
 * Felder fehlen, steht im Ergebnis selbst, und der Admin sieht es vor dem Absenden.
 */
export async function extractTariffSheetData(pdfBase64: string): Promise<TariffSheetScanOutcome> {
  let client
  try {
    client = createTariffSheetScanClient()
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
      model: TARIFF_SHEET_SCAN_MODEL,
      /*
       * Grosszügiger als beim Rechnungs-Scan (dort 4096): die Antwort trägt hier eine Liste
       * unbekannter Länge. Ein Blatt mit Hochlastfenstern je Saison kommt schnell auf ein Dutzend
       * Einträge, und eine abgeschnittene Antwort wäre kein Teilergebnis, sondern ungültiges JSON
       * — sie landete als `api_error`, ohne dass jemand die Ursache sähe.
       */
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      /*
       * Das Schema wird von der API erzwungen (`json_schema` mit `additionalProperties: false` und
       * vollständigen `required`-Listen, s. `../tariff-sheet-scan`). Die Antwort ist damit
       * strukturell garantiert — der Inhalt der Felder selbstverständlich nicht, deshalb läuft sie
       * unten trotzdem durch `parseTariffSheetExtraction`.
       */
      output_config: {
        format: { type: 'json_schema', schema: TARIFF_SHEET_SCAN_JSON_SCHEMA },
      },
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
     * Protokolliert wird die Ursache des Fehlschlags — bei einem SDK-Fehler Statuscode und
     * Meldung, nicht die gesendete Nutzlast. Ein Preisblatt ist zwar ein öffentliches Dokument,
     * aber ein Log ist trotzdem kein zweiter Ablageort für einen Anhang.
     *
     * Ein unbrauchbarer JSON-Text landet ebenfalls hier: `JSON.parse` wirft. Das ist richtig — die
     * API hat dann etwas geliefert, das ihr eigenes Schema verletzt, und das ist ein Fehler des
     * Aufrufs, kein Befund über das Blatt.
     */
    console.error('[tariff-scan] Extraktion fehlgeschlagen:', cause)
    return { ok: false, reason: 'api_error' }
  }

  const extraction = parseTariffSheetExtraction(raw)

  /*
   * NICHTS gefunden ist ein eigener Ausgang, kein leerer Erfolg. Ein leeres Ergebnis als `ok: true`
   * zurückzugeben zwänge jeden Aufrufer, die Leere selbst zu bemerken — und der erste, der es
   * vergisst, meldet „Preisblatt gelesen" über einem unveränderten Formular.
   */
  if (tariffSheetExtractionIsEmpty(extraction)) return { ok: false, reason: 'unreadable' }

  return { ok: true, extraction }
}
