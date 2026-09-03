# PDF-Rendering-Spike (`@react-pdf/renderer`) — Bestandsaufnahme

> **Reine Messung, keine Bauentscheidung.** Vorarbeit für einen späteren Bauabschnitt (Arbeitstitel B23, noch nicht in `Fahrplan_2026.md`). Am Produktivcode wurde nichts geändert: die zwei Prototypen, die Fontdateien und die Abhängigkeit sind nach der Messung vollständig entfernt; im Commit steht ausschliesslich dieses Dokument. Die Frage lautete NICHT „welche Bibliothek nehmen wir", sondern: **kann `@react-pdf/renderer` unsere Charts in der nötigen Qualität darstellen, und tut es das clientseitig ohne Server (Prinzip 4)?**

---

## 0. Messaufbau

| | |
|---|---|
| Bibliothek | `@react-pdf/renderer` **4.9.0** (`peerDependencies: react ^16.8 \|\| ^17 \|\| ^18 \|\| ^19`) |
| Umgebung | `apps/website`, React 19.0, Next 15.1.4 (Laufzeit `next-server v15.5.20`) |
| Server | **`next start` (Production-Build)** auf Port 4988 — kein Dev-Server |
| Messwerkzeug | Playwright 1.62.1 (Chromium 1234), echtes Klicken, `page.on('request')` |
| Prüfling | Monatsvergleich „Ist-Tarif vs. aWATTar ohne Steuerung vs. aWATTar mit Speicher" |
| Zahlen | die dokumentierten Urbanz-Summen **769,73 / 890,07 / 685,85 €** über 8 gemessene Monate; die fünf in `CLAUDE.md` einzeln genannten Monatspaare wörtlich, die drei nicht genannten Monate (Mär/Mai/Jul) **synthetisch** so gewählt, dass alle drei Spaltensummen die dokumentierten Werte exakt treffen |

Zwei Prototypen desselben Charts:

- **Variante 1 — native Primitives.** `<Svg>/<Rect>/<Line>/<Path>/<Text>`, Gitternetz, Achsenbeschriftung, 3 Serien × 12 Kategorien komplett selbst gezeichnet.
- **Variante 2 — Rasterbild.** Der **unveränderte** `MonthlyTariffChart` aus `apps/website/components/report/` wird gerendert, sein `svg.recharts-surface` serialisiert, über Canvas (Skalierung 3) zu PNG gerastert und per `<Image>` eingebettet. Beschriftung, Legende und Erklärkasten drumherum sind in beiden Varianten native react-pdf-Elemente.

0 Konsolenfehler und 0 Seitenfehler in **allen** Läufen.

---

## Kurzfassung — die fünf Messpunkte in je einem Satz

1. **Clientseitig, ohne Netz:** die Erzeugung selbst macht im warmen Lauf **0 Requests**; die einzigen Requests überhaupt sind der einmalige Lazy-Chunk und — nur bei registriertem Font — zwei Anfragen auf die eigene Herkunft.
2. **Optik:** beide Varianten treffen die DESIGN.md-Tokens exakt; Variante 1 liefert Vektortext (16 Chart-Beschriftungen als durchsuchbarer Text), Variante 2 288 dpi Raster — mit zwei stillen Fallen, die erst der 300-dpi-Vergleich gezeigt hat.
3. **Bundle:** `/rechner` **First Load JS unverändert 580 kB** (0 kB Delta), Preis ist ein Lazy-Chunk von **≈ 773 kB roh / ≈ 307 kB gzip**, der erst beim ersten Klick lädt.
4. **Aufwand Variante 1:** **56 Codezeilen** für den EINFACHSTEN Chart des Reports — und ein Lastgang mit 35.040 Punkten kostet gemessen nur **85 ms / 170 kB**, ist auf 515 pt aber optisch ein Block.
5. **Next/App-Router:** Server-Component → `'use client'` → `await import(...)` im Klick-Handler, Build **Exit 0**, Route als `○ /spike-pdf` statisch vorgerendert — react-pdf wird serverseitig nie ausgewertet.

