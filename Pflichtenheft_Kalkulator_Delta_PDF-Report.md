# Pflichtenheft-Delta: neu gerenderter PDF-Report (`@react-pdf/renderer`)

> **Delta zu `Pflichtenheft_Kalkulator_MVP.md` §6.2, kein Ersatz.** Alles, was hier nicht erwähnt wird — Engine, Contract, Report-Inhalte, Lead-/Einwilligungspfad —, bleibt unverändert gültig. Wer aus diesem Dokument baut, liest **zuerst** `PDF_Rendering_Spike_Bestandsaufnahme.md` (die Messung, auf der es beruht), **dann** dieses Delta, **dann** `CLAUDE.md` (Arbeitsregeln + Handover).
>
> **Verhältnis zu Delta 16** (`Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`): Delta 16 Entscheidung 1 lautete „`window.print()` bleibt der Weg, kein serverseitiges PDF". **Diese Entscheidung wird hier NICHT umgestossen** — sie richtete sich gegen ein SERVERSEITIG erzeugtes PDF (Prinzip 4: der Chart-reiche Report bräuchte `dispatchTrace` auf dem Server). Der Weg hier ist ein **clientseitig** erzeugtes PDF: gemessen 0 Requests bei der Erzeugung, die Verbrauchsdaten verlassen den Browser weiterhin nicht (Spike §1). **Die Konsequenz aus Delta 16 gilt unverändert weiter: kein Mail-Anhang** — es entsteht kein serverseitiges Artefakt, der Kunde lädt selbst herunter.
>
> **Legende:** wie im Basisdokument — `[ANNAHME]` = vor Bau zu bestätigen · `[MARTIN]` = Domänen-Input erforderlich · `[OFFEN]` = echte Entscheidungslücke.

---

## D1 — Warum überhaupt ein zweiter Rendering-Weg

