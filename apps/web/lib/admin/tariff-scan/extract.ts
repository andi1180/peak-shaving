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
 * höher als beim Rechnungs-Scan: Ein hier angelegter Tarifstand ist nachträglich nicht mehr
 * korrigierbar (B21-2b: keine Update-Funktion; das Löschen aus B21-2c ist ein protokollierter
 * Rückbau für Probeeinträge) und geht in JEDE künftige Analyse dieser Netzebene ein — nicht nur in
 * die eines einzelnen Kunden.
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
 * ── ⚠ DIE MEHR-EBENEN-REGEL IST ERSETZT: JE KOMBINATION EIN EINTRAG ───────────────────────────
 * Bis zum 01.09.2026 stand hier das Gegenteil. Das Schema beschrieb GENAU EINEN Tarifstand, ein
 * Preisblatt führt aber typischerweise ALLE Netzebenen in einer Tabelle — das Modell hätte eine
 * Zeile auswählen müssen, und jede Auswahl wäre geraten gewesen. Die Anweisung lautete deshalb:
 * bei mehreren gleichrangigen Ebenen sind die ebenenabhängigen Felder `null`. Das war ehrlich und
 * teuer; an WN-EX0105 gemessen kamen drei von neun Angaben zurück, den Rest tippte der Admin ab.
 *
 * Beantwortet wird die Frage jetzt von der STRUKTUR statt vom Modell: Das Schema trägt eine LISTE
 * (`candidates`), und jeder Eintrag beschreibt genau eine Kombination aus Netzebene und — auf
 * Netzebene 7 — Messvariante. Es gibt damit nichts mehr auszuwählen; das Modell liest jede Zeile,
 * die es sicher zuordnen kann, und lässt jede weg, die es nicht kann.
 *
 * ⚠ DIE IDENTITÄT IST DAS PAAR, NICHT DIE EBENE. Netzebene 7 mit drei Varianten nebeneinander sind
 * DREI Einträge, nicht einer — sonst gingen zwei Leistungspreise verloren, und zwar unbemerkt.
 * Ausführlich begründet im Kopf von `../tariff-sheet-scan`.
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
  '- Ist das Dokument kein Netz-Preisblatt, unlesbar oder leer, lass ALLE blattweiten Felder null',
  '  und die Kandidatenliste leer.',
  '',
  'DER AUFBAU DER ANTWORT — blattweite Angaben und eine Liste von Tarifzeilen:',
  'Ein Preisblatt hat Angaben, die für das GANZE Blatt gelten, und Preise, die je Tarifzeile',
  'verschieden sind.',
  '',
  '- Blattweit und nur EINMAL einzutragen: operatorName, validFrom, priceBasis.',
  '- Je Tarifzeile ein eigener Eintrag in candidates: netzebene, meteringVariant,',
  '  grundpreisAmount, grundpreisUnit, netzverlustCtPerKwh und die Fensterliste windows.',
  '',
  'JE KOMBINATION AUS NETZEBENE UND MESSVARIANTE EIN EINTRAG — der wichtigste Punkt:',
  'Viele Preisblätter führen alle Netzebenen nebeneinander, meist als Tabelle mit einer Zeile oder',
  'Spalte je Ebene. Lege für JEDE Zeile, die du sicher zuordnen kannst, einen eigenen Eintrag an.',
  '',
  '- Ein Blatt mit den Netzebenen 3 bis 7 hat mindestens FÜNF Einträge, nicht einen.',
  '- Unterscheidet das Blatt eine Netzebene zusätzlich nach Leistungsmessungs-Variante — auf',
  '  Netzebene 7 ist das der Regelfall —, dann ist JEDE dieser Varianten ein EIGENER Eintrag.',
  '  Führt das Blatt Netzebene 7 mit Leistungsmessung, ohne Leistungsmessung und unterbrechbar',
  '  auf, sind das DREI Einträge mit netzebene 7 und drei verschiedenen meteringVariant-Werten —',
  '  nicht ein Eintrag. Fasse sie NICHT zusammen und wähle nicht eine davon aus: du verlörest',
  '  sonst die Preise der anderen, und niemand würde es bemerken.',
  '- Zwei Einträge mit derselben Kombination aus netzebene und meteringVariant darf es NICHT',
  '  geben. Trifft dasselbe Paar zweimal zu, gehört es in EINEN Eintrag.',
  '- Unterscheidet das Blatt eine Netzebene nicht nach Variante, ist meteringVariant für diesen',
  '  Eintrag null. Das ist ein richtiges Ergebnis und kein Versäumnis.',
  '',
  'WAS DU AUSLÄSST — und warum das kein Fehler ist:',
  'Lässt sich eine Zeile keiner Netzebene sicher zuordnen, lass den ganzen Eintrag WEG. Rate die',
  'Netzebene nicht und trage sie nicht „vorläufig" ein. Ein fehlender Eintrag sieht der Mensch, der',
  'die Werte anschliessend bestätigt; ein Eintrag unter falscher Netzebene sieht er nicht — und er',
  'wäre die Preisgrundlage für jeden künftigen Kunden dieser Ebene.',
  '',
  'Dasselbe gilt innerhalb eines Eintrags: Ein Preis, den du für DIESE Zeile nicht sicher lesen',
  'kannst, ist null. Nimm keinen Wert aus einer NACHBARZEILE — die Netzebenen haben verschiedene',
  'Entgelte, und ein übernommener Nachbarwert ist die gefährlichste Art von Fehler, weil er',
  'plausibel aussieht.',
  '',
  'Sind auf dem ganzen Blatt keine Zeilen sicher zuordenbar, ist candidates ein leeres Array. Trage',
  'dann trotzdem die blattweiten Angaben ein, die dastehen.',
  '',
  'MEHRERE GÜLTIGKEITSZEITRÄUME:',
  'Preisblätter stellen häufig den bisherigen und den neuen Satz nebeneinander („gültig bis',
  '31.12.2025" / „gültig ab 01.01.2026"), oder ein Blatt führt mehrere Zeitabschnitte auf.',
  '',
  'In diesem Fall gilt durchgehend der Satz des ZULETZT beginnenden Zeitraums — also der jüngste,',
  'aktuellste. Sein Beginn gehört in validFrom, und alle Beträge in allen Einträgen gehören zu',
  'genau diesem Zeitraum.',
  '',
  '- Trage NICHT null ein. Mehrere Werte sind kein Grund zu schweigen: der Posten steht auf dem',
  '  Blatt, und welcher Satz zuletzt gilt, ist ablesbar.',
  '- Nimm NICHT den ersten und NICHT den grössten, sondern den mit dem spätesten Beginn.',
  '- Mische NICHT: nimm nicht den Grundpreis aus dem einen und den Arbeitspreis aus dem anderen',
  '  Zeitraum. Alle Werte stammen aus demselben, dem jüngsten.',
  '- Lege für einen älteren Zeitraum KEINE eigenen Einträge an. Die Kandidatenliste beschreibt die',
  '  Tarifzeilen EINES Standes, nicht die Geschichte des Blattes.',
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
  'null und fiele niemandem als Fehler auf. Lege für Einspeise-Zeilen auch KEINE eigenen',
  'Kandidaten-Einträge an.',
  '',
  'VORZEICHEN:',
  'Stehen Beträge mit einem Minuszeichen (Gutschriften, Abschläge, Rabattzeilen), trage den Betrag',
  'OHNE Vorzeichen ein. Alle Felder dieses Schemas sind Beträge, keine Buchungen — ein negativer',
  'Wert ist kein gültiges Ergebnis und geht verloren.',
  '',
  'grundpreisAmount UND grundpreisUnit — nur gemeinsam, und je Eintrag:',
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
  'Ein Blatt kann für verschiedene Netzebenen verschiedene Einheiten führen: entscheide die Einheit',
  'für JEDEN Eintrag einzeln, nicht einmal für das ganze Blatt.',
  '',
  'netzverlustCtPerKwh:',
  'Das Netzverlustentgelt ist ein EIGENER Posten und NICHT der Arbeitspreis der Netznutzung.',
  'Österreichische Blätter führen beide getrennt: „Netznutzungsentgelt (Arbeit)" bzw. „Arbeitspreis',
  'Netznutzung" auf der einen Seite, „Netzverlustentgelt" auf der anderen. Der Arbeitspreis der',
  'Netznutzung gehört in die Fensterliste, nicht in dieses Feld. Findest du keinen ausdrücklich als',
  'Netzverlustentgelt bezeichneten Posten, ist das Feld null.',
  'Es wird je Netzebene ausgewiesen: nimm für jeden Eintrag den Wert SEINER Netzebene. Teilen sich',
  'mehrere Einträge denselben Wert — etwa die drei Messvarianten einer Netzebene —, trage ihn bei',
  'jedem von ihnen ein.',
  '',
  'DIE FENSTERLISTE (windows) — die zeitabhängigen Arbeitspreise der Netznutzung, je Eintrag:',
  'Jeder Arbeitspreis der Netznutzung DIESER Tarifzeile wird ein Element. Weist das Blatt für sie',
  'einen einzigen, ganztägigen Arbeitspreis aus, ist das GENAU EIN Element mit timeFrom „00:00",',
  'timeTo „24:00" und ohne Saison (beide Saisonfelder null).',
  '',
  'Weist das Blatt zeitlich oder saisonal unterschiedene Arbeitspreise aus, wird jeder davon ein',
  'eigenes Element:',
  '- Der Regel-/Grundpreis, der ausserhalb der besonderen Zeiten gilt, heisst „normal" und deckt',
  '  in der Regel den ganzen Tag ab (00:00 bis 24:00) und das ganze Jahr.',
  '- Ein Hochlastfenster heisst „snap". Blätter nennen es „Hochlastzeitfenster", „Spitzenzeit",',
  '  „Hochtarif", „HT" oder „Lastspitzenzeit". Es gilt meist nur an bestimmten Tageszeiten und oft',
  '  nur im Winterhalbjahr.',
  '- Ein Fenster, das nur eine Jahreszeit betrifft, heisst „winter" (bzw. „sommer").',
  '- Nennt das Blatt einen anderen Namen, nimm ihn in Kleinbuchstaben.',
  '',
  'Zu jedem Element:',
  '- timeFrom und timeTo als HH:MM. Das Tagesende ist „24:00", nicht „23:59" und nicht „00:00".',
  '- Die Saison als MM-TT ohne Jahreszahl, etwa monthDayFrom „10-01" und monthDayTo „03-31" für',
  '  Oktober bis März. Gilt das Fenster ganzjährig, sind BEIDE Saisonfelder null.',
  '- Gib die Saison vollständig an oder gar nicht. Eine halbe Saisonangabe ist unbrauchbar.',
  '- Kannst du für einen Arbeitspreis die Uhrzeiten oder den Betrag nicht sicher lesen, lass das',
  '  ganze Element weg. Erfinde keine Uhrzeit und setze keine Standardzeit ein — ein Fenster mit',
  '  geratener Zeit gilt sonst rund um die Uhr.',
  '- Nimm in die Liste NUR Arbeitspreise der Netznutzung für BEZUG auf. Keine Energiepreise eines',
  '  Lieferanten, keine Steuern und Abgaben, keine Einspeise-Entgelte, kein Netzverlustentgelt und',
  '  keinen Leistungspreis.',
  '- Gilt dieselbe Zeitfenster-Struktur für mehrere Netzebenen, wiederhole sie bei jedem Eintrag',
  '  mit dessen eigenen Beträgen. Verweise nicht auf einen anderen Eintrag.',
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
  'Unterscheidet das Blatt für eine Netzebene gar nicht nach Messvariante — was auf höheren',
  'Netzebenen der Regelfall ist, weil dort ohnehin gemessen wird —, ist das Feld für diesen Eintrag',
  'null. Das ist ein richtiges Ergebnis und kein Versäumnis. Rate die Variante NICHT aus der',
  'Netzebene, und lege für eine nicht ausgewiesene Variante KEINEN eigenen Eintrag an.',
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
 *
 * Der letzte Satz verstärkt die Kandidatenregel. Er stand hier bis zum 01.09.2026 in der
 * GEGENTEILIGEN Fassung („lass die ebenenabhängigen Felder null") und musste in derselben Änderung
 * mitwandern: eine Anweisung im System-Prompt und ihre Umkehrung im Auftrag hätten die
 * Unbestimmtheit wiederhergestellt, die beide beseitigen sollen.
 */
const USER_PROMPT =
  'Lies aus diesem Preisblatt die Entgelte nach Schema aus. Lass jedes Feld null, das auf dem ' +
  'Dokument nicht steht. Stehen mehrere Gültigkeitszeiträume nebeneinander, gilt durchgehend der ' +
  'zuletzt beginnende. Lege für JEDE Kombination aus Netzebene und Messvariante, die das Blatt ' +
  'ausweist, einen eigenen Eintrag in candidates an — Netzebene 7 mit mehreren Varianten ergibt ' +
  'mehrere Einträge. Eine Zeile, die du keiner Netzebene sicher zuordnen kannst, lässt du weg.'

/**
 * Extrahiert die Tarifzeilen aus einem Preisblatt.
 *
 * @param pdfBase64 Das Preisblatt als base64-kodierte PDF (ohne `data:`-Präfix, ohne Umbrüche).
 *
 * ── DIE DREI AUSGÄNGE, UND WARUM ES DREI SIND ─────────────────────────────────────────────────
 *   `not_configured`  Der Schlüssel fehlt. Kein Aufruf. Ein eigener Zustand, weil die Oberfläche
 *                     dafür etwas anderes sagen muss als bei einem Fehlschlag — „noch nicht
 *                     eingerichtet" ist kein Fehler und schon gar keine Aussage über das Blatt.
 *                     ⚠ Seit dem 01.09.2026 ist der Schlüssel in `peak-shaving-web` gesetzt — der
 *                     Zustand ist damit KEIN zu erwartender Produktionszustand mehr (§1l).
 *   `api_error`       Der Aufruf ist gescheitert (Netz, Kontingent, Ablehnung). Wiederholbar.
 *   `unreadable`      Der Aufruf lief, aber es wurde NICHTS gefunden. Das ist ein BEFUND, kein
 *                     Fehler. Er kommt als eigener Ausgang zurück, damit der Aufrufer nicht ein
 *                     unverändertes Formular vorlegt und so tut, als hätte der Scan funktioniert.
 *
 * Es gibt bewusst KEINEN vierten Ausgang für „teilweise erkannt": ein Ergebnis mit drei von sieben
 * Tarifzeilen ist ein normaler Erfolg — der Admin sieht, welche gelesen wurden, und trägt die
 * übrigen von Hand nach. „Nichts gefunden" heisst hier: keine einzige Tarifzeile UND keine der
 * drei blattweiten Angaben (s. `tariffSheetExtractionIsEmpty`); ein Blatt, von dem nur der
 * Betreibername lesbar war, ist ausdrücklich NICHT leer.
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
       * ── ⚠ DIE ZAHL IST GEMESSEN, NICHT GESCHÄTZT ──────────────────────────────────────────
       * Bis zum 01.09.2026 standen hier 8192 — bemessen für EINE Tarifzeile mit EINER
       * Fensterliste. Seit der Umstellung auf Kandidaten trägt eine Antwort bis zu sieben
       * Tarifzeilen mit je eigener Fensterliste (4 + 3, s. `../tariff-sheet-scan`), also ein
       * Vielfaches.
       *
       * Der Bedarf wurde am Zeichenumfang einer konstruierten Höchstlast-Antwort gemessen
       * (7 Kandidaten, lange Fensterbezeichnungen, vierstellige Beträge mit vier Nachkommastellen,
       * eingerückt ausgegeben — die teuerste Schreibweise):
       *
       *     1 Fenster je Kandidat   →   3.236 Zeichen
       *     6 Fenster je Kandidat   →  11.286 Zeichen
       *    12 Fenster je Kandidat   →  20.960 Zeichen
       *    20 Fenster je Kandidat   →  33.896 Zeichen
       *
       * Bei konservativ gerechneten 2 Zeichen je Token (JSON liegt real eher bei 3 bis 4) sind das
       * rund 10.500 Tokens für den realistischen Höchstfall von zwölf Fenstern je Zeile und rund
       * 17.000 für den unrealistischen von zwanzig. 16384 deckt den ersten mit Reserve ab.
       *
       * ⚠ EINE ABGESCHNITTENE ANTWORT IST KEIN TEILERGEBNIS, sondern ungültiges JSON: sie landet
       * als `api_error`, ohne dass jemand die Ursache sähe. Die Grenze grosszügig zu setzen kostet
       * nichts (abgerechnet werden die tatsächlich erzeugten Tokens), sie zu knapp zu setzen macht
       * den Scan für genau die Blätter unbrauchbar, für die er gebaut wurde.
       */
      max_tokens: 16384,
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