**Dazu der Befund, um den es eigentlich geht:** der Seitenzähler und die wiederkehrende Kopf-/Fusszeile funktionieren — an einem dreiseitigen PDF gemessen und über die Glyph-IDs im Content-Stream nachgewiesen. Das ist genau das, was der CSS-Print-Weg nachweislich nicht kann.

---

## 1. Läuft die Erzeugung vollständig clientseitig, ohne Netzwerk-Request?

**Ja.** Gemessen über `page.on('request')`, je Erzeugungsvorgang einzeln abgegrenzt.

Erster (kalter) Durchgang:

```
Seitenladung:                      11 Requests   (normales Next-Asset-Laden)
v1 · Helvetica                      7 Requests   ausschliesslich /_next/static/chunks/*
v1 · Inter                          2 Requests   /spike-fonts/Inter-Regular.woff
                                                 /spike-fonts/Inter-SemiBold.woff
v2 · Raster + Inter                 2 Requests   1× /_next/static/chunks/924.*.js
                                                 1× blob:http://localhost:4988/…
```

Zweiter Durchgang, dieselbe Seite, warm:

```
Lauf 1 (v1-inter): 9 Requests, davon nicht-blob 9   ← Lazy-Chunk + Fonts, einmalig
Lauf 2 (v2-inter): 2 Requests, davon nicht-blob 1   ← Modul-Chunk der Variante 2
Lauf 3 (v1-inter): 0 Requests, davon nicht-blob 0   ← ⬅ die Erzeugung selbst
Lauf 4 (v2-inter): 1 Request,  davon nicht-blob 0   ← nur die blob:-URL des Downloads
```

Daraus folgt, mit Zahlen belegt:

- **Es gibt keinen Erzeugungs-Request.** Kein POST, kein Server-Roundtrip, keine fremde Herkunft — auch nicht im kalten Lauf. Die PDF-Bytes entstehen im Browser und verlassen ihn nicht. Prinzip 4 bleibt für den Lastgang unangetastet: es geht überhaupt nichts hinaus.
- **Die `blob:`-URL ist der Download selbst** (`URL.createObjectURL` + `<a download>`), also ein rein lokaler Vorgang.
- **Der Lazy-Chunk ist einmalig** und ein statisches Asset der eigenen Herkunft.
- **⚠ Die einzige echte Laufzeit-Anfrage ist die Fontregistrierung.** `Font.register({ src: '/spike-fonts/Inter-*.woff' })` holt die Datei per `fetch` — gemessen genau **zwei** Dateien, nämlich nur die tatsächlich benutzten Schnitte (Regular, SemiBold; Bold war registriert und wurde nicht geholt). Ohne Registrierung bleibt es bei Helvetica und die Erzeugung ist ab dem ersten Klick vollständig request-frei. Beide Wege sind gemessen; welcher gewählt wird, ist eine Bauentscheidung (s. §6, offener Punkt (b)).

Laufzeiten (warmer Lauf, `performance.now()` um den gesamten Vorgang inkl. `pdf().toBlob()`):

| Variante | Zeit | PDF-Grösse |
|---|---|---|
| v1 · Helvetica | 160 ms | 6,1 kB |
| v1 · Inter | 236 ms | 17,9 kB |
| v2 · Raster + Inter | 333 ms | 46,8 kB |

---

## 2. Visueller Vergleich

### 2.1 Farben — beide Varianten treffen DESIGN.md exakt

Verwendet sind die Tokenwerte aus `app/globals.css`: Kopfbalken `--color-navy #18336f`, „Ihr Tarif heute" `--color-text-muted #475569`, „aWATTar mit Speicher" `--color-accent #0f766e`, Rahmen `--color-border #e2e8f0`, Kastenfläche `--color-surface-alt #f8fafc`. Die Zwischenstufe des Bildschirm-Charts (`color-mix(in srgb, var(--color-accent) 50%, var(--color-surface))`) ist als `#87bab6` nachgerechnet — react-pdf kennt `color-mix()` nicht.

