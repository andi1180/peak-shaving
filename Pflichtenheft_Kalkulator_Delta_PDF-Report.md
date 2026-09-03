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
| **B23c** | Übernahme der Bestands-Report-Karten in den neuen Fluss (Kern-Kennzahl, Empfehlung, Aufschlüsselung, Annahmen-Snapshot, Warnungen) — **erst danach ist der Cutover möglich** | offen |
| **B23d** | Calls-to-Action-Seite | offen, hängt an einer noch nicht getroffenen Entscheidung: Kontakthinweis gegen QR-Code |
| **Cutover** | Umschalten des Kunden-Knopfes, Rückbau des CSS-Wegs (`print-cover`, `print-frame`, `print-methodology`, `print-assumptions-snapshot`, `@media print`) | **nicht Teil dieser Zerlegung** — eigene Entscheidung, nachdem B23c inhaltliche Parität hergestellt hat |

**Was in B23a fertig ist:** das Dokument trägt Deckblatt (Titel, Untertitel, Kunde, mehrzeilige Anschrift, Zeitraum, Erstellungsdatum, Vorbehalt), auf jeder Seite Kopfzeile (Emblem + Wortmarke + Navy-Balken) und Fusszeile (Absender + Web + „Seite X von Y"), eine Agenda mit gemessenen Seitenverweisen und das Methodik-Kapitel mit denselben sechs Punkten wie der CSS-Weg (der Hindsight-Hinweis WÖRTLICH aus `lib/report-copy.ts` importiert, nicht abgeschrieben).

**Was in B23a bewusst NICHT fertig ist:** die Kernergebnisse. Sie stehen als ausdrücklich gekennzeichnete Platzhalter-Seite im Dokument — nicht, weil sie vergessen wurden, sondern damit die Agenda mehr als triviale Ein-Seiten-Sprünge zeigt und der Mechanismus messbar wird.

---

## D9 — ⚠ Der neue Weg ist NICHT live, und das ist eine Zusage

Der Knopf im Rechner löst unverändert `window.print()` aus. Der react-pdf-Weg ist ausschliesslich über die unverlinkte, `noindex`-Route `/pdf-report-probe` erreichbar. **Umgeschaltet wird erst mit B23c** — vorher wäre der neue Report ein Rückschritt: Deckblatt und Methodik ohne Kennzahlen, Grafiken und Empfehlung.

Die Prüfroute enthält bewusst **nicht** den Gate-Dialog: der schreibt einen echten Lead nach `platform.leads`, und eine Prüfroute, die das kann, verfälscht genau die Statistik, für die die Herkunft `rechner-report` existiert.

---

## D10 — Offene Punkte

- **`[OFFEN]` B23d: Kontakthinweis gegen QR-Code** auf der Abschlussseite. Nicht entschieden, blockiert B23d.
- **`[OFFEN]` Der Cutover-Zeitpunkt und der Rückbau des CSS-Wegs.** Solange beide Wege nebeneinander stehen, ist der Methodik-TEXT doppelt im Repo (einmal als JSX in `print-methodology.tsx`, einmal als Daten in `lib/pdf-report/content.ts`) — bewusst, und der Hindsight-Hinweis ist die eine Ausnahme, die geteilt bleibt.
- **`[OFFEN]` Der Ladezustand beim ersten Export** (Spike §6 (e)): der Lazy-Chunk (≈ 307 kB gzip) lädt beim ersten Klick. Lokal unter 200 ms, über eine echte Leitung nicht. Die Prüfroute zeigt „Wird erzeugt …"; der spätere Kunden-Knopf braucht dasselbe.
- **`[OFFEN]` Kerning** (Spike §6 (c)) — „aWATTar" steht in react-pdf mit sichtbarer Lücke zwischen den beiden T. Kosmetisch, am Papier sichtbar.
- **`[OFFEN]` Kein automatischer Wächter gegen die `lineHeight`-Falle** (D7).
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

**`[OFFEN]` Welcher Ausschnitt eines Charts ins Bild gehört.** Bei Recharts trennt
`svg.recharts-surface` den Zeichenbereich sauber ab. Die Heatmap trägt keinen solchen Anker — im
Prüfstand wird deshalb die ganze Karte samt Fliesstext gerastert. Für den Report ist das die falsche
Aufteilung (Text gehört nativ daneben, nicht als Pixel ins Bild); die Entscheidung und der dafür
nötige Anker gehören in B23c.
