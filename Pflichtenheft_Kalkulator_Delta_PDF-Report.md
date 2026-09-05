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
- ~~**Der Unterschied „leer ≠ gemessene Null" ist am B23b-Fixture gemessen, nicht am
  Report-Lastgang**~~ — **ERLEDIGT mit B23c-3b-2 (04.09.2026, s. D16):** der neue Prüffall
  `teiljahr` fährt denselben Lastgang auf Jänner bis August gekürzt durch den ECHTEN Analyse-Worker;
  gemessen sind 96 von 288 leeren Zellen, **#ffffff** gegen **#f5faf9** positionsgenau im Bild und
  51.864 bit-genaue Rand-Bildpunkte, mit dem Volljahres-Lauf (0 leere Zellen, 0 Rand-Bildpunkte) als
  Gegenprobe.
- **Das Kapitel läuft über zwei bis drei Seiten** (Heatmap 352,8 pt, Ladepreis 179,9 pt plus Text).
  Kein `wrap={false}`-Block sprengt den Satzspiegel; ob die Aufteilung schöner ginge, ist eine
  Layout- und keine Richtigkeitsfrage.
- ~~**Offen bleiben Grenznutzen-Kurve, Zusatzspeicher-Abschnitt und Katalog-Alternativen**
  (B23c-3b-2)~~ — **gebaut, s. D16.** Offen bleiben Annahmen-Snapshot und Datenqualität (B23c-4).
- **Die Data-URIs bleiben der teure Teil**: die PDFs wiegen jetzt 593–772 kB.

---

## D16 — B23c-3b-2: Speichergrösse und Gerätewahl, und die Tabelle statt der wiederholten Karte

**Gebaut am 04.09.2026.** Das Dokument trägt damit **sechs der sieben** Report-Grafiken. Neu ist das
Kapitel **„Speichergrösse und Gerätewahl"** mit der Grenznutzen-Kurve und einer kompakten
Vergleichstabelle — eine eigene `<Page>` (D5, Regel 1) zwischen „Das Ladeverhalten Ihres Speichers"
und „Methodik & Vorbehalte", in derselben Reihenfolge wie am Bildschirm.

### Ein Kapitel für zwei Fälle, die einander ausschliessen

`report.tsx` verzweigt am Seitenende an `isExisting`: im Bestandsfall die Zusatzspeicher-Sektion
(Grenznutzen `variant="addon"`, darunter Karten ODER der Klarsatz), sonst die Katalog-Kurve
(`variant="catalog"`) samt Alternativen-Aufklappliste. Beide beantworten dieselbe Frage in zwei
Rahmungen — „welche GRÖSSE lohnt sich, und welches Gerät dieser Grösse". Es ist deshalb EIN Kapitel
mit zwei Inhalten und nicht zwei Kapitel, von denen eines in jedem Dokument leer bliebe; der Titel
nennt folgerichtig weder „Zusatzspeicher" noch „Alternativen".

**Die Kurve steht ÜBER der Aussage und erscheint unbedingt**, auch wenn alle Punkte unter der
Nulllinie liegen — wortgleich zur Begründung in `report.tsx` und `marginal-benefit-chart.tsx`:
rechnet sich keines der Geräte, ist sie die BEGRÜNDUNG des Klarsatzes. Sie zeigt, dass die Linie
über alle Grössen unter null bleibt und nicht bloss knapp danebenliegt.

### Eine Tabelle statt der wiederholten Empfehlungskarte