**⚠ Falle 1, gemessen:** Recharts zeichnet mit CSS-Variablen (`fill="var(--color-accent)"`). In einem serialisierten, freistehenden SVG (Data-URL → Canvas) **lösen die nicht auf** — das Diagramm käme unbemalt heraus. Variante 2 läuft deshalb vor dem Serialisieren über jedes Element und schreibt `fill`/`stroke`/`font-size`/`font-family` aus `getComputedStyle` als feste Attribute zurück (14 Codezeilen). Ohne diesen Schritt ist der Chart im PDF wertlos, und zwar ohne Fehlermeldung.

### 2.2 Schrift — Inter ist eingebettet, mit drei Nebenbefunden

Aus den erzeugten PDFs ausgelesen:

```
spike-v1-inter.pdf   /BaseFont /EZZZZZ+Inter-Regular   FontFile2  ToUnicode
                     /BaseFont /CZZZZZ+Inter-SemiBold  FontFile2  ToUnicode
                     /BaseFont /Helvetica              Type1, nicht eingebettet
spike-v1-helvetica.pdf  /Helvetica + /Helvetica-Bold   (Standard-14, nichts eingebettet)
```

- **Inter wird als Untermenge eingebettet** (`FontFile2`) und trägt eine `ToUnicode`-CMap — der Text ist damit durchsuchbar und kopierbar.
- **⚠ Falle 2: `next/font` hilft hier nicht.** `.next/static/media/` enthält ausschliesslich **woff2** (10 Dateien, alle `.woff2`). react-pdf/fontkit verarbeitet TTF/OTF/WOFF, nicht woff2. B23 braucht deshalb ein **eigenes Font-Asset** (WOFF oder TTF); für diesen Spike wurden drei Inter-Schnitte als WOFF beschafft (je ~30 kB) und funktionieren.
- **⚠ SVG-`<Text>` erbt die Seitenschrift NICHT.** Erst mit explizitem `fontFamily` am SVG-Text greift Inter. Nachgewiesen über die Font-Auswahl-Operatoren im Content-Stream: `F4@7.5` (= Inter-Regular in 7,5 pt) kommt **genau 16×** vor — die 12 Monatsnamen plus 4 Y-Achsenbeschriftungen.
- **`/Helvetica` steht trotzdem im PDF** — 3 Textläufe in 8 pt. Nachgeprüft, statt vermutet: der Content-Stream um diese drei Läufe enthält **nur Leerraum**, es rendert also kein sichtbares Glyph in Helvetica. Ebenfalls gegengeprüft, weil es die naheliegende Erklärung gewesen wäre: `•`, `„`, `"`, `·`, `—`, `€`, `ä`, `ß` einzeln als eigene Textläufe geprüft — **alle acht landen in Inter**, die Untermenge deckt unsere deutschen Sonderzeichen also ab.
- **Kerning:** in Variante 1 steht „aWATTar" mit sichtbarer Lücke zwischen den beiden T (react-pdf wendet die Kern-Paare nicht wie der Browser an). Im Rasterbild ist derselbe String browser-gekernt. Kosmetisch, aber am Papier sichtbar.

### 2.3 Textebene — der Unterschied ist exakt bezifferbar

Textausgabe-Operatoren im Content-Stream:

```
Variante 1: 53 Textläufe
Variante 2: 37 Textläufe
Differenz:  16   = 12 Monatsnamen + 4 Y-Achsenwerte
```

Genau die 16 Chart-Beschriftungen sind in Variante 1 Vektortext und in Variante 2 Pixel. Zusätzlich hat Variante 2 ein `/Image`-XObject, Variante 1 keines.

### 2.4 Kantenschärfe — gemessen, nicht geschätzt