Der bestehende Export ist `window.print()` gegen ein Print-Stylesheet (U2 Prompt D, ausgebaut mit Delta 16a). Er trägt Deckblatt, Methodik-Kapitel und eine wiederkehrende Kopf-/Fusszeile — und stösst an zwei Grenzen, die **gemessen** und nicht vermutet sind (`CLAUDE.md`, Eintrag „Druck-Report — Kopf-/Fusszeile", 02.09.2026):

- **Es gibt keinen Seitenzähler.** In Chromium existiert kein Weg, „Seite X von Y" aus dem Dokument heraus zu setzen.
- **Die wiederkehrende Kopfzeile erzwingt eine echte `<table>` als Dokumentrahmen.** Von vier gemessenen Techniken waren drei unbrauchbar. Die vierte hat eine Nebenwirkung, die bereits zugeschlagen hat: **die Mindestinhaltsbreite eines Charts treibt die Breite der ganzen Seite** — ein zu breites Element schneidet Beträge auf anderen Seiten ab.
- **Eine Agenda mit Seitenverweisen ist auf diesem Weg gar nicht möglich**, weil das Dokument seine eigenen Seiten nicht kennt.

Der Spike hat `@react-pdf/renderer` 4.9.0 daraufhin gemessen und trägt: Seitenzähler und fixierte Kopf-/Fusszeile sind vorhanden und über die Glyph-IDs im Content-Stream nachgewiesen; die Erzeugung macht im warmen Lauf **0 Requests**; `/rechner` First Load JS bleibt bei **580 kB** (Delta 0 kB), weil die Bibliothek erst beim Klick nachgeladen wird.

---

## D2 — Contract-Entscheidung 1: hybrid, nicht „alles nativ"

**Entschieden (Empfehlung des Spikes §6, hier übernommen):**

- **react-pdf NATIV für alles Dokumenthafte** — Deckblatt, Seiten, Kopf-/Fusszeile, Seitenzahlen, Agenda, Kennzahlen, Tabellen, Fliesstext, Methodik. Hier liegt der ganze Gewinn, und der Aufwand ist niedrig.
- **Charts als RASTERBILD aus dem bestehenden Recharts-Chart** (B23b). Ausschlaggebend ist nicht der Aufwand, sondern die **eine Definition**: der Chart im PDF ist bit-genau derselbe, den der Kunde am Bildschirm gesehen hat. Eine zweite Zeichenimplementierung wäre eine zweite Wahrheit über dieselbe Zahl — genau das Divergenzrisiko, das dieses Repo sonst vermeidet.
- **Ausdrücklich NICHT:** die Charts vollständig auf react-pdf-Primitives umzustellen. Das wäre eine kleine eigene Chart-Bibliothek neben Recharts (Spike §4: rund 7 × 50–100 Zeilen plus geteilte Achsen-/Skalen-Arithmetik).

**Zwei Fallen der Rasterung sind benannt und je in wenigen Zeilen abzudecken** (Spike §2.1/§2.4): CSS-Variablen lösen im serialisierten SVG nicht auf (`getComputedStyle` vor dem Serialisieren zurückschreiben), und ein falsch gerechnetes Seitenverhältnis streckt das Bild still (gemessen 13,6 %).

**`apps/website/lib/downsample.ts` ist für Lastgang-artige Reihen auch auf diesem Weg Pflicht** (Spike §4): 35.040 Punkte auf 515 pt ergeben einen geschlossenen Block, keine lesbare Kurve.

---

## D3 — Contract-Entscheidung 2: Titel und Untertitel

- **Titel:** vorgeschlagen, aber **editierbar**. Vorschlag ist `Wirtschaftlichkeitsanalyse Batteriespeicher`, ergänzt um `& Ladeoptimierung`, **wenn und nur wenn** `result.tariffOptimization?.computable === true` — dieselbe Bedingung und dieselbe Zeile wie im Bildschirm-Report (B21-3c). Der Titel darf den zweiten Hebel nur nennen, wenn er im Dokument auch vorkommt; „& Ladeoptimierung" auf dem Deckblatt eines Reports, der die Optimierung als nicht berechenbar ausweist, wäre eine Ankündigung, die das Dokument selbst zurücknimmt.
- **Untertitel:** **abgeleitet und NICHT editierbar** — `Auf Basis Ihres Viertelstunden-Lastgangs` bzw. `Auf Basis eines geschätzten Jahresprofils`, entschieden an `loadProfile.source === 'standard_profile'`. Er ist eine Aussage über die DATENGRUNDLAGE, keine Beschriftung. Wäre er frei, könnte auf einem Report, der auf einem synthetischen Standardprofil beruht, „auf Basis Ihres Viertelstunden-Lastgangs" stehen — die teuerste Verwechslung, die dieses Dokument zulassen könnte. Es gibt aus demselben Grund **kein drittes Formularfeld** dafür.

---

## D4 — Contract-Entscheidung 3: die Adresse ist ein Druckfeld, kein Lead-Feld

Das Deckblatt trägt optional eine **mehrzeilige Anschrift**. Sie wird **rein clientseitig** erhoben und geht ausschliesslich in das Dokument, das der Browser erzeugt:

- **kein Feld** in `ReportGateSubmission` (`packages/shared/src/report-gate.ts`),
- **keine Spalte** in `platform.leads`,
- **kein Parameter** in `public.capture_lead`,
- **keine Migration.**

Die E-Mail-Adresse bleibt unverändert Pflichtfeld und schreibt den Lead wie bisher (Delta 16b). Wer die Anschrift je speichern will, trägt sie in `leads`, `capture_lead`, `guard_anonymized_lead` und `platform.anonymize_lead` **gemeinsam** nach — dieselbe Auflage, die schon für „Funktion/Rolle" gilt (Delta 16, Befund 3).

**⚠ Die zwei Dokument-Felder (Titel, Adresse) werden im Gate-Dialog nur gerendert, wenn der Aufrufer sie anfordert** (`documentFields`-Prop). Solange der neue Weg nicht live ist, zeigt der Rechner sie nicht: erhoben und verworfen wären sie eine Requisite, und bei einer Anschrift zusätzlich eine Erhebung ohne Zweck.

---

## D5 — Contract-Entscheidung 4: die Agenda misst ihre Seitenzahlen (Zwei-Pass)

Der Spike nannte das den härtesten offenen Punkt (§6 (a)) — er ist entschieden und **gemessen** (03.09.2026, `@react-pdf/renderer` 4.9.0, `renderToBuffer`, Seitenzahl je über `/Count` gegengeprüft):

| Aufbau | Sentinels melden | Urteil |
|---|---|---|
| EINE `<Page>`, Kapitel per `<View break>` — Dokument hat real 4 Seiten | `1, 1, 1, 1` | **unbrauchbar** |
| eine `<Page>` je Kapitel, ein Kapitel läuft über zwei Seiten | `2, 3, 5` bei `/Count 5` | **trägt** |
| Sentinels für UNTERPUNKTE innerhalb einer umbrechenden Seite | alle `2`, obwohl zwei real auf Seite 3 stehen | **unbrauchbar** |

**Daraus zwei bindende Regeln:**

1. **Jedes Kapitel, das in der Agenda mit einer Seitenzahl steht, ist eine eigene `<Page>`.** Ein Kapitel per Seitenumbruch innerhalb einer bestehenden Seite bekäme still die Zahl des SEITENANFANGS — eine plausibel aussehende, falsche Zahl.
2. **Unterpunkte tragen KEINE Seitenzahl.** Sie stehen eingerückt unter ihrem Kapitel. Die Zahl des Kapitels für sie zu wiederholen wäre für jeden Unterpunkt falsch, der eine Seite weiter beginnt — bei sechs Absätzen der Regelfall.

**Der Ablauf:** erster Durchlauf mit Sentinels (das PDF wird verworfen), zweiter Durchlauf mit den gemessenen Zahlen — und dabei erneut gemessen. Weichen die beiden Messungen ab, hat die Anwesenheit der Zahlen den Umbruch verändert; dann wird ein **dritter Durchlauf ohne Zahlen** ausgeliefert. Keine Zahl ist besser als eine falsche. Ein Fixpunkt-Verfahren ist bewusst nicht gebaut: eine Abweichung heisst gerade, dass der Umbruch von den Zahlen abhängt, und dann kann die Iteration pendeln.

**PDF-Outlines (`bookmark`-Prop) ersetzen das nicht** — sie erzeugen eine Klick-Navigation im Betrachter, aber keine gedruckte Seitenzahl. Der Report wird ausgedruckt weitergereicht.

**Konvention: das Deckblatt zählt mit** — es ist „Seite 1 von N", und die Agenda verweist auf gezählte Seiten. Die Alternative verlangte eine zweite Zählung neben `pageNumber`, und die stünde dann neben der Wahrheit des Seitenbaums.

---

## D6 — Contract-Entscheidung 5: der Fontweg

**Entschieden: Registrierung per URL auf die EIGENE Herkunft** (`/report-fonts/Inter-*.woff`), keine Data-URI im Bündel. Der Spike liess das offen (§6 (b)).

- `next/font` fällt aus, und das ist gemessen: `.next/static/media/` enthält ausschliesslich **woff2**, und fontkit — der Font-Unterbau von react-pdf — verarbeitet TTF/OTF/WOFF, aber kein woff2. Es braucht ein eigenes Asset.
- Geholt werden nur die tatsächlich benutzten Schnitte. Eine Data-URI trüge alle drei bedingungslos im Bündel (3 × ~65 kB als base64 ≈ 260 kB), auch für jeden Nutzer, der nie exportiert.
- Die Dateien sind statische Assets der eigenen Herkunft — es geht nichts an einen fremden Server, Prinzip 4 ist unberührt.

**⚠ Folge, die zu kennen ist:** die ERSTE Erzeugung macht Netzwerk-Anfragen (Fonts + Emblem, alle auf die eigene Herkunft), jede weitere macht **keine**. Gemessen: 3 Fonts + 1 Emblem im kalten Lauf, **0 Nicht-blob-Requests** im warmen.

**Hyphenation ist abgeschaltet.** react-pdf trennt Wörter standardmässig mit einem englischen Silbenalgorithmus; auf deutschen Komposita erzeugt das falsche Trennungen, und auf einem Blatt, das ein Installateur beim Kunden dalässt, fällt genau das auf.

---

## D7 — ⚠ Die Falle, die der Spike nicht kannte: `lineHeight` löscht fixierte Elemente

**Gemessen am 03.09.2026** (`@react-pdf/renderer` 4.9.0, `renderToBuffer` + Textextraktion, danach im Browser gegen den Production-Build bestätigt):

> **Erbt ein Element mit `render`-Prop einen `lineHeight`, verschwindet das GESAMTE `fixed`-Element, zu dem es gehört, spurlos aus dem Dokument.**

Ohne Fehler, ohne Warnung, mit **0 Konsolenfehlern** — und der Rückruf läuft trotzdem (die Gesamtseitenzahl kam im Sink an, während im PDF weder Fusszeile noch Seitenzähler standen).

| Aufbau | Ergebnis |
|---|---|
| `lineHeight` auf der `<Page>` + STATISCHER Text in der fixierten Fusszeile | rendert |
| `lineHeight` auf der `<Page>` + `render`-Text in der fixierten Fusszeile | **Fusszeile komplett weg** |
| `lineHeight` nur auf der Fusszeile selbst | **weg** |
| gar kein `lineHeight` im Pfad des `render`-Elements | rendert |

**Regel:** der Zeilenabstand gehört auf die **Inhalts-Wrapper**, nie auf die `<Page>`. Kopf- und Fusszeile sind deren Geschwister und erben ihn dann nicht.

**⚠ Es gibt dafür keinen automatischen Wächter.** `apps/website` hat keinen Testlauf, und die Grösse, an der man es merken würde (die Gesamtseitenzahl), bleibt korrekt. Der Schutz besteht aus einer ausdrücklichen Warnung an der Stelle (`document.tsx`, `styles.page`) und aus der Prüfroute: wer am Layout arbeitet, erzeugt dort ein PDF und liest nach, ob „Seite X von Y" darin steht. Dieser offene Punkt ist als solcher benannt und nicht gelöst.

---

## D8 — Zerlegung

| | Umfang | Stand |
|---|---|---|
| **B23a** | Dokumentgerüst: Deckblatt, Kopf-/Fusszeile mit Seitenzahl, Agenda mit Seitenverweisen, Methodik-Kapitel, Fontweg, Titel-/Untertitel-Ableitung, die zwei Dokument-Felder im Gate-Dialog, unverlinkte Prüfroute | **gebaut, 03.09.2026** |
| **B23b** | Charts als Rasterbild: generische Pipeline (`chart-raster.ts` + `chart-capture.ts`), an drei strukturell verschiedenen Chart-Typen bewiesen, Downsampling, Seitenverhältnis | **gebaut, 03.09.2026** (s. D11) |
| **B23c-1** | Contract-Erweiterung (`PdfReportInput.analysis`) und die Executive Summary „Kernergebnisse" — Kern-Kennzahl plus drei bis vier abgeleitete Kernaussagen, kein Chart | **gebaut, 03.09.2026** (s. D12) |
| **B23c-2** | Empfehlung, Ladesteuerung und der ERSTE Chart im Dokument (Lastgang mit Kapp-Linie) über die B23b-Pipeline | **gebaut, 03.09.2026** (s. D13) |
| **B23c-3/4** | Die übrigen Report-Charts (Monatsvergleich, Heatmap samt Anker, Kostenvergleich, Tages-Energiefluss, Grenznutzen, Ø-Ladepreis), Annahmen-Snapshot, Datenqualität und Warnungen — **erst danach ist der Cutover möglich** | offen |
| **B23d** | Calls-to-Action-Seite | offen, hängt an einer noch nicht getroffenen Entscheidung: Kontakthinweis gegen QR-Code |
| **Cutover** | Umschalten des Kunden-Knopfes, Rückbau des CSS-Wegs (`print-cover`, `print-frame`, `print-methodology`, `print-assumptions-snapshot`, `@media print`) | **nicht Teil dieser Zerlegung** — eigene Entscheidung, nachdem B23c inhaltliche Parität hergestellt hat |

**Was in B23a fertig ist:** das Dokument trägt Deckblatt (Titel, Untertitel, Kunde, mehrzeilige Anschrift, Zeitraum, Erstellungsdatum, Vorbehalt), auf jeder Seite Kopfzeile (Emblem + Wortmarke + Navy-Balken) und Fusszeile (Absender + Web + „Seite X von Y"), eine Agenda mit gemessenen Seitenverweisen und das Methodik-Kapitel mit denselben sechs Punkten wie der CSS-Weg (der Hindsight-Hinweis WÖRTLICH aus `lib/report-copy.ts` importiert, nicht abgeschrieben).

**Was in B23a bewusst NICHT fertig war:** die Kernergebnisse. Sie standen als ausdrücklich gekennzeichnete Platzhalter-Seite im Dokument — nicht, weil sie vergessen wurden, sondern damit die Agenda mehr als triviale Ein-Seiten-Sprünge zeigt und der Mechanismus messbar wird. **Mit B23c-1 ist die Platzhalter-Seite ersatzlos entfallen** (s. D12).

---

## D9 — ⚠ Der neue Weg ist NICHT live, und das ist eine Zusage

Der Knopf im Rechner löst unverändert `window.print()` aus. Der react-pdf-Weg ist ausschliesslich über die unverlinkte, `noindex`-Route `/pdf-report-probe` erreichbar. **Umgeschaltet wird erst, wenn B23c vollständig ist** — vorher wäre der neue Report ein Rückschritt: mit B23c-2 trägt er Deckblatt, Agenda, Kernergebnisse, Empfehlung, das Lastgang-Diagramm und Methodik, aber noch nicht die übrigen sechs Grafiken, den Annahmen-Snapshot und die Datenqualität.

Die Prüfroute enthält bewusst **nicht** den Gate-Dialog: der schreibt einen echten Lead nach `platform.leads`, und eine Prüfroute, die das kann, verfälscht genau die Statistik, für die die Herkunft `rechner-report` existiert.

---

## D10 — Offene Punkte

- **`[OFFEN]` B23d: Kontakthinweis gegen QR-Code** auf der Abschlussseite. Nicht entschieden, blockiert B23d.
- **`[OFFEN]` Der Cutover-Zeitpunkt und der Rückbau des CSS-Wegs.** Solange beide Wege nebeneinander stehen, ist der Methodik-TEXT doppelt im Repo (einmal als JSX in `print-methodology.tsx`, einmal als Daten in `lib/pdf-report/content.ts`) — bewusst, und der Hindsight-Hinweis ist die eine Ausnahme, die geteilt bleibt.
- **`[OFFEN]` Der Ladezustand beim ersten Export** (Spike §6 (e)): der Lazy-Chunk (≈ 307 kB gzip) lädt beim ersten Klick. Lokal unter 200 ms, über eine echte Leitung nicht. Die Prüfroute zeigt „Wird erzeugt …"; der spätere Kunden-Knopf braucht dasselbe.
- **`[OFFEN]` Kerning** (Spike §6 (c)) — „aWATTar" steht in react-pdf mit sichtbarer Lücke zwischen den beiden T. Kosmetisch, am Papier sichtbar.
- **`[OFFEN]` Kein automatischer Wächter gegen die `lineHeight`-Falle** (D7).
- **`[ERLEDIGT mit B23c-2]` Die Kernergebnis-Seite sagt im KATALOG-Fall nichts zur Kaufentscheidung** (D12). Sie tut es weiterhin nicht — die Kaufaussage steht jetzt im eigenen Kapitel „Empfehlung und Lastverlauf“ (D13), samt Investition, Amortisation, Netto über den Horizont und den §3.8-Warnungen, und zwar in BEIDEN Fällen.
- **`[OFFEN]` Der Blocker-BEFUND der Ladesteuerung erscheint im PDF gar nicht** (D13) — am Bildschirm trägt ihn eine eigene Karte (betroffene Seite, Grund, Zeitbereiche). Er gehört zu den „was fehlt und warum“-Aussagen und damit in dasselbe Kapitel wie Datenqualität und Warnungen (B23c-4).
- **`[OFFEN]` Waisenschutz für die Schluss-Fussnote der Kernergebnis-Seite** (D12) — `minPresenceAhead` ist gemessen wirkungslos; heute tritt der Fall in keinem der drei Prüfläufe auf, ist aber eine Eigenschaft des Textes und keine Zusage des Layouts.
- **Nicht Teil dieses Deltas** (Spike §6 (g)): Barrierefreiheit/PDF-Tags, PDF/A, Dateigrösse eines vollständigen Reports mit sieben Charts, Verhalten auf Safari/iOS — gemessen wurde ausschliesslich Chromium.
- **White-Label bleibt `[v2]`.** Ein PDF trägt kein Stylesheet des Betrachters; die Farben werden beim Erzeugen eingebrannt. Sobald White-Label real wird (MVP §7; `platform.partners` trägt heute weder Logo noch Farbe), wandert `PDF_COLORS` von einer Konstante zu einem Parameter des Dokuments.

---

## D11 — B23b: die Rasterbild-Pipeline, und was an ihr über den Spike hinaus gemessen ist

Der Spike hat Variante 2 an GENAU EINEM Chart bestätigt: einem Recharts-Balkenchart. Gebaut ist
jetzt eine Pipeline mit EINEM Einstieg (`rasterizeChart`), die an drei strukturell verschiedenen
Chart-Typen gemessen ist — kategorial/Balken, Raster/Heatmap und kontinuierlich mit grosser
Punktzahl. Die vier übrigen Report-Charts (Kostenvergleich, Tages-Energiefluss, Grenznutzen-Kurve,
Ø-Ladepreis) sind strukturell je einem dieser drei ähnlich und folgen in B23c.

**Vier Befunde, die der Spike nicht hatte:**

**(1) ⚠ Es braucht ZWEI Serialisierungswege, nicht einen.** Die Stunden-Heatmap ist kein SVG,
sondern ein CSS-Grid aus `div`s (so begründet in ihrem eigenen Kopfkommentar). `XMLSerializer` auf
ein `<svg>` greift dort ins Leere. Der zweite Weg verpackt das HTML in ein `<foreignObject>` und
schreibt dabei den VOLLSTÄNDIGEN berechneten Stil je Element fest — im `foreignObject` gibt es kein
Stylesheet, was dort nicht inline steht, existiert nicht, und das betrifft nicht nur Farben, sondern
das gesamte Layout. Gemessen: der Weg trägt, mit `color-mix()`-Sättigungen, gestricheltem Rand für
leere Zellen und Fliesstext.

**(2) ⚠ Ein „ODER"-Selektor ist bei asynchron rendernden Charts ein Timing-Zufall.** Der erste
Entwurf lautete „nimm `svg.recharts-surface`, sonst das erste Kind". `ResponsiveContainer` rendert
seinen `<svg>` aber erst einige Frames nach dem Mounten, das erste Kind steht sofort — die
Wartebedingung war erfüllt, bevor es den Chart gab. Gemessen: **2280 × 2643 px statt 2280 × 768 px**
(die ganze Karte statt des Zeichenbereichs), und beim Lastgang zusätzlich über den HTML-Weg, was die
Kurve ungezeichnet liess (**0 Bildpunkte in jeder erwarteten Farbe**). Ohne Fehler, ohne Warnung.
Der Standardwert ist deshalb deterministisch; wer den Zeichenbereich will, sagt es ausdrücklich.

**(3) ⚠ Die Schrift fehlt im serialisierten SVG — auf BEIDEN Wegen.** Ein freistehendes SVG kennt die
`@font-face`-Regeln der Seite nicht, und `next/font` vergibt zur Bauzeit erzeugte Familiennamen
(`__Inter_e8ce45`), die dort auf nichts zeigen. Der Text fiele auf eine System-Schrift zurück — im
PDF stünde ein Chart in einer anderen Schrift neben nativem Inter-Text. Inter wird deshalb als
Data-URI in das serialisierte SVG eingebettet, und zwar aus **derselben Liste** (`PDF_FONT_SOURCES`
in `theme.ts`), die `fonts.ts` bei react-pdf registriert. Gemessen ohne Einbettung: die Flächen und
Linien bleiben **bit-identisch** (Akzent-Bildpunkte unverändert), die Beschriftungen ändern sich —
0,5 % bis 5,5 % der Bildpunkte je nach Textanteil.

**(4) ⚠ Eine von Hand nachgerechnete `color-mix()`-Farbe trifft den Bildpunkt nicht.** Der Spike
nennt für die Zwischenstufe des Monatsvergleichs **#87bab6**; im Bild steht **#87bbb6**.
`getComputedStyle` liefert für `color-mix()` keinen `rgb()`-Wert, sondern
`color(srgb 0.529412 0.731373 0.715686)` — die Rundung auf 8 Bit passiert erst im Canvas, und
0,731373 × 255 = 186,5001 landet auf 187. Eine gemischte Farbe ohne Toleranz zu prüfen heisst, die
Rundung zu messen statt die Farbe.

**Downsampling, gemessen statt nachgestellt:** der Lastgang wird mit dem VOLLEN Profil gemountet
(35.040 Werte) und die Stützpunktzahl danach am gerenderten `<path>` gezählt — **2.920**, exakt die
Zahl aus Spike §4. `downsampleMinMax` läuft damit nachweislich auf dem echten Weg zum Chart.

**Seitenverhältnis (Falle 3):** `fitRasterToWidth` ist die einzige Stelle, an der eine Bildhöhe
entsteht. Der Nachweis läuft NICHT über dieselbe Funktion, sondern über das erzeugte PDF: die
`cm`-Matrix der Bildplatzierung gegen die intrinsische Grösse des Bild-XObjects. Gemessen für alle
drei Typen auf sechs Nachkommastellen gleich (2,773438 · 0,883191 · 3,125000).

**Was B23b ausdrücklich NICHT tut:** es hängt sich nicht in den bestehenden Fluss ein.
`PdfReportInput`, `ReportDocument` und `render.tsx` (B23a) haben 0 Zeilen Diff — die
Contract-Erweiterung um das Ergebnis kommt mit B23c. Die drei Chart-Komponenten sind ebenfalls
unverändert; sie werden gemountet und gelesen.

**~~`[OFFEN]`~~ ERLEDIGT mit B23c-3b-1 (04.09.2026, s. D15): Welcher Ausschnitt eines Charts ins Bild
gehört.** Bei Recharts trennt `svg.recharts-surface` den Zeichenbereich sauber ab. Die Heatmap trug
keinen solchen Anker — im B23b-Prüfstand wurde deshalb die ganze Karte samt Fliesstext gerastert.
Für den Report ist das die falsche Aufteilung (Text gehört nativ daneben, nicht als Pixel ins Bild).
Sie trägt jetzt einen: `data-testid="stunden-heatmap-raster"` um Monatskopf und die 24 Datenzeilen,
gelesen von `selectHeatmapGrid`. Gemessen, was das ausmacht: 1710 × 1209 px statt 1860 × 2106 px,
und rund 86.000 Bildpunkte Text stehen jetzt nativ daneben statt im Bild.

---

## D12 — B23c-1: die Executive Summary, und die Regel, nach der sie schweigt

**Gebaut am 03.09.2026.** Der Platzhalter aus B23a ist ersatzlos entfallen; `SECTION_ID.results`,
der Kapiteltitel und die Stellung in `REPORT_AGENDA` sind unverändert — der Agenda-Eintrag zeigt auf
denselben Abschnitt, nur ist dessen Inhalt jetzt gerechnet.

**Der Contract wächst um eine TEILMENGE, nicht um den ganzen Report.** `PdfReportInput.analysis` ist
ein `Pick<AnalysisResult, 'current' | 'perBattery' | 'recommendation' | 'assumptions' |
'tariffOptimization' | 'existingBatteryAnalysis'>` — dasselbe Muster wie die `Pick<…>`-Parameter in
`derive.ts`, und aus demselben Grund: die engere Signatur sagt, was das Dokument LIEST. Sie wächst
mit jedem Schritt, der eine weitere Karte übernimmt, und zwar um die Felder dieser Karte.

**Die Seite trägt eine Kern-Kennzahl und drei bis vier Kernaussagen.** Welche, entscheidet
ausschliesslich `lib/pdf-report/summary.ts`; das Dokument rendert, was die Ableitung liefert, und
verzweigt an keinem Contract-Feld selbst. Die Regel dahinter ist eine einzige:

> **Jede Aussage entsteht NUR, wenn die Grösse, um die es geht, tatsächlich gerechnet wurde. Fehlt
> die Grundlage, fehlt die ZEILE — nicht ein Strich, nicht eine 0, nicht ein „nicht verfügbar".**

Dasselbe Muster wie das leere Adressfeld auf dem Deckblatt (D4). Auf einer Seite mit der Überschrift
„Kernergebnisse" wiegt es schwerer als sonst irgendwo: sie ist die eine Seite, die ein
weitergereichter Report garantiert gelesen bekommt. Konkret ausgelassen wird

- die **Ladesteuerung**, wenn `tariffOptimization?.computable !== true` — und zwar vollständig, ohne
  gedämpfte Ersatzzahl. Genau davor warnt Delta 15 Regel C: `intervalTariffRates` füllt die
  Preisreihe im nicht berechenbaren Fall bewusst durchgehend mit dem Standard-Arbeitspreis, und eine
  daraus gebildete Zahl behauptete, die Steuerung bringe nichts, statt zu sagen, dass sie nicht
  bewertbar ist. **Gemessen** (Prüflauf „Blocker"): die Aussage kommt im erzeugten PDF 0× vor, das
  Wort „Börsenpreis" ebenfalls, und der Titelvorschlag verliert korrekt „& Ladeoptimierung" (D3).
- die **Spitzenkappung**, wenn der Speicher den abgerechneten Leistungswert nicht senkt — eine
  `static` gesteuerte Anlage kappt nicht, ein Anschluss ohne Leistungsmessung hat den Posten gar
  nicht (Delta 3). **Gemessen:** im Bestandsfall (`buildExistingBatteryCandidate` setzt
  `controlType: 'static'`) fehlt die Aussage, im Katalog-Fall steht sie.
- der **Zusatzspeicher**, wenn es keine bestehende Anlage gibt. Die Schwelle ist unverändert
  `netSavingOverHorizon > 0` — dieselbe wie im Bildschirm-Report, keine neue erfunden.

**Es wird nichts nachgerechnet.** Die einzige Arithmetik der Ableitung sind `sumCovered` und
`buildRealSavingBreakdown`, und beide sind DIESELBEN Funktionen wie am Bildschirm. `sumCovered` ist
dafür von `monthly-tariff-chart.tsx` nach `packages/shared/src/real-saving.ts` gewandert (die
Chart-Datei exportiert den Namen weiter, ihre drei Konsumenten bleiben unverändert): der PDF-Weg
liegt in einem eigenen Lazy-Chunk und darf keine Chart-Bibliothek ziehen, und ein zweiter Reducer
ergäbe im selben Report anders gebildete Summen derselben drei Reihen.

**⚠ Die eine Stelle, an der zwei richtige Zahlen wie ein Rechenfehler aussehen.** Im Bestandsfall
trägt die Aufschlüsselung eine Zeile „Wert der Ladesteuerung" (Kassengrösse aus dem Monatsvergleich)
und wenige Zeilen weiter steht die Kernaussage „Wert der Ladesteuerung unter aWATTar"
(§3.7-Attribution). Gemessen unterscheiden sie sich um einen Euro (€ 450 gegen € 451, die Posten
sind im Kopf von `real-saving.ts` benannt). Am Bildschirm liegen die beiden in getrennten Karten;
auf einer Seite ist der Abstand deshalb ausdrücklich benannt, statt eine der beiden Zahlen
wegzulassen — weglassen hiesse, „was zahle ich real" oder „was ist die Steuerung wert" unbeantwortet
zu lassen.

**Der KATALOG-Fall bekommt bewusst keine eigene Sprache** (s. D10): ohne bestehende Anlage zeigt die
Seite Kern-Kennzahl und die gerechnete §3.7-Aufschlüsselung des bestgereihten Geräts — keine
Kaufempfehlung, keine Investition, keine Amortisation. **Gemessen:** die Wörter „Investition",
„Amortisation" und „zusätzlicher Speicher" kommen im Katalog-PDF 0× vor.

---

## D13 — B23c-2: die erste Karte mit Chart im echten Dokument

**Gebaut am 03.09.2026.** Damit steht zum ersten Mal ein über die B23b-Pipeline gerastertes Chart
IM Zwei-/Drei-Pass-Dokument aus B23a — bis hierher waren beide Hälften getrennt bewiesen (ein Chart
in einem Mini-PDF, ein Dokument ohne Chart).

**Das neue Kapitel ist EINES und heisst „Empfehlung und Lastverlauf".** Es trägt in dieser
Reihenfolge: die Kaufaussage, das Lastgang-Diagramm im Fluss, die Ladesteuerungs-Aussage. Das Bild
steht bewusst ZWISCHEN den beiden Textteilen — es ist der Beleg für die Kapp-Schwelle, von der die
Empfehlung darüber lebt, und der Anschauungsgegenstand für die Ladesteuerung darunter. Als eigene
`<Page>` dazwischen wäre es ein Kapitel ohne Aussage, hinter beiden Texten ein Anhang. Es ist eine
eigene `<Page>` (D5, Regel 1) und rendert ohne Rahmen und ohne Kasten: am Bildschirm grenzt die
Karte den Chart gegen ihre Nachbarn ab, auf einem Blatt gibt es diese Nachbarn nicht.

### Die Orchestrierung ist der Kern, nicht die Textkarten

**Das Bild entsteht GENAU EINMAL je Dokument, VOR dem ersten Renderdurchlauf** (`charts.tsx`,
aufgerufen aus `render.tsx`), und wandert als fertige Data-URI in alle Durchläufe. Zwei Gründe, und
der zweite wiegt schwerer:

1. Rastern braucht ein DOM und mehrere Frames (`chart-capture.ts`); der Dokumentbaum ist gegenüber
   `pdf(...).toBlob()` synchron und kann darauf nicht warten.
2. Alle Durchläufe müssen BIT-IDENTISCHE Bilder bekommen. Je Durchlauf neu gerastert könnte eine um
   einen Bildpunkt abweichende Höhe den Umbruch verschieben — dann schlüge der Agenda-Wächter
   (`measurementsAgree`) an, und die Ursache stünde nirgends im Dokument.

**Gemessen statt behauptet:** ein Zähler an der Rasterung selbst (`reportChartBuildCount()`) liefert
`chartBuilds` — in allen drei Prüfläufen **1 bei 2 Durchläufen**.

> **⚠ Die erste Fassung dieser Messung war eine Tautologie, und die Wächter-Probe hat sie gefangen.**
> Die Differenz wurde unmittelbar nach dem einen Aufruf gebildet; mit der Rasterung in `renderPass`
> verschoben (also der FALSCHEN Architektur) blieb sie deshalb fälschlich bei 1. Sie wird jetzt über
> die GANZE Erzeugung gebildet und meldet in derselben Probe korrekt **3**.

### Der Contract ist NICHT gewachsen — und das ist ein Befund

`PdfReportAnalysis` bleibt derselbe `Pick<…>` aus B23c-1. Empfehlungs-Aussage,
Ladesteuerungs-Aussage und Chart lesen zusammen genau die sechs Felder, die bereits dort stehen —
`dispatchTrace` mit der Kapp-Schwelle hängt an `perBattery`/`existingBatteryAnalysis`, wie
`types.ts` es vorhergesagt hatte. Ein Feld ohne nachweisbare Verwendung kommt nicht dazu, nur weil
ein Schritt „gross" ist.

**Gewachsen ist der EINGANG um `PdfReportInput.loadProfile`** — den rohen Lastgang. Der steht
bewusst NICHT im `AnalysisResult` (`DispatchTrace` führt ausdrücklich keine Rohreihe) und kommt
deshalb als eigenes Feld, genau wie am Bildschirm (`report.tsx` bekommt `loadProfile` neben dem
Ergebnis). Er ist der volle `LoadProfile` und kein `Pick<…>`: das Bild entsteht aus der
UNVERÄNDERTEN Produktionskomponente `LoadChart`, und deren Prop ist der volle Typ — sie dafür
aufzuweichen hiesse, eine Bildschirm-Komponente für den PDF-Weg anzufassen (Contract-Entscheidung 1).

### Dieselbe Schweigeregel wie D12, an zwei neuen Stellen

- Die **Ladesteuerungs-Aussage** entfällt VOLLSTÄNDIG bei `tariffOptimization?.computable !== true`.
  **Gemessen** (Prüflauf „Blocker"): sie kommt 0× vor, „Börsenpreis" 0×, „Ladesteuerung" 0×.
- Die **Spitzenkappungs-Aussage** (Kapp-Schwelle, abgefangene Spitzen, abgerechneter Wert vorher →
  nachher) entfällt, wenn der Speicher den abgerechneten Leistungswert nicht senkt. An ihrer Stelle
  steht dann eine Aussage über das BILD — warum keine gestrichelte Linie darin ist —, keine über
  eine Ersparnis. **Gemessen:** im Bestands- und im Blocker-Fall (`buildExistingBatteryCandidate`
  setzt `controlType: 'static'`) fehlt sie, im Katalog-Fall steht sie samt Schwelle.

**Was dieses Kapitel bewusst NICHT wiederholt:** die Ladesteuerungs-Aussage trägt KEINE Kopfzahl —
sie wäre bit-identisch mit der auf der Kernergebnis-Seite, und zwei gleich grosse Beträge unter zwei
ähnlichen Überschriften laden dazu ein, sie zu addieren. Aus demselben Grund fehlt die Warnung
„aWATTar wäre derzeit teurer": sie ist rechnerisch dieselbe Aussage wie die Kernergebnis-Zeile „Was
aWATTar Sie zusätzlich kosten würde" (`surcharge = −totalEur`, dieselben drei Summen).

**Der Engine-Satz `recommendation.rationale` wird bewusst nicht übernommen:** er formatiert seine
Beträge selbst (`€1234` über `toFixed(0)`, `rank.ts`) und stünde im selben Dokument neben
`formatEur` („€ 1.234"). Dieselben Grössen stehen als Zeilen; nur ihre Formatierung ist die des
Dokuments.

### Gemessen am erzeugten PDF

Drei Läufe über die echte Prüfroute gegen den Production-Build, **82 Prüfungen, alle grün, 0
Konsolenfehler, 0 Seitenfehler**:

| | Bestand | Blocker | Katalog |
|---|---|---|---|
| Seiten | 8 | 7 | 8 |
| Durchläufe / Rasterungen | 2 / **1** | 2 / **1** | 2 / **1** |
| Rasterbild | 2700 × 864 px | 2700 × 864 px | 2700 × 864 px |
| Stützpunkte der Kurve | **2.920** | 2.920 | 2.920 |
| Kapitel-Aussagen | Empfehlung, keine Kapp-Linie, Ladesteuerung | Empfehlung, keine Kapp-Linie | Empfehlung, **Kapp-Aussage**, Ladesteuerung |

- **Downsampling auf dem echten Weg:** 2.920 Stützpunkte am gerenderten `<path>` gezählt (bei 35.040
  Rohwerten) — exakt die Zahl aus B23b und Spike §4.
- **Seitenverhältnis gegen die tatsächliche Platzierung:** intrinsische Grösse des Bild-XObjects aus
  dem Rohstrom des PDF (2700 × 864 → 3,125000) gegen die `cm`-Matrix der Platzierung
  (499,00 × 159,68 pt → 3,125000). Auf sechs Nachkommastellen gleich, in allen drei Läufen.
- **Die Kurve ist wirklich im PDF, nicht bloss ein Kasten:** das eingebettete RGB-XObject entpackt
  und Bildpunkte gezählt — Katalog: Lastgang-Kurve `#475569` **421.964**, Kapp-Linie `#0f766e`
  **6.604**, abgefangene Spitzen `#b45309` **4.237**. Bestand/Blocker: Kurve **426.004**, Kapp-Linie
  **0**, Spitzen **0** — die fehlende Kapp-Linie ist damit auch im BILD nachgewiesen und nicht nur
  im Text.
- **Agenda erneut gemessen**, nicht aus B23c-1 übernommen: jeder Agenda-Eintrag gegen die
  TATSÄCHLICHE erste Seite seines Kapitels — Kernergebnisse 3/3/3, Empfehlung und Lastverlauf
  5/4/5, Methodik 7/6/7. Die Abweichung des Blocker-Laufs ist der Beleg, dass gemessen und nicht
  abgezählt wird.

**Drei Wächter-Proben, jede bringt gezielt Rot:** (1) `computable`-Gate entfernt → **genau 3** rot,
alle im Blocker-Lauf. (2) Kapp-Bedingung entfernt → **genau 2** rot, und im PDF steht dann wörtlich
„Kapp-Schwelle … zwischen kW und - kW" (`Math.min` über eine leere Liste) und „sinkt dadurch von
50,8 kW auf 50,8 kW" — der Unsinn, den die Bedingung verhindert. (3) Rasterung in `renderPass`
verschoben → **genau 3** rot, `chartBuilds` meldet 3 statt 1.

### Bündelgrösse

`/rechner` First Load: **581.268 → 584.360 Bytes gzip**, roh dagegen **1.919.673 → 1.919.820 Bytes
(+147)**. Der Unterschied ist reine Chunk-Graph-Buchhaltung: der Graph hat einen Chunk mehr
(16 → 17), weil `charts.tsx` die Produktionskomponente `LoadChart` zieht und Next daraufhin ein paar
`shared`-zod-Module in einen eigenen, geteilten Chunk auslagert (1.937 Bytes, Inhalt nachgesehen);
mehr, kleinere gzip-Ströme komprimieren schlechter. **Gemessen: über den GESAMTEN
`/rechner`-First-Load-Satz kommen `@react-pdf`, `fitRasterToWidth`, `reportChartBuildCount` und
jeder Text des neuen Kapitels 0× vor** — es ist kein neuer Code auf der Route, nur eine andere
Aufteilung. `/pdf-report-probe` bleibt bei 117 kB.

---

## D14 — B23c-3a: Kostenverlauf und ein Tag im Detail

**Gebaut am 04.09.2026.** Das Dokument trägt damit drei der sieben Report-Grafiken. Neu ist das
Kapitel **„Kostenverlauf und ein Tag im Detail"** — eine eigene `<Page>` mit eigenem Agenda-Eintrag
(D5, Regel 1), zwischen „Empfehlung und Lastverlauf" und „Methodik & Vorbehalte".

### Die eine Bedingung, und die eine benannte Abweichung

Das Kapitel trägt **entweder** den Monatsvergleich „Ihr Tarif heute gegen aWATTar" **oder** den
kumulierten Kostenvergleich mit/ohne Speicher, gefolgt vom Tages-Energiefluss. Entschieden wird das
an GENAU EINER Bedingung — ist `tariffOptimization.monthlyComparison` gerechnet, steht der
Monatsvergleich, sonst der Kostenvergleich. Ausdrücklich keine zweite Prüfung an `computable`: der
Worker setzt das Feld ausschliesslich bei berechenbarem Hebel UND vorhandener Bestandsanlage, und
eine hier nachgebaute Zweitprüfung könnte davon abweichen (dieselbe Regel wie in `report.tsx` und
`summary.ts`).

> **⚠ Der Bildschirm-Report verzweigt anders, und das ist gemessen statt angenommen.** `report.tsx`
> entscheidet an `isExisting`: im Bestandsfall steht der Monatsvergleich (oder, wenn er fehlt, GAR
> NICHTS), im Katalog-Fall der Kostenvergleich. Der Fall „Bestandsanlage, Hebel nicht berechenbar"
> trägt am Bildschirm damit KEINEN der beiden.

Im PDF trägt er den Kostenvergleich. Drei Gründe, alle drei in `detail.ts` ausgeschrieben:

1. Am Bildschirm ist der Kostenvergleich an die Katalog-Empfehlung als PRIMÄRE Aussage gebunden,
   und die gibt es für einen Bestandskunden dort nicht — die Sektion „Falls Sie stattdessen neu
   kaufen würden" ist am Bildschirm ersatzlos gestrichen.
2. Im PDF gibt es sie sehr wohl: B23c-2 trägt die Kaufaussage in BEIDEN Fällen, im Bestandsfall in
   genau dieser Rahmung. Der Kostenvergleich ist das BILD zu jener Aussage — dieselbe
   Nettoinvestition, dieselbe Amortisation, derselbe Betrachtungszeitraum.
3. Ein Kapitel, das im Blocker-Fall gar nichts trägt, wäre ein Agenda-Eintrag auf eine Seite, die
   nur sagt, dass sie leer ist.

Nicht übernommen wird die Begründung, die am Bildschirm dagegen spricht (die Kurve vergleicht „mit
gegen ohne Speicher" und ist für ein ZUSATZgerät die falsche Form) — genau deshalb steht sie hier
unter derselben Rahmung wie die Kaufaussage, als Ersatz und nicht als Ergänzung.

### Der Contract ist zum zweiten Mal NICHT gewachsen — ausgezählt

`PdfReportAnalysis` bleibt der `Pick<…>` aus B23c-1. Die drei Bilder lesen zusammen: den
Monatsvergleich aus `tariffOptimization`, den empfohlenen Eintrag aus `perBattery` (über
`recommendation`) samt `current.leistungspreisCostPerYear` und `assumptions.horizonYears`, und für
den Energiefluss `existingBatteryAnalysis.entry` bzw. `perBattery` (je `dispatchTrace` mit
`representativeDays`) plus die Zeitzone aus `PdfReportInput.loadProfile`. Alle sechs Felder standen
bereits dort; `representativeDays` hängt an `dispatchTrace`, genau wie `capKwByPeriod` in B23c-2.

### Die Tagesauswahl wird GELESEN, nicht nachgebaut

Welcher Tag im Energiefluss steht, entscheidet `EnergyFlowChart` selbst (`worst_caught_peak`, sonst
`pv_strong`, sonst ein erklärter Leerzustand). Die Komponente wird unverändert und ohne Interaktion
gemountet — ihr Standardzustand IST die Auswahl. Die Beschriftung („10. Feb. (Teuerste abgefangene
Spitze)") wird beim Rastern aus dem GERENDERTEN Baum gelesen und geht von dort in die
Bildunterschrift; die Zeitachse des Bildes zeigt nur Uhrzeiten, das Datum ginge sonst verloren.
Findet sich die Zeile nicht oder ist sie unplausibel lang, fehlt der Halbsatz — ein aus einem
fremden Element gegriffener Text unter einem Bild wäre schlimmer als keine Angabe.

Geprüft wird im Code nur die VORBEDINGUNG: ob der Trace überhaupt einen Tag trägt. Ohne einen
rendert die Komponente ihren Leerzustand, es gäbe keinen Zeichenbereich, und der Rasterweg liefe
acht Sekunden in eine Zeitüberschreitung — statt dass das Dokument sagt, warum kein Bild da ist.

### ⚠ Zwei Befunde an der Pipeline, beide stille Fehlschläge

**(1) Ein animierender Chart wird bei t = 0 gerastert — vier Datenreihen fehlen, fehlerfrei.**
`waitForLayout` (B23b) prüft, ob das Zielelement DA ist und PLATZ hat; beides trifft auf einen
Recharts-Zeichenbereich zu, sobald die Achsen stehen. Der Tages-Energiefluss ist der einzige
Report-Chart, der seine Einblend-Animation ausdrücklich BEHÄLT (§6.2 erlaubt ihm als einzigem
„leichte Interaktion/Animation"); alle übrigen setzen `isAnimationActive={false}`. Gerastert wurde
deshalb ein technisch einwandfreies Bild eines leeren Charts: Achsen, Gitter, Ticks und Nulllinie
vollständig, **0 Bildpunkte in jeder Serienfarbe**.

Am gerenderten Baum abgelesen (alle sechs Pfade mit vollständigem `d`): beide Flächen mit einem
Clip-Rechteck der Breite `0`, beide Linien mit `stroke-dasharray="0px …"`. **Stillstand allein
genügt als Wartebedingung NICHT** — die erste Fassung wartete auf drei unveränderte Frames und lief
in genau denselben leeren Chart, weil zwischen Mounten und dem ersten Tick von react-smooth mehrere
IDENTISCHE Frames liegen und der Anfangszustand der stabile und unsichtbare ist. Gewartet wird
jetzt auf beides: der Baum steht still UND zeigt keinen dieser zwei Anfangszustände mehr. Eine
Wartezeit „lang genug für die Animation" wäre stattdessen eine geratene Zahl.

**(2) `stop-color` fehlte in der Anstrichliste — der Break-even-Balken kam grau heraus.** Ein
Verlauf trägt seine Farben an seinen `<stop>`-Kindern, und dort als `stop-color`. Im freistehenden
SVG blieb `var(--color-negative)` damit unaufgelöst und fiel auf den Anfangswert SCHWARZ zurück:
das Band zwischen den beiden Kostenlinien war einheitlich grau statt rot vor und grün nach dem
Break-even — die Farbe trug keine Information mehr (DESIGN.md). `stop-color`/`stop-opacity` werden
jetzt eingebettet, und zwar nur auf `<stop>`: auf jedem anderen Element sind sie wirkungslos und
blähten die Data-URI.

### Gemessen am erzeugten PDF

Drei Läufe über die Prüfroute gegen den Production-Build, **99 Prüfungen, alle grün, 0
Konsolenfehler, 0 Seitenfehler**:

| | Bestand | Blocker | Katalog |
|---|---|---|---|
| Seiten (B23c-2 → jetzt) | 8 → **10** | 7 → **8** | 8 → **10** |
| Durchläufe / Rasterungen | 2 / **2** | 2 / **2** | 2 / **3** |
| Kosten-Chart | **Monatsvergleich** | kumuliert | kumuliert |
| Energiefluss | kein Tag | kein Tag | **10. Feb.** |
| Agenda (4 Kapitel) | 3 / 5 / 7 / 9 | 3 / 4 / 6 / 7 | 3 / 5 / 7 / 9 |
| Dateigrösse | 522 kB | 528 kB | 609 kB |

- **Agenda erneut gemessen**, nicht übernommen: jeder Eintrag gegen die TATSÄCHLICHE erste Seite
  seines Kapitels, erkannt an Titel UND Vorspann. Der blosse Titel genügt nicht — „Methodik &
  Vorbehalte" steht auch im Fliesstext der Kernergebnis-Fussnote, und danach gesucht meldete die
  Prüfung eine Seite, auf der das Kapitel gar nicht beginnt.
- **Seitenverhältnis** je Bild: intrinsische Grösse des XObjects aus dem Rohstrom gegen die
  `cm`-Matrix der Platzierung — 2,773438 · 2,968750 · 3,125000, relative Abweichung < 1e-6.
- **Die Bilder sind gezeichnet, nicht bloss Kästen** (entpackte RGB-Ströme, Bildpunkte gezählt):
  Monatsvergleich Akzent **105.630** · Mischton **110.740** · grau **248.890** — also alle drei
  Reihen. Kostenvergleich „mit Batterie" Akzent **10.291**, Band **423.359** rötlich und **88.477**
  grünlich. Energiefluss Verbrauch (ink) **4.699** · Batterie (Akzent-hover) **13.291** · Netzbezug
  **19.544**. Lastgang unverändert: Kapp-Linie **6.604** im Katalog-Fall, **0** in den beiden
  anderen.
- **Die Bandfarben werden als EIGENSCHAFT geprüft, nicht als fester Wert** (rötlich/grünlich statt
  einer nachgerechneten Mischfarbe) — D11, Befund 4: eine von Hand gemischte Farbe misst die
  Rundung statt die Farbe. Die tatsächliche Deckung ist hier zudem das Produkt aus `stopOpacity`
  und der Flächendeckung, die Recharts vorgibt.
- **Grün gibt es nur, wo es einen Schnittpunkt gibt.** Im Blocker-Fall spielt das Gerät seine
  Anschaffung im Horizont nicht ein; das Band ist durchgehend rot, und die Bildunterschrift sagt
  genau das statt „bis dahin rot und danach grün".
- **Querprobe über zwei Kapitel hinweg:** die drei Monatssummen des Detail-Kapitels ergeben die
  Differenzen der Kernergebnis-Seite exakt — € 20.721 − € 9.766 = € 10.955 („Reiner Tarifwechsel")
  und € 9.766 − € 9.316 = € 450 („Wert der Ladesteuerung").
- **Der Energiefluss-Tag ist gegen den Trace gehalten**, nicht bloss als „irgendein Datum" geprüft:
  gelesen „10. Feb. (Teuerste abgefangene Spitze)", im Trace `worst_caught_peak@2025-02-10`.

**Vier Wächter-Proben, jede bringt gezielt Rot:** (1) Rasterung in `renderPass` gezogen →
`chartBuilds` 6 / 6 / 9 statt 2 / 2 / 3, **6** Prüfungen rot. (2) Animationszustand ignoriert →
**genau 1** rot, und zwar der leere Energiefluss (Akzent-hover 0, ink 0). (3) `stop-color` nicht
eingebettet → **4** rot, das Band mit **219.294** bzw. **509.935** neutralgrauen Bildpunkten.
(4) Vorbedingung „trägt der Trace einen Tag" entfernt → **7** rot, und an der Stelle der Begründung
steht die technische Meldung einer Zeitüberschreitung.

### Bündelgrösse

`/rechner` First Load: **584.361 → 583.328 Bytes gzip** (−1.033), roh **1.919.820 → 1.920.145**
(+325), Chunk-Zahl unverändert **17**. `/pdf-report-probe` 117 → 118 kB.

Es ist erneut reine Chunk-Graph-Buchhaltung: `charts.tsx` zieht jetzt vier statt einer
Produktionskomponente, und Next zieht die vier daraufhin aus dem Seiten-Chunk in zwei kleine
geteilte Chunks (14.181 und 15.683 Bytes roh); der Seiten-Chunk schrumpft entsprechend von 226.374
auf 215.329 Bytes, und die drei recharts-tragenden Chunks werden zu zweien neu aufgeteilt.
**Gemessen: über den GESAMTEN `/rechner`-First-Load-Satz kommen `@react-pdf`, `fitRasterToWidth`,
`reportChartBuildCount`, `buildDetailChapter` und der Kapiteltitel 0× vor** — es ist kein neuer Code
auf der Route.

### `[OFFEN]` nach diesem Schritt

- **Der `pv_strong`-Rückfall ist mit den Prüf-Fixtures nicht erreichbar.** Der Prüf-Lastgang trägt
  keine Einspeisung, und der Bestandsspeicher ist `static` — im Bestands- wie im Blocker-Fall
  trägt der Trace deshalb GAR KEINEN Tag (dieselbe Lage wie am Bildschirm), im Katalog-Fall genau
  `worst_caught_peak`. Der Rückfall läuft im UNVERÄNDERTEN Bauteil und wird hier nicht nachgebaut;
  gemessen ist er trotzdem nicht. Ein zweiter Lastgang für dieselbe Prüfroute wäre eine zweite
  Grundlage (s. `summary-fixtures.ts`) und ist deshalb bewusst unterblieben.
- **Die Tagesangabe trägt kein Jahr.** `formatDayLabel` formatiert Tag und Monat — am Bildschirm
  genügt das, im weitergereichten PDF wäre das Jahr besser. Ändern hiesse die Komponente anfassen.
- **„Break-even" und „Jahr" stehen am Rand des Zeichenbereichs und werden dort beschnitten** —
  dasselbe wie am Bildschirm, geerbt und nicht durch das Rastern verursacht.
- ~~**Der Heatmap-Anker (D11) ist unverändert offen**~~ — **erledigt mit B23c-3b-1 (s. D15)**,
  zusammen mit dem Ø-Ladepreis. Offen bleiben Grenznutzen-Kurve und Zusatzspeicher-Abschnitt
  (B23c-3b-2).
- **Die Data-URIs sind weiterhin der teure Teil**: die PDFs wiegen jetzt 522–609 kB.


---

## D15 — B23c-3b-1: das Ladeverhalten, und das erste Kapitel, das es nicht immer gibt

**Gebaut am 04.09.2026.** Das Dokument trägt damit fünf der sieben Report-Grafiken. Neu ist das
Kapitel **„Das Ladeverhalten Ihres Speichers"** mit der Stunden-Heatmap und dem Ø-Ladepreis je
Monat — eine eigene `<Page>` (D5, Regel 1) zwischen „Kostenverlauf und ein Tag im Detail" und
„Methodik & Vorbehalte", in derselben Reihenfolge wie am Bildschirm.

### Der Heatmap-Anker: D11s letzter offener Punkt ist entschieden

D11 hat den fehlenden Anker als offenen Punkt benannt: bei Recharts trennt `svg.recharts-surface`
den Zeichenbereich ab, die Heatmap ist bewusst kein SVG und hatte nichts Vergleichbares — im
B23b-Prüfstand wurde deshalb die GANZE Karte samt Fliesstext gerastert.

`battery-flow-heatmap.tsx` trägt jetzt **genau einen** neuen Anker (`data-testid`) um die
Monats-Kopfzeile und die 24 Datenzeilen; 0 Zeilen Diff an Logik, Farben und Zellenverhalten.
`selectHeatmapGrid` (neben `selectRechartsSurface`) liest ihn. Es ist der ERSTE
Produktionseinsatz des HTML-/`foreignObject`-Wegs — bis hierher war er nur im Prüfstand gemessen.

**Gemessen, was der Zuschnitt ausmacht** (Wächter-Probe: Anker entfernt, Standardselektor):
1710 × 1209 px gegen **1860 × 2106 px**, und im Bild der ganzen Karte stehen **6.215** Bildpunkte in
`--color-ink` (die Überschrift) sowie **85.377** in `--color-text-muted` (Beschreibung, Legende, die
zwei Absätze) — im zugeschnittenen Bild **0** bzw. **5.768** (nur Monatsköpfe und Stundenlabels).
Rund 86.000 Bildpunkte Text sind damit aus dem Bild heraus und stehen nativ daneben.

**Warum das nicht Kosmetik ist:** Text als Bildpunkte ist nicht durchsuchbar, nicht kopierbar und
bei jeder Skalierung weicher als der Text daneben. Die Legende der Heatmap ist deshalb im PDF ein
nativer Baustein aus denselben `theme.ts`-Tokens, mit denen die Komponente zeichnet — inklusive des
dritten Musters (leer, gestrichelt umrandet).

### ⚠ Leere Zelle ≠ gemessene Null — positionsgenau im Bild abgelesen

Die Komponente warnt in ihrem Kopf: `null` (kein Messwert) wird als leere Zelle mit gestricheltem
Rand gezeichnet, eine echte 0 als hellste Stufe der Skala; „der Unterschied ist bei einem
Teiljahres-Lastgang die halbe Grafik". Verlöre das Rastern ihn, wäre das eine ernste Regression und
niemandem als Fehler anzusehen.

**Eine Farbzählung kann das nicht beantworten:** eine leere Zelle ist durchsichtig und im Bild
papierweiss — und Papierweiss steht ohnehin überall (Kartengrund, Zellabstände). Gezählt würde der
Hintergrund, nicht die Zelle. Gemessen wird deshalb POSITIONSGENAU: die Zelle wird über ihren
Rasterindex im DOM aufgesucht (`grid[h][m]` → `zeile[h+1].kind[m+1]`, nicht über einen formatierten
`title`-Text), ihr Mittelpunkt relativ zum gerasterten Element gemerkt und derselbe Punkt im PNG
abgelesen. Am B23b-Fixture (es trägt als einziges leere Zellen — der Prüf-Lastgang der Report-Läufe
ist ein Volljahrgang):

| Zelle | Wert | berechnet am lebenden Element | im Bild |
|---|---|---|---|
| leer (0 h / Sep) | `null` | `rgba(0, 0, 0, 0)`, Rand `dashed` | **#ffffff** |
| gemessene Null (0 h / Mär) | `0` | `color(srgb 0.962353 0.97851 0.977255)` | **#f5faf9** |
| stärkste Ladezelle (11 h / Aug) | `126` | `color(srgb 0.0588235 0.462745 0.431373)` | **#0f766e** |
| stärkste Entladezelle (19 h / Jän) | `−70` | `color(srgb 0.463529 0.481412 0.523882)` | **#767b86** |

Die beiden ersten Zeilen sind der Nachweis: **#ffffff gegen #f5faf9**, unterscheidbar. Die zweite
Hälfte ist der Rand — ohne ihn wäre eine leere Zelle im Bild vom Kartengrund nicht zu trennen:
**51.864 Bildpunkte in `--color-border` (#e2e8f0), bit-genau**.

⚠ Keine der vier Farben ist von Hand gemischt (D11, Befund 4) — abgelesen wird, was der Browser
berechnet und das Bild trägt.

### ⚠ Das erste Kapitel, das nicht in jedem Dokument steht

Beide Bilder hängen an einer Datenlage, die fehlen kann: die Heatmap rendert bewusst NICHTS, wenn
keine Zelle einen von null verschiedenen Wert trägt, und den Ø-Ladepreis gibt es nur mit einer
echten Börsenpreis-Reihe. Fehlen beide, entfällt das Kapitel — ein Kapitel, das nur sagt, dass es
leer ist, wäre ein Agenda-Eintrag auf eine leere Seite (D14).

**Folge für die Agenda:** `REPORT_AGENDA` ist keine Konstante mehr, sondern
`buildReportAgenda({ insight })`. `ReportDocument` bildet die Entscheidung EINMAL und speist damit
Agenda UND Seitenbaum; zwei getrennte Auswertungen ergäben einen Eintrag mit dauerhaft leerer
Zahlenspalte (kein Sentinel meldet je) oder ein Kapitel, das die Agenda verschweigt. `content.ts`
nahm das seit B23a für sich in Anspruch („führt AUSSCHLIESSLICH Abschnitte, die tatsächlich
gerendert werden") — jetzt trägt der Code es.

**Die eine Bedingung ist die aus `report.tsx`** (`primaryEntry && (hourFlow || chargePrice)`), also
reines Vorhandensein der Trace-Felder und ausdrücklich keine Zweitprüfung an
`tariffOptimization.computable`. Dazu kommt die VORBEDINGUNG der Heatmap-Komponente — und die ist
keine zweite Fachregel, sondern dasselbe wie `hasRepresentativeDay` in D14: ohne sie liefe
`captureChart` acht Sekunden in eine Zeitüberschreitung und setzte eine technische Meldung an die
Stelle einer Aussage.

### Der Contract ist zum DRITTEN Mal nicht gewachsen — ausgezählt

Der naheliegende Schluss wäre gewesen, den `Pick<…>` um `batteryFlowByHourMonth` und
`monthlyChargePrice` zu erweitern. Beide sind aber keine Felder von `AnalysisResult`, sondern von
`DispatchTrace` — und der hängt an `perBattery` bzw. `existingBatteryAnalysis.entry`, die beide
bereits dort stehen. Ein Feld zu ergänzen, das gar nicht auf dieser Ebene liegt, behauptete eine
Abhängigkeit, die es nicht gibt.

### Eine Rechnung, zwei Konsumenten

„Stärkste Zelle", „am meisten geladen um" und die drei Ladepreis-Kennzahlen entstehen in
`insight.ts` EINMAL und werden von Bildunterschrift und Fliesstext gemeinsam gelesen. Dass die
beiden Komponenten dieselben Grössen für den BILDSCHIRM ein zweites Mal bilden, ist die bewusst in
Kauf genommene Doppelung zwischen den zwei Rendering-Wegen — dieselbe, die `content.ts` für den
Methodik-Text und `detail.ts` für die Leerzustands-Begründungen benennt. Über einen Import aus der
Komponente aufzulösen ginge nicht, ohne die Ableitung an React und an die Darstellung zu binden.

### Gemessen am erzeugten PDF

Drei Läufe über die Prüfroute gegen den Production-Build, **102 Prüfungen, alle grün, 0
Konsolenfehler, 0 Seitenfehler**:

| | Bestand | Blocker | Katalog |
|---|---|---|---|
| Seiten (B23c-3a → jetzt) | 10 → **13** | 8 → **10** | 10 → **13** |
| Rasterungen / Durchläufe | **4** / 2 | **3** / 2 | **5** / 2 |
| Heatmap | ja | ja | ja |
| Ø-Ladepreis | ja | **nein** (keine Preiskurve) | ja |
| Agenda (5 Kapitel) | 3 / 5 / 7 / 9 / 12 | 3 / 4 / 6 / 7 / 9 | 3 / 5 / 7 / 9 / 12 |
| Rasterdauer | 461 ms | 434 ms | 2.074 ms |
| Dateigrösse | 663 kB | 593 kB | 772 kB |

- **`chartBuilds` folgt den BILDERN, nicht den Durchläufen** — 4 / 3 / 5 bei je 2 Durchläufen, und
  je genau so viele, wie das Dokument zeigt.
- **Agenda erneut gemessen**, jeder der FÜNF Einträge gegen die tatsächliche erste Seite seines
  Kapitels. ⚠ Der Erkennungs-Stolperdraht aus D14 ist hier schärfer geworden: die
  Kernergebnis-Fussnote enthält den Methodik-Titel UND dessen Vorspann („Wie diese Zahlen
  entstanden sind und wo ihre Grenzen liegen, steht im Kapitel …") — „Titel irgendwo UND Vorspann
  irgendwo" meldete deshalb Seite 4 statt 12. Erkannt wird an Titel und Vorspann **unmittelbar
  hintereinander**.
- **Seitenverhältnis** je Bild aus dem Rohstrom gegen die `cm`-Matrix: 3,125000 · 2,968750 ·
  2,773438 · **1,414392** · 2,773438, relative Abweichung < 1e-5. ⚠ Die Zuordnung Bild →
  Platzierung läuft über die OBJEKTNUMMER (react-pdf legt sie in Dokumentreihenfolge an), nicht
  über die Reihenfolge im Rohstrom — dort steht je Bild zuerst seine DeviceGray-Alphamaske, und
  nach Rohstrom-Reihenfolge gepaart meldete die Prüfung vier falsche Verhältnisse.
- **Die Heatmap steht auf der ersten Seite ihres Kapitels** (9 / 7 / 9), der Ladepreis auf der
  folgenden.
- **Die Bilder sind gezeichnet** (entpackte RGB-Ströme): Heatmap — stärkste Zelle voll gesättigt
  (Anteil exakt 1,0) in allen drei Läufen, gemessene Nullen als hellste Stufe **1.159.895 /
  1.758.522 / 259.237** Bildpunkte, Sättigungsrampen (Akzent bzw. Ink gegen Weiss, Toleranz 2)
  **154.898+198.026 / 0+12.336 / 433.156+451.672**. Ladepreis — Akzent-Balken **105.630 bzw.
  180.936**, 45-%-Mischung **1.498 bzw. 338.687**, gestrichelte Durchschnittslinie **248.890 bzw.
  17.340**.
- **⚠ Im Blocker-Fall trägt die Heatmap KEINE einzige Ladezelle** (Akzent-Rampe 0, Ink-Rampe
  12.336): der statisch gesteuerte Speicher entlädt dort über den Zeitraum seinen Anfangs-Ladestand
  und lädt kein einziges Mal nach. Geprüft wird deshalb die Eigenschaft der SKALA (die stärkste
  Zelle ist voll gesättigt) und nicht „Akzent muss vorkommen" — welche Richtung sie trägt, hängt an
  den Daten.
- **Die Zeile „Zellen ohne Messwert" erscheint nicht**, weil der Prüf-Lastgang ein Volljahrgang ist
  (0 von 288 leeren Zellen) — geprüft am Zeilenmuster und nicht am Halbsatz der Bildunterschrift,
  der den Unterschied gerade erklärt.

**Vier Wächter-Proben, jede bringt gezielt Rot:** (1) Anker entfernt → Heatmap-Bild 1860 × 2106
statt 1710 × 1209, mit 6.215 Überschrift- und 85.377 Fliesstext-Bildpunkten darin. (2) Legende auf
`null` → der Legendenblock „netto geladen netto entladen keine Messwerte" verschwindet, „keine
Messwerte" 1 → 0. (3) Mengengewichtung durch das arithmetische Mittel der Monatspreise ersetzt →
„Geladen zu **8,35** ct/kWh" wird zu **8,30** ct/kWh; ⚠ der Abstand ist an dieser synthetischen
Preisreihe klein, die Probe zeigt also zugleich, dass eine Prüfung auf „irgendeine Zahl" die
Verwechslung nicht fangen würde. (4) Die `price`-Prüfung in `insightChartPlan` entfernt → der
Blocker-Lauf scheitert schon beim Rechnen mit „Cannot read properties of undefined (reading
'averageCtPerKwh')", es entsteht gar kein Dokument.

### Bündelgrösse

`/rechner` First Load: **583.328 → 583.333 Bytes gzip** (+5), roh **1.920.145 → 1.920.293** (+148),
Chunk-Zahl unverändert **17**. `/pdf-report-probe` **117.863 → 118.341** gzip (+478), roh
396.490 → 398.433, unverändert 6 Chunks.

Der Zuwachs auf `/rechner` ist die eine neue Zeichenkette auf der Route: das `data-testid` des
Ankers, das die Bildschirm-Heatmap mitrendert. **Gemessen über den GESAMTEN `/rechner`-First-Load-
Satz: `@react-pdf`, `fitRasterToWidth`, `reportChartBuildCount`, `buildInsightChapter`,
`insightChartPlan`, `summarizeHourFlow`, `selectHeatmapGrid` und der Kapiteltitel kommen 0× vor**,
`stunden-heatmap-raster` genau 1×.

### `[OFFEN]` nach diesem Schritt

- **Der Fall „gar kein Kapitel" ist gebaut, aber nicht gemessen.** Er verlangt einen Speicher, der
  im ganzen Zeitraum nicht arbeitet, UND eine fehlende Preiskurve; die drei Prüf-Fälle erreichen
  ihn nicht (der Blocker-Speicher entlädt sehr wohl). Ein vierter Fixture-Fall wäre eine zweite
  Grundlage — dieselbe Überlegung, aus der D14 den `pv_strong`-Rückfall nicht nachgestellt hat.
- **Der Unterschied „leer ≠ gemessene Null" ist am B23b-Fixture gemessen, nicht am Report-Lastgang**
  — der ist ein Volljahrgang und trägt keine leere Zelle. Für einen echten Teiljahres-Lastgang ist
  er im PDF neu zu messen.
- **Das Kapitel läuft über zwei bis drei Seiten** (Heatmap 352,8 pt, Ladepreis 179,9 pt plus Text).
  Kein `wrap={false}`-Block sprengt den Satzspiegel; ob die Aufteilung schöner ginge, ist eine
  Layout- und keine Richtigkeitsfrage.
- **Offen bleiben Grenznutzen-Kurve, Zusatzspeicher-Abschnitt und Katalog-Alternativen** (B23c-3b-2)
  sowie Annahmen-Snapshot und Datenqualität (B23c-4).
- **Die Data-URIs bleiben der teure Teil**: die PDFs wiegen jetzt 593–772 kB.