Am Bildschirm zeigt die Aufklappliste je Gerät eine volle `RecommendationCard`. Auf Papier wären das
für fünf Kandidaten mehrere Seiten, auf denen sich derselbe Hindsight-Vorbehalt fünfmal wiederholt
und die eine Frage („welches Gerät ist besser?") zwischen den Wiederholungen verschwindet. Die
Tabelle beantwortet genau sie: sechs Grössen nebeneinander, eine Zeile je Gerät.

**EINE Funktion, ZWEI Konsumenten** (`buildCandidateTable`): Zusatzgeräte und Katalog-Alternativen
sind beide `BatteryResultEntry & BatteryRoiSummary` — dass eine Funktion beide bedient, ist eine
Eigenschaft des Contracts und keine hier erfundene Verallgemeinerung. Die Spalten sind identisch;
was sich unterscheidet, ist die BEDEUTUNG (im Zusatzfall sind alle Ersparnis-Zahlen Differenzen),
und das steht im Fliesstext daneben — „Zusätzliche Ersparnis pro Jahr" passt in keine Spalte von
60 pt, und zwei Spaltensätze wären zwei Tabellen, die beim nächsten Nachtrag auseinanderlaufen.
Kapazität und Leistung teilen sich eine Zelle („25 kWh / 15 kW"): sie sind zusammen die „Grösse"
eines Geräts und werden auch am Bildschirm gemeinsam genannt.

> **⚠ Benannte Abweichung vom Bildschirm: die Alternativentabelle ist VOLLSTÄNDIG.** `report.tsx`
> kürzt auf drei (`.slice(0, 3)`, §3.8/§6.2 „2–3 Alternativen"), und dort ist das richtig: jede
> Alternative ist eine volle Karte. Im PDF ist eine Alternative eine TABELLENZEILE — die Kürzung
> spart einen Zeilenabstand und kostet eine Angabe. Dazu kommt der Unterschied, der auf Papier
> zählt: ein Bildschirm-Report lässt sich weiter aufklappen, ein weitergereichtes Blatt nicht.
> **Gemessen** (Wächter-Probe): mit der Bildschirm-Kürzung verschwindet HomeStore R15 aus dem
> gedruckten Report.

### Der Klarsatz steht wortgleich, die Kopfzahl steht nicht doppelt

Die Kernergebnis-Seite trägt im Bestandsfall bereits eine Zusatzspeicher-Aussage (`summary.ts`):
entweder den bestgereihten Kandidaten mit Kopfzahl oder den Klarsatz in gekürzter Form. Dieses
Kapitel trägt deshalb **keine Kopfzahl** — sie wäre im positiven Fall bit-identisch mit der dort
(dieselbe Regel wie bei der Ladesteuerungs-Aussage, D13). Der **Klarsatz** dagegen steht wortgleich
zum Bildschirm, samt beider Absätze, die die Kernergebnis-Seite kürzt: er ist eine FESTSTELLUNG und
keine Zahl, und zwei verschieden formulierte Fassungen desselben Befunds sähen wie zwei Befunde aus.
**Gemessen: 5 von 5 Sätzen wortgleich**, gelesen aus der QUELLE von `report.tsx` gegen den
GEDRUCKTEN Text.

### Der Contract ist zum VIERTEN Mal nicht gewachsen — ausgezählt

Der naheliegende Schluss wäre gewesen, den `Pick<…>` um `addonScenarios` zu erweitern. Das Feld ist
aber keines von `AnalysisResult`, sondern von `ExistingBatteryAnalysis` — und die hängt an
`existingBatteryAnalysis`, das bereits dort steht (dieselbe Lage wie `batteryFlowByHourMonth` unter
`dispatchTrace` in D15). Nachgezählt liest das Kapitel `existingBatteryAnalysis.addonScenarios`,
`perBattery`, `recommendation` und `assumptions.horizonYears` — alle vier standen bereits dort.

### Gemessen am erzeugten PDF

Fünf Läufe über die Prüfroute gegen den Production-Build, **0 Konsolenfehler, 0 Seitenfehler**:

| | Bestand | Blocker | Katalog | Teiljahr | Zusatz |
|---|---|---|---|---|---|
| Seiten (D15 → jetzt) | 13 → **14** | 10 → **11** | 13 → **15** | (neu) **14** | (neu) **15** |
| Rasterungen / Durchläufe | **5** / 2 | **4** / 2 | **6** / 2 | **5** / 2 | **5** / 2 |
| Kurve | addon | addon | catalog | addon | addon |
| Aussage darunter | `addon_none` | `addon_none` | `catalog_alternatives` | `addon_none` | `addon_table` |
| Tabellenzeilen | 0 (Klarsatz) | 0 (Klarsatz) | **4** | 0 (Klarsatz) | **4** |
| Leere Heatmap-Zellen | 0 | 0 | 0 | **96** | 0 |
| Dateigrösse | 724 kB | 651 kB | 834 kB | 661 kB | 717 kB |

- **Agenda erneut gemessen**, jeder der SECHS Einträge gegen die tatsächliche erste Seite seines
  Kapitels, erkannt an Titel und Vorspann unmittelbar hintereinander (D15). Bestand/Teiljahr
  3 / 5 / 7 / 9 / 12 / 13 · Blocker 3 / 4 / 6 / 7 / 9 / 10 · Katalog/Zusatz 3 / 5 / 7 / 9 / 12 / 14.
  Alle 30 Zahlen treffen. „Seite X von Y" auf allen **69** Seiten der fünf Dokumente.
- **Seitenverhältnis** der Grenznutzen-Kurve aus dem Rohstrom (2130 × 768 px = **2,773438**) gegen
  die `cm`-Matrix der Platzierung (499,00 × 179,92 pt = **2,773437**), in allen fünf Läufen; die
  Zuordnung Bild → Platzierung läuft wie in D15 über die OBJEKTNUMMER.
- **Das Bild ist gezeichnet, nicht bloss ein Kasten** (entpackter RGB-Strom): Akzent (Linie und
  Punkte) **10.617–12.401** Bildpunkte, Sekundärton (Nulllinie und Achsenbeschriftung)
  **20.669–22.916**, Rasterlinien **5.481–8.162**.
- **Die Zahl der Tabellenzeilen ist gegen die Kandidatenzahl gehalten**, nicht bloss „> 0": Katalog
  5 Geräte − 1 Empfehlung = **4** Zeilen (PeakStore C40 · C25 · HomeStore R10 · R15, die Empfehlung
  C60 fehlt korrekt); Zusatzfall **4** von 5 Szenarien. Die Zeile „Davon im Betrachtungszeitraum
  wirtschaftlich" zählt über ALLE betrachteten Geräte (Katalog 3 von 5) und nicht über die gezeigten
  Zeilen — sonst fehlte ausgerechnet der beste Kandidat in der eigenen Statistik.

### ⚠ Der Zusatzspeicher-Tabellenzweig ist nur über den HORIZONT erreichbar — und das ist ein Befund

An diesem Prüf-Lastgang bleibt neben JEDER Bestandsanlage jedes Zusatzgerät unter der Nulllinie, und
zwar strukturell: die Anlage des Kunden ist `static` (Pessimismus-Prinzip), der kombinierte Speicher
damit ebenfalls — ein Zusatzgerät kappt also KEINE Spitzen —, und der Lastgang trägt keine
Einspeisung, also gibt es auch keinen Eigenverbrauch. Übrig bleibt allein die Lastverschiebung, und
die trägt bei diesen Preisen die Anschaffung in zehn Jahren nicht. **Gemessen: auch mit 5 kWh
Bestand sind alle fünf Szenarien über zehn Jahre negativ.**

Erreicht wird der Zweig deshalb über GENAU die Grösse, die ihn am Bildschirm auch erreicht: den
**Betrachtungszeitraum**. Er ist eine Angabe des Nutzers (Annahmen-Panel, §6.2), und die Schwelle
`netSavingOverHorizon > 0` verschiebt sich mit ihm — so ist sie am 01.09.2026 begründet worden. Über
25 Jahre rechnen sich vier der fünf Szenarien. Eine hier erfundene Mindest-Ersparnis oder eine
gedrehte Preisreihe wären dagegen Zahlen, auf die sich niemand festgelegt hat.

### ⚠ D15s erster offener Punkt ist geschlossen: „leer ≠ gemessene Null" an ECHTEN Daten

D15 hat den Unterschied am B23b-**Fixture** nachgewiesen und offengelassen, ob er an einem echten,
durch den Analyse-Worker gerechneten Teiljahres-Lastgang trägt. Der neue Prüffall `teiljahr` fährt
DENSELBEN Lastgang, auf die Monate Jänner bis August gekürzt (gefiltert über die lokale Wanduhr —
eine abgezählte Slot-Zahl reichte wegen der Zeitumstellung in den September hinein). Gemessen wird
positionsgenau wie in D15: Zelle über den Rasterindex im DOM aufsuchen, Mittelpunkt merken,
denselben Punkt im PNG ablesen.

| Zelle | Wert | berechnet am lebenden Element | im Bild |
|---|---|---|---|
| leer (0 h / Sep) | `null` | `rgba(0, 0, 0, 0)`, Rand `dashed` | **#ffffff** |
| gemessene Null (0 h / Jän) | `0` | `color(srgb 0.962353 0.97851 0.977255)` | **#f5faf9** |
| stärkste Ladezelle (4 h / Aug) | `328,6` | `color(srgb 0.0588235 0.462745 0.431373)` | **#0f766e** |
| stärkste Entladezelle (15 h / Jän) | `−281,6` | `color(srgb 0.190588 0.217569 0.281647)` | **#313748** |

**96 von 288 Zellen ohne Messwert** — genau die vier fehlenden Monate × 24 Stunden —, und
**51.864 Bildpunkte in `--color-border` (#e2e8f0)**, bit-genau: ohne den gestrichelten Rand wäre
eine leere Zelle im Bild vom papierweissen Kartengrund nicht zu trennen.

**Der Volljahres-Lauf ist die Gegenprobe und liefert genau das Gegenteil:** 0 leere Zellen, **0**
Rand-Bildpunkte, und die Zellprobe findet gar keine leere Zelle zum Messen. Der Unterschied ist an
einem Volljahrgang also nicht bloss unauffällig — er ist dort nicht existent, und genau deshalb war
er offen.

**Vier Wächter-Proben, jede bringt gezielt Rot:**
1. Kurve an den `netSavingOverHorizon > 0`-Filter gekoppelt → im Bestandsfall **keine Kurve**
   (`chartBuilds` 5 → 4), und an ihrer Stelle steht die Fehlmeldung, während der Klarsatz darunter
   unbelegt dasteht. ⚠ Zusätzlich wird der Begründungstext dabei selbst falsch („es liegt nur ein
   einziges durchgerechnetes Gerät vor" — es sind fünf).
2. Bildschirm-Kürzung `.slice(0, 3)` auf die Alternativen → Tabelle 4 → **3** Zeilen, HomeStore R15
   fehlt im gedruckten Report.
3. „Davon wirtschaftlich" über die gezeigten Zeilen statt über alle Kandidaten → **4 statt 5**
   betrachtete Geräte und **2 statt 3** wirtschaftliche; die Empfehlung fehlt in ihrer eigenen
   Statistik.
4. Der Klarsatz gegen die QUELLE von `report.tsx` — 5 von 5 Sätzen wortgleich; eine Umformulierung
   an einer der beiden Stellen macht die Prüfung rot.

### Bündelgrösse

`/rechner` First Load: roh **1.920.293 → 1.920.351** (+58), Chunk-Zahl unverändert **17**.
`/pdf-report-probe` roh **398.433 → 400.137** (+1.704), unverändert 6 Chunks.

**Gemessen über den GESAMTEN `/rechner`-First-Load-Satz: `@react-pdf`, `fitRasterToWidth`,
`reportChartBuildCount`, `buildComparisonChapter`, `comparisonChartPlan`, `buildCandidateTable`,
`hasComparisonChapter` und der Kapiteltitel kommen 0× vor**, `stunden-heatmap-raster` genau 1×
(Positivkontrolle) — es ist kein neuer Code auf der Route; die 58 Bytes sind Chunk-Graph-Buchhaltung.

> **⚠ Neu gemessen und für künftige Schritte wichtig: die GZIP-Zahl dieser Route ist zwischen zwei
> Builds derselben Quelle nicht stabil.** Drei Builds ergaben bei bit-genau gleicher Rohgrösse
> (1.920.351) die Werte **582.863 / 582.984 / 582.982** — rund 120 Bytes Streuung, weil sich
> Modul-Reihenfolge und -Kennungen zwischen Builds verschieben. Vergleichbar ist deshalb die
> ROHGRÖSSE; eine gzip-Differenz unterhalb von etwa 200 Bytes ist Rauschen. (Die in D15 genannten
> „+5 Bytes gzip" liegen darunter.)

### `[OFFEN]` nach diesem Schritt

- **Der Fall „gar kein Kapitel" ist für BEIDE bedingten Kapitel gebaut und für keines gemessen.**
  Beim Ladeverhalten verlangt er einen Speicher, der im ganzen Zeitraum nicht arbeitet, UND eine
  fehlende Preiskurve; bei der Gerätewahl einen Katalog mit einem einzigen Gerät. Beides erreichen
  die fünf Prüf-Fälle nicht — dasselbe bleibt für die Abschluss-Prüfung vor dem Cutover offen.
- **Der `pv_strong`-Rückfall des Energieflusses** ist unverändert nicht erreichbar (D14).
- **Die Kurve trägt keine Beschriftung der einzelnen Punkte** — welcher Punkt welches Gerät ist,
  steht am Bildschirm im Tooltip und im PDF nur mittelbar über die Tabelle (Kapazität als X-Achse).
  Ein Datenpunkt-Label wäre eine Änderung an der Komponente.
- ~~**Offen bleiben Annahmen-Snapshot und Datenqualität** (B23c-4)~~ — **gebaut, s. D17.** Offen bleibt der Cutover selbst.
- **Die Data-URIs bleiben der teure Teil**: die PDFs wiegen jetzt 651–834 kB.

---

## D17 — B23c-4: die Hinweise bei der Kern-Kennzahl und das Schlusskapitel

**Gebaut am 04.09.2026.** Damit trägt das Dokument alle Inhalte des Bildschirm-Reports bis auf eine
benannte Ausnahme (s. `[OFFEN]`). Neu sind **drei Hinweise bei der Kern-Kennzahl** (`summary.ts`)
und das Kapitel **„Annahmen und Datengrundlage"** (`basis.ts`) — eine eigene `<Page>` (D5, Regel 1)
als LETZTES Kapitel, hinter der Methodik.

### Drei Hinweise, drei Bedingungen — und warum sie einzeln gemessen sind

`summary.ts` ist zum ersten Mal seit B23c-1 erweitert worden. Die drei Hinweise hängen an je einer
eigenen Bedingung, alle drei wortgleich aus `report.tsx` übernommen:

| Hinweis | Bedingung | Ton |
|---|---|---|
| Standardprofil | `loadProfile.source === 'standard_profile'` | neutral |
| Teiljahr | `billingModel.startsWith('monthly') && coveredMonths < 12` | Warnung |
| Datenlücke | `largestGapSlots > LARGE_GAP_SLOTS_THRESHOLD` | Warnung |

Der Bildschirm-Kommentar begründet ausdrücklich, warum sie nicht zusammengelegt werden: sie sagen
Verschiedenes, und die Handlung, die daraus folgt, ist je eine andere (anderes Abrechnungsmodell ·
vollständigen Lastgang anfordern · echten Lastgang hochladen). Sie stehen deshalb einzeln, und alle
drei können zugleich zutreffen.

**Sie stehen ZWISCHEN Kopfzahl und Kernaussagen** und nicht im Schlusskapitel: sie qualifizieren
genau die Zahl darüber — der abgerechnete Leistungswert eines Standardprofils ist die Spitze einer
Durchschnittskurve und keine gemessene Spitze. Dieselbe Stellung wie am Bildschirm, wo der Kommentar
das ausdrücklich begründet („nicht nur in der Datenqualitäts-Box, die beim Live-Test überscrollt
wurde").

**Keine Schwelle ist hier erfunden:** `< 12` und `startsWith('monthly')` stehen so in `report.tsx`,
die Lückengrenze ist die EINE Konstante `LARGE_GAP_SLOTS_THRESHOLD` (importiert, nicht abgeschrieben
— ein als vorläufig gekennzeichneter Platzhalter, Delta 14 Punkt 9), und `source` ist dieselbe
Eigenschaft, an der die Engine die Spitzenkappung abschaltet.

> **⚠ Benannte Präzisierung gegenüber dem Bildschirm.** Dort steht das Modell fest als „Mittelwert
> der Monatsspitzen" im Satz, obwohl die Bedingung auch `monthly_max_sum` trifft — dann benennt der
> Satz das falsche Modell. Im PDF steht der Name, den das Ergebnis tatsächlich trägt. Es ist
> derselbe BEFUND, nur nicht mehr an einen der zwei Fälle gebunden. Der KNOPF des Bildschirms („Mit
> Jahreshöchstwert rechnen") entfällt: ein Satz, der auf eine Schaltfläche verweist, die es auf
> Papier nicht gibt, wäre eine tote Anweisung — der Inhalt des Knopfes steht als Aussage da.

### Das Schlusskapitel: sechs Teile, vier davon bedingt

In dieser Reihenfolge: Annahmen-Tabelle (nativ, kein Bild) → Datenqualitäts-Kasten → Blocker-Befund
→ Tarifherkunft → Preisstand → Schluss-Vorbehalt. **Vom Bekannten zum Fehlenden** — wer bis hierher
liest, sucht die Grenzen.

Es steht NACH der Methodik, und das ist eine andere Reihenfolge als am Bildschirm (dort liegt der
Annahmen-Schnappschuss davor und die Datenqualitäts-Box dahinter). Auf Papier ist es eine Aussage:
die Methodik sagt, WIE gerechnet wurde, dieses Kapitel WOMIT und was dabei fehlte.

**Es ist ausdrücklich KEIN drittes bedingtes Kapitel** — Annahmen, Tarifherkunft und Vorbehalt gibt
es in jedem Report; nur die einzelnen Abschnitte darin entfallen. `ReportChapterPresence` wächst
deshalb nicht.

**⚠ Der Blocker-Befund ist die Lücke, die `recommendation.ts` benannt und hierher verwiesen hat.**
Dort entfällt die Ladesteuerungs-Aussage vollständig, wenn der Hebel nicht berechenbar ist (Delta 15
Regel C) — der STRUKTURIERTE Befund (`side`/`kind`/`ranges`) erschien im PDF damit gar nicht. Er
gehört zu den „was fehlt und warum"-Aussagen und nicht unter eine Überschrift, die einen Wert
ankündigt. Er trägt ausdrücklich KEINEN Betrag.

**Zwei Selbstverweise des Bildschirms sind ersetzt, nicht gestrichen:** der Annahmen-Schnappschuss
verweist auf „das Annahmen-Panel im Bildschirm-Report", die Blocker-Karte auf „die Empfehlung
nebenan". Auf einem weitergereichten Blatt gibt es weder ein Panel noch ein Nebenan. An ihre Stelle
tritt die AUSSAGE, die sie transportieren sollten.

### Der Contract wächst um GENAU EIN Feld — ausgezählt

`PdfReportAnalysis` bekommt `dataQuality` und sonst nichts. Nachgezählt lesen die vier neuen
Bausteine: `dataQuality.coveredMonths` (Teiljahr), `.largestGapSlots` (Lücke),
`.coveredDays`/`.gapsInterpolated`/`.warnings` (Datenqualität), `assumptions` (Annahmen-Tabelle,
und `billingModel` zusätzlich für den Teiljahres-Hinweis), `perBattery` + `recommendation` (das
Gerät der Tabelle) und `tariffOptimization` (der Blocker). Nur `dataQuality` fehlte.

**`PdfReportInput` wächst um ZWEI Felder:** `tariffSource` (die Herkunft der Tarifsätze steht nicht
im `AnalysisResult` — die Engine rechnet mit Tarifwerten, nicht mit ihrer Herkunft; am Bildschirm
ist es genauso eine eigene Prop) und `tariffVintage` als fertige Zeichenkette. Ein `tariff`-Feld
steht ausdrücklich NICHT dort: die Grundgebühr wird ausschliesslich für den Preisstand-Satz gelesen,
und der entsteht in `derive.ts`.

> **⚠ Der Preisstand-Satz ist der einzige Teil dieses Kapitels, der in `derive.ts` steht.** Seine
> Aussage hängt an der UHR, und diese Datei ist die eine, die Grössen ableitet, für die das gilt
> (`formatPrintedAt`). Die Alternative wäre ein zweites Feld für denselben Augenblick gewesen (neben
> dem bereits formatierten `printedAt`) — zwei Darstellungen desselben Zeitpunkts, die
> auseinanderlaufen können.

### Der Vorbehalt steht zweimal, und deshalb an EINER Stelle

Deckblatt und Schlusskapitel tragen denselben Satz; der CSS-Weg tut das ebenso (`print-cover.tsx`
und der Schlussabsatz in `report.tsx`), und der Grund ist derselbe: ein weitergereichter Report wird
von beiden Enden gelesen. Er ist ein Vorbehalt und keine Zahl (D16) — dass er zweimal steht, ist
richtig; dass er zweimal ANDERS stünde, wäre es nicht. Der Bildschirm hat wörtlich zwei Fassungen,
die sich um ein „Die" unterscheiden. Er steht deshalb ab jetzt in `content.ts`
(`REPORT_DISCLAIMER`), gelesen von Deckblatt und Schlusskapitel.

### ⚠ Kein `wrap={false}` am Hinweis — anders als bei `Statement`

Eine Kernaussage trägt eine feste Zahl von Zeilen und ist nachweislich kleiner als der Satzspiegel.
Ein Hinweis nicht: die Aufzählung des Blocker-Befunds führt die betroffenen Zeitbereiche, und wie
viele es sind, entscheidet die Datenlage. Ein `wrap={false}`-Block, der die Seite sprengt, wird von
react-pdf ABGESCHNITTEN statt umgebrochen — bei einem Befund über fehlende Preise wäre das ein
stiller Inhaltsverlust an genau der Stelle, die sagt, was fehlt. Der Preis ist ein Hinweis, der im
Ungünstigsten über einen Seitenwechsel läuft; dieselbe Abwägung steht bereits an `ResultsChapter`.

### Gemessen am erzeugten PDF

Zehn Läufe über die Prüfroute gegen den Production-Build, **326 Prüfungen, alle grün, 0
Konsolenfehler, 0 Seitenfehler**. Drei Prüffälle sind neu (`teiljahr_monat`, `luecke`,
`standardprofil`), dazu zwei, die je einen sonst unerreichbaren Zweig öffnen (`blocker_luecke`,
`foerderung`):

| | Hinweis | Datenqualität | Blocker | Preisstand | Tarifstand | Seiten |
|---|---|---|---|---|---|---|
| bestand | — | — | — | — | at-2026 | 15 |
| blocker | — | — | `unavailable`, 0 Bereiche | — | at-2026 | 13 |
| blocker_luecke | — | — | **`gap`, 1 Bereich** | — | at-2026 | 13 |
| katalog | — | — | — | — | **keiner** | 16 |
| teiljahr | — | — | — | — | at-2026 | 15 |
| zusatz | — | — | — | — | at-2026 | 16 |
| **teiljahr_monat** | **`partial_year`** | — | — | **ja** | at-2026 | 15 |
| **luecke** | **`large_gap`** | **ja** | — | — | at-2026 | 16 |
| **standardprofil** | **`standard_profile`** | **ja** | — | — | at-2026 | 16 |
| foerderung | — | — | — | — | at-2026 | 16 |

- **Jeder der drei Hinweise steht einmal ALLEIN**, und in den sieben übrigen Läufen kommt sein
  Wortlaut im gesamten PDF **0×** vor. Ein gemeinsamer Lauf mit allen dreien bewiese die
  Unabhängigkeit nicht: er bliebe auch dann grün, wenn zwei Bedingungen in Wahrheit an derselben
  Grösse hingen.
- **Der Hinweis steht auf DERSELBEN Seite wie die Kern-Kennzahl** (je gemessen, nicht angenommen).
- **Der Blocker-Befund ist gegen den ROHEN Contract-Wert gehalten**, nicht bloss auf Vorhandensein
  geprüft: Seite, Grund und die Zeitbereiche in Ortszeit gegen `side`/`kind`/`ranges` der Analyse
  (gemessen `spot_price · gap · 04.07.2025, 12:00 – 04.07.2025, 15:00`).
- **Die Annahmen-Tabelle ist gegen die ROHE `AnalysisResult`-Instanz gehalten** und unabhängig
  formatiert (de-AT Intl), nicht gegen die Ableitung, die sie erzeugt hat.
- **Agenda erneut gemessen**, jeder der SIEBEN Einträge gegen die tatsächliche erste Seite seines
  Kapitels (Titel und Vorspann unmittelbar hintereinander, D15). Alle 70 Zahlen treffen; „Seite X
  von Y" auf allen **151** Seiten der zehn Dokumente.
- **Der Vorbehalt steht in jedem Dokument genau 2× und wortgleich**, auf Seite 1 und auf der
  letzten Seite.

### ⚠ Zwei Prüffälle öffnen je einen sonst unerreichbaren Zweig

**`blocker_luecke`.** Der bestehende `blocker`-Fall fährt `spotPrices: null` und erzeugt damit
`kind: 'unavailable'` — dazu gibt es KEINE Bereiche (gemessen). `kind: 'gap'` ist der einzige Grund,
der Zeitbereiche trägt, und genau deren Darstellung wäre sonst gebaut und nie gemessen.

**`foerderung`.** Ohne Finanzparameter meldet `calculateRoi` `taxEffectsIncluded: false`, und
`netInvestment` ist Zahl für Zahl gleich `totalInvestment`. **Gemessen: eine Wächter-Probe, die das
eine gegen das andere tauscht, bleibt an solchen Daten GRÜN.** Erst mit einer echten Förderung
trennen sich die Werte (19.100 gegen 10.505), und erst dann ist die Zeile „Nettoinvestition" gegen
die richtige Grösse geprüft. Der Lauf erreicht zugleich den zweiten Zweig jener Zeile — die übrigen
neun zeigen dort „keine Angabe (nicht einbezogen)".

### ⚠ Drei Fehler in der PRÜFUNG, alle von einer Wächter-Probe gefunden

Sie sind der eigentliche Ertrag der Proben und stehen hier, weil sie sich wiederholen werden.

1. **Die Erwartung stammte aus dem geprüften Code.** Die erste Fassung verglich das PDF gegen das,
   was der Prüfstand anzeigt — und beides kommt aus DERSELBEN Ableitung. Mit entfernter
   `billingModel`-Bedingung blieb alles grün, weil die Erwartung mit dem Fehler mitwanderte. Sie
   steht jetzt als Tabelle in der Prüfung und folgt dem AUFBAU der Prüffälle.
2. **`indexOf` über das ganze Dokument traf den Fliesstext.** „Arbeitspreis" und
   „Abrechnungsmodell" stehen auch in den Kernergebnis-Aussagen; die erste Fundstelle ist deshalb
   regelmässig nicht die Tabellenzeile, und die Prüfung meldete Rot an einer Tabelle, die stimmt.
3. **ALLE Vorkommen zu durchsuchen war umgekehrt zu grosszügig.** Mit vertauschter Investitions-
   Zeile fand die Prüfung „Gesamtinvestition € 19.100" in der Kaufaussage des Empfehlungs-Kapitels
   wieder und blieb grün. Gesucht wird jetzt im ABSCHNITT der Tabelle.

**⚠ Dazu ein Extraktions-Artefakt, das keiner ist:** pdfjs zerlegt einen react-pdf-Textlauf an
Kerning-Stellen und setzt dort ein Leerzeichen — aus „04.07.2025" wird „04.07 .2025". Am Bild
gemessen überlappen die Glyphen (zweiter Lauf bei x = 87,8, erster endet bei x = 90,1); im PDF steht
keine Lücke. Verglichen wird deshalb ohne Leerzeichen.

**Sechs Wächter-Proben, jede bringt gezielt Rot:** (1) `billingModel`-Bedingung entfernt → **2** rot
im `teiljahr`-Lauf. (2) Lückenschwelle aufgehoben → **4** rot, „Grosse Datenlücke: 0 Tage" in Läufen
ohne Lücke. (3) Datenqualitäts-Kasten an `gapsInterpolated` statt an `warnings` → **2** rot, der
Kasten des Standardprofil-Laufs verschwindet. (4) Investitions-Zeilen vertauscht → **1** rot, und
zwar NUR im Förderungs-Lauf (s. o.). (5) Blocker ohne Zeitbereiche → **2** rot. (6) Schluss-Vorbehalt
eigenständig formuliert statt geteilt → **2** rot („1×" statt „2× wortgleich"). Danach jeweils
wiederhergestellt, 326/326 grün.

**⚠ Nebenbefund, zum dritten Mal:** eine Probe, die eine Konstante oder Funktion unbenutzt lässt,
bricht den BUILD an ESLint (`no-unused-vars`) — hier zweimal, und dann misst der Prüflauf den alten
Server statt Rot zu melden. Die Probe muss die Symbole referenziert lassen.

### Layout, am Bild gemessen

Ein Hinweis bei der Kern-Kennzahl schiebt die Kernaussagen darunter auf die Folgeseite (sie tragen
`wrap={false}`): das Kapitel läuft dann über zwei Seiten, und die erste bleibt zu rund 45 % leer.
Das ist die bekannte Eigenschaft, die `ResultsChapter` bereits benennt — die Folgeseite ist gut
gefüllt, die Agenda nennt weiterhin die erste. Der grosszügige Zeilenabstand des Kastens ist der des
Dokuments (an einer unveränderten Kernergebnis-Seite gegengeprüft) und keine Eigenheit des Hinweises.

### Bündelgrösse

`/rechner` First Load: roh **1.920.351 → 1.923.660** (+3.309), Chunk-Zahl **17 → 18**.
`/pdf-report-probe` roh **400.137 → 404.457**, unverändert 6 Chunks.

Es ist erneut Chunk-Graph-Buchhaltung, und sie ist ausgezählt: der Seiten-Chunk SCHRUMPFT von
201.727 auf 178.897 Bytes, ein Chunk (25.475) wird zu zweien (27.159 und 25.270), ein weiterer
verschiebt sich um rund 900 Bytes. **Gemessen über den GESAMTEN `/rechner`-First-Load-Satz:
`@react-pdf`, `fitRasterToWidth`, `buildBasisChapter`, `tariffVintageNote`, `buildNotices`,
„Annahmen und Datengrundlage" und „Grosse Datenlücke" kommen 0× vor**, `stunden-heatmap-raster`
genau 1× (Positivkontrolle) — es ist kein neuer Code auf der Route. Die gzip-Zahl dieser Route ist
zwischen zwei Builds ohnehin nicht stabil (D16: rund 120 Bytes Streuung); massgeblich ist die
Rohgrösse.

### `[OFFEN]` nach diesem Schritt

- **⚠ EIN Bildschirm-Inhalt fehlt im PDF und ist bewusst nicht ergänzt: der Hinweis zur GESCHÄTZTEN
  PV-Erzeugung** (`estimated-pv-note.tsx`, B22b). Er nennt Standort, kWp, Wetterjahre und die
  gemessene Streuung — und die stehen in `EstimatedPvSummary`, einer eigenen Prop des
  Bildschirm-Reports, nicht im Contract und nicht im Lastgang. `loadProfile.pvSource` sagt nur, DASS
  geschätzt wurde, nicht WOMIT; eine daraus gebaute Kurzfassung wäre eine zweite Formulierung
  desselben Befunds (D16). Wer ihn nachträgt, erweitert `PdfReportInput` um jene Zusammenfassung und
  braucht einen Prüffall mit echter PVGIS-Schätzung.
- **Der Fall „gar kein Kapitel" ist für beide bedingten Kapitel unverändert gebaut und ungemessen**
  (D16) — er gehört in die Abschluss-Prüfung vor dem Cutover, zusammen mit dem `pv_strong`-Rückfall
  des Energieflusses (D14).
- **Der Preisstand-Hinweis erscheint im Jänner nicht**, und das ist die richtige Antwort: die acht
  Monate vor einem Jänner enden im Vorjahr. Der Prüffall hängt als einziger an der heutigen Uhr; wer
  im Jänner prüft, misst dort den negativen Zweig.
- **Der Cutover ist NICHT Teil von B23c** und braucht eine eigene Entscheidung. Der Knopf im Rechner
  löst unverändert `window.print()` gegen das Print-Stylesheet aus; der react-pdf-Weg ist
  ausschliesslich über die unverlinkte, `noindex`-Route `/pdf-report-probe` erreichbar.
- **Die Data-URIs bleiben der teure Teil**: die PDFs wiegen jetzt 657–852 kB.

## D18 — B23c-5: der PV-Schätzungshinweis, und der letzte Bildschirm-Inhalt

**Gebaut am 04.09.2026.** Damit trägt das Dokument **alle** Inhalte des Bildschirm-Reports — der in
D17 als `[OFFEN]` benannte Hinweis zur geschätzten PV-Erzeugung (`estimated-pv-note.tsx`, B22b) ist
der letzte gewesen. Neu: ein VIERTER Hinweis bei der Kern-Kennzahl in `summary.ts`, ein
eigenständiges Contract-Feld und zwei Prüffälle, die die Schätzung LIVE bei PVGIS holen.

### Der Contract wächst um GENAU EIN Feld — und ausdrücklich AUSSERHALB des Analyse-Picks

`PdfReportInput.estimatedPv?: EstimatedPvSummary`. `PdfReportAnalysis` ist **unverändert** — zum
fünften Mal, und wieder ausgezählt.

Das ist keine Formfrage. Die Zusammenfassung steht an **keiner** Stelle im `AnalysisResult`, und
zwar strukturell: die Engine bekommt einen Lastgang, dem die geschätzte Erzeugung bereits abgezogen
ist (`applyEstimatedPv`, B22a) — WOMIT geschätzt wurde, erfährt sie nie. `loadProfile.pvSource` sagt
allein, DASS geschätzt wurde. Standort, Nennleistung, Wetterjahre und die für diese Anlage gemessene
Streuung gibt es nur hier. Am Bildschirm ist es genauso eine eigene Prop neben dem Ergebnis, und der
dortige Kommentar begründet es wörtlich gleich.

⚠ **Optional und nicht `null`-fähig** — anders als `tariffSource`. Dort ist „kein Stand gewählt" eine
eigenständige AUSSAGE (der Kunde hat die Werte aus seiner Netzrechnung, die bessere Grundlage). Hier
gibt es dieses Gegenstück nicht: „nicht geschätzt" ist die Abwesenheit einer Frage. `undefined` ⇒ der
Hinweis erscheint gar nicht, kein Platzhaltertext.

### Der vierte Hinweis — wortgleich, an derselben relativen Stelle

Er steht in `buildNotices` zwischen Standardprofil und Teiljahr, also an GENAU der Stelle, an der
`report.tsx` ihn führt. Beide Herkunfts-Hinweise zuerst (woraus der Verbrauch stammt, dann woraus die
Erzeugung stammt), danach die zwei Mängel am Umfang.

Übernommen sind beide Unsicherheiten, die der Bildschirm-Kommentar ausdrücklich als *zwei* benennt:

1. **Die Jahresstreuung** (± x %) — aus der ECHTEN PVGIS-Antwort dieser Anlage, nicht aus einer
   Konstanten. `spread === null` heisst „keine Angabe" und nicht „Streuung 0"; dann steht der Satz
   ohne Zahlen da, statt eine zu erfinden.
2. **Der systematische Aufschlag der Glättung** — über die IMPORTIERTE Konstante
   `PV_TEN_YEAR_SMOOTHING_OPTIMISM_PERCENT` und nicht als abgeschriebene Zahl. Ohne ihn läse sich
   das „±" wie eine symmetrische Unsicherheit, und das ist es nicht.

**Neutraler Ton, nicht Warnung** — wortgleich zum Bildschirm, wo dieser Kasten wie der
Standardprofil-Hinweis die Standard-Variante trägt. Eine geschätzte Erzeugungskurve ist kein Mangel
an den Daten, sondern eine andere Art von Grundlage.

⚠ **Er begründet NICHT, warum die Spitzenkappung entfällt.** Das sagt der Engine-Warnsatz zum Blocker
`estimated_pv` (`savings/attribute.ts`, in diesem Schritt mit 0 Zeilen Diff) dort, wo die € 0 steht.
Er STELLT die Folge fest, weil das der Satz ist, den der Bildschirm an dieser Stelle trägt.

### ⚠ Der Prüffall holt die Zahlen LIVE — und das ist keine Bequemlichkeit

`EstimatedPvSummary` besteht fast vollständig aus ANTWORTEN von PVGIS: Wetterjahre, zehn
Jahreserträge, die daraus gebildete Streuung, die zurückgespiegelten Azimut- und Neigungswerte. Eine
notierte Zusammenfassung wäre genau der zweite Zahlensatz, den `summary-fixtures.ts` in seinem Kopf
ausschliesst — der Hinweis sähe richtig aus, weil seine Zahlen danebenstehen, und ausgerechnet die
eine Grösse, um die es ihm geht, wäre erfunden.

`pv-estimate-fixture.ts` fährt deshalb den PRODUKTIONSWEG: `lookupPostalCodeCentroid` →
`pvArrayAzimuthDeg` → `fetchPvReferenceProfileAction` → `expandReferenceToTimestamps` →
`summarizeAnnualYields` → `applyEstimatedPv`/`buildEstimatedPvProfile`. Dieselbe Haltung wie
`analysis-run.ts`, wo der echte Analyse-Worker läuft statt einer zweiten Orchestrierung. **EINGABE
ist allein die Auslegung** (PLZ 1100, 4,25 kWp/90°/SO 133° und 5,95 kWp/35°/SW) — die Anlage aus dem
echten PV*SOL-Exposé, an dem B22c den Scan-Weg gemessen hat.

Preis: zwei Aufrufe à rund 8 MB, gemessen 19–20 s je Prüflauf gegen 1,4–2,4 s der übrigen.

### ⚠ Zwei PV-Prüffälle, und sie messen Verschiedenes

**`pv_schaetzung`** — gemessener Lastgang (`import_only`), der PV-Hinweis steht **ALLEIN**. Nur so
ist gemessen, dass er an `estimatedPv` hängt und nicht an `loadProfile.source`; dieselbe Überlegung,
aus der die drei B23c-4-Fälle je einzeln stehen.

⚠ Er trägt DENSELBEN Volljahrgang, nur ehrlich als `import_only` etikettiert statt `net_signed`. Das
Profil hat keinen einzigen negativen Wert — es ist ein Export ohne Einspeise-Spalte, und das ist
zugleich der EINZIGE Zustand, in dem der Generator überhaupt angeboten wird
(`pvGeneratorEligibility` weist `net_signed` mit `measured_feed_in` ab). Das alte Etikett wäre hier
nicht bloss ungenau, sondern die Behauptung eines Falls, den der Rechner nicht zulässt.

**`pv_standardprofil`** — Standardprofil H0 plus dieselbe Schätzung, der einzige Fall mit ZWEI
Hinweisen. Er misst, was ein einzeln stehender Hinweis nicht messen kann: **die Reihenfolge**. Er ist
zugleich der wichtigste Anwendungsfall des Generators und die Konfiguration, an der B22b ihn live
gemessen hat.

### Gemessen am erzeugten PDF

Sieben Läufe über die Prüfroute gegen den Production-Build, **72 Prüfungen, alle grün, 0
Konsolenfehler, 0 Seitenfehler**.

| Lauf | Hinweise | Seiten | kB | Dauer |
|---|---|---|---|---|
| **pv_schaetzung** | **`estimated_pv`** | 16 | 797 | 20,0 s |
| **pv_standardprofil** | **`standard_profile`, `estimated_pv`** | 17 | 956 | 19,1 s |
| bestand | — | 15 | 729 | 1,9 s |
| standardprofil | `standard_profile` | 16 | 852 | 1,6 s |
| luecke | `large_gap` | 16 | 708 | 2,4 s |
| teiljahr_monat | `partial_year` | 15 | 666 | 1,9 s |
| katalog | — | 16 | 838 | 1,4 s |

**Die PVGIS-Antwort, in beiden Läufen identisch:** Wetterjahre **2014–2023**, **10,2 kWp** auf **2**
Flächen, **1100 Wien, Favoriten**, zurückgespiegelter Azimut **−47 / +45**, Jahresertrag
**9.221,60 … 10.177,13 kWh, Mittel 9.740,94, ± 4,90473 %**. Der Azimut ist der Durchstich der
Konventions-Umrechnung Kompass → PVGIS end-to-end an echten Werten; Mittel und Streuung treffen die
in B22c dokumentierte Messung derselben Anlage (9.741 kWh ± 4,9 %).

- **Der Wortlaut ist gegen die ROHE `EstimatedPvSummary`-Instanz gehalten**, nicht bloss auf
  Vorhandensein geprüft: die Prüfung liest die ungerundeten Antwortwerte aus dem Prüfstand und
  formatiert sie UNABHÄNGIG (de-AT Intl) zu den drei Sätzen, die im PDF stehen müssen. Die
  Glättungs-Prozentzahl wird dabei aus der QUELLE von `packages/shared/src/pv-design.ts` gelesen —
  gegen die Ableitung gehalten wäre der Vergleich tautologisch (Lehre 1 aus D17).
- **In den fünf Läufen ohne Schätzung kommen Titel, Rumpf und Glättungssatz je 0× im ganzen PDF vor.**
- **Der Hinweis steht in beiden PV-Läufen auf DERSELBEN Seite wie die Kern-Kennzahl** (gemessen, nicht
  angenommen).
- **Die Reihenfolge ist gegen `report.tsx` gehalten und nicht gegen die eigene Ableitung:** die
  Prüfung liest die Quelldatei, sortiert die vier Kästen nach ihrer Position im JSX
  (`standard_profile, estimated_pv, partial_year, large_gap`) und misst dieselbe Folge im PDF. Im
  Fliesstext des `pv_standardprofil`-Laufs: Kern-Kennzahl @1244 → Standardprofil @1333 → PV @1856 →
  erste Kernaussage @4439.
- **Agenda erneut gemessen**, jeder genannte Eintrag gegen die tatsächliche erste Seite seines
  Kapitels; „Seite X von Y" auf allen Seiten aller sieben Dokumente.

### Vier Wächter-Proben, jede bringt gezielt Rot

1. **`document.tsx` reicht `estimatedPv` nicht durch** → **7** rot, alle im PV-Lauf; `bestand` bleibt
   grün, das PDF schrumpft von 16 auf 15 Seiten. ⚠ Der Prüfstand meldet dabei WEITERHIN
   `estimated_pv` — die Ableitung läuft ja —, während das Dokument den Hinweis gar nicht trägt.
   Genau diese Divergenz zwischen Anzeige und Ausgabe fängt die Probe.
2. **Reihenfolge in `buildNotices` vertauscht** (PV vor Standardprofil) → **genau 2** rot, und zwar
   NUR im `pv_standardprofil`-Lauf; `pv_schaetzung` bleibt korrekt grün. Das ist zugleich der
   Beleg, dass ein einzeln stehender Hinweis die Reihenfolge nicht messen kann — beide Prüffälle
   werden gebraucht.
3. **Die Glättungszahl aus der Streuung statt aus der Konstanten bezogen**, bei gleichzeitig auf
   7,3 gesetzter Konstante → **genau 1** rot, und im PDF steht „rund **4,9 %**" statt „rund 7,3 %".
   Damit sind die zwei Prozentzahlen als VERSCHIEDEN BEQUELLT nachgewiesen, obwohl sie im
   ungestörten Lauf identisch drucken. Die Konstante bleibt in der Probe referenziert — sonst
   bricht ESLint den Build, und dann misst der Prüflauf den alten Server (Nebenbefund D17, zum
   vierten Mal).
4. **Der Modulflächen-Halbsatz entfällt** (`arrayCount > 1` aufgehoben) → **genau 1** rot; „aufgeteilt
   auf 2 Modulflächen" verschwindet aus dem Rumpf.

Danach jeweils wiederhergestellt, 72/72 grün.

### ⚠ Ein Zufall dieser Auslegung, der eine Prüfung schwächt

**Beide Prozentzahlen des Hinweises drucken „4,9 %"**: die gemessene Streuung ist 4,90473 %, die
Glättungs-Konstante 4,9 — auf eine Nachkommastelle fallen sie zusammen. Eine Prüfung, die nur nach
der ZAHL suchte, könnte die zwei an dieser Anlage nicht auseinanderhalten. Die Prüfung vergleicht
deshalb **ganze Sätze**, und die unterscheiden sich vollständig; zusätzlich trennt Wächter-Probe 3
die Quellen (s. u.). **Wer diesen Prüffall je auf eine andere Auslegung stellt, gewinnt die
Unterscheidung von selbst zurück.**

### Bündelgrösse

`/rechner` First Load: roh **1.923.660 → 1.923.160** (**−500**), Chunk-Zahl **18 → 19**.
`/pdf-report-probe` roh **404.457 → 405.849**, unverändert 6 Chunks.

Die Rohgrösse der Kundenroute SINKT, und das ist wieder Chunk-Graph-Buchhaltung: der Seiten-Chunk
schrumpft von 178.897 auf 178.771 Bytes, ein weiterer Chunk (25,4 kB) kommt hinzu. **Gemessen über
den GESAMTEN `/rechner`-First-Load-Satz: `@react-pdf`, `fitRasterToWidth`, `buildEstimatedPvNotice`,
`buildEstimatedPvProbe`, „PV-Erzeugung geschätzt", „geschätzten Erzeugungskurve", „Annahmen und
Datengrundlage" und `buildBasisChapter` kommen 0× vor**, `stunden-heatmap-raster` genau 1×
(Positivkontrolle) — es ist kein neuer Code auf der Route. Die Baseline ist durch Stashen von
`apps/website` erhoben worden und trifft die D17-Zahlen bit-genau.

### `[OFFEN]` nach diesem Schritt

- **Das Dokument hat inhaltliche Parität mit dem Bildschirm-Report.** Damit ist B23c abgeschlossen;
  was bleibt, ist die Entscheidung über den **Cutover** — der ist ausdrücklich NICHT Teil von B23c.
  Der Knopf im Rechner löst unverändert `window.print()` aus.
- **Der Fall „gar kein Kapitel" ist für beide bedingten Kapitel unverändert gebaut und ungemessen**
  (D16), ebenso der `pv_strong`-Rückfall des Energieflusses (D14) — beides gehört in die
  Abschluss-Prüfung vor dem Cutover.
- **Die beiden PV-Prüffälle brauchen NETZ.** Ohne Erreichbarkeit von PVGIS scheitern sie mit einer
  benannten Meldung statt still auf notierte Zahlen zurückzufallen — das ist Absicht, macht sie aber
  zu den einzigen Prüfläufen, die von einem fremden Dienst abhängen.
- **Die Prüfroute hat kein `maxDuration`.** Lokal gegen `next start` ist das folgenlos; auf einem
  Vercel-Deployment würde die Server Action des Proxys an der Plattformgrenze abgeschnitten (die
  Falle aus B22c). Wer die Prüfroute je dort fahren will, setzt es in `app/pdf-report-probe/page.tsx`
  — in einer `page`-Datei, nicht in `'use server'`.
- **Der Preisstand-Hinweis erscheint im Jänner nicht** (unverändert aus D17).

---

## D19 — Wie lange eine Erzeugung dauert (Messreihe, keine Umsetzung)

**Reine Messung.** Dieser Schritt ändert weder Dokumentinhalt noch Chart-Auswahl noch Reihenfolge
noch Contract; er baut keinen Ladezustand, kein UI und keine Fehlerbehandlung für gescheiterte
Erzeugungen. Er liefert die Zahlen, auf deren Grundlage über beides **getrennt** zu entscheiden ist,
und enthält deshalb bewusst **keine Empfehlung**.

### Was instrumentiert wurde — und warum es stehen bleibt

`performance.now()` an den Phasengrenzen, sonst nichts:

- `charts.tsx` misst je Rasterung (`figureMs`). `null` heisst „für diesen Fall gar nicht gerastert";
  ein **Fehlschlag trägt sehr wohl eine Zahl**, weil er Zeit kostet — beim Rastern sogar am meisten,
  denn der teuerste Fehlschlag ist eine abgelaufene Wartezeit.
- `render.tsx` misst Font-Registrierung, Rasterung gesamt und **jeden Renderdurchlauf einzeln**
  (`ReportRenderTimings`).
- `download.ts` misst zusätzlich den dynamischen Import (`importMs`) — den Teil, den
  `renderReportPdf` selbst nicht sehen kann — und die Gesamtzeit von der ersten Zeile bis zum
  fertigen Blob.
- Der Prüfstand zeigt alles an; die Werte steuern **nichts** und werden nirgends verzweigt.

Sie bleiben dauerhaft im Code, aus demselben Grund wie `chartBuilds` und `captureMs`: eine Zahl, die
niemand messen kann, ist eine Behauptung — und die nächste Messung ist damit kostenlos.

**Bündelgrösse, gemessen:** `/rechner` First Load roh **1.923.160 Bytes, 19 Chunks** — **bit-genau
die D18-Zahl**, die Instrumentierung kostet die Kundenroute also exakt null Bytes. Über den GESAMTEN
`/rechner`-First-Load-Satz kommen `@react-pdf`, `importMs`, `figureMs`, `passMs`,
`ReportRenderTimings` und `probe-timing-total` **0×** vor, `stunden-heatmap-raster` genau 1×
(Positivkontrolle). `/pdf-report-probe` roh **405.849 → 406.840** (die Anzeigetexte), unverändert
6 Chunks. `ReportRenderTimings` steht **0×** in beiden Bündeln — der Typ-Import in `download.ts` ist
`import type` und wird restlos entfernt; ein Wert-Import zöge den Lazy-Chunk in jede Seite, die die
Datei liest.

### ⚠ Zwei Annahmen der Aufgabenstellung sind falsch — gemessen, nicht abgeleitet

**(a) Es sind höchstens SECHS Rasterungen je Dokument, nicht sieben.** Der Bildschirm-Report führt
sieben Grafiken, aber Monatsvergleich und kumulierter Kostenvergleich schliessen einander aus
(D14) — ein Dokument sieht immer nur eine von beiden. Genau so steht es seit D16 im Kopf von
`render.tsx` („bis zu SECHS"), und die Messung bestätigt es: `builds` ist in allen 60 Läufen 6 bzw. 5,
nie 7.

**(b) Der grösste Fall ist NICHT der Bestandsfall mit Zusatzspeicher-Tabelle, sondern der
Katalog-Fall.** `zusatz` trägt nur **fünf** Rasterungen: seine Bestandsanlage ist `static`, der Trace
gibt deshalb gar keinen Tag her, und der Tages-Energiefluss entfällt (D14). Ausgerechnet dieses
fehlende Bild ist das mit Abstand teuerste (s. u.). Gemessen wurden deshalb **drei** Fälle:

| Fall | Rasterungen | Seiten |
| --- | --- | --- |
| `katalog` | **6** | 16 |
| `pv_standardprofil` | **6** | **17** (die meisten) |
| `zusatz` (Zusatzspeicher-Tabelle) | 5 | 16 |

### Methode

Production-Build (`next start`, Port 4993), Chromium über Playwright, die Prüfroute
`/pdf-report-probe`. Gemessen wird **ausschliesslich die Erzeugung** — der Rechenlauf davor ist
nicht enthalten, er geht im echten Ablauf ohnehin voraus.

- **warm** = zweite und jede weitere Erzeugung in DERSELBEN Sitzung. Der erste Lauf jeder
  warmen Sitzung wird verworfen und getrennt als kalter berichtet.
- **kalt** = je Wiederholung ein **frischer Browser-Kontext** (eigener Cache, eigener Modulzustand),
  also Lazy-Chunk und Schriftdateien ungeladen.
- **5 Wiederholungen je Konfiguration**, berichtet als **Minimum / Median / Maximum**. Eine
  Einzelmessung ist nach der Bündelgrössen-Erfahrung aus D16 (Streuung als vermeintliches Signal)
  nicht belastbar.
- **CPU-Drosselung 4×** über CDP `Emulation.setCPUThrottlingRate` — als untere Schranke für ein
  durchschnittliches Kundengerät, nicht als Abbild eines bestimmten.
- 3 Fälle × kalt/warm × 1×/4× = **12 Konfigurationen, 60 gemessene Erzeugungen** (plus 6 verworfene
  Erstläufe). **0 Konsolenfehler, 0 Seitenfehler.** In **allen 60** Läufen `passes = 2` — der
  Wächter-Durchlauf ist nie eingetreten.

### Die Zahlen (min / Median / max, in ms)

**`katalog` — 6 Rasterungen, 16 Seiten**

| Phase | warm 1× | kalt 1× | warm 4× | kalt 4× |
| --- | --- | --- | --- | --- |
| **Gesamt (Klick → Blob)** | 5012 / **5034** / 5098 | 5518 / **5619** / 5792 | 14927 / **14943** / 15316 | 17293 / **18077** / 18594 |
| Lazy-Chunk | 0 / 0 / 0 | 92 / 96 / 166 | 0 / 0 / 0 | 262 / 266 / 320 |
| Fonts registrieren | 0 / 0 / 0 | 0 / 0,1 / 0,1 | 0 / 0 / 0 | 0 / 0 / 0,1 |
| Rasterung gesamt | 2065 / **2078** / 2078 | 2105 / 2118 / 2172 | 3292 / **3293** / 3336 | 3600 / 3739 / 3955 |
| Durchlauf 1 (messen) | 1502 / **1519** / 1592 | 1861 / **1934** / 1989 | 5821 / **5893** / 5960 | 7466 / **8106** / 8229 |
| Durchlauf 2 (final) | 1419 / **1431** / 1450 | 1427 / 1465 / 1480 | 5750 / **5770** / 6032 | 5928 / 5995 / 6498 |

**`pv_standardprofil` — 6 Rasterungen, 17 Seiten**

| Phase | warm 1× | kalt 1× | warm 4× | kalt 4× |
| --- | --- | --- | --- | --- |
| **Gesamt (Klick → Blob)** | 4894 / **4930** / 4986 | 5522 / **5546** / 5564 | 14895 / **15031** / 15213 | 17589 / **17705** / 18863 |
| Lazy-Chunk | 0 / 0 / 0 | 88 / 92 / 100 | 0 / 0 / 0 | 270 / 274 / 281 |
| Rasterung gesamt | 2076 / 2084 / 2109 | 2122 / 2127 / 2130 | 3359 / 3377 / 3438 | 3630 / 3701 / 3733 |
| Durchlauf 1 (messen) | 1425 / 1446 / 1477 | 1861 / 1894 / 1917 | 5826 / 5921 / 5964 | 7640 / 7843 / 8310 |
| Durchlauf 2 (final) | 1374 / 1386 / 1426 | 1430 / 1432 / 1439 | 5710 / 5754 / 5811 | 5871 / 5992 / 7005 |

**`zusatz` — 5 Rasterungen, 16 Seiten**

| Phase | warm 1× | kalt 1× | warm 4× | kalt 4× |
| --- | --- | --- | --- | --- |
| **Gesamt (Klick → Blob)** | 3002 / **3062** / 3107 | 3606 / **3683** / 3701 | 12027 / **12152** / 12720 | 14390 / **14488** / 14565 |
| Lazy-Chunk | 0 / 0 / 0 | 88 / 94 / 97 | 0 / 0 / 0 | 254 / 262 / 266 |
| Rasterung gesamt | 461 / **477** / 494 | 505 / 510 / 534 | 1590 / **1625** / 1667 | 1809 / 1833 / 1869 |
| Durchlauf 1 (messen) | 1298 / 1314 / 1342 | 1719 / 1753 / 1765 | 5286 / 5340 / 5360 | 7027 / 7069 / 7081 |
| Durchlauf 2 (final) | 1227 / 1265 / 1285 | 1284 / 1319 / 1331 | 5150 / 5223 / 5702 | 5250 / 5322 / 5370 |

**Je Bild** (Median; `katalog`, das Feld mit allen sechs):

| Bild | warm 1× | kalt 1× | warm 4× | kalt 4× | Faktor 4×/1× (warm) |
| --- | --- | --- | --- | --- | --- |
| **Tages-Energiefluss** | **1578** | 1595 | **1674** | 1707 | **1,06** |
| Stunden-Heatmap (nur Raster) | 231 | 245 | 875 | 1008 | 3,79 |
| Lastgang | 112 | 129 | 364 | 498 | 3,25 |
| Ø-Ladepreis | 53 | 49 | 129 | 169 | 2,43 |
| Kostenvergleich | 52 | 59 | 145 | 198 | 2,79 |
| Grenznutzen-Kurve | 48 | 48 | 108 | 139 | 2,25 |

Die Summe der sechs (2074 ms) trifft `Rasterung gesamt` (2078 ms) — der Rest ist die Ableitung der
Chart-Pläne davor.

### ⚠ Was die Zahlen sagen — vier Befunde

**1. Ein einziges Bild macht drei Viertel der Rasterung aus, und es RECHNET dabei nicht.** Der
Tages-Energiefluss kostet 1578 von 2078 ms und wächst unter vierfacher Drosselung um **6 %**, während
jedes andere Bild um den Faktor 2,3 bis 3,8 wächst. Es ist also **Wartezeit, keine Rechenzeit**:
`waitForStableRender` (D14) wartet die Einblend-Animation von react-smooth ab, und der Energiefluss
ist der einzige Report-Chart, der sie behält (§6.2 erlaubt ihm als einzigem „leichte Interaktion/
Animation"). Genau daher stammt der ganze Abstand zwischen `katalog` (5034 ms) und `zusatz`
(3062 ms) — der zweite Fall zeigt dieses Bild nicht.

**2. Der Messdurchlauf ist NICHT billiger als der finale.** 1519 gegen 1431 ms (warm 1×), 5893 gegen
5770 ms (warm 4×). Der Zwei-Durchlauf-Entwurf aus D5 — die Voraussetzung dafür, dass die Agenda echte
Seitenverweise trägt — kostet damit rund eine **Verdopplung** der Renderzeit, und ein
Wächter-Durchlauf käme mit demselben Betrag noch einmal obendrauf.

**3. `fontsMs` ist null, die Schrift kostet trotzdem.** Die Registrierung selbst liegt bei 0…0,1 ms;
GEHOLT werden die drei WOFF-Dateien erst im ersten Durchlauf, der sie braucht. Sichtbar wird das
ausschliesslich in der Differenz: **Durchlauf 1 kalt 1934 gegen warm 1519 ms ≈ 415 ms** (`zusatz`:
1753 gegen 1314 ≈ 439 ms). Zusammen mit dem Lazy-Chunk ergibt das einen **Kalt-Aufschlag von rund
0,6 s bei 1× und 2,4 bis 3,1 s bei 4×** — ein Kunde, der den Report zweimal zieht, erlebt nur den
zweiten Wert.

**4. Die Seitenzahl ist fast irrelevant, die Zahl der Bilder nicht.** `pv_standardprofil` trägt eine
Seite MEHR als `katalog` und ist mit 4930 gegen 5034 ms nicht langsamer. Was zählt, sind die Bilder:
ein Bild weniger (`zusatz`) spart knapp zwei Sekunden. Unter Drosselung skalieren die Renderdurchläufe
um den Faktor ~3,9 (CPU-gebunden), die Rasterung nur um ~1,6 (durch den Energiefluss
wanduhr-gebunden).

### ⚠ Was NICHT gemessen ist

- **Ein echtes Kundengerät.** Die 4×-Drosselung ist eine untere Schranke, kein Abbild eines
  bestimmten Telefons oder Laptops; gemessen wurde auf der Entwicklungsmaschine.
- **Eine echte Leitung.** Lazy-Chunk und Schriftdateien kommen über die Loopback-Schnittstelle. Der
  Kalt-Aufschlag ist damit die **günstigste** Fassung des kalten Falls; über eine echte Verbindung
  liegt er höher (der Chunk misst laut Spike §3 ≈ 307 kB gzip).
- **Der Wächter-Durchlauf.** Er ist in keinem der 60 Läufe eingetreten; nach Befund 2 wäre er rund
  +1,4 s (1×) bzw. +5,8 s (4×).
- **Die übrigen zehn Prüffälle**, der Spitzenspeicherbedarf und die Dateigrösse des Ergebnisses.

### `[OFFEN]` nach diesem Schritt

- **Ladezustand und UI am Kunden-Knopf** sind ausdrücklich NICHT Teil dieser Messung und getrennt zu
  entscheiden.
- **Eine Fehlerbehandlung für gescheiterte Erzeugungen** gibt es weiterhin nicht — offener Punkt aus
  dem Cutover-Gespräch, nicht Gegenstand dieses Schritts.
- Alle `[OFFEN]`-Punkte aus D18 gelten unverändert weiter; der Knopf im Rechner löst nach wie vor
  `window.print()` aus.

---

## D20 — Die Einblend-Animation für den Rasterungspfad abschalten (Messreihe mit A/B)

**Ein Prop, ein Konsument.** `EnergyFlowChart` bekommt ein optionales `disableAnimation` (Standard
`false`); gesetzt wird es an **genau einer** Stelle im ganzen Repo — dem Mount-Aufruf der Rasterung
in `charts.tsx`. Der Bildschirm-Aufruf (`report.tsx`, zwei Stellen) setzt es NICHT und hat
**0 Zeilen Diff**. Weder Dokumentinhalt noch Chart-Auswahl, Reihenfolge, Contract,
Zwei-Durchlauf-Mechanismus noch Layout ändern sich; es entsteht kein Ladezustand und keine
Fehlerbehandlung, und der Kunden-Knopf löst unverändert `window.print()` aus.

### Warum überhaupt

D19 Befund 1: der Tages-Energiefluss kostet **1578 von 2078 ms** der gesamten Rasterung und wächst
unter vierfacher CPU-Drosselung nur um 6 %, während jedes andere Bild um den Faktor 2,3 bis 3,8
wächst. Es ist also **Wartezeit, keine Rechenzeit** — `waitForStableRender` (D14) wartet die
Einblend-Animation von react-smooth ab, und der Energiefluss ist der einzige Report-Chart, der sie
behält (§6.2 erlaubt ihm als einzigem „leichte Interaktion/Animation").

**Auf einem Blatt Papier gibt es keine Animation.** Sie abseits des Sichtfelds abzuwarten ist
Wartezeit ohne jede Wirkung auf das Ergebnis.

### Umgesetzt als Spread eines leeren Objekts

Im Bildschirmfall wird `{}` gespreadet, im Rasterungsfall `{ isAnimationActive: false }`. Damit
bekommen die vier Datenreihen am Bildschirm **bit-identisch dieselben Props wie zuvor**. Ein
explizites `isAnimationActive={true}` wäre heute gleichwertig, hinge aber am Standardwert von
recharts und wäre eine Aussage, die diese Datei nicht treffen muss.

**`waitForStableRender` bleibt unverändert in Kraft und wird ausdrücklich NICHT umgangen** — es
prüft weiterhin beide Anfangszustände (Clip-Breite 0, `stroke-dasharray="0px …"`) und den
Stillstand, findet sie hier nur sofort erfüllt. Der Schalter, den D14 als „warte, wenn dieser Chart
animiert" verworfen hat, entsteht damit nicht: die Wartelogik weiss weiterhin nichts von der
Animation einer fremden Komponente.

### Methode — wortgleich zu D19, aber als A/B auf DERSELBEN Maschine in DERSELBEN Sitzung

Die D19-Zahlen sind nicht als Vergleichsgrundlage übernommen, sondern **neu gemessen**: der
pristine Stand wurde gestasht, neu gebaut und vollständig durchgemessen (VORHER), danach derselbe
Durchlauf mit der Änderung (NACHHER). Sonst wäre der Vergleich einer gegen eine Notiz.

Production-Build (`next start`), Chromium über Playwright, Prüfroute `/pdf-report-probe`,
3 Fälle × kalt/warm × 1×/4×, **5 Wiederholungen je Konfiguration**, Median berichtet. Je
Wiederholung ein **frischer Browser-Kontext**: die erste Erzeugung darin ist die KALTE Stichprobe,
die zweite die WARME. CPU-Drosselung über CDP `Emulation.setCPUThrottlingRate`, gesetzt **nach** dem
Rechenlauf und **vor** der ersten Erzeugung — gemessen wird ausschliesslich die Erzeugung.

**Je Stand 60 gemessene Erzeugungen, zusammen 120. In beiden Ständen: 0 Konsolenfehler,
0 Seitenfehler, `passes = 2` durchgehend, `builds` 6/6/5 und Seiten 16/17/16** — die strukturellen
D19-Feststellungen reproduzieren unverändert.

### Die Zahlen (Median, VORHER → NACHHER)

**`katalog` — 6 Rasterungen, 16 Seiten**

| Phase | warm 1× | kalt 1× | warm 4× | kalt 4× |
| --- | --- | --- | --- | --- |
| **Gesamt (Klick → Blob)** | 5033 → **3440** (−31,7 %) | 5597 → **4006** (−28,4 %) | 15737 → **14469** (−8,1 %) | 17944 → **16323** (−9,0 %) |
| Rasterung gesamt | 2100 → **553** (−73,7 %) | 2126 → **581** (−72,7 %) | 3510 → **1950** (−44,4 %) | 3732 → **2130** (−42,9 %) |
| Durchlauf 1 (messen) | 1505 → 1503 | 1899 → 1879 | 6157 → 6405 | 7727 → 7689 |
| Durchlauf 2 (final) | 1412 → 1396 | 1480 → 1442 | 5998 → 5912 | 6086 → 5959 |
| **Bild Tages-Energiefluss** | 1582 → **47** (−1535) | 1592 → **47** (−1545) | 1687 → **143** (−1544) | 1713 → **184** (−1529) |
| Bild Stunden-Heatmap | 244 → 233 | 247 → 246 | 937 → 990 | 1008 → 986 |
| Bild Lastgang | 115 → 120 | 129 → 129 | 409 → 395 | 497 → 514 |

**`pv_standardprofil` — 6 Rasterungen, 17 Seiten**

| Phase | warm 1× | kalt 1× | warm 4× | kalt 4× |
| --- | --- | --- | --- | --- |
| **Gesamt (Klick → Blob)** | 5042 → **3660** (−27,4 %) | 5542 → **4168** (−24,8 %) | 15549 → **14083** (−9,4 %) | 17848 → **16394** (−8,1 %) |
| Rasterung gesamt | 2117 → **579** (−72,6 %) | 2140 → **609** (−71,5 %) | 3565 → **2016** (−43,5 %) | 3692 → **2180** (−41,0 %) |
| **Bild Tages-Energiefluss** | 1584 → **49** (−1535) | 1588 → **48** (−1540) | 1680 → **136** (−1544) | 1692 → **151** (−1541) |

**`zusatz` — 5 Rasterungen, 16 Seiten, KEIN Energiefluss-Bild**

| Phase | warm 1× | kalt 1× | warm 4× | kalt 4× |
| --- | --- | --- | --- | --- |
| **Gesamt (Klick → Blob)** | 3040 → 3188 (**+4,9 %**) | 3585 → 3723 (**+3,8 %**) | 12036 → 12506 (**+3,9 %**) | 14243 → 15181 (**+6,6 %**) |
| Rasterung gesamt | 467 → 517 | 505 → 527 | 1652 → 1769 | 1803 → 1941 |
| Bild Tages-Energiefluss | — | — | — | — |

### ⚠ Drei Befunde

**1. Der Rückgang IST die ausgewartete Animation — auf die Millisekunde, nicht ungefähr.** Der
Absolutbetrag ist über **alle acht** Konfigurationen (zwei Fälle × vier Konfigurationen) praktisch
konstant: **1529 bis 1545 ms**, Streubreite 16 ms. Genau das sagt „Wartezeit" vorher und
„Rechenzeit" nicht: eine CPU-gebundene Ersparnis müsste unter vierfacher Drosselung mitwachsen, sie
tut es nicht. Gegengeprüft an der Quelle statt behauptet: `Area` und `Line` tragen in recharts 3.9.2
`animationDuration: 1500`; die drei Frames, die `waitForStableRender` zusätzlich verlangt, sind bei
60 Hz rund 50 ms. **1500 + 50 ≈ 1535.** Ein anderer, zufälliger Effekt könnte diese Zahl nicht
treffen.

**2. ⚠ `zusatz` ist um 3,8 bis 6,6 % LANGSAMER geworden — und das ist die wichtigste Zahl der
Messreihe.** Dieser Fall zeigt den Energiefluss gar nicht (`flow: null`, D19 Befund b), die Änderung
kann ihn also nicht erreichen. Der Zuwachs ist **Drift zwischen den zwei rund 45 Minuten
auseinanderliegenden Läufen**, nicht Wirkung. Er ist damit die unfreiwillige, aber belastbarste
Negativkontrolle der ganzen Reihe: er **beziffert das Rauschen** dieses Aufbaus mit rund **±5 %**.
Die Ersparnis der beiden anderen Fälle (25 bis 32 % bei 1×) liegt weit ausserhalb; korrigiert man um
die Drift, ist der wahre Gewinn eher grösser als gemessen. Wer diese Reihe wiederholt, misst
`zusatz` mit und **liest daran zuerst ab, wie vergleichbar die zwei Läufe überhaupt sind**.

**3. Die Ersparnis fällt durch bis zur Gesamtzeit, und die Renderdurchläufe bleiben unberührt.**
Durchlauf 1 und 2 bewegen sich um höchstens 4 % und in beide Richtungen — also im Driftband aus
Befund 2. Der relative Gewinn ist bei **1×** am grössten (rund ein Drittel), weil dort die
Rasterung den grössten Anteil hat; bei **4×** bleibt der Betrag derselbe, macht aber nur noch 8 bis
9 % aus, weil die CPU-gebundenen Renderdurchläufe dann dominieren.

### Verifikation — der Bildschirm-Chart animiert unverändert

Gemessen wird die Mechanik selbst, auf die auch `isStillDrawing` wartet: ein rAF-Sampler läuft
durchgehend ab dem Klick auf „Analyse starten" und zählt, in wie vielen Frames die Energiefluss-
KARTE ein Clip-Rechteck der Breite 0 bzw. ein mit `0px` beginnendes `stroke-dasharray` trägt. Der
Sampler ist auf die Karte eingegrenzt: jeder andere Report-Chart setzt `isAnimationActive={false}`
und könnte diese Marken gar nicht erzeugen — dokumentweit gezählt wäre es trotzdem eine Aussage über
alle Charts statt über diesen einen. Voller 4-Schritt-Durchlauf über `/rechner` mit
`demo-baeckerei-lastgang-2025.csv`, je 0 Konsolen- und Seitenfehler.

| Stand | Frames mit Clip-Breite 0 | Frames mit `0px …` | Frames mit Karte |
| --- | --- | --- | --- |
| VORHER (pristine) | **8** | **8** | 303 |
| NACHHER (diese Änderung) | **8** | **8** | 303 |
| Negativkontrolle: `disableAnimation` am BILDSCHIRM-Aufruf | **0** | **0** | 303 |

Die Negativkontrolle ist der Teil, der die zwei Achten erst zu einer Aussage macht: sie zeigt, dass
der Sampler auf 0 gehen KANN und die Marken nicht ohnehin immer zählt. Danach war `report.tsx`
wiederhergestellt (0 Zeilen Diff).

### Verifikation — Bündel

`/rechner` First Load roh **1.923.160 → 1.923.232 Bytes** (**+72**), unverändert **19 Chunks**;
`/pdf-report-probe` roh **406.840 → 406.840**, unverändert 6 Chunks. Die Vorher-Zahl ist durch
Stashen und Neubauen **selbst gemessen** und trifft die D19-Zahl bit-genau — sie ist nicht aus dem
Handover übernommen. Die 72 Bytes sind der Prop-Name, den die BILDSCHIRM-Fassung mitträgt;
`animationProps` kommt 0× vor (der Minifizierer benennt die lokale Konstante um). Über den GESAMTEN
`/rechner`-First-Load-Satz: `@react-pdf` **0×** (unverändert), `disableAnimation` **0× → 1×**,
`stunden-heatmap-raster` genau 1× (Positivkontrolle).

### ⚠ Was NICHT gemessen ist

- **Ein echtes Kundengerät und eine echte Leitung** — unverändert die D19-Einschränkungen.
- **Der Wächter-Durchlauf** ist in keinem der 120 Läufe eingetreten.
- **Die übrigen neun Prüffälle**, der Spitzenspeicherbedarf und die Dateigrösse.
- **Ob die Erzeugung damit schnell genug ist.** Diese PR liefert eine Zahl, keine Bewertung.

### `[OFFEN]` nach diesem Schritt

- **Der grösste verbleibende Posten sind jetzt die zwei Renderdurchläufe** (zusammen rund 2,9 s warm
  1×, 12,3 s warm 4× im `katalog`-Fall) und darin der Messdurchlauf, den D5 für die Seitenverweise
  der Agenda braucht — D19 Befund 2 gilt unverändert.
- **Ladezustand und UI am Kunden-Knopf**, **Fehlerbehandlung für gescheiterte Erzeugungen** und der
  **Cutover** sind weiterhin getrennt zu entscheiden; alle `[OFFEN]`-Punkte aus D18/D19 gelten fort.

---

## D21 — Cutover Teil 1: der neue Weg wird bedienbar, hinter einem Schalter mit Vorgabe AUS

**Diese PR schaltet NICHTS um.** Sie macht den react-pdf-Weg zum ersten Mal aus dem echten
Kunden-Auslöseweg heraus erreichbar — und zwar ausschliesslich, wenn eine Umgebungsvariable
ausdrücklich auf einen Wert gesetzt wird, den kein Deployment heute trägt. Bis dahin verhält sich
der Rechner Zeile für Zeile wie vorher; D9 („der neue Weg ist NICHT live") bleibt damit für jede
bestehende Umgebung gültig, verliert aber seine Unbedingtheit: der Weg IST jetzt einschaltbar.

### Die sechs Entscheidungen dieses Schritts

**(1) Ladezustand — Pflicht, und ausdrücklich ohne Phasen oder Prozent.** D19/D20 haben gemessen,
was eine Erzeugung kostet: **3,4–4,7 s** je nach Fall und Cache-Lage, unter vierfacher CPU-Drosselung
das Dreifache. Der Kopf von `download.ts` verlangt deshalb seit B23a einen Ladezustand („sonst sieht
ein Klick, der ein paar hundert Millisekunden nichts tut, wie ein toter Knopf aus"). Umgesetzt sind
drei Dinge zusammen: der Knopf ist **gesperrt**, er trägt die Beschriftung „Report wird erzeugt …"
samt Spinner, und darunter steht ein `role="status"`-Satz, der sagt, was geschieht und dass der
Download von selbst startet.

**Kein Fortschrittsbalken, und das ist begründet:** was ein Dokument kostet, hängt an der Zahl der
Bilder (fünf oder sechs — D19 Befund (a)) und an der Seitenzahl, die erst der Messdurchlauf kennt
(D5). Ein Balken, der bei 80 % stehenbleibt, weil dieser Lauf ein Bild mehr trägt, ist schlechter
als gar keiner.

**(2) Fehlerfall — eine Meldung mit Wiederholung, und AUSDRÜCKLICH KEIN stiller Rückfall auf
`window.print()`.** Die zwei Wege tragen verschiedene Felder (Titel und Adresse gibt es nur im
neuen) und verschiedene Seitenumbrüche; ein Ausdruck, der nach einem Fehlschlag heimlich der andere
ist, wäre ein anderes Dokument unter demselben Knopf — und niemand könnte im Nachhinein sagen,
welches der Kunde in der Hand hält. Der Fehlerblock nennt zuerst die Handlungsanweisung, dann die
technische Ursache als untergeordnete Zeile („Loading chunk 429 failed" sagt einem Bäcker nichts,
einem Support-Anruf dagegen alles); ohne verwertbare Meldung fehlt die zweite Zeile ganz.

**(3) Der Rückfallschalter IST der Schalter.** `NEXT_PUBLIC_PDF_REPORT_ENGINE=react-pdf` schaltet
ein; **jeder andere Wert — nicht gesetzt, leer, `print`, `false`, ein Tippfehler — bedeutet AUS**.
Die Prüfung ist bewusst ein Vergleich auf genau diese Zeichenkette und keine Wahrheitswert-Prüfung:
`…=false` wäre dabei eine nicht-leere Zeichenkette und damit wahr, und der neue Weg ginge live, weil
jemand ihn abschalten wollte. Ein Schalter, den ein Tippfehler EINschaltet, ist keiner.

⚠ `NEXT_PUBLIC_*` ist ein **Bauzeit**-Wert (Next ersetzt ihn textuell an der Fundstelle). Umschalten
heisst deshalb: Variable in Vercel setzen bzw. entfernen **und neu ausrollen** — es gibt keinen
Laufzeit-Schalter. Aus demselben Grund muss der Zugriff wörtlich als
`process.env.NEXT_PUBLIC_PDF_REPORT_ENGINE` stehen bleiben; über einen Zwischenschritt gelesen
(`process.env[NAME]`, ein Spread, eine Hilfsfunktion mit dem Namen als Parameter) findet die
Ersetzung nicht statt, und der Schalter stünde dauerhaft auf AUS, ohne dass irgendetwas
fehlschlüge.

**(4) Die Gate-Felder gehen mit dem Schalter live.** `documentFields` (Titel + Adresse, B23a/D3/D4)
wird GENAU DANN gesetzt, wenn der neue Weg aktiv ist. Mit ausgeschaltetem Schalter erhebt der Dialog
sie nicht — der CSS-Weg (`print-cover.tsx`) kennt beide Felder nicht, und sie dort zu erheben wäre
genau die „Requisite", die der Kopf des Dialogs seit B23a ausschliesst: erhoben, angezeigt und ohne
jede Wirkung. Bei der Adresse käme hinzu, dass eine Erhebung ohne Zweck personenbezogen ist.

Ein **geleertes** Titelfeld fällt auf den Vorschlag aus `defaultReportTitle` zurück statt eine leere
Zeile zu drucken: der Titel ist die einzige Angabe des Deckblatts, die es immer geben muss.

**(5) Der alte Weg bleibt vollständig bestehen.** `print-cover.tsx`, `print-frame.tsx`,
`print-methodology.tsx`, `print-assumptions-snapshot.tsx`, der `@media print`-Block in `globals.css`
und jedes `print:hidden` sind unangetastet. Der Rückbau ist eine eigene PR nach einer
Beobachtungsphase — solange beide Wege nebeneinander stehen, bleibt der Methodik-TEXT doppelt im
Repo (D10, unverändert).

**(6) Der Fall „gar kein Kapitel" bleibt gebaut und ungemessen — bewusst akzeptiertes Risiko.**
D15/D16/D17/D18 führen ihn seit vier Schritten als offenen Punkt: das Ladeverhalten-Kapitel entfällt
nur, wenn ein Speicher im ganzen Zeitraum nicht arbeitet UND keine Preiskurve vorliegt; das
Gerätewahl-Kapitel nur bei einem Katalog mit einem einzigen Gerät. Beide Zustände sind mit den
heutigen Prüf-Fixtures nicht erreichbar. Das Risiko wird mit dem Einschalten übernommen und nicht
davor beseitigt: die Agenda wird in `ReportDocument` aus **derselben** Präsenz-Entscheidung gebildet
wie der Seitenbaum (D15), ein Eintrag ohne Kapitel kann also strukturell nicht entstehen — was
ungemessen bleibt, ist das Layout eines Dokuments mit einem Kapitel weniger.

### ⚠ Der Defekt, den erst der Live-Lauf gefangen hat: eine Effekt-Aufräumung, die mitten in der Arbeit läuft

Der Auslöser läuft über einen `useEffect`, nach dem Vorbild des bestehenden Gate→Druck-Mechanismus
(`step-result.tsx`) — und aus einem **zweiten**, hier neuen Grund: `downloadReportPdf` arbeitet
synchron im selben Thread, sobald der Lazy-Chunk da ist. Unmittelbar im Klick-Rückruf gestartet
könnte die Auflösung des dynamischen Imports auf einem Microtask **vor dem ersten Paint** liegen —
der Ladezustand wäre gesetzt, aber nie gezeigt. Ein `useEffect` (kein `useLayoutEffect`) läuft nach
dem Paint.

Die erste Fassung führte zusätzlich ein `let cancelled = false` im Effekt und setzte es in dessen
Aufräumfunktion. **Das war falsch, und es sah aus wie ein Hänger der Erzeugung:** der Effekt setzt
als Erstes `setPdfRequested(false)`, damit ändert sich seine eigene Abhängigkeit, React räumt auf und
startet ihn neu — die Aufräumung läuft also mitten in der Erzeugung. Gemessen: das PDF wurde
vollständig erzeugt und **heruntergeladen**, aber `setPdfState({ kind: 'idle' })` wurde übersprungen;
der Knopf blieb nach 60 s noch auf „Report wird erzeugt …", und ein zweiter Export war unmöglich.
Ersetzt durch einen `mounted`-Vermerk in einem Ref: er sagt, was gemeint ist („gibt es diese
Komponente noch"), und ändert sich nur beim Ausbau.

### Verifikation — vier Läufe über die ECHTE Oberfläche gegen den Production-Build

Playwright, Port 4930, voller 4-Schritt-Durchlauf mit `dev-fixtures/demo-baeckerei-lastgang-2025.csv`
(Wiener Netze, Leistungspreis 38,52 · Arbeitspreis 25 ct · Einspeisevergütung 8 ct). `window.print()`
ist in jedem Lauf abgefangen und gezählt. **Der einzige Konsolenfehler ist in allen Läufen der
vorbestehende `/favicon.ico`-404** — eigens nachgemessen und über die Konsolen-Herkunft eindeutig
zugeordnet, nicht bloss angenommen.

⚠ **Es ist KEIN Lead in die Produktion geschrieben worden.** Der Report-Gate-Schreibpfad liest seine
Verbindung aus `SUPABASE_URL` (mit Vorrang vor `NEXT_PUBLIC_SUPABASE_URL`, s.
`lib/report-gate/service-role.ts`); für den Lauf zeigte sie auf einen zustandslosen lokalen Stub, der
`get_active_consent_text` und `capture_lead` beantwortet. Die Preisdaten kamen unverändert aus der
echten Cloud. Der Stub protokollierte genau **einen** `capture_lead`-Aufruf je Gate-Durchlauf.

| Lauf | Ergebnis |
| --- | --- |
| **Flag AUS** | Gate-Beschriftungen exakt `["Vorname *","Nachname *","Firma *","E-Mail *","Website (bitte frei lassen)"]` — **0 Titel-, 0 Adressfelder**; `window.print()` **1×**, **0 Downloads**; Knopfbeschriftung unverändert „Als PDF speichern"; zweiter Klick druckt erneut (**2×**) **ohne** das Gate wieder zu öffnen. |
| **Flag AN, alle Felder** | Gate trägt **7** Beschriftungen inkl. „Titel des Dokuments" und „Adresse (falls bekannt)"; Titelvorschlag `Wirtschaftlichkeitsanalyse Batteriespeicher`; während der Erzeugung **Knopf gesperrt**, Beschriftung „Report wird erzeugt …", **0 Knöpfe** mit der alten Beschriftung, Status-Satz sichtbar; **4,0 s** bis zum fertigen Download; `window.print()` **0×**; Datei **375.365 Bytes**, **15 Seiten**. |
| **Flag AN, Dokumentfelder leer** | Titel fällt auf den Vorschlag zurück, **kein** Adressblock; `window.print()` **0×**, Download **374.998 Bytes**, 15 Seiten. |
| **Flag AN, erzwungener Fehler** | Der Lazy-Chunk wurde auf Netzebene abgewürgt (genau **ein** abgebrochener Chunk, `429.…js`). Fehlerblock erscheint mit Handlungssatz + technischem Hinweis, **1** Knopf „Erneut versuchen", Hauptknopf zurück auf „Als PDF speichern" und **nicht** gesperrt; **`window.print()` 0×, 0 Downloads** — kein stiller Rückfall. Nach dem Lösen der Sperre führt „Erneut versuchen" zum Download (375.365 Bytes), Fehlerblock und Wiederholen-Knopf verschwinden. |

**Das Deckblatt, Feld für Feld gegen die Eingaben gehalten** (pdfjs über die erzeugten Dateien):

- mit Feldern: `Wirtschaftlichkeitsanalyse Bäckerei Gruber` · `Auf Basis Ihres Viertelstunden-Lastgangs`
  · `ERSTELLT FÜR` · `Bäckerei Gruber GmbH` · `Anna Gruber` · **`Hauptstraße 12` · `2100 Korneuburg`**
  · `01.01.2025 – 31.12.2025` · `05.09.2026`;
- ohne Felder: derselbe Aufbau, aber Titel `Wirtschaftlichkeitsanalyse Batteriespeicher` und **keine
  Adresszeilen** — der Block fehlt ganz, statt eine leere Zeile zu drucken.

### Verifikation — Bündel

`/rechner` First Load roh **1.923.232 → 1.926.670 Bytes (+3.438)** bei Flag AUS, unverändert **19
Chunks**; `/pdf-report-probe` roh **406.840 → 406.840**, unverändert 6 Chunks. Die Vorher-Zahl ist
durch einen eigenen Bau vor der Änderung gemessen und trifft die D20-Zahl bit-genau.

⚠ **Die Zusage ist NICHT „unverändert", und das ist offengelegt.** Der Zuwachs ist `derive.ts` (der
eine Teil von `lib/pdf-report/`, der statisch importiert werden darf — fünf Ableitungen samt
Intl-Formatierern), der Effekt samt Zusammenbau des Eingangs und die drei neuen Anzeigetexte. Zur
Einordnung: B23c-4 hat an derselben Route +3.309 Bytes gekostet.

**Was dagegen zählt und gemessen ist: `@react-pdf` kommt über den GESAMTEN `/rechner`-First-Load-Satz
0× vor — in BEIDEN Bauzuständen.** Der Lazy-Chunk bleibt draussen, `stunden-heatmap-raster` genau 1×
(Positivkontrolle).

**Ein Nebenbefund, der die Bauzeit-Natur des Schalters belegt:** der Bau mit **eingeschaltetem**
Schalter ist mit **1.926.570 Bytes um 100 Bytes KLEINER** als der ausgeschaltete. Bei gesetzter
Variable ersetzt Next sie textuell, der Vergleich faltet sich zu `true`, und die Zeichenkette
`react-pdf` kommt im Bündel **0×** vor; bei nicht gesetzter Variable bleiben Zugriff und Literal
stehen (`NEXT_PUBLIC_PDF_REPORT_ENGINE` 1×). Beide Bauzustände tragen 19 Chunks.

### `[OFFEN]` nach diesem Schritt

- **Das Einschalten in Produktion ist ein eigener, bewusster Schritt** — mit Redeploy (s. (3)) und
  einer Beobachtungsphase, bevor der CSS-Weg zurückgebaut wird.
- **Der Rückbau von `print-*.tsx`, dem `window.print()`-Pfad und dem `@media print`-Block** ist die
  darauffolgende PR; mit ihr fällt auch die in D10 benannte Doppelung des Methodik-Texts und die in
  `derive.ts` benannte Doppelung der Zeitraum-Formatierung.
- **Kein serverseitiges Fehler-Logging.** Ein gescheiterter Export ist heute ausschliesslich im
  Browser des Kunden sichtbar; wie oft er eintritt, weiss niemand. Bewusst nicht gebaut — es gibt in
  dieser App keine Fehler-Telemetrie, und eine für diesen einen Fall einzuführen wäre der Umbau, den
  niemand angefordert hat.
- **Kein Abbrechen einer laufenden Erzeugung.** Wer „Neue Analyse" drückt, während erzeugt wird,
  bekommt die Datei trotzdem — die Arbeit läuft weiter, nur die Anzeige ist weg.
- **Safari/iOS ist unverändert ungemessen** (D10, Spike §6 (g)); der Download läuft über eine
  `blob:`-URL und einen synthetischen Klick.
- Alle übrigen `[OFFEN]`-Punkte aus D10/D18/D19/D20 gelten fort.