Rasterung mit Skalierung 3 ergibt **1950 × 768 px** in 487 pt Breite = **288 dpi effektiv** (bei Skalierung 2 wären es 192 dpi). Beide PDFs bei 300 dpi gerendert (`qlmanage -t -s 2480`, A4 → 1753 × 2480 px) und derselbe Bildausschnitt Pixel für Pixel verglichen: die Rasterbeschriftung ist **geringfügig weicher**, im Druckbild aber nicht störend. Der Unterschied ist kleiner, als er in Zahlen klingt.

**⚠ Falle 3, und sie war fast unsichtbar:** der erste Versuch bettete das 1950 × 768-Raster (Seitenverhältnis 2,539) mit `width: 487, height: 218` ein (Verhältnis 2,234) → **13,6 % vertikale Streckung, still**. Am Bildschirm und in einer Vorschau nicht zu erkennen; aufgefallen ist es erst am 300-dpi-Ausschnittsvergleich, weil die Achsenbeschriftung im Raster grösser wirkte als der native Text drei Zeilen darunter. Richtig ist `height: 191.8`. Wer Rasterbilder einbettet, muss das Seitenverhältnis rechnen — eine falsche Höhe verzerrt den Chart, ohne dass irgendetwas kaputt aussieht.

### 2.5 Abstand zum Consulting-Look (§6.1/§6.2)

Beide Varianten halten ihn: kein Rahmen um die Zeichenfläche, waagrechtes Gitternetz gestrichelt und dezent, eine dominante Aussage je Abschnitt, Beträge tabellarisch, Navy-Kopfbalken plus wiederkehrende Fusszeile. Was das PDF gegenüber dem heutigen CSS-Druck **zusätzlich** kann, ist der Grund für den ganzen Spike:

```
Dreiseitiges Test-PDF, je Seite ein eigener Content-Stream:
  Seite 1: 56 Tf-Aufrufe, 5 gefüllte Rechtecke
  Seite 2: 53 Tf-Aufrufe, 5 gefüllte Rechtecke
  Seite 3: 53 Tf-Aufrufe, 5 gefüllte Rechtecke
Fusszeilen-Textlauf in 7 pt, Glyph-IDs (Position 7 unterschiedlich):
  Seite 1: … 0008 0030 0008 …   → „1"
  Seite 2: … 0008 0031 0008 …   → „2"
  Seite 3: … 0008 0032 0008 …   → „3"
  Endziffer bei allen dreien 0032 → „von 3"
```

Also: `Seite 1 von 3` / `Seite 2 von 3` / `Seite 3 von 3`, je Seite zur Renderzeit aufgelöst (`<Text render={({pageNumber, totalPages}) => …} fixed />`), und die fixierte Kopf-/Fusszeile wird auf jeder Seite ausgegeben. `/Count 3` im Seitenbaum. Zur Erinnerung, was das ablöst (CLAUDE.md, 02.09.2026): von vier Techniken für eine wiederkehrende Kopfzeile in Chromium waren **drei unbrauchbar**, die vierte erzwingt eine echte `<table>` als Dokumentrahmen — mit der gemessenen Nebenwirkung, dass die Mindestinhaltsbreite eines Charts die Breite der ganzen Seite treibt. Einen Seitenzähler gibt es dort gar nicht.

---

## 3. Bundle-Size-Delta

Beide Zahlen aus dem `next build`-Output von `apps/website`, gleiche Maschine, gleicher Lauf-Typ.

**Ohne `@react-pdf/renderer` (Baseline):**

```
Route (app)                                 Size  First Load JS
┌ ○ /                                      164 B         106 kB
├ ○ /_not-found                             1 kB         103 kB
└ ƒ /rechner                              474 kB         580 kB
+ First Load JS shared by all             102 kB
```

**Mit `@react-pdf/renderer` installiert + Spike-Route:**

```
Route (app)                                 Size  First Load JS
┌ ○ /                                      164 B         106 kB
├ ○ /_not-found                             1 kB         104 kB
├ ƒ /rechner                              356 kB         580 kB
└ ○ /spike-pdf                           2.32 kB         222 kB
+ First Load JS shared by all             103 kB
```

Auswertung:

- **`/rechner` First Load JS: 580 kB → 580 kB. Delta 0 kB.** Das ist die entscheidende Zahl.
- **Die `Size`-Spalte von `/rechner` fällt 474 → 356 kB und ist hier ein Artefakt**, kein Gewinn: Recharts wandert in einen Chunk, den sich die neue Route mit `/rechner` teilt, und wird dadurch anders zugerechnet. `First Load JS` ist die belastbare Grösse. `shared by all` 102 → 103 kB (+1 kB) durch den zusätzlichen geteilten Chunk der zweiten Route.
- **`/spike-pdf`: Size 2,32 kB, First Load JS 222 kB** — react-pdf steckt *nicht* im First Load. Der dynamische Import hält es vollständig heraus.
- **Der Preis ist der Lazy-Chunk**, gemessen an den erzeugten Dateien:

| Chunk | roh | gzip |
|---|---|---|
| `263.*.js` (react-pdf + pdfkit) | 640 kB | 259 kB |
| `a5ceee99.*.js` (fontkit u. a.) | 129 kB | 46 kB |
| `232.*.js` (Spike-Module) | 4 kB | 2 kB |
| **Summe** | **≈ 773 kB** | **≈ 307 kB** |

Diese Chunks werden nachweislich erst beim ersten Klick geholt (§1) und danach aus dem Cache. Der Kostenpunkt ist also nicht die Seitenladung, sondern **eine einmalige Wartezeit beim ersten PDF-Export** — im Messlauf 7 Requests, insgesamt unter 200 ms lokal.

---

## 4. Implementierungsaufwand Variante 1

Zeilenzahlen des Prototyps:

```
variant1-primitives.tsx   168 Zeilen   (Dokument + Chart + Stylesheet)
  davon Chart-Funktion      56 Codezeilen (Gitter, Y-Beschriftung, Balken, Monatsnamen, Nulllinie)
  davon Geometrie-Konstanten ~10 Zeilen  (Plotfläche, Y-Maximum, Ticks)
variant2-raster.tsx        82 Zeilen   (Dokument, Chart als <Image>)
  + Rasterisierung          41 Zeilen  (27 svgToPng + 14 inlineComputedPaint) — je Chart wiederverwendbar
spike-data.ts              26 Zeilen
```

**Was die 56 Zeilen wirklich bedeuten.** Sie sind der **einfachste** Chart des Reports: kategoriale X-Achse, lineare Y-Achse, keine Zeitachse, kein Tooltip, keine zweite Achse, keine Stapelung, keine Referenzlinie. Und sie enthalten *alles* von Hand: Y-Skala, „nettes" Maximum, Tickabstände, Gruppen- und Balkenbreite, Zwischenräume, Textanker, Nulllinie über den Balken. Es gibt in react-pdf keine Achsen-, Tick-, Legenden- oder Skalen-Abstraktion — was Recharts mitbringt, entsteht hier neu.

**Hochrechnung, mit Zahlen wo messbar** (statt geschätzt):

- **Lastgang, 35.040 Viertelstundenwerte als EIN `<Path>`:** gemessen **85 ms**, PDF **170,4 kB**, `d`-String **550.821 Zeichen** — react-pdf verarbeitet das problemlos und schnell. Die Elementzahl ist also nicht das Problem.
- **⚠ Das Problem ist die Pixeldichte auf Papier, nicht die Bibliothek.** 35.040 Punkte auf 515 pt Breite ergeben rund 68 Punkte je Punkt Breite; das gerenderte Blatt zeigt einen geschlossenen Block, keine lesbare Kurve. Bei 300 dpi trägt die Fläche höchstens ~2.150 unterscheidbare X-Positionen. **Der bestehende `apps/website/lib/downsample.ts` (Min-Max je Bucket, ~1.500 Buckets) ist damit für den PDF-Weg genauso Pflicht wie für den Bildschirm** — und dort gemessen: **2.920 Punkte → 20 ms, 18,9 kB.**
- **Heatmap (24 × 12 = 288 `<Rect>`):** strukturell dasselbe wie die 24 Balken hier; unkritisch.
- **Die eigentlichen Kosten sind nicht je Chart die Zeichenfläche, sondern je Chart-TYP die Achsen-/Skalen-/Legenden-Arithmetik.** Der Report führt heute sieben Charts (Lastgang mit Kapp-Linie, Kostenvergleich, Tages-Energiefluss, Monatsvergleich, Grenznutzen-Kurve, Stunden-Heatmap, Ø-Ladepreis). Auf diesem Weg wären das grob 7 × 50–100 Zeilen plus ein geteilter Skalen-/Achsen-Helfer — **also eine kleine eigene Chart-Bibliothek, als ZWEITE Umsetzung neben Recharts.** Damit entsteht genau das Divergenzrisiko, das dieses Repo an anderen Stellen konsequent vermeidet (eine Definition, zwei Konsumenten): der Chart im PDF könnte etwas anderes zeigen als der Chart am Bildschirm, und niemand merkt es, weil beide für sich plausibel aussehen.

---

## 5. Next.js / App-Router — clientseitiges Laden ohne Server-Build-Bruch

Aufbau: `app/spike-pdf/page.tsx` (Server Component, kein `'use client'`) → `spike-client.tsx` (`'use client'`) → `await import('@react-pdf/renderer')` **im Klick-Handler**, ebenso die beiden Dokument-Module.

Ergebnis:

```
pnpm --filter website build → EXIT 0
Route: ○ /spike-pdf   (Static — statisch vorgerendert)
```

- **Kein `serverExternalPackages`, keine Webpack-Konfiguration, kein `next/dynamic`-Wrapper mit `ssr: false`** war nötig. Weil der Import im Handler steht, wird react-pdf serverseitig nie ausgewertet.
- **Ein Typ-Detail, an dem der erste Build wirklich gescheitert ist:** `pdf()` verlangt `ReactElement<DocumentProps>`; ein einfaches `React.ReactElement` bricht `tsc` mit *„Argument of type 'ReactElement<unknown, …>' is not assignable to parameter of type 'ReactElement<DocumentProps, …>'"*. Zu wissen, bevor jemand eine Stunde sucht.
- Alle sechs Builds dieses Spikes (Baseline, Spike, Font-Probe, Zeichen-Probe, Mehrseiten-Probe, Lastgang-Probe) liefen mit Exit 0.

---

## 6. Empfehlung (Empfehlung, keine Entscheidung)

**Nicht abbrechen — `@react-pdf/renderer` trägt.** Der Grund ist nicht die Chart-Qualität (die ist auf beiden Wegen ausreichend), sondern das Dokument: Seitenzähler, wiederkehrende Kopf-/Fusszeile und kontrollierter Umbruch sind gemessen vorhanden, request-frei, und genau das kann der CSS-Print-Weg nachweislich nicht.

**Für die Charts empfehle ich das Rasterbild (Variante 2) als Regelfall und die Primitives (Variante 1) als Ausnahme** — also einen hybriden Aufbau:

- **react-pdf nativ für alles Dokumenthafte:** Deckblatt, Seiten, Kopf-/Fusszeile, Seitenzahlen, Kennzahlen, Tabellen, Fliesstext, Methodik-Kapitel. Hier liegt der ganze Gewinn, und hier ist der Aufwand niedrig.
- **Charts als Rasterbild aus dem bestehenden Recharts-Chart.** Ausschlaggebend ist nicht der Aufwand (41 wiederverwendbare Zeilen gegen ~56 je Chart-Typ), sondern die **eine Definition**: der Chart im PDF ist dann bit-genau derselbe, den der Kunde am Bildschirm gesehen hat. Eine zweite Zeichenimplementierung wäre eine zweite Wahrheit über dieselbe Zahl. 288 dpi sind im 300-dpi-Vergleich nicht störend, und die zwei Fallen (CSS-Variablen, Seitenverhältnis) sind benannt und je in wenigen Zeilen abgedeckt.
- **Variante 1 gezielt dort**, wo Vektortext oder Durchsuchbarkeit wirklich zählt — realistisch beim Deckblatt-Diagramm und bei etwaigen Exhibit-Grafiken ohne Bildschirm-Zwilling.

**Wogegen ich ausdrücklich nicht empfehle, ohne eine eigene Entscheidung fortzufahren:** die Charts vollständig auf Primitives umzustellen. Das wäre eine zweite Chart-Bibliothek im Repo, gepflegt neben Recharts, mit dem oben beschriebenen stillen Divergenzrisiko — und der Anlass des Umbaus (Seitenzahlen, Agenda, Exhibit-Layout) verlangt das nicht.

### Offene Punkte für den Bau-Prompt — gemessen als offen, nicht als gelöst

- **(a) Agenda mit Seitenverweisen ist NICHT gemessen und der härteste Punkt.** `render={({pageNumber})}` löst je Element auf, beantwortet aber nicht „auf welcher Seite beginnt Abschnitt X". Das braucht entweder zwei Renderdurchläufe (erst messen, dann das Inhaltsverzeichnis füllen) oder eine Navigation über PDF-Outlines (`bookmark`-Prop, existiert, hier ungeprüft). Vor dem Bau zu klären — der Anspruch stand ausdrücklich in der Motivation.
- **(b) Fontweg entscheiden.** Registrierung per URL (gemessen: 2 Requests auf die eigene Herkunft, sauber) gegen Einbettung als Data-URI im Bündel (0 Requests, ungemessene Bündelkosten). `next/font` fällt aus, weil es woff2 liefert.
- **(c) Kerning** („aWATTar") in Variante 1 — kosmetisch, aber am weitergereichten Blatt sichtbar.
- **(d) Downsampling ist Pflicht** für Lastgang-artige Reihen, auf beiden Wegen (§4). Die bestehende Funktion deckt das ab.
- **(e) Der Lazy-Chunk (≈ 307 kB gzip) braucht einen sichtbaren Ladezustand** beim ersten Export; im Messaufbau war das lokal unter 200 ms, über eine echte Leitung ist es das nicht.
- **(f) Ein `/Helvetica` bleibt im erzeugten PDF** (3 leerraum-Textläufe, keine sichtbare Wirkung, §2.2). Kein Fehler, aber zu wissen, falls eine Prüfung später „nur Inter" verlangt.
- **(g) Nicht Teil dieses Spikes:** Barrierefreiheit/PDF-Tags, PDF/A, Dateigrösse eines vollständigen Reports mit sieben Charts, Verhalten auf Safari/iOS (gemessen wurde ausschliesslich Chromium).

---

## 7. Was am Ende vom Spike übrig ist

Nichts ausser diesem Dokument. Entfernt: `apps/website/app/spike-pdf/**` (5 Dateien, 442 Zeilen), `apps/website/public/spike-fonts/**` (3 WOFF), der `@react-pdf/renderer`-Eintrag in `apps/website/package.json` und der zugehörige `pnpm-lock.yaml`-Diff. `apps/website/components/report/**`, `app/globals.css`, `Fahrplan_2026.md` und jede Produktivdatei haben **0 Zeilen Diff**.

Die eine weitere modifizierte Datei im Arbeitsbaum (`Pflichtenheft_Zugangsplattform_MVP.md`) lag **vor** diesem Spike bereits geändert vor, wurde nicht angefasst und ist nicht Teil des Commits.
