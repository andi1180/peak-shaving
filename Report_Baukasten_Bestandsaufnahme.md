# Report-Baukasten (B24 Teil 3) — Bestandsaufnahme

> **Was dieses Dokument ist:** eine reine Bestandsaufnahme zum Report-Baukasten, entstanden am
> 16.09.2026 gegen den Stand `4dc3231` (HEAD von `origin/main`, „docs: Session-Handover 15.09.2026 —
> B24-Stand aktualisiert (#247)"). Sie beantwortet sieben Fragen gegen den **echten Code**, die
> echten Migrationen und die echten Dokumente. Jede Aussage trägt eine Fundstelle (Datei:Zeile); wo
> etwas nicht existiert, ist die Fehlanzeige selbst der Befund und mit ausgeführtem Grep **plus
> Positivkontrolle im selben Suchraum** belegt. Jede Fundstelle ist ein zweites Mal von einem
> unabhängigen Gegenprüfer nachgegriffen worden.
>
> **Was dieses Dokument NICHT ist:** kein Pflichtenheft, keine Bewertung, keine Empfehlung, keine
> Architekturentscheidung. Es ist an **keiner** Zeile Anwendungscode etwas geändert worden —
> `packages/**`, `apps/**`, `supabase/**` und jede Konfiguration haben **0 Zeilen Diff**; im Commit
> steht ausschliesslich diese Datei.
>
> **Vorgelagerte Quellen (gelesen):** `Fahrplan_2026.md` (Z. 74, 75, 292, 298, 300) ·
> `Pflichtenheft_Kalkulator_Delta_PDF-Report.md` (1.966 Z.) · `B24_KI-Interface_Kalkulator.md` TEIL 3
> (Z. 237–300) · `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §5 (Z. 174–191) · `CLAUDE.md`
> (139 Z.) und die neun `[GEBAUT: B23 …]`-Absätze aus `git show 4089ddf:CLAUDE.md` (s. §1) ·
> `KI-Interface_Kalkulator_Bestandsaufnahme.md` (727 Z., Stil-Vorbild) ·
> `PDF_Rendering_Spike_Bestandsaufnahme.md` · `Report_Verstaendlichkeit_Bestandsaufnahme.md`.
>
> **Reihenfolge-Einordnung:** `Fahrplan_2026.md:300` sagt zu B24 Teil 3 „**Nächster Schritt: keiner.**
> Vor einem Bau steht derselbe Zwischenschritt wie bei B22 und B23 — erst eine Bestandsaufnahme gegen
> den echten Code, dann die Entscheidungen, dann ein Pflichtenheft." Dieses Dokument ist dieser
> Zwischenschritt.

---

## Kurzfassung — die sieben Befunde in je einem Satz

- **Q1 — Contract-Bindung: ja, vollständig.** `PdfReportAnalysis` ist ein `Pick<AnalysisResult, …>`
  über **sieben der acht** Top-Level-Felder (ausgelassen ist genau `peaks`); `PdfReportInput` hat
  **zehn** Felder. Zwischen den vom Report gelesenen Blattwerten und den vom Wizard geschriebenen
  Entwurfsschlüsseln gibt es **zwei** Namensgleichheiten (`energyPriceCtPerKwh`,
  `einspeiseverguetungCtPerKwh`) — alles Übrige wird gerechnet statt erfasst, allen voran der volle
  `LoadProfile`. Dazu zwei Hindernisse, die keine Feldliste zeigt: es gibt **keinen Engine-Einstieg**,
  der ein vollständiges `AnalysisResult` erzeugt (`computeAnalysis` liegt app-lokal), und der
  PDF-Weg ist **browsergebunden** (DOM-Mount für die Diagramme).
- **Q2 — Nahe-Null-Strecken: keine Erkennung im Code, genau EIN Treffer im ganzen Repo — und der
  steht in einem System-Prompt.** `apps/web/lib/project-chat/system-prompt.ts:223` weist die Prüfung
  dem Sprachmodell zu. Was gebaut ist, ist die **Lücken**-Erkennung (fehlende Zeitstempel), zweifach,
  und sie ist per Konstruktion blind für vorhandene Werte nahe null. **Die Zeitreihe, an der der
  Prompt-Satz zu prüfen wäre, erreicht das Modell über keinen seiner drei Werkzeug-Kanäle.**
- **Q3 — Jahres-Hochrechnung: eine der drei Zutaten ist gebaut.** `annualizationFactor`
  (`packages/engine/src/savings/annualization.ts:71`) rechnet mit **genau einem Faktor
  `365 / coveredDays`** auf **zwei** Energie-Töpfe hoch, unter offengelegter Homogenitäts-Annahme und
  mit mitgeführtem Rohwert. Eine Referenzperiode nach Kälte existiert **nicht**; eine
  Marktpreis-Nachladung durch den Rechner existiert **nicht** (der Rechner bricht bei einer
  Preislücke ab). Die Funktion ist **nicht** über `packages/engine/src/index.ts` exportiert.
- **Q4 — Kapitel „Annahmen und Datengrundlage": 168 Code-Zeilen in `basis.ts`, 15 JSX-Zeilen in
  `document.tsx`, eine zweispaltige Label/Wert-Liste mit 4 oder 8 Zeilen.** Keine der drei erfragten
  Strukturen existiert: **keine** Datenquellen-Tabelle (das Kapitel liest `LoadProfile.source` nicht
  einmal), **keine** Tarifkomponenten-Tabelle (3 von 13 Tarifgrössen mit Wert), **keine**
  Berechnungsmethodik je Kennzahl. Das Methodik-Kapitel ist ein **zweites, getrenntes** Kapitel mit
  sechs pauschalen Punkten.
- **Q5 — Fünf-Balken-Grafik: `MonthlyTariffChart` zeichnet drei Serien** (`monthly-tariff-chart.tsx:60-76`),
  als Farbserien über zwölf Monatsgruppen, nicht als Balken auf einer Szenario-Achse. Zwei der fünf
  genannten Balken haben im Kalkulator keine Entsprechung: „einfacher Tarifwechsel" ist als vier
  Entwurfsfelder **erfasst, aber nicht gerechnet** (als fertige Rechnung liegt er im
  Monitor-Produkt), „aWATTar optimal" ist an drei Stellen als **ausdrücklich nicht gerechnet**
  dokumentiert.
- **Q6 — zwei Ersparnis-Zahlen nebeneinander: ja, an fünf Orten.** Der Contract führt **elf**
  Euro-Ersparnisgrössen. Der PDF-Report stellt zwei seiner vier Kernergebnis-Aussagen einen
  expliziten Verhältnis-Satz zur Seite; für `addon` bekommt der Bauer den dafür vorgesehenen Schalter
  gar nicht übergeben. Am Bildschirm steht die Nicht-Additions-Aussage zur Ladesteuerungs-Karte nur
  in einer **per Vorgabe zugeklappten** `InfoHint`; eine andere, unbedingt sichtbare
  Nicht-Additions-Aussage existiert daneben (`recommendation-card.tsx:307-317`). Rechnerisch
  abgesichert ist die Zuordnung an **vier** Stellen, alle in `packages/**` — in `apps/website` gibt
  es **0 Testdateien und kein `test`-Skript**.
- **Q7 — Report-Freiheitsmodell: nicht ausgearbeitet.** §5.1 umfasst **8 Zeilen**, die drei Stufen
  selbst **3 Zeilen mit zusammen 58 Wörtern**; im ganzen §5 (18 Zeilen) stehen **vier** in Backticks
  gesetzte Bezeichner, und alle vier benennen **Bestehendes**. Die Stufen sind entschieden, der
  **Inhalt** des Baukastens ist der offene Punkt 5 in §9. Im Code: **0 Treffer** auf das gesamte
  Begriffsfeld.

### Drei Befunde, nach denen keine der sieben Fragen gefragt hat

- **Der react-pdf-Report erreicht heute keinen Kunden.** Der Knopf im Rechner löst
  `window.print()` gegen das Print-Stylesheet aus (`step-result.tsx:99`); der react-pdf-Weg hängt an
  `REACT_PDF_REPORT_ENABLED` mit Vorgabe AUS (`pdf-report-flag.ts:39`). **Alles, was Q1, Q4, Q5 und
  Q6 über `lib/pdf-report/**` messen, beschreibt ein Dokument, das heute nur über die unverlinkte
  `noindex`-Prüfroute erreichbar ist.**
- **Es gibt DREI Report-Artefakte, nicht zwei.** Bildschirm (947 Z.), react-pdf (7.072 Z., aus) und
  der CSS-Druckweg (399 Z., an). Das produktive Artefakt hat **weder Inhaltsverzeichnis noch
  „Seite X von Y"** — beides existiert nur im abgeschalteten Weg.
- **Der heutige Baukasten hat über sieben Kapitel genau ZWEI An/Aus-Schalter und keine
  Umsortierung** (`content.ts:292-301`). Das ist die messbare Ausgangslage für „Auswahl & Struktur
  frei" (`Pflichtenheft_Kalkulator_Delta_KI-Interface.md:180`).

---

## 0. Stand der Messung

| Messung | Ergebnis |
|---|---|
| `git rev-parse --short HEAD` | `4dc3231` — identisch mit `origin/main` |
| `git log --oneline -1` | `4dc3231 docs: Session-Handover 15.09.2026 - B24-Stand aktualisiert (#247)` |
| Branch | `docs/report-baukasten-bestandsaufnahme` (von frischem `origin/main` abgezweigt) |
| `git status --porcelain` | **leer (0 Zeilen)** |

**Ein Zustandswechsel während der Messung, offengelegt:** Der erste Messpunkt lief noch gegen
`1d18532` auf `docs/b24-handover-15-09` — der lokalen, noch nicht gemergten Fassung desselben
Handovers. `git diff --stat 1d18532 4dc3231` liefert **0 Zeilen Ausgabe**; zusammen mit dem leeren
`git status` ist der Arbeitsbaum damit inhaltsgleich. Alle Zeilenzahlen unten wurden nach dem Wechsel
gegen `4dc3231` erneut erhoben.

### 0.1 Umfang der gelesenen Dokumente (`wc -l`)

| Datei | Zeilen |
|---|---|
| `Pflichtenheft_Kalkulator_Delta_PDF-Report.md` | 1.966 |
| `KI-Interface_Kalkulator_Bestandsaufnahme.md` | 727 |
| `Report_Verstaendlichkeit_Bestandsaufnahme.md` | 571 |
| `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` | 424 |
| `Fahrplan_2026.md` | 381 |
| `B24_KI-Interface_Kalkulator.md` | 346 |
| `PDF_Rendering_Spike_Bestandsaufnahme.md` | 255 |
| `CLAUDE.md` | **139** |
| **Summe** | **4.809** |

### 0.2 Umfang des gelesenen Code-Bestands

| Verzeichnis | Dateien | Zeilen |
|---|---|---|
| `apps/website/lib/pdf-report/` | 20 | 7.072 |
| `apps/website/app/pdf-report-probe/` | 8 | 3.091 |
| `apps/website/components/report/` | 24 | 5.708 |

Grösste Einzeldateien: `lib/pdf-report/document.tsx` 1.526 · `app/pdf-report-probe/probe-client.tsx`
987 · `components/report/report.tsx` 947 · `lib/pdf-report/summary.ts` 747 ·
`app/pdf-report-probe/chart-runs.tsx` 565. Die vier `print-*.tsx` zusammen 399.

---

## 1. Vorbemerkung: die Pflichtlektüre verweist auf Absätze, die es nicht mehr gibt

Die Aufgabenstellung verlangt „`CLAUDE.md`, alle `[GEBAUT: B23 …]` und `[GEBAUT: B24 …]` Absätze".
**Diese Absätze stehen im aktuellen `CLAUDE.md` nicht.**

### 1.1 Fehlanzeige mit Positivkontrolle

| Suchmuster in `CLAUDE.md` (139 Zeilen) | Treffer |
|---|---|
| `GEBAUT` | **0** |
| `[GEBAUT:` | **0** |
| `B23` | **0** |
| `B24` (Positivkontrolle) | 3 (Z. 9, 117, 139) |
| `B14` / `B16` (Positivkontrolle) | 3 / 2 |
| `gebaut` case-insensitiv (Positivkontrolle) | 6 (Z. 9, 46, 78, 106, 107, 139) |

Der Suchraum ist damit als korrekt belegt: dieselbe Datei liefert auf vier andere Muster Treffer.
Die sechs case-insensitiven Treffer sind Fliesstext („**gebaut, 22.07.2026**", `CLAUDE.md:9`;
„**Weiterhin nicht gebaut:**", `CLAUDE.md:139`), keine Handover-Absätze.

### 1.2 Die Historie — zwei Commits am 15.09.2026, zweieinhalb Stunden auseinander

| Commit | Datum | `GEBAUT` | `GEBAUT: B23` | `GEBAUT: B24` | Zeilen |
|---|---|---|---|---|---|
| `4dc3231` (HEAD) | 15.09. 21:03 | **0** | 0 | 0 | 139 |
| `d7699eb` | 15.09. 19:44 | **0** | 0 | 0 | 125 |
| `c6ae581` | 15.09. 17:15 | **27** | **0** | **23** | 493 |
| `4089ddf` | 15.09. 16:53 | **117** | **9** | **23** | 1.719 |

| Commit | Nachricht | `--numstat` an `CLAUDE.md` |
|---|---|---|
| `c6ae581` | `docs: CLAUDE.md - aeltere Handover-Eintraege verdichtet (1719 auf ca. 490 Zeilen) (#237)` | **+19 / −1245** |
| `d7699eb` | `feat/energieberater kundenfreundliche sprache (#242)`, dritter Teilcommit: „docs: CLAUDE.md - B24 Handover-Eintraege verdichtet" | **+14 / −382** |

`c6ae581` (Verdichtung der **älteren** Einträge) hat die neun B23-Absätze entfernt und alle 23
B24-Absätze stehen lassen — Fehlanzeige `GEBAUT: B23` = 0 bei Positivkontrolle `GEBAUT: B24` = 23 in
derselben Datei. `d7699eb` hat anschliessend auch die B24-Absätze entfernt.

**Folge für die Fahrplan-Verweise:** `Fahrplan_2026.md:75` und `:292` verweisen für den
Einzelnachweis je Bauschritt auf „die `[GEBAUT: B24 …]`-Absätze von `CLAUDE.md`". Dieser Verweis geht
seit `d7699eb` ins Leere. Arbeitsgrundlage dieser Bestandsaufnahme ist deshalb
`git show 4089ddf:CLAUDE.md` (1.719 Zeilen); Zitate aus B23-Absätzen tragen unten die Zeilennummer
**dieser Fassung**.

### 1.3 ⚠ Der Filter `B23` verliert die beiden jüngsten Bauschritte

Die neun `[GEBAUT: B23 …]`-Absätze sind nicht der vollständige Bauverlauf des Report-Wegs. Die zwei
letzten Schritte tragen eine andere Beschriftung und fallen durch jeden `B23`-Filter:

| Fundstelle in `4089ddf:CLAUDE.md` | Absatz |
|---|---|
| `:495` | `[GEBAUT: Cutover Teil 1 — der neue PDF-Weg ist bedienbar, hinter einem Schalter mit Vorgabe AUS. Diese PR schaltet NICHTS um]` (05.09.2026) |
| `:481` | `[GEBAUT: D22 — Gestaltung des PDF-Reports: navyfarbenes Deckblatt, Abschlussseite, und der Zeilenabstand, der NIE gewirkt hat]` (06.09.2026) |

Wer nach `B23` filtert, verliert genau den Schritt, der **den Schalter angelegt** hat (§2.2) und den,
der **die Abschlussseite gebaut** hat (§10.3). Zwei belastbare Messwerte stehen ausschliesslich dort:
„**DER REPORT SCHRUMPFT VON 15 AUF 10 SEITEN**" (`:484`) und „`@react-pdf` über den GESAMTEN
First-Load-Satz **0×**" (`:491`). Der Report-Weg hat damit **elf** dokumentierte Bauschritte, nicht
neun.

---

## 2. Der Ausgangszustand: drei Report-Artefakte, eines davon live

### 2.1 Der B23-Baustand aus den elf Absätzen

| Schritt | Datum | Was gebaut | Live? |
|---|---|---|---|
| **B23a** | 03.09. | Dokumentgerüst: `theme/types/content/derive/fonts/page-numbers/document/render/download`, drei Inter-WOFF unter `public/report-fonts/`, die Prüfroute `/pdf-report-probe`, zwei Dokumentfelder im Gate-Dialog (PR #150) | **Nein** (`:691`) |
| **B23b** | 03.09. | Generische Chart-Rasterbild-Pipeline (`chart-raster.ts`, `chart-capture.ts`, `chart-probe.tsx`), an DREI Chart-Typen bewiesen | **Nein** (`:674`) |
| **B23c-1** | 03.09. | Kernergebnisse (`summary.ts`); B23a-Platzhalterseite ersatzlos weg | **Nein** (`:658`) |
| **B23c-2** | 03.09. | Erster gerasterter Chart im echten Dokument, `statement.ts`, `recommendation.ts`, `charts.tsx` | **Nein** (`:638`) |
| **B23c-3a** | 04.09. | Kostenvergleich + Tages-Energiefluss (`detail.ts`) — 3 von 7 Grafiken | **Nein** (`:620`) |
| **B23c-3b-1** | 04.09. | Stunden-Heatmap + Ø-Ladepreis (`insight.ts`) — 5 von 7 | **Nein** (`:603`) |
| **B23c-3b-2** | 04.09. | Grenznutzen-Kurve, Zusatzspeicher, Katalog-Alternativen (`comparison.ts`) — 6 von 7 | **Nein** (`:585`) |
| **B23c-4** | 04.09. | Drei Hinweise + Schlusskapitel „Annahmen und Datengrundlage" (`basis.ts`) | **Nein** (`:562`) |
| **B23c-5** | 04.09. | PV-Schätzungshinweis — „das Dokument trägt jetzt ALLE Bildschirm-Inhalte" | **Nein** (`:540`) |
| *(D19/D20)* | 04.09. | Zwei Messreihen: Erzeugungsdauer; Einblend-Animation für den Rasterungspfad abgeschaltet (~1,5 s) | **Nein** (`:526`, `:512`) |
| **Cutover Teil 1 (D21)** | 05.09. | `pdf-report-flag.ts` neu; `step-result.tsx` und `.env.example` geändert. „Diese PR schaltet NICHTS um." | **Schalter vorhanden, Vorgabe AUS** (`:496`) |
| *(D22)* | 06.09. | Navy-Deckblatt + Abschlussseite, `lineHeight`-Befund, Report **15 → 10 Seiten** (`:484`) | **Nein** — „Der Schalter aus D21 bleibt AUS" (`:481`) |
| **B23d** | — | Calls-to-Action-Seite | **nicht gebaut**, blockiert (s. §10.3) |

Die wörtliche Formulierung „DER WEG IST WEITERHIN NICHT LIVE" steht in der Altfassung **9×**
(Z. 512, 526, 540, 562, 585, 603, 620, 638, 658), dazu eine Variante ohne „WEITERHIN" auf `:691`.
Wortlaut typisch (`:540`): „Der Knopf im Rechner löst unverändert `window.print()` gegen das
Print-Stylesheet aus; der react-pdf-Weg ist ausschliesslich über die unverlinkte, `noindex`-Route
`/pdf-report-probe` erreichbar."

### 2.2 Der Cutover-Schalter, im Code

| Fundstelle | Zustand |
|---|---|
| `apps/website/lib/pdf-report-flag.ts:39` | `export const REACT_PDF_REPORT_ENABLED = process.env.NEXT_PUBLIC_PDF_REPORT_ENGINE === 'react-pdf'` — die **einzige** Anweisung der Datei (39 Zeilen, davon 38 Kommentar) |
| `pdf-report-flag.ts:10-15`, `:21-29` | fail-closed auf genau diese Zeichenkette; der Zugriff muss wörtlich so stehen bleiben, weil Next `NEXT_PUBLIC_*` **textuell zur Bauzeit** ersetzt — Ein- wie Ausschalten verlangt ein neues Deployment |
| `apps/website/components/flow/step-result.tsx:28` | der **einzige** Import im ganzen Repo; ausgewertet an fünf Stellen (`:261`, `:354`, `:379`, `:385`, `:420`) |
| `step-result.tsx:354` | `REACT_PDF_REPORT_ENABLED ? requestPdf() : setPrintRequested(true)` — die Weiche am Knopf; ein zweites Mal auf `:385` für den Weg durch das Gate |
| `step-result.tsx:96-100` | `useEffect` auf `printRequested` → `window.print()` (`:99`) — der **einzige tatsächliche Aufruf** im gesamten Anwendungscode |
| `step-result.tsx:378-382` | `documentFields` wird **nur** bei eingeschaltetem Schalter gesetzt, sonst `undefined` |
| `report-gate-dialog.tsx:76-77` | „OHNE `documentFields` ist diese Komponente Zeile für Zeile die bisherige" — die zwei Deckblatt-Felder (freier Titel, Anschrift) sind heute dunkel |
| `.env.example:48` | `# NEXT_PUBLIC_PDF_REPORT_ENGINE=react-pdf` — **auskommentiert** |
| `DEPLOYMENT.md:1068`, `:1075` | „§1-Website-e … **HEUTE AUS**" / „**HEUTE NICHT GESETZT, und das ist der beabsichtigte Zustand.**" |
| `apps/website/app/pdf-report-probe/page.tsx:26-30` | `robots: { index: false, follow: false }`; der Kopf `:9-12` hält fest, dass die App weder `sitemap.ts` noch `robots.ts` führt |

`grep -rn "NEXT_PUBLIC_PDF_REPORT_ENGINE"` über das ganze Repo (ohne `node_modules`/`.next`/`.git`)
liefert **8 Treffer**, und keiner ist ein gesetzter Wert. Positivkontrolle im selben Suchraum:
`.env.example:7` und `:10` sind unkommentierte `NEXT_PUBLIC_*`-Zeilen. Es existieren genau zwei
`.env`-Dateien im Repo (`./.env.example`, `./apps/web/.env.example`), keine `.env` oder `.env.local`.

⚠ **Nicht gemessen:** der Live-Zustand der Variable im Vercel-Projekt `peak-shaving-website`. Weil
`NEXT_PUBLIC_*` zur Bauzeit textuell ersetzt wird, beweist ein Repo-Grep den ausgelieferten Zustand
nicht; der Nachweis liefe über die Projekt-Env per Vercel-API plus einen Grep im ausgelieferten
`/_next/static/chunks` des Rechner-Hosts. `DEPLOYMENT.md:1075` ist eine Dokumentationsaussage.

### 2.3 Drei Artefakte, und das produktive ist das ärmste

| Artefakt | Umfang | Zustand |
|---|---|---|
| Bildschirm-Report | `components/report/report.tsx` 947 Z. | **an** |
| react-pdf-Weg | `lib/pdf-report/` 20 Dateien, 7.072 Z. | **aus** |
| CSS-Druckweg | `print-cover.tsx` 118 + `print-frame.tsx` 106 + `print-methodology.tsx` 86 + `print-assumptions-snapshot.tsx` 89 = **399 Z.** | **an** |

`apps/website/app/globals.css:111` trägt den einzigen `@media print {`-Block der App; `report.tsx`
allein führt 18 `print:`-Utilities, über `components/` + `app/` zusammen **63**.

**Fehlanzeige mit Positivkontrolle:** Suchmuster `agenda|Seite .* von|inhaltsverzeichnis`
(case-insensitiv) über `components/report/print-*.tsx` und `app/globals.css` → **0 Treffer**;
Positivkontrolle `Methodik` im selben Suchraum → 2 Treffer (`print-methodology.tsx:4`, `:41`). Der
Kunde bekommt heute also ein Dokument **ohne Inhaltsverzeichnis und ohne „Seite X von Y"** — beides
existiert nur im abgeschalteten Weg (`lib/pdf-report/page-numbers.ts` 109 Z.; `document.tsx:753`
`Agenda`).

### 2.4 Der heutige Baukasten, ausgezählt

**Darstellungstypen — `apps/website/lib/pdf-report/statement.ts` (149 Z., 8 Exporte):**

| Fundstelle | Baustein |
|---|---|
| `statement.ts:18` | `ReportTone = 'positive' \| 'warning' \| 'neutral'` |
| `statement.ts:30` | `ReportFigure` (Bildunterschrift + optionaler Zusatz) |
| `statement.ts:37` | `ReportRow` (Beschriftung, Hinweis, Wert, Ton, Abschlusszeile) |
| `statement.ts:55` | `ReportStatement` (id, Titel, optionale Grosszahl, Zeilen, Fliesstext, Zusatzsätze) |
| `statement.ts:88` / `:103` / `:110` | `ReportTableColumn` / `ReportTableRow` / `ReportTable` |
| `statement.ts:129` | `ReportNotice` |

`statement.ts:11-14` zieht die Trennlinie wörtlich: „Es ist ausdrücklich eine DARSTELLUNGS-Form und
kein fachlicher Typ: was in einer Aussage steht, entscheidet die jeweilige Ableitung; wie es
aussieht, entscheidet `document.tsx`." Das ist die Schicht, die
`Pflichtenheft_Kalkulator_Delta_KI-Interface.md:189` unter „vorqualifizierte Aussage-Bausteine"
meint.

**Generische Renderer in `document.tsx`, fünf Stück:** `StatementRow:799`, `Notice:836`,
`Statement:873`, `StatementTable:927`, `ChartFigure:1062`.

**Kapitel-Ableitungen — sieben Module, sieben Renderer:**

| Modul | Zeilen | Renderer | Abschnittskonstante |
|---|---|---|---|
| `summary.ts` | 747 | `ResultsChapter` (`document.tsx:994`) | `content.ts:113` |
| `recommendation.ts` | 314 | `RecommendationChapter` (`:1148`) | `content.ts:132` |
| `detail.ts` | 380 | `DetailChapter` (`:1193`) | `content.ts:165` |
| `insight.ts` | 429 | `InsightChapter` (`:1277`) | `content.ts:192` |
| `comparison.ts` | 365 | `ComparisonChapter` (`:1323`) | `content.ts:221` |
| `content.ts:42` (`METHODOLOGY_ITEMS`) | — | `MethodologyChapter` (`:1352`) | `content.ts:236` |
| `basis.ts` | 346 | `BasisChapter` (`:1386`) | `content.ts:261` |

**Und die entscheidende Zahl: die Struktur hat heute genau ZWEI Freiheitsgrade.**

| Fundstelle | Zustand |
|---|---|
| `content.ts:292-301` | `ReportChapterPresence = { insight: boolean; comparison: boolean }` — **zwei** Felder |
| `content.ts:316-329` | `buildReportAgenda(presence)` — 5 feste Abschnitte, 2 bedingte, in **fester** Reihenfolge |
| `document.tsx:1441-1442` | `hasInsight` / `hasComparison`, **einmal** gebildet |
| `document.tsx:1457-1523` | **10** `<Page>`-Elemente, davon 2 bedingt (`:1489`, `:1497`) |

Über sieben Kapitel gibt es also **zwei** An/Aus-Schalter und **keine** Umsortierung. Die zwei
bedingten Kapitel sind namentlich „Das Ladeverhalten Ihres Speichers" (`INSIGHT_SECTION`,
`content.ts:192`) und „Speichergrösse und Gerätewahl" (`COMPARISON_SECTION`, `content.ts:221`).

⚠ **Der Bezeichner `REPORT_AGENDA` existiert im Code nicht mehr** — `content.ts:316` heisst
`buildReportAgenda`; `REPORT_AGENDA` steht nur noch in zwei Kommentaren (`content.ts:183`, `:337`).
`Fahrplan_2026.md:298` benutzt weiterhin den alten Namen.

**Chart-Bestand:** `components/report/` führt **sieben** Recharts-Komponenten (`load-chart`,
`cost-chart`, `monthly-tariff-chart`, `energy-flow-chart`, `battery-flow-heatmap`,
`charge-price-chart`, `marginal-benefit-chart`), alle sieben werden in `charts.tsx:1-7` importiert.
`ReportChartRasters` (`charts.tsx:70-141`) hat aber nur **sechs** Bildplätze (`load`, `cost`, `flow`,
`hourFlow`, `chargePrice`, `comparison`), dazu zwei Felder, die eine dieser sechs in einander
ausschliessende Fassungen teilen: `costKind: 'monthly' | 'cumulative' | null` (`:90`) und
`comparisonVariant: 'addon' | 'catalog' | null` (`:124`). Am Bildschirm stehen **acht**
Zeichenflächen — `cost-chart.tsx` trägt zwei `ResponsiveContainer` (`:165`, `:225`), und
`charts.tsx:340-344` hält fest: „`selectRechartsSurface` rastert den ERSTEN Zeichenbereich … der
ZWEITE Chart … bleibt bewusst draussen". Die gestapelte Ersparnis-Aufschlüsselung
(`cost-chart.tsx:152-155`) ist damit **bildschirmexklusiv** — das berührt Q6 unmittelbar.

**Fehlanzeige mit Positivkontrolle:** `Baukasten` über `apps/**` + `packages/**` (`*.ts`, `*.tsx`,
ohne `node_modules`/`.next`) → **0 Treffer**; Positivkontrolle: derselbe Begriff über die `*.md` im
Root → 7 Treffer (`CLAUDE.md:137`, `Fahrplan_2026.md:75`, `:292`,
`Pflichtenheft_Kalkulator_Delta_KI-Interface.md:34`, `:180`, `:183`, `:248`, `:392`). Ebenso
`reportsection|reportlayout|reportblock|reportcomposition|reportplan|reportstructure` über
`packages/shared/src` + `packages/engine/src` → **0 Treffer**; Positivkontrolle `Report` im selben
Suchraum → 10+ Dateien. **Die acht Darstellungstypen liegen app-lokal in `apps/website`, nicht in
`shared`** — `packages/shared/src/` führt 33 Nicht-Test-Module, report-bezogen sind genau zwei
(`report-gate.ts`, `report-request.ts`).

---

## 3. Frage 1 — Ist der react-pdf-Report an `AnalysisResult` gebunden?

**Ja, vollständig — und der Wizard-Entwurf steht ihm als reine Eingabeseite gegenüber.**

### 3.1 `PdfReportAnalysis` — ein `Pick` über sieben von acht Feldern

```ts
// apps/website/lib/pdf-report/types.ts:93-102
export type PdfReportAnalysis = Pick<
  AnalysisResult,
  | 'current' | 'perBattery' | 'recommendation' | 'assumptions'
  | 'tariffOptimization' | 'existingBatteryAnalysis' | 'dataQuality'
>
```

Der Kopfkommentar (`types.ts:10`) spricht noch von „GENAU die sechs Felder"; `types.ts:78` erklärt
den siebten (`dataQuality`, B23c-4).

`AnalysisResult` (`packages/shared/src/analysis-result.ts:263`) hat **acht** Top-Level-Felder, davon
**zwei** optional:

| Zeile | Feld | optional? | im `Pick`? |
|---|---|---|---|
| 264 | `current` | nein | ja |
| **270** | **`peaks`** | nein | **nein** |
| 274 | `perBattery` | nein | ja |
| 275 | `recommendation` | nein | ja |
| 279 | `assumptions` | nein | ja |
| 302 | `tariffOptimization` | **ja** | ja |
| 320 | `existingBatteryAnalysis` | **ja** | ja |
| 321 | `dataQuality` | nein | ja |

`peaks` ist das einzige ausgelassene Feld — und es wird auch am Bildschirm nicht gebraucht:
`result\.peaks|analysis\.peaks|\.peaks\b` über `components/report` + `lib/pdf-report` → **0 Treffer**;
Positivkontrolle `result.current|analysis.current` im selben Suchraum → Treffer (`report.tsx:357`,
`:358`, `:391`, `:658`; `charts.tsx:300`).

### 3.2 `PdfReportInput` — zehn Felder

| Zeile | Feld | Typ | Pflicht/optional |
|---|---|---|---|
| 124 | `title` | `string` | Pflicht |
| 126 | `subtitle` | `string` | Pflicht, abgeleitet, nicht editierbar |
| 127 | `customer` | `PdfReportCustomer` | **optional** |
| 129 | `period` | `string \| null` | Pflicht, `null`-fähig |
| 132 | `printedAt` | `string` | Pflicht, hereingereicht |
| 140 | `analysis` | `PdfReportAnalysis` | Pflicht |
| 159 | `loadProfile` | `LoadProfile` | Pflicht |
| 175 | `tariffSource` | `TariffSourceRef \| null` | Pflicht, `null`-fähig |
| 189 | `tariffVintage` | `string \| null` | Pflicht, `null`-fähig |
| 213 | `estimatedPv` | `EstimatedPvSummary` | **optional** |

`PdfReportCustomer` (`:111-120`) hat drei optionale Felder: `name` (112), `company` (113), `address`
(119). Der Kommentar an `address` (`:114-118`) hält fest, dass die Adresse „NICHT erfasst und NICHT
gespeichert" wird. Drei Felder stehen ausdrücklich **nicht** in `analysis`, je einzeln begründet:
`loadProfile` („`DispatchTrace` trägt bewusst KEINE Rohreihe", `:144-148`), `tariffSource` („die
Engine rechnet mit TARIFWERTEN und nicht mit ihrer Herkunft", `:164-168`) und `estimatedPv` („Es
steht nicht im `AnalysisResult`, und zwar an keiner Stelle", `:197-203`).

### 3.3 Wer den Eingang baut — die Aufrufkette

Es gibt genau **zwei** Aufrufer von `downloadReportPdf`: den Prüfstand
(`app/pdf-report-probe/probe-client.tsx:268`) und den Rechner-Weg (`step-result.tsx:182`) — Letzterer
hinter dem Schalter aus §2.2, also heute unerreichbar.

Das Objektliteral steht in `step-result.tsx:190-213`:

| Zeile | Feld | Woher der Wert kommt |
|---|---|---|
| 190 | `title` | `customer.title` (Gate-Formular) oder `defaultReportTitle(result)` |
| 191 | `subtitle` | `reportSubtitle(load.profile)` — liest `loadProfile.source` |
| 192–196 | `customer` | `ReportGateCustomer` aus dem Gate-Dialog |
| 197 | `period` | `formatAnalysisPeriod(load.profile)` |
| 198 | `printedAt` | `formatPrintedAt(now)` |
| 199 | `analysis` | **`result`** — das Worker-Ergebnis |
| 200 | `loadProfile` | `load.profile` — der geparste Lastgang |
| 201 | `tariffSource` | aus `payload.tariffSelection` + `activeTariff` (`:113-120`) |
| 208 | `tariffVintage` | `tariffVintageNote(load.profile, payload.tariff, now)` |
| 213 | `estimatedPv` | `payload.estimatedPv?.summary` |

Rückwärts: `step-result.tsx:61` (`result: AnalysisResult`) ← `calculator.tsx:111`
(`analysis.displayResult`, dazu `load` `:120` und `payload` `:121`) ← `use-analysis.ts:74`/`:98`
(Worker-Start), `:106` (`setResult`) ← `analysis.worker.ts:14` (Import aus `'engine'`), `:336`
(`computeAnalysis(msg.payload, DEFAULT_HORIZON_YEARS, DEMO_BATTERY_CATALOG)`), `:302-312` (der
`assumptions`-Block). `payload` ist `CalculatorPayload` (`components/flow/types.ts:164-166`) =
`TariffResult` (`:17`) **&** `{ load: ParsedLoad }` (`:110-124`) — also der Formularzustand der
Schritte 1 und 2. **Der Report bezieht damit beides: das gerechnete Ergebnis und den
Formularzustand.**

### 3.4 ⚠ Zwei Hindernisse, die keine Feldliste zeigt

**(a) `computeAnalysis` ist app-lokal, nicht Teil der Engine.** Die Funktion steht in
`apps/website/lib/analysis.worker.ts:191` mit der Signatur `(payload, horizonYears, catalog):
AnalysisResult`. `packages/engine/src/index.ts:5-17` exportiert neun Teilbereiche (`parser`,
`tariff`, `peaks`, `simulation`, `savings`, `roi`, `recommendation`, `standard-profile`,
`pv-generation`), aber **keinen Einstieg, der ein vollständiges `AnalysisResult` erzeugt**;
`grep -rn "computeAnalysis" packages/` → **0 Treffer**. Auch der Prüfstand baut sie nicht nach,
sondern fährt denselben Worker (`app/pdf-report-probe/analysis-run.ts:43-49`).

**(b) Der PDF-Weg braucht einen Browser.** `lib/pdf-report/download.ts:122` („Läuft vollständig im
Browser"), `:147-154` (`URL.createObjectURL`, `document.createElement('a')`). Die Diagramme entstehen
aus echtem DOM: `chart-capture.ts:2` (`createRoot` aus `react-dom/client`), `:241`
(`document.createElement('div')`), `:250` (`document.body.appendChild`), `:254` (`createRoot`);
`chart-raster.ts:11-15`: „was gerastert wird, ist ein DOM-Element". Einziger Render-Einstieg ist
`renderReportPdf(input: PdfReportInput)` (`render.tsx:158`).

### 3.5 Die andere Seite: der Wizard-Entwurf

`tariffParamsSchema` (`packages/shared/src/tariff.ts:55-114`) hat **13 Schlüssel**, davon fünf
Pflicht:

| Zeile | Schlüssel | Pflicht? |
|---|---|---|
| 56 | `leistungspreisEurPerKwYear` | **ja** |
| 57 | `billingModel` | **ja** |
| 58 | `minBillableKw` | **ja** |
| 59 | `arbeitspreisNetzCtPerKwh` | nein |
| 60 | `energyPriceCtPerKwh` | **ja** |
| 61 | `energyPriceNightCtPerKwh` | nein |
| 62 | `timeOfUseWindows` | nein |
| 63 | `dynamicPriceProfile` | nein |
| 64 | `einspeiseverguetungCtPerKwh` | **ja** |
| 79 | `supplierBaseFeeEurPerMonth` | nein |
| 111 | `meteringVariant` | nein |
| 112 | `netzebene` | nein |
| 113 | `benutzungsdauerModel` | nein |

`apps/web/lib/project-chat/tools.ts:83` leitet `DRAFT_CONTRACT_FIELDS` aus
`Object.keys(tariffParamsSchema.shape)` ab, `:91-94` die Pflichtmenge über `field.isOptional()`.

`platform.metering_points` hat **neun Spalten**: `id` (`20260911090000:43`), `project_id` (`:45`),
`created_at` (`:47`), `interval_minutes` (CHECK in 15, 60, `20260911120000:43`), `covered_from`
(`:48`), `covered_to` (halboffen, `:55`), `gaps` (`jsonb not null default '[]'`, `:65`),
`source_document_id` (`:79`) und `draft` (`jsonb not null default '{}'`, CHECK Objekt,
`20260911150000:57`). Der Spaltenkommentar (`20260911150000:60-68`): „der laufende Entwurf der
Eingabedaten DIESES Zählpunkts — das Pendant zu TariffParams, während es entsteht".

**Neun Contract-Schlüssel** schreiben die Wizard-Stationen (`invoice-extractions.ts:248-259`,
`data-entry-actions-rechnung.ts:844-878`): `netzebene`, `meteringVariant`,
`leistungspreisEurPerKwYear`, `minBillableKw`, `arbeitspreisNetzCtPerKwh`, `energyPriceCtPerKwh`,
`energyPriceNightCtPerKwh`, `einspeiseverguetungCtPerKwh`, `supplierBaseFeeEurPerMonth`.

**Vier Contract-Schlüssel schreibt KEINE Station**: `billingModel`, `timeOfUseWindows`,
`dynamicPriceProfile`, `benutzungsdauerModel` — `billingModel` ist darunter das einzige
**Pflicht**feld. ⚠ Das heisst nicht „nie geschrieben": `set_draft_field`
(`apps/web/lib/project-chat/tools.ts:162-215`, ausgeführt in `executor.ts:115`) schreibt in denselben
`draft` und nimmt `field` als **freie Zeichenkette** (`:197-200`); seine Beschreibung nennt alle 13
Contract-Felder wörtlich (`:184`). Ein Literal-Grep kann diesen Weg strukturell nicht finden — der
Feldname entsteht zur Laufzeit.

**26 Nicht-Contract-Schlüssel** stehen daneben im selben `jsonb`: `annualConsumptionKwh`
(`standard-profile.ts:31`), sechs Batterie-Schlüssel (`battery-draft.ts:36`, `:46`, `:59`, `:67`,
`:75`, `:84`), zehn PV-Schlüssel (`pv-draft.ts:47`; `pv-profile-draft.ts:66`, `:69`, `:79`, `:88`,
`:91`, `:108`, `:116`, `:125`, `:136`/`:137`), `invoiceSkipped` (`invoice-extractions.ts:113`), vier
Tarif-Schlüssel (`tariff-draft.ts:37-40`) und vier Seiteneinträge mit `_`-Vorsilbe
(`_invoiceExtractions`, `_provenance`, `_pvArrays`, `_pvProfileGaps`).

### 3.6 Gegenüberstellung

| PDF-Report verlangt | Wizard-Entwurf | Zustand |
|---|---|---|
| `title` | — | FEHLT (Gate-Dialog bzw. `defaultReportTitle`, `derive.ts:40`) |
| `subtitle` | `MeteringPointSummary.profileSource` | wird gerechnet (`derive.ts:55-61` liest `loadProfile.source`) |
| `customer.name` / `.company` | `platform.projects.customer_label` (**ein** Feld) | anderer Name, zusammengelegt |
| `customer.address` | — | FEHLT (`grep -rn "address" supabase/migrations/` → 0; einzige Ortsangabe: `projects.postal_code`, `20260913090000:60`) |
| `period` | `metering_points.covered_from`/`covered_to` | anderer Name, Rohwerte, andere Intervallkonvention (`20260911120000:49-54`) |
| `printedAt` | — | FEHLT (Uhr zum Klickzeitpunkt) |
| `analysis` (7 Contract-Felder) | — | FEHLT, s. unten |
| `loadProfile` | nur Metadaten, **keine `readings`** | FEHLT, s. §3.7 |
| `tariffSource` (7 Felder, `tariff-catalog.ts:471-479`, `:500-502`) | nur `netzebene` (als `'NE 5'`) | überwiegend FEHLEND — `netzbetreiber` ist ausdrücklich ausgeschlossen (`invoice-extractions.ts:185-194`) |
| `tariffVintage` | Grundgebühr da, Stichtag nicht | wird gerechnet (`derive.ts:121-125`) |
| `estimatedPv` (10 Felder, `pv-design.ts:273-295`) | 6 mit Gegenstück, 3 ohne (`locationName`, `latitudeDeg`, `longitudeDeg`) | teilweise vorhanden |

Innerhalb von `analysis`:

| Blattwert | Wizard-Entwurf | Zustand |
|---|---|---|
| `current.*` (4 Werte) | — | wird gerechnet, nicht erfasst |
| `perBattery`, `recommendation` | — | wird gerechnet (gegen `DEMO_BATTERY_CATALOG`) |
| `assumptions.roundTripEfficiency` | `existingBatteryRoundTripEfficiencyPercent` (`battery-draft.ts:75`) | anderer Name, andere Einheit (Prozent, `:79`), andere Bezugsgrösse (`analysis.worker.ts:307`) |
| `assumptions.horizonYears` | — | FEHLT (Konstante `DEFAULT_HORIZON_YEARS = 10`, `apps/website/lib/constants.ts:3`) |
| **`assumptions.energyPriceCtPerKwh`** | **`energyPriceCtPerKwh`** | **gleicher Name** |
| **`assumptions.einspeiseverguetungCtPerKwh`** | **`einspeiseverguetungCtPerKwh`** | **gleicher Name** |
| `assumptions.billingModel` | Schema-Schlüssel da, von keiner Station geschrieben | nur über `set_draft_field` erreichbar |
| `tariffOptimization` | `tariffComparison*` (4 Schlüssel) | anderer Name — und fachlich etwas anderes (`tariff-draft.ts:29-35`: „kein Optimierungsgegenstand") |
| `existingBatteryAnalysis` | die **Eingaben** liegen vor (`battery-draft.ts:59`/`:67`/`:75`) | wird gerechnet, nicht erfasst |
| `dataQuality.coveredDays` | aus `covered_from`/`covered_to` ableitbar | nicht als Zahl abgelegt |
| `dataQuality.coveredMonths` | wird gelesen, aber ausdrücklich NICHT gespeichert (`pv-profile-draft.ts:188-189`) | FEHLT |
| `dataQuality.gapsInterpolated` | `metering_points.gaps` (nur Lücken > Toleranz) | anderer Name, andere Semantik (Bereiche statt Summe) |
| `dataQuality.warnings` | — | FEHLT |

⚠ **Die Nicht-Entsprechung gilt für die Top-Ebene, nicht sachlich.** Die Tarifwerte des
Wizard-Entwurfs entsprechen der **Eingangsseite** dessen, was im Report als `analysis.assumptions`
erscheint. „Keine Entsprechung" darf nicht als „der Wizard erhebt nichts, was der Report braucht"
gelesen werden.

### 3.7 Das schwerste Einzelstück: `loadProfile`

| `LoadProfile` (`packages/shared/src/load-profile.ts:60-67`) | Wizard-Entwurf | Zustand |
|---|---|---|
| `readings: LoadReading[]` (bis 35.040 Punkte) | — | **FEHLT** — keine Spalte, kein Entwurfsschlüssel |
| `intervalMinutes: 15` (Literal) | `interval_minutes` (15 **oder 60**) | anderer Name, weiterer Wertebereich |
| `timezoneMeta: string` | — | FEHLT (im Leser `DEFAULT_TZ = 'Europe/Vienna'` fest, `parser/metadata.ts:161`) |
| `source: LoadSource` (4 Werte, `:30-35`) | `profileSource` (3 Zustände, abgeleitet) | anderer Name, gröber (`metering-points.ts:81`, `:188-192`) |
| `pvSource?: 'estimated'` (`:57`) | `pvProfileSource` (`'generated'`) | anderer Name |

Grund: `apps/web` liest eine hochgeladene Datei mit `readLoadProfile` aus `packages/extractors`
(`data-entry-actions-lastgang.ts:4`), und dieser Leser liefert **Metadaten** —
`LoadProfileMetadata` (`packages/engine/src/parser/metadata.ts:106-136`) hat genau sechs Felder
(`intervalMinutes`, `coveredFrom`, `coveredTo`, `gaps`, `rowCount`, `coveredMonths`). Die Rohdatei
liegt in `platform.project_documents` (Storage), nicht in der Datenbank. `metadata.ts:80-82` sagt es
selbst: „⚠ ES KOMMT KEIN EINZIGER MESSWERT HERAUS".

⚠ **Eine Ausnahme:** genau ein Weg in `apps/web` erzeugt den vollen `LoadProfile` doch —
`checkPvGeneratorEligibility` (aus `data-entry-actions-pv.ts:7`) läuft in
`packages/extractors/src/pv-reference/eligibility.ts:3` gegen den vollen Parser `parseLoadProfile`.
Die Reihe entsteht dort und verlässt die Datei nicht (ebd. 9–30); heraus kommt eine Ja/Nein-Antwort.

### 3.8 Ergebnis vs. Eingabe — und kein Engine-Lauf vom Wizard aus

`AnalysisResult` ist ausdrücklich Ergebnis: „Engine-Ausgabe-Contract (§3.10) — autoritativ, die
einzige Wahrheit für beide UIs" (`analysis-result.ts:258`). `metering_points.draft` ist ausdrücklich
Eingabe (`20260911150000:61`).

**Es gibt im Repo keine Stelle, die aus dem Wizard-Entwurf einen Engine-Lauf startet:**

- `grep -rn "from 'engine'" apps/web --include="*.ts" --include="*.tsx"` (ohne `node_modules`/`.next`)
  → **0 Treffer**. Positivkontrolle im selben Suchraum: `from 'shared'` → **35 Dateien**; dasselbe
  Muster gegen `apps/website` → 13 Treffer, u. a. `analysis.worker.ts:14`.
- `apps/web/package.json`, `dependencies` (Z. 15–45): `extractors` (`:25`), `shared` (`:37`),
  `tariff-monitor` (`:41`) — **kein `engine`**, **kein `@react-pdf/renderer`**.
  `apps/website/package.json:21`, `:25` führt beide.
- ⚠ **Transitiv ist die Engine trotzdem da:** `packages/extractors/package.json:21` führt
  `"engine": "workspace:*"`, und `apps/web` hängt an `extractors`. Fünf Dateien in
  `packages/extractors/src` importieren aus `'engine'`. Engine-Code läuft also im Anfragepfad von
  `apps/web` — hinter der Paketgrenze, nicht über einen eigenen Import.
- `grep -rn "readings" supabase/migrations/` → **0 Spaltentreffer**. Positivkontrolle: `jsonb` über
  dieselben Migrationen → 55 Dateien.

⚠ **Und eine Präzisierung, die nicht fehlen darf:** `grep -rn "AnalysisResult" apps/web` (ohne
Tests/Fixtures) liefert **1 Treffer**, eine Zeichenkette in der Oberfläche
(`app/admin/(intern)/analysen/[id]/page.tsx:356`). Das darf nicht als „`apps/web` kennt den Contract
nicht" gelesen werden: `apps/web/lib/admin/analysis-upload.ts:33` importiert `type AnalysisBundle`
aus `shared`, `:86` typt `bundle: AnalysisBundle`, `:183` ruft `deriveBaselineExtracts(bundle.result)`
— und `AnalysisBundle.result` **ist** `AnalysisResult` (`analysis-bundle.ts:298`, `:333`). `apps/web`
ist über den Archiv-Weg (B14-2) statisch gegen den Ergebnis-Contract getypt.

### 3.9 Zusammenfassung in Zahlen

`PdfReportInput` 10 Felder (2 optional, 3 `| null`-fähig) · `PdfReportAnalysis` 7 von 8 ·
`AnalysisResult` 8 (2 optional) · `tariffParamsSchema` 13 (5 Pflicht) · von Stationen geschriebene
Contract-Schlüssel 9 · von keiner Station geschrieben 4 (darunter das Pflichtfeld `billingModel`) ·
geschriebene Nicht-Contract-Schlüssel 26 · `platform.metering_points` 9 Spalten · **direkte
Namensgleichheit zwischen einem vom Report gelesenen Blattwert und einem geschriebenen
Entwurfsschlüssel: 2** (als Schema-Schlüssel gezählt 3, mit `billingModel`).

---

## 4. Frage 2 — Gibt es eine Erkennung für lange Nahe-Null-Strecken?

**Nein, nicht im Code. Es gibt einen Satz in einem System-Prompt, der die Prüfung dem Sprachmodell
zuweist.** Diese Unterscheidung ist der Kern der Antwort.

### 4.1 Die Fehlanzeige, mit Positivkontrolle

| Suchmuster (`grep -rn -iE`, `*.ts`/`*.tsx`) | Suchraum | Treffer |
|---|---|---|
| `beinahe.?null\|nahe.?null\|near.?zero\|nullstunde\|zero.?run\|dauernull` | `apps/website apps/web packages` | **1** — `apps/web/lib/project-chat/system-prompt.ts:223` |
| `consecutive\|aufeinanderfolgend\|streak\|longestRun\|maxRun\|am Stück` | enger Suchraum (5 Verzeichnisse) | 22 — alle über FEHLENDE Slots, Zeitstempel-Abstände, Chat-Nachrichten oder Render-Frames; **keiner über Werte** |
| `minValue\|maxValue\|avgValue\|sumKwh\|valueStats\|statistik` | `packages/engine/src/parser/` ohne Tests | **0** |
| `zeroRun\|nullserie\|flatline\|konstant.?null\|durchgehend.?null\|stillstand\|nullwert\|allZero\|leerlauf` | `apps/website apps/web packages` | 49 — Zustandsmaschinen (`kind: 'idle'`), Grundlast-Fixtures, „Anfangs-Leerlauf" im Parser; **keine Lauflängen-Messung über Werte** |
| `anomal\|auffaellig\|ausreiss\|outlier\|messfehler\|implausib` (ohne Tests) | `apps/website apps/web packages` | 47 — genau **einer** zur Sache (`system-prompt.ts:223`), einer als Obergrenze (`prepare.ts:6`/`:154`) |
| `\.value (<\|<=) \|gridPowerKw (<\|<=) \|pvGenerationKw (<\|<=) ` (ohne Tests) | Engine + beide `lib`-Bäume + `extractors` | **2** — `parse.ts:286`, `couple.ts:126`, beide auf **negativ** |

Positivkontrollen im jeweils selben Suchraum: `Lastgang` → **1.086** · `Einspeisung` → 172 ·
`Viertelstunde` → 53 · `rowCount` in `parser/` → 6.

⚠ **Methodischer Hinweis, der im Dokument bleiben soll:** ein erster Durchlauf mit den Pfaden in
einer Shell-Variablen (`$SR`) lieferte scheinbar 0 Treffer bei **allen** Mustern einschliesslich der
Positivkontrollen — zsh splittet Variablen nicht bei Wortgrenzen, `grep` bekam einen einzigen nicht
existierenden Pfad. Erst die Positivkontrolle hat das aufgedeckt.

### 4.2 Was es gibt: die Lücken-Erkennung — und worin sie sich unterscheidet

**Engine-Parser (`packages/engine/src/parser/prepare.ts`, 167 Z.):** `prepareSeries` legt die
bekannten Werte auf ein 15-min-Gitter (`:102-107`) und läuft dann über die **undefinierten**
Rasterplätze:

```
prepare.ts:119   const start = i
prepare.ts:120   while (i < totalSlots && grid[i] === undefined) i++
prepare.ts:122   const runLength = end - start
prepare.ts:136   largestGapSlots = Math.max(largestGapSlots, runLength)
```

Die Bedingung ist `grid[i] === undefined` — **kein Wert vorhanden**. Ein Rasterplatz mit dem Wert `0`
ist nicht `undefined` und wird in dieser Schleife nie betreten. `largestGapSlots` steht bewusst
**innerhalb** des Interpolations-Zweigs (`:126`, begründet `:132-135`). `PrepareResult` (`:10-18`)
hat sechs Felder, keine Wert-Statistik.

**Wizard-Schicht (`apps/web/lib/project-chat/consistency.ts`, 265 Z.):**
`checkMeteringPointConsistency` (`:228`) kennt **zwei** Befundarten (`:73-90`): `internal_gap` und
`coverage_gap`. Die internen Lücken werden **nicht selbst gemessen**, sondern aus
`metering_points.gaps` durchgereicht (`:259-262`, Begründung `:253-258`). Die Datei liest
ausschliesslich Zeitstempel (`:122`, `:155`, `:190`).

**Herkunft von `gaps` (`packages/engine/src/parser/metadata.ts`):** `:332-339` läuft über die
sortierte, deduplizierte **Zeitstempel**-Liste (`:315-320`) und meldet `missing >=
GAP_TOLERANCE_INTERVALS` (= 2, `:156`). Die Messwerte gehen in diese Schleife nicht ein. Die
Migration formuliert es als Schema-Eigenschaft (`20260911120000:23-26`).

| | misst | Bedingung | sichtbar bei durchgehend 0,0 kW |
|---|---|---|---|
| Lücken-Erkennung | Abstände zwischen Zeitstempeln | `grid[i] === undefined` bzw. `missing >= 2` | **nein** — die Zeile existiert |
| gesuchte Nahe-Null-Erkennung | Wertniveau über eine Dauer | — | nicht gebaut |

`packages/engine/src/parser/sparse-sample.test.ts:66` schreibt die Trennung explizit fest: „⚠ Ein
Anfangs-Leerlauf ist KEINE Lücke: die Reihe beginnt beim ersten echten Messwert." Eine Strecke aus
echten Nullwerten läuft damit als gültige Messung durch.

### 4.3 Was `dataQuality` (B23c-4) misst

`dataQuality` (`analysis-result.ts:321-339`) hat **fünf** Felder: `coveredDays` (`:322`),
`coveredMonths` (`:325`), `gapsInterpolated` (`:326`), `largestGapSlots` (`:337`), `warnings`
(`:338`). Es wird in `packages/engine/src/parser/parse.ts:302-311` gebaut und bezieht **vier von
fünf** Werten unverändert aus dem Zeitstempel-Gitter; `coveredMonths` wird aus den Zeitstempeln
gezählt (`parse.ts:304`, `s.ms`). **`dataQuality` zählt fehlende Intervalle, keine Nullwerte** — der
Contract sagt es für `largestGapSlots` wörtlich (`analysis-result.ts:331-333`).

`warnings` ist das einzige Feld, in dem wertbezogene Aussagen landen können. **Neun Einspeisungen,
davon drei wertbezogen:**

| Fundstelle | Prüfung | Art |
|---|---|---|
| `prepare.ts:72` | doppelte Zeitstempel entfernt | Zeitstempel |
| `prepare.ts:140-144` | grössere Datenlücken interpoliert | Zeitstempel |
| `prepare.ts:154-157` | `maxAbs > OUTLIER_KW` (100.000, `:6`) | **Wert, zu HOCH** |
| `parse.ts:276-277` | Zeilen ohne gültigen Zeitstempel/Wert übersprungen | Zeilen ohne Messwert |
| `parse.ts:280-283` | `import_only` ohne PV-Profil | Quellenart |
| `parse.ts:286-289` | `slots.some((s) => s.value < 0)` bei `import_only` | **Wert, negativ, punktweise** |
| `pv.ts:113` → `analysis.worker.ts:213-214` | `matchedSlots === 0` bzw. `< 0.2` | Zeitstempel-Überlappung |
| `pv.ts:92` → `analysis.worker.ts:215-216` | `inconsistentSlots > 0` (`pv.ts:71`/`:74`) | **Wert, Widerspruch, gezählt** |
| `analysis.worker.ts:217-221` | `pvError` | Lesefehler |

Das gesamte Warnungs-Inventar der Engine ist abzählbar: `warnings.push` über `packages/engine/src`
(ohne Tests) trifft **14 Stellen** (`prepare.ts:72`, `:141`, `:155`; `parse.ts:277`, `:281`, `:287`,
`:395`; `attribute.ts:322`, `:330`, `:344`, `:362`; `rank.ts:65`, `:68`, `:71`) — **keine davon über
Nullverbrauch**. `prepare.ts:154-157` ist dabei die Positivkontrolle in derselben Codezeile-Familie:
eine Ausreisser-Erkennung existiert, aber ausschliesslich **am oberen Ende** („Ungewöhnlich hoher
Spitzenwert … mögliche Einheiten-/Skalierungsverwechslung").

⚠ Nicht in dieser Liste, obwohl wertbasiert: `pvGeneratorEligibility`
(`packages/engine/src/pv-generation/couple.ts:122-130`, Bedingung `:126`) prüft punktweise auf
negative Werte, speist aber **nichts** in `dataQuality.warnings` — sie ist der Torwächter für den
PVGIS-Generator.

Anzeige-Seite: `buildDataQuality` (`lib/pdf-report/basis.ts:161-173`) rechnet nichts nach (`:163`:
`if (dq.warnings.length === 0) return null`); `buildLargeGapNotice` (`summary.ts:549-563`) rechnet
`largestGapSlots` nur in Tage um (`:553`, `/96`). Am Bildschirm dieselbe Bedingung (`report.tsx:914`,
`:920-921`).

### 4.4 Was `check_data_consistency` prüft

Das Werkzeug (`tools.ts:262-263`) liefert je Zählpunkt ein Objekt mit **bis zu elf Schlüsseln**
(`executor.ts:549-585`): `nummer`, `metering_point_id`, `befunde`, `zeitraum_vergleich`,
`lastgang_zeitraum`, `rechnungs_zeitraum`, `zeitraum_luecke` (5 Unterfelder), `luecken_gesamt`,
`luecken` (gekappt auf `MAX_REPORTED_GAPS = 10`, `:891`), `luecken_hinweis`, `hinweis`. Geprüft wird
**(a)** Zeitraum-Abgleich Rechnung gegen Lastgang mit fester Schwelle
`COVERAGE_GAP_TOLERANCE_DAYS = 60` (`consistency.ts:60`) und **(b)** interne Lücken als
durchgereichte Bereichsgrenzen. **Nullwerte prüft es nicht** — kein Schlüssel des Rückgabeobjekts
trägt einen Messwert. Der Werkzeugtext sagt den Umfang selbst (`tools.ts:265-266`).

### 4.5 Der Energieberater-Prompt: die Prüfung liegt beim Modell

Der einzige Treffer im ganzen Repo steht in `ENERGY_ADVISOR_SYSTEM_PROMPT`
(`apps/web/lib/project-chat/system-prompt.ts:211`), Zeilen 217–224:

> „Deine Aufgabe: das Gesamtbild fachlich prüfen. check_data_consistency deckt nur zwei mechanische
> Fälle ab (Zeitraum-Abgleich Rechnung/Lastgang, interne Lücken im Lastgang) … Alles darüber hinaus
> ist deine eigene fachliche Einschätzung: … **Gibt es im Lastgang auffällig lange
> Beinahe-Null-Strecken, die eher nach einem Messfehler als nach echtem Verbrauch aussehen?** Das ist
> keine abschliessende Liste — urteile aus deiner Expertise, nicht nach einem festen Katalog."

Der Prüfpunkt ist also **benannt**, aber als Frage an das Modell formuliert, ausdrücklich abgegrenzt
von den „zwei mechanischen Fällen" des Werkzeugs und ausdrücklich als nicht abschliessende Liste.

| Fundstelle | Zustand |
|---|---|
| `system-prompt.ts:223` | einzige Nennung im Repo |
| `apps/web/lib/project-chat/*.test.ts`, Muster `beinahe\|Messfehler` | **0 Treffer** — der Satz ist nicht als Wortlaut gepinnt |
| Positivkontrolle `system-prompt.test.ts` | 14 `toMatch`/`toContain`; neun betreffen den Energieberater — sieben wörtliche Satz-Pins (`:99`, `:100`, `:104`, `:108`–`:111`), zwei Werkzeugnamen-Prüfungen (`:87`, `:94`) |

**⚠ Der wichtigste Einzelbefund dieser Frage:** Was dem Modell an Daten zugeht, ist gemessen —
über **beide** Kanäle:

1. **Der Systemzustand-Block** (`buildProjectStateBlock`, `system-prompt.ts:287`) schreibt je
   Zählpunkt eine Deckungszeile mit vier Angaben (`:362-367`) **und unmittelbar danach den
   vollständigen Entwurf** (`:368-369` → `describeDraft`, `:406-422`), der jeden Entwurfsschlüssel
   als `- key = <JSON-Wert> [Herkunft]` ausgibt. Skalare Entwurfswerte erreichen das Modell also sehr
   wohl; **Viertelstundenwerte nicht.**
2. **Die Werkzeuge:** `ENERGY_ADVISOR_TOOL_NAMES` (`tools.ts:529-533`) sind **drei** —
   `check_data_consistency`, `flag_open_question`, `set_draft_field`. Das erste liefert die
   Zeitfelder aus §4.4, die beiden anderen schreiben. Auch die elf Werkzeuge des Kunden-Chats
   (`tools.ts:45-57`) enthalten keinen Reihen-Kanal.

**Der Prüfpunkt steht in der Anweisung; die Zeitreihe, an der er zu prüfen wäre, erreicht das Modell
über keinen der beiden Kanäle.**

### 4.6 Die PV-Seite

`packages/engine/src/pv-generation/` (4 Module): Muster
`sommer|mittag|noon|summer|nachts|tagsüber|daylight|sonnenstand` → **6 Treffer**, alle in
`reference-profile.ts:14`/`:18`/`:21`/`:29`/`:92` und `__fixtures__/synthetic-series.ts:28`, alle zur
**Indizierung über UTC statt Ortszeit** bzw. zum Jahresgang der Fixture — keine
Plausibilitätsprüfung. Positivkontrolle `kwh` im selben Raum: 14 Treffer. Eine Prüfung
„Sommermittag ohne Erzeugung" existiert nicht.

Stattdessen existiert `packages/engine/src/simulation/pv.ts` (130 Z.) mit zwei Prüfungen, beide als
**Zählung** über alle Slots: `pvConsistencyWarning` (`:92`, löst bei `inconsistentSlots > 0` aus,
Bedingung `:71`, Zähler `:74`) und `pvCoverageWarning` (`:113`, `matchedSlots === 0` oder
`< MIN_PV_COVERAGE_FRACTION` = 0.2, `:111`/`:122`). Der Kopfkommentar trennt es: „Fehlende Abdeckung
≠ Widerspruch … Ein Slot OHNE PV-Messwert … wird still auf die Einspeisung gesetzt und NICHT als
inkonsistent gezählt" (`pv.ts:27-31`). `inconsistentSlots` ist der strukturell nächste Verwandte
einer Nahe-Null-Erkennung — aber eine **Summe**, keine **Lauflänge**.

`apps/web/lib/admin/pv-profile-draft.ts` (445 Z.) hat 23 Exporte, keiner mit `plausib`/`warn` im
Namen.

### 4.7 Welche Schicht welche Daten sieht

Rein deskriptiv — **es wird hier nichts entschieden und nichts empfohlen.**

| Schicht | Sieht die Messwerte? | Was dort heute steht | Woran ein Befund heute andockt |
|---|---|---|---|
| **Engine-Parser, Gitterlauf** (`prepare.ts`, 167 Z.) | **ja**, `grid[]`/`slots[]` vollständig | Lücken-Lauflängenschleife (`:114-138`), Ausreisser oben (`:154-157`) | `PrepareResult.warnings` (`:17`), 6 Felder (`:10-18`) |
| **Engine-Parser, Metadaten** (`metadata.ts`, 566 Z.) | **nein**, arbeitet auf `stamps` (`:315-320`); erklärt sich als messwertfrei (`:80-82`) | Zeitraum, Intervall, Lückenbereiche, `rowCount`, `coveredMonths` | `LoadProfileMetadata`, 6 Felder (`:106-136`) |
| **Engine-Parser, Spaltenerkennung** (`detect.ts`) | **ja**, als Stichprobe | zweite, gleichverteilte Stichprobe „für Dateien mit langem Anfangs-Leerlauf" (`:64-79`, Auslösung `:314-320`) | rettet nur die Spaltenerkennung; **kein** Qualitätsbefund |
| **Engine-Rechenkern** (`simulation/pv.ts`, 130 Z.) | **ja**, beide `readings` | slotweise Zählung (`:59-78`), zwei Warntext-Bauer (`:92`, `:113`) | `dataQuality.warnings` über `analysis.worker.ts:213-216` |
| **Contract** (`analysis-result.ts`, 340 Z.) | **nein** — trägt keine Rohreihe (begründet `types.ts:145-148`) | `dataQuality`, 5 Felder, davon 4 rein zeitstempelabgeleitet | `dataQuality.warnings: string[]` (`:338`) als einziger Freitextkanal |
| **Report, PDF** (`lib/pdf-report/`, 20 Dateien) | **ja**, über eine **eigene** Prop `loadProfile` (`types.ts:159`, begründet `:141-158`) | `buildDataQuality` (`basis.ts:161`), `buildLargeGapNotice` (`summary.ts:549`) | `ReportNotice` (`basis.ts:165-172`) |
| **Report, Bildschirm** (`report.tsx`, 947 Z.) | **ja**, `loadProfile` als Prop (`:59`, `:73`) | Datenqualitäts-Kasten (`:914-930`), Teiljahres-Hinweis (`:180-181`), Lücken-Hinweis (`:200-202`) | dieselben Contract-Felder |
| **Wizard / `apps/web`** (`consistency.ts`, 265 Z.) | **nein** — nur abgeleitete Angaben; die Reihe liegt als Dokument im Storage | `ConsistencyIssue`, 2 Varianten (`:73-90`), beide zeitlich | `checkMeteringPointConsistency` (`:228`) → `executor.ts:549-585` |
| **Modell (Energieberater)** (`system-prompt.ts`, 441 Z.) | **nein, was die Reihe angeht** — Deckungsangaben (`:362-367`) plus vollständiger Entwurf (`:406-422`), 3 Werkzeuge | der Prüfpunkt als Prompt-Satz (`:223`) | `flag_open_question` / `set_draft_field` |

**Was die Dokumente dazu festhalten** (Konzeptstand, nicht gebaut):

- `B24_KI-Interface_Kalkulator.md:95-99` zum Urbanz-Befund: „Der **PV-Ausfall Feb–Apr** wurde nicht
  erfragt, sondern aus dem Lastgang selbst erkannt: fehlende Nullstunden, systematisch abwesend in
  drei Wintermonaten. **Kein Nutzer hätte das von sich aus gemeldet**". ⚠ *Deutung, keine Messung:*
  die Doku formuliert das Muster als **fehlende** Nullstunden, der Prompt-Satz (`system-prompt.ts:223`)
  als **auffällig lange Beinahe-Null-Strecken**. Gemessen ist nur, dass beide Formulierungen so
  dastehen.
- `B24_KI-Interface_Kalkulator.md:165-168`: „**Automatisierte Auffälligkeits-Prüfung NEBEN dem
  Gespräch.** … als **feste Regel, nicht als Zufallsfund**."
- `Pflichtenheft_Kalkulator_Delta_KI-Interface.md:124` führt denselben Punkt in der Baseline-Liste.
- Repo-weit über alle `*.md`: `nullstunde|beinahe-null|nahe null` → genau diese **drei** Treffer
  (`B24:97`, `B24:167`, `Delta-KI:124`).

---

## 5. Frage 3 — Gibt es eine wiederverwendbare Engine-Funktion für die Jahres-Hochrechnung?

Die Frage enthält drei Behauptungen. Gemessen:

| Behauptung | Zustand |
|---|---|
| Es gibt eine Engine-Funktion für die Jahres-Hochrechnung | **Ja** — `packages/engine/src/savings/annualization.ts:71` |
| Sie wählt eine Referenzrate aus der kältesten verfügbaren Periode | **Nein** — keine Auswahl nach Temperatur, keine Referenzperiode; eine Bezugswert-Wahl mit Rückfallregel existiert an anderer Stelle (§5.4) |
| Sie lädt Marktpreise für den Lückenzeitraum nach | **Nein** — der Rechner bricht ab statt nachzuladen; ein Nachbeschaffungs-Weg existiert ausserhalb des Rechners als Skript (§5.5) |
| *(zusätzlich gemessen)* Sie ist über den Paket-Index exportiert | **Nein** — zwei Importeure, einer davon die eigene Testdatei |

Gebaut ist also nicht der in der Frage beschriebene Mechanismus, sondern ein einfacherer: **ein
einziger skalarer Faktor `365 / coveredDays`, angewandt auf genau zwei Ersparnis-Töpfe**, mit
ausdrücklich mitgeführtem Rohwert.

### 5.1 Was es gibt: `annualization.ts` (76 Zeilen, davon 41 Kommentar)

| Fundstelle | Zustand |
|---|---|
| `annualization.ts:46` | `DAYS_PER_YEAR = 365` — „Kalendarische Schaltjahre werden bewusst nicht unterschieden" |
| `annualization.ts:52-55` | `coveredDaysOf(loadProfile)` = `Math.round(readings.length / slotsPerDay)` |
| `annualization.ts:71-76` | `annualizationFactor(loadProfile)` — der gesamte Rumpf sind **fünf** Zeilen |

```ts
export function annualizationFactor(loadProfile: LoadProfile): number {
  if (loadProfile.source === 'standard_profile') return 1
  const coveredDays = coveredDaysOf(loadProfile)
  if (coveredDays <= 0 || coveredDays >= DAYS_PER_YEAR) return 1
  return DAYS_PER_YEAR / coveredDays
}
```

**Die Annahme steht im Modulkopf** (`:20-27`): „Hochgerechnet wird mit `365 / coveredDays`, also
unter der Annahme eines HOMOGENEN JAHRES: die nicht abgedeckten Tage verhalten sich im Mittel wie die
abgedeckten. Das ist bei einem Sommer-Halbjahr mit PV nachweislich zu optimistisch und bei einem
Winter-Halbjahr zu pessimistisch". **Genau dort, wo die Frage eine kälteste Referenzperiode vermutet,
steht im Code die Feststellung, dass der Faktor diesen Unterschied nicht macht** — die Gegenmassnahme
ist nicht eine bessere Schätzung, sondern das Mitführen des Rohwerts (`:24-27`).

Drei Fälle liefern bewusst `1` (`:61-69`): synthetisches Standardprofil (an der **Herkunft**
ausgeschlossen, nicht über die Tageszahl), `coveredDays >= 365` („es wird nie nach UNTEN skaliert")
und `coveredDays <= 0`.

### 5.2 Erreichbarkeit

| Fundstelle | Zustand |
|---|---|
| `packages/engine/src/savings/index.ts:4-5` | exportiert **ausschliesslich** `computeBatterySavings` und `BatterySavings` (Datei: 5 Zeilen) |
| `packages/engine/src/index.ts:9` | `export * from './savings'` — reicht damit nur diese zwei Symbole weiter |
| `packages/engine/dist/savings/index.d.ts` | Gegenprobe am Build-Artefakt: dieselben zwei Zeilen |

Fehlanzeige: `annualization|annualizationFactor|coveredDaysOf|DAYS_PER_YEAR` über `savings/index.ts`
+ `index.ts` → **0 Treffer**; Positivkontrolle `^export` im selben Suchraum → 2 bzw. 9 Treffer.
Importeure: `packages/engine/src/savings/attribute.ts:13` und `annualization.test.ts:8` — sonst
keine; ausserhalb von `packages/engine` nur ein Textverweis (`analysis-bundle.ts:70`).

### 5.3 Warnen oder rechnen? Die Kernunterscheidung

Der Code tut **beides**, aber an getrennten Stellen, mit getrennten Bedingungen und über getrennte
Grössen. Das ist ausdrücklich so entschieden (`Pflichtenheft_Kalkulator_MVP.md:299`).

**(a) Die Engine RECHNET — zwei Zeilen, zwei Töpfe:**

| Fundstelle | Zustand |
|---|---|
| `savings/attribute.ts:281-283` | `const factor = annualizationFactor(loadProfile)`; `selfConsumptionSavingPerYear = …OverCoveredPeriod * factor`, dasselbe für `loadShiftSavingPerYear` |
| `savings/attribute.ts:276-277` | „⚠ Der Faktor betrifft AUSSCHLIESSLICH diese beiden Zeilen. `leistungspreisSavingPerYear`, `newBilledKw` und alles in `roi.ts` bleiben unangetastet" |
| `savings/attribute.ts:380-385`, `:41-48` | Rückgabe führt Paar UND Faktor UND `coveredDays` gemeinsam heraus |
| `recommendation/rank.ts:110` | reicht den Faktor in den `perBattery`-Contract durch |

Begründung (`attribute.ts:268-275`): der Leistungspreis-Anteil ist ratenbasiert (€/kW·Jahr) und schon
eine Jahresgrösse, die beiden Energie-Töpfe sind Summen über die vorhandenen Intervalle. Ohne den
Faktor addierte `totalSavingPerYear` ungleichartige Grössen. „Gar nicht hochrechnen" ist ausdrücklich
verworfen (`annualization.ts:29-31`).

**(b) Der Contract führt beide Zahlen** — `BatteryResultEntry` (`analysis-result.ts:172-202`) trägt
vier Felder dafür: `selfConsumptionSavingOverCoveredPeriod` (`:193`),
`loadShiftSavingOverCoveredPeriod` (`:194`), `annualizationFactor` (`:196`), `coveredDays` (`:198`),
begründet `:183-192`: „Die Hochrechnung ist aber eine ANNAHME (homogenes Jahr) — der gemessene Wert
darf sie deshalb nicht verdrängen". Der CSV-Export führt beide Paare als **sechs eigene Spalten**
(`apps/website/lib/csv-export.ts:48-53`), den Faktor mit vier Nachkommastellen (`:72`). Das
Archiv-Austauschformat führt die Änderung als eigene Formatfassung (`analysis-bundle.ts:66-77`:
„FASSUNG 4 … Die einzige der vier Fassungen, die die BEDEUTUNG eines bereits vorhandenen Feldes
ändert").

**(c) Die Reports ANNOTIEREN — fünf Stellen, alle an `annualizationFactor > 1`, keine rechnet
selbst:** `pdf-report/summary.ts:232-239`, `summary.ts:334-338`, `pdf-report/recommendation.ts:275-280`,
`components/report/recommendation-card.tsx:373-395` (mit `data-testid="hochrechnung-hinweis"` und der
Annahme im Kundentext) und `tariff-optimization-card.tsx:214-223` (Begründung `:208-212`).

**(d) Der PDF-Report WARNT — andere Bedingung, andere Grösse, kein Rechnen:**
`buildPartialYearNotice` (`summary.ts:519-536`) hängt an
`billingModel.startsWith('monthly') && coveredMonths < 12` — also der **Monats**zahl und dem
**Abrechnungsmodell**, nicht den Energie-Töpfen. Der Kasten empfiehlt ein anderes Abrechnungsmodell;
**er verändert keine Zahl**. Er ist einer von vier unabhängigen Hinweisen (`summary.ts:695-706`),
deren Nicht-Zusammenlegung in `:455-476` begründet ist.

**Antwort auf die Kernfrage:** Die Engine rechnet hoch (zwei Zeilen, ein Faktor), der Report warnt
zusätzlich und **unabhängig davon** vor dem Teiljahr im Abrechnungsmodell. Die beiden greifen nicht
ineinander.

**(e) Sechs Stellen, die ausdrücklich NICHT hochrechnen:**

| Fundstelle | Zustand |
|---|---|
| `simulation/monthly-tariff-comparison.ts:58-61` | „⚠ NICHT AUF EIN JAHR HOCHGERECHNET — `annualizationFactor` (§3.7.1) wird hier bewusst NICHT angewandt: ein Monatsbalken ist eine Aussage über EINEN gemessenen Monat" |
| `shared/tariff-pricing.ts:168-171` | sinngleich am Typ `MonthlyTariffComparison` |
| `shared/real-saving.ts:40-45` | „⚠ NICHT HOCHGERECHNET … fehlende Monate liegen typischerweise nicht gleichverteilt über das Jahr" |
| `pdf-report/detail.ts:234-236` | im Report-Text gespiegelt |
| `engine/tariff/strategy.ts:62-67` | `monthly_max_sum` summiert über die BELEGTEN Monate |
| `shared/invoice-scan.ts:328-330` | das Extraktionsschema verbietet dem Modell das Hochrechnen |

⚠ **Der Report führt damit ZWEI Zeitregime nebeneinander, jeweils gekennzeichnet.** Sichtbar gemacht
an vier Stellen: `recommendation-card.tsx:213`, `:295-297` („**Nicht auf ein Jahr hochgerechnet:**"),
`monthly-tariff-chart.tsx:279`, `pdf-report/summary.ts:181`. Gegenprobe (hochgerechnet):
`summary.ts:233-234`, `:335-336`, `recommendation.ts:276-279`, `recommendation-card.tsx:373-391`.

### 5.4 Referenzperiode: keine nach Kälte — aber eine Bezugswert-Wahl mit Rückfallregel

**Suchmuster A** (`coldestPeriod|referencePeriod|referenceRate|Referenzrate|kaelteste|pickReference|
selectReference|worstMonth|peakMonth|referenzmonat`) über `packages/engine/src packages/shared/src
apps/website/lib apps/web/lib` (457 Dateien) → **0 Treffer**; Positivkontrolle `coveredMonths` im
selben Suchraum → **39 Treffer** (ohne Tests: 29). **Zweite Breitsuche**
(`referenzzeitraum|bezugsperiode|vergleichszeitraum|repraesentativ|baseline.?period|coldest|kaeltest|
extrapolat`) → **0 produktive Treffer** ausser `representativeDays` (die §6.2-Chart-Tagesauswahl).

Die breitere Suche nach `kaelt|kält|coldest|winter|saison|season` liefert Treffer in **elf** Dateien;
zehn sind fachfremd (u. a. `standard-profile/h0.ts:36` `H0_WINTER_SUMMER_RATIO = 1.32` und `:121`,
`:135-139` — ein Kosinus, der das **synthetische** Profil formt: Erzeugung, nicht Extrapolation;
`shared/tariff-window-rules.ts:67-87` Saisonfenster von Netzentgelt-Tarifzeilen;
`pv-generation/reference-profile.ts:14-29` UTC-Kalenderpositionen).

**Der elfte ist einschlägig:** `packages/engine/src/simulation/tou.ts:315-348` / `:350-360`.
`cheapAgainstDailyMean` wählt einen **Bezugswert** und hat eine ausdrückliche **Rückfallregel**:

| Fundstelle | Zustand |
|---|---|
| `tou.ts:316` | „Günstig" = der kombinierte Preis liegt unter dem Mittel SEINES Kalendertags |
| `tou.ts:319-326` | Begründung der Umstellung vom Perioden- auf das Tagesmittel, **ausdrücklich saisonal**: „in einem teuren Winter liegt fast jede Stunde über dem Jahresmittel … in einem billigen Sommer fast jede darunter" |
| `tou.ts:303-307` | `MIN_DAY_COVERAGE_RATIO = 0.5` — „Anteil eines vollen Tages, den ein Kalendertag mindestens tragen muss, damit sein eigenes Mittel als Bezugswert taugt" |
| `tou.ts:341-348`, `:354-357` | Randfragmente unterhalb der Schwelle fallen auf den **Perioden-Durchschnitt** zurück: „eine bekannte, benannte Grösse statt einer aus zu wenigen Werten gebildeten" |

Das ist keine Auswahl nach Temperatur und keine Referenzrate für die Hochrechnung — der Bezugswert
steuert, welche Intervalle als günstig gelten, nicht, wie auf ein Jahr skaliert wird. Es ist aber die
einzige Stelle im Rechenkern, die eine Bezugsgrösse **wählt**, eine Abdeckungs-Untergrenze dafür
führt und saisonal argumentiert.

Den saisonalen Schiefstand einer Hochrechnung benennen **vier** Stellen (`annualization.ts:22-24`,
`real-saving.ts:43-45`, `recommendation-card.tsx:390-393`, `Pflichtenheft_Kalkulator_MVP.md:297`).
Zwei nennen ihn als Grund, den Rohwert mitzuführen; eine als Grund, gar nicht hochzurechnen.
**Keine nennt ihn als Anlass für eine Referenzperiode.**

### 5.5 Marktpreise: wie sie ins System kommen — und dass der Rechner sie nicht nachlädt

| Fundstelle | Zustand |
|---|---|
| `shared/tariff-pricing.ts:84-89` | `SpotPricePointInput` = `{tsStart, tsEnd, ctPerKwh, priceBasis}` |
| `shared/tariff-pricing.ts:98-102` | `SpotPriceSeriesInput` = `{prices, complete, missingRanges}` — der Lückenbefund reist **neben** den Preisen mit, nicht als Fehlerfall |
| `apps/website/lib/tariff-pricing.ts:41-53` | die einzige Brücke: `analysisWindow(loadProfile)` → `analysisWindowToPriceRange(…)` → `fetchSpotPrices(from, to)` |
| `apps/website/lib/tariff-data/spot-prices.ts:88-95`, `:111-112` | PostgREST-Abfrage seitenweise; `missingRanges` = `findMissingRanges(...)`, `complete = missingRanges.length === 0` |

**Länge und Zeitraum von Last und Preis sind fest aneinander gebunden**, an zwei Stellen:
`analysisWindowToPriceRange` (`spot-prices.ts:167-173`) leitet den Preis-Zeitraum ausschliesslich aus
dem Lastgang-Fenster ab — **es gibt keinen Parameter für einen grösseren Zeitraum**; und
`combinedIntervalPrices` (`tou.ts:153-288`) legt `prices` mit
`new Array(loadProfile.readings.length)` an (`:232`) und ordnet je Messwert einen Preis zu (`:244`).

**Bei einer Lücke: Abbruch, nicht Nachladen.**

| Fundstelle | Zustand |
|---|---|
| `tou.ts:187-197` | `if (!spotPrices.complete)` → `blocker: {computable: false, side: 'spot_price', kind: 'gap', ranges: …}` |
| `tou.ts:274-285` | pro Intervall gesammelte `spotGaps` führen ebenfalls zum Blocker |
| `tou.ts:296-299` | „Für einen Teil des Lastgang-Zeitraums fehlen ${what} … **Es wird bewusst nicht interpoliert und nicht übersprungen**" |
| `apps/website/lib/tariff-pricing.ts:10-14` | „⚠ WAS HIER BEWUSST NICHT PASSIERT: Kein Rückfall, keine Ersatzwerte, keine Interpolation" |
| `tou.ts:130-133` | „Schlägt die Zuordnung für auch nur EIN Intervall fehl, ist der Hebel für die GANZE Analyse nicht berechenbar" |

⚠ **Die Nicht-Interpolation gilt für die PREISSEITE, nicht für den Lastgang.** Der Parser füllt
Lücken im Lastgang linear auf (`prepare.ts:109-139`), still bis `maxInterpolationGap` (Vorgabe 4
Slots = 1 h, `parser/types.ts:84-85`) und darüber mit Warnung (`prepare.ts:140-143`).

⚠ **Und ein Befund, den ein zu enges Suchmuster verdeckt hätte:** `refetch|nachlade|backfillGap|
fetchMissing|retryRange` liefert 8 Treffer, **alle** das Wort „nachladen" im Sinn von *Batterie
nachladen*. Das blosse `backfill` liefert im **genau selben** Suchraum **25 Treffer** — Preise werden
also nicht nur vom Cron geschrieben. `apps/web/lib/spot-prices/sync.ts:8-11` nennt **zwei** Aufrufer
derselben `syncSpotPrices`-Funktion: den Cron-Endpunkt und das Skript
`apps/web/scripts/backfill-spot-prices.mjs` (5.704 Bytes; Kopf `:1-27`: „Einmaliger Backfill der
aWATTar-Marktpreise", ab festem Anker, ausserhalb von Next, bewusst kein zweiter Endpunkt);
`packages/shared/src/analysis-window.ts:37-43` führt dessen `BACKFILL_ANCHOR_ISO` als zweite Kopie
derselben Zahl samt Wächter. **Es gibt also einen Weg, Preise für einen vergangenen Zeitraum
nachzubeschaffen — er ist ein von Hand gestartetes Skript in einer anderen App, kein Pfad, den der
Rechner bei einem Lückenbefund selbst nimmt.**

### 5.6 Die Gegenrichtung: was einen Lastgang ablehnt

| Fundstelle | Zustand |
|---|---|
| `apps/website/lib/anchor-rule.ts:26-28` | `rejectIfBeforeAnchor(profile, timezone)` — die einzige ZEITRAUM-Ablehnung: abgelehnt wird ein Lastgang, der **vor dem Anker beginnt** |
| `shared/analysis-window.ts:69`, `:112-114` | `SPOT_PRICE_ANCHOR_DATE = '2025-01-01'`; `startsBeforeSpotPriceAnchor` — eine Zeile |
| `apps/website/lib/anchor-rule.ts:40-45` | Meldungstext endet mit „ideal sind die letzten zwölf Monate" — eine **Empfehlung**, keine Bedingung |
| `engine/parser/parse.ts:265`, `:384` | `if (norm.parsedRows < 2) return err('insufficient_rows', …)` |
| `engine/parser/metadata.ts:307`, `:321`, `:548`, `:563` | dieselbe Schwelle im Metadaten-Pfad |
| `apps/web/lib/admin/data-entry-actions-segment.ts:137` | die einzige Sperre dieser Art im Wizard betrifft das **Verkleinern der Zählpunktzahl**, nicht die Lastgang-Länge |

Fehlanzeige: `MIN_COVERED|MIN_DAYS|minCoveredDays|tooShortProfile|zu wenige Tage|zu kurzer Lastgang`
→ **0 Treffer**; Positivkontrolle `coveredDays` im selben Suchraum ohne Tests → 46 Treffer. Das
belegt, dass es **keine in TAGEN bemessene Untergrenze** gibt — nicht, dass es gar keine gibt: die
tatsächliche Grenze liegt bei **zwei gültigen Datenzeilen** bzw. zwei unterschiedlichen Zeitstempeln
(`insufficient_rows`, 7 Treffer in `packages/engine/src`). Zwei weitere Untergrenzen bestehen für
Teilaspekte: `MIN_DAY_COVERAGE_RATIO = 0.5` (`tou.ts:307`) und `MIN_PV_COVERAGE_FRACTION = 0.2`
(`simulation/pv.ts:111`).

**Ein Lastgang über wenige Tage wird also angenommen und mit `365 / coveredDays` hochgerechnet**,
sofern er nach dem Anker beginnt und mindestens zwei gültige Zeilen trägt.

### 5.7 Was die Dokumente zur Advisor-Sitzung sagen

| Fundstelle | Zustand |
|---|---|
| `B24_KI-Interface_Kalkulator.md:101-103` | Punkt 5 der sieben Momente: „**156 von 365 Tagen ohne Lastgang.** Die Hochrechnung brauchte eine explizite, begründete Annahme statt einer stillschweigenden Interpolation." |
| `B24_KI-Interface_Kalkulator.md:118-120` | „Punkt 5 deckt sich mit dem bereits dokumentierten Urbanz-Lastgang: dieser trägt **209 abgedeckte Tage** … 365 − 209 = **156**" |
| `B24_KI-Interface_Kalkulator.md:252-254` | „Der Jahres-Hochrechnungs-Abschnitt existiert ausschliesslich deshalb, weil echte Daten fehlten … Ohne die Lücke gäbe es den Abschnitt nicht." |

Das Dokument beschreibt also einen **Report-Abschnitt** und eine „explizite, begründete Annahme" — es
beschreibt **keine** Referenzrate aus der kältesten Periode und **keine** Preis-Nachladung. Die
gebaute Regel ist im Pflichtenheft kodifiziert (`Pflichtenheft_Kalkulator_MVP.md:286` §3.7.1, `:293`
die Regel wörtlich, `:297` die Sichtbarkeitspflicht, `:299` die Abgrenzung zur §3.5-Warnung).

### 5.8 Befund

Eine Engine-Funktion für die Jahres-Hochrechnung existiert und ist produktiv verdrahtet — von den
drei Bestandteilen der Frage ist **einer** gebaut. Für den Lückenfall existiert daneben ein
**Kennzeichnungs-System**: vier unabhängige Report-Hinweise (`summary.ts:695-706`), vier
Contract-Felder (`analysis-result.ts:193-198`), eine eigene Archiv-Formatfassung
(`analysis-bundle.ts:66-77`), sechs CSV-Spalten (`csv-export.ts:48-53`), fünf Annotationsstellen und
sechs Stellen, die ausdrücklich nicht hochrechnen. Die Behandlung einer fehlenden **Preis**periode
ist im Rechner durchgängig **Abbruch mit benanntem Zeitraum**, die einer **Lastgang**-Lücke dagegen
**lineare Interpolation mit Zählung**.

---

## 6. Frage 4 — Wie tief ist das Kapitel „Annahmen und Datengrundlage" (B23c-4)?

**Gemessen: 168 Code-Zeilen in `basis.ts`, 15 JSX-Zeilen in `document.tsx`, eine zweispaltige
Label/Wert-Liste mit 4 oder 8 Zeilen.** Keine der drei erfragten Strukturen existiert.

### 6.1 Fundort und Abgrenzung

| Fundstelle | Zustand |
|---|---|
| `apps/website/lib/pdf-report/basis.ts` | 346 Zeilen gesamt, davon 27 leer und 151 Kommentar → **168 Code-Zeilen**. **Acht** Funktionen: `neutralRow` (65), `buildAssumptions` (84–110), `batteryRows` (124–141), `buildDataQuality` (161–173), `formatRange` (207), `buildBlocker` (240–266), `buildTariffSource` (291–309), `timeZoneOf` (344–346), dazu `buildBasisChapter` (328–336) |
| `apps/website/lib/pdf-report/document.tsx:1386-1410` | `BasisChapter`, **25 Zeilen**: 4 leer, 6 Kommentar, **15 JSX-Zeilen**; dazu 17 Zeilen Doc-Kommentar (`:1369-1385`) |
| `apps/website/lib/pdf-report/content.ts` | `BASIS_SECTION` (261–265), `BASIS_INTRO` (268–269), `REPORT_DISCLAIMER` (287–289) — zusammen 10 Zeilen Inhalt |
| `apps/website/lib/pdf-report/derive.ts:121-142` | `tariffVintageNote`, 22 Zeilen — der Preisstand-Satz, der einzige Teil ausserhalb von `basis.ts` (Begründung `:99-105`: er hängt an der Uhr) |

**Zwei Konsumenten, nicht einer:** neben `document.tsx:1387` baut auch die Prüfroute das Kapitel
(`app/pdf-report-probe/analysis-run.ts:271`) und zeigt es am Bildschirm (`probe-client.tsx:581-591`,
`:651`).

Das Kapitel ist eine eigene `<Page>` (`document.tsx:1510-1514`) und steht **hinter** dem
Methodik-Kapitel (`:1504-1508`). Es trägt **kein einziges Bild**: `ChartFigure` kommt im Block
1386–1410 **0×** vor, im Dokument insgesamt 6× (`:1164`, `:1201`, `:1211`, `:1285`, `:1295`, `:1337`).

### 6.2 Was gerendert wird — Element für Element

| Element | Fundstelle | Zustand |
|---|---|---|
| 1 Kapitelüberschrift (`h2`) | `document.tsx:1391` | „Annahmen und Datengrundlage" (`content.ts:264`) |
| 1 Lead-Absatz | `:1392` | **ein** Satz (`content.ts:268-269`) |
| 1 Aussage-Block | `:1394` | `Statement` — Titel + **0 Kopfzahl** (`amount: null`, `basis.ts:102`) + 4 bis 8 Zeilen + 1 Fliesstext-Absatz. Das Renderer-Feld `notes` (`document.tsx:900`) wird von `basis.ts` **nie** gesetzt |
| 0–1 Hinweiskasten „Datenqualität" | `:1395` | nur bei `warnings.length > 0` (`basis.ts:163`) |
| 0–1 Hinweiskasten „Blocker" | `:1396` | nur bei nicht berechenbarem Börsenpreis-Vergleich (`basis.ts:245`) |
| 1 Herkunftsabsatz Tarifsätze | `:1398` | immer |
| 0–1 Herkunftsabsatz Preisstand | `:1399` | bedingt |
| 1 Fussnote Vorbehalt | `:1407` | 2 Sätze (`content.ts:287-289`) |

**Gezählter Umfang, in zwei Konventionen.** Nach Zeilen (eine Tabellenzeile = 1): minimal **10**, im
Vollausbau **22** feste Posten. Als tatsächlich gerenderte `<Text>`-Knoten (jede Tabellenzeile
rendert zwei — Beschriftung `document.tsx:803`, Wert `:807`): minimal **14**, im Vollausbau **30**.
Dazu in beiden Fällen N Datenqualitäts-Warnungen und M Zeitbereiche.

### 6.3 Die Annahmen-Tabelle: 8 Zeilen, 2 Spalten, 3 gesetzte Felder je Zeile

| Fundstelle | Zeile |
|---|---|
| `basis.ts:91` | 1 — Abrechnungsmodell |
| `basis.ts:92` | 2 — Betrachtungshorizont |
| `basis.ts:93` | 3 — Arbeitspreis |
| `basis.ts:94` | 4 — Einspeisevergütung |
| `basis.ts:131` | 5 — Wirkungsgrad (Gerätename) |
| `basis.ts:132` | 6 — Batteriepreis (Gerätename) |
| `basis.ts:133` | 7 — Gesamtinvestition |
| `basis.ts:134-139` | 8 — Nettoinvestition (nach Förderung/Steuervorteil) |

Die Zeilen 5–8 entfallen geschlossen, wenn es keine Katalog-Empfehlung gibt (`basis.ts:128`:
`if (!recommended) return []`) — dann hat die Tabelle **4 Zeilen**.

Je Zeile werden **drei** Felder gesetzt: `label`, `value`, `tone` (`neutralRow`, `basis.ts:65-67`).
Der Typ `ReportRow` kennt zwei weitere — `hint` (`statement.ts:40`) und `total` (`:44`) — **keines
davon wird hier gesetzt**. Gerendert ergibt das **zwei Spalten** (`document.tsx:799-810`).

**Deckung gegen den Contract, genau gezählt:** `AnalysisResult['assumptions']` hat fünf Felder
(`analysis-result.ts:279-286`). Die vier Nicht-Geräte-Zeilen decken davon **vier** ab; das fünfte,
`roundTripEfficiency`, steht ausschliesslich in der Geräte-Zeile `basis.ts:131` — **im
4-Zeilen-Fall erscheint es gar nicht.**

### 6.4 (a) Datenquellen-Tabelle — FEHLANZEIGE

**Messung 1 — Struktur.** `ReportTable` (der einzige mehrspaltige Tabellentyp, `statement.ts:110-113`)
kommt in `basis.ts` **0×** vor; Positivkontrolle `ReportRow` im selben Suchraum → **4×**. Der
Renderer `StatementTable` (`document.tsx:927`) wird im ganzen Dokument **genau einmal** aufgerufen,
im Vergleichskapitel (`:1347`), nicht hier.

**Messung 2 — der Contract selbst, und das ist der schärfere Befund.** Der Lastgang trägt zwei
Herkunftsfelder: `source` (Enum mit vier Werten, `load-profile.ts:30-35`, Feld auf `:64`) und
`pvSource` (`:65`). **Das Kapitel liest keines von beiden.** Es greift auf den Lastgang ausschliesslich
über `Pick<LoadProfile, 'timezoneMeta'>` zu (`basis.ts:344-345`, aufgerufen `:332`) — **die Herkunft
der Verbrauchsdaten ist der Ableitung strukturell nicht zugänglich.**

**Messung 3 — Vokabular, mit einer nötigen Präzisierung.** Ein enges Muster
(`Quelle|Datenquelle|gemessen|geschätzt|Standardprofil|aus Ihrer Rechnung`) liefert in `basis.ts` nur
einen Treffer in einem Kommentar (`:341`). Ein **breiteres** Muster (`herkunft|stammt|beruht|
grundlage|eingabe|angaben|eingetragen|hochgeladen|annahme|schätz|quelle|messung|erfasst|ermittelt`,
-i) trifft dagegen sehr wohl **gerenderten** Text: `basis.ts:107` („unverändert aus Ihren Angaben
ein"), `:295` („stammen unverändert aus Ihrer Eingabe"), `:303` („Selbst eingetragen und damit
massgeblich"). Es wäre also falsch zu sagen, im Kapitel stehe kein Herkunfts-Vokabular. **Richtig
ist: die Herkunftsaussagen sind Fliesstext, nicht Tabelle, und sie betreffen die Tarifwerte, nicht
die einzelnen Eingangsgrössen.** Positivkontrolle: `Tarif` in `basis.ts` → 14 Treffer.

Die übrigen Herkunftsaussagen stehen verstreut im Kapitel „Kernergebnisse" (`summary.ts:594` „Auf
Basis eines Standardlastprofils — keine gemessenen Werte", `:654` „PV-Erzeugung geschätzt — nicht
gemessen").

### 6.5 (b) Tarifkomponenten-Tabelle — FEHLANZEIGE, mit drei ausgewiesenen Werten

Einzeln **mit Wert** stehen im Kapitel **drei** Tarifgrössen: Abrechnungsmodell in Klartext
(`basis.ts:91`, Zuordnung `:59-63`), Arbeitspreis (`:93`, €/kWh) und Einspeisevergütung (`:94`).

**Nur als Bezeichnung, ohne Wert** erscheinen Leistungspreis und Mindestleistung:
`TARIFF_FIELD_LABEL` (`basis.ts:273-277`) benennt sie, um zu sagen, **welches** Feld der Nutzer
überschrieben hat; im Satz ohne gewählten Tarifstand (`:294-295`) werden beide genannt, ohne Zahl.
„Leistungspreis" steht zusätzlich im Blocker-Schlusssatz (`:261`). Einen Wert zu „Netzebene" zeigt
das Kapitel (`:306`) — gelesen aber aus `TariffSourceRef` (`tariff-catalog.ts:500-502`), nicht aus
`TariffParams`.

**Fehlanzeige, mit korrigiertem Suchmuster.** Ein enges Muster (`Grundgeb`, `Abgabe|Umlage|MwSt|USt`)
liefert 0 Treffer — es übersieht die gebräuchlichsten Schreibweisen. Ein breites Muster
(`grundgeb|netzentgelt|netzabgabe|abgabe|umlage|mwst|umsatzsteuer|elektrizit|arbeitspreis|
leistungspreis|messentgelt|steuer|gebühr`, -i) trifft: „Netzentgelte Ihres Netzbetreibers"
(`basis.ts:187`, gerendert), „Netzentgelt-Seite" (`:199`, gerendert), „Steuersatz" (`:203`,
gerendert), „Steuervorteil" (`:135`). **Keine dieser Nennungen trägt einen Betrag.** Der Befund
lautet also: keine Aufschlüsselung mit Beträgen — nicht: die Begriffe kommen nicht vor.

**Strukturelle Messung.** `PdfReportInput` trägt **kein `tariff`-Feld**: `^  tariff[?:]` in
`types.ts` → 0 Treffer; Positivkontrolle `^  tariff` → 2 Treffer (`:175` `tariffSource`, `:189`
`tariffVintage`). Der Kommentar `types.ts:185-187` nennt den Grund: „Deshalb steht hier auch KEIN
`tariff`-Feld: die Grundgebühr wird ausschliesslich für diesen einen Satz gelesen".

Zum Vergleich: `tariffParamsSchema` führt 13 Felder. Davon erreichen **3** das Kapitel als Wert,
**2** nur als Bezeichnung, **8** gar nicht. Der Leistungspreis erscheint als Zahl an anderer Stelle
des Dokuments (`summary.ts:137`), die Grundgebühr nur als **Wort** im Preisstand-Satz
(`derive.ts:135`), nie als Betrag.

### 6.6 (c) Berechnungsmethodik je Kennzahl — FEHLANZEIGE; und es sind ZWEI Kapitel

**Die Trennung zuerst.** „Methodik & Vorbehalte" (`content.ts:236-240`, `SECTION_ID.methodology`) und
„Annahmen und Datengrundlage" (`content.ts:261-265`, `SECTION_ID.basis`) sind **zwei Kapitel auf zwei
`<Page>`-Elementen** (`document.tsx:1504-1508` bzw. `:1510-1514`). Beide haben `level: 1` und damit
je einen eigenen Agenda-Eintrag mit eigener gemessener Seitenzahl (`content.ts:325`, `:327`). Der
Kommentar `content.ts:246-250` begründet die Reihenfolge: „die Methodik sagt, WIE gerechnet wurde,
dieses Kapitel WOMIT und was dabei fehlte."

**Das Methodik-Kapitel ist pauschal.** `METHODOLOGY_ITEMS` (`content.ts:42-100`) hat **sechs**
Einträge mit je vier Feldern. Die sechs Titel (`:46`, `:55`, `:66`, `:76`, `:83`, `:94`): „Grundlage
ist Ihr echter Lastgang" · „Ein Fahrplan, keine addierten Einzelrechnungen" · „Physikalische
Simulation, kein Hochrechnen von Spitzen" · „Bestmarke, nicht Alltagsbetrieb" · „Konstante
Batterieeigenschaften über den Betrachtungszeitraum" · „Ihre Verbrauchsdaten haben Ihren Rechner
nicht verlassen". **Kein Titel nennt eine Kennzahl.**

⚠ **Der Suchraum umfasst zwei Dateien, nicht eine.** Der Rumpf des vierten Eintrags ist kein Literal,
sondern der Import `HINDSIGHT_NOTE` (`content.ts:78`), definiert in
`apps/website/lib/report-copy.ts:21-23`. Das Muster
`Amortisation|Rendite|ROI|Gesamtersparnis|Eigenverbrauch|Leistungspreis|Kapitalwert|Payback|Autarkie`
trifft deshalb **vier**, nicht zwei Stellen: `content.ts:57` („Eigenverbrauch") und `:60`
(„Gesamtersparnis") sowie `report-copy.ts:22` („Eigenverbrauch") und `:23` („Spitzenschutz-Anteil").
**Der importierte Satz IST eine Zuordnung zu einzelnen Kennzahlen:** „Eigenverbrauch & tarifbewusstes
Laden sind mit vollem Rückblick auf das Jahresprofil gerechnet (Bestmarke). Der Spitzenschutz-Anteil
ist davon nicht betroffen." Er nennt jedoch einen **Vorbehalt** und keinen Rechenweg, und er ist die
einzige Stelle dieser Art.

Dieselben sechs Punkte stehen ein zweites Mal als Literal-JSX am Bildschirm
(`print-methodology.tsx:47-82`; nur `HINDSIGHT_NOTE` ist geteilt, `:68`) — die Doppelung ist in
`basis.ts:23-30` benannt.

**Auch die Annahmen-Tabelle trägt keine Rechenweg-Spalte.** Das dafür vorgesehene Feld
`ReportRow.hint` („Zweite, kleinere Zeile unter der Beschriftung", `statement.ts:39-40`) wird in
`basis.ts` nie gesetzt. Gemessen mit `grep -rni "hint"` über `lib/pdf-report/`: die Eigenschaft wird
im ganzen Verzeichnis an **genau einer** Stelle gesetzt, `summary.ts:104` (in Kurzschreibweise
`{ label, hint, … }`). ⚠ Ein Muster `hint:` findet diese Stelle **nicht** — sie ist nur mit der
breiten Suche belegbar.

**Wo eine Erklärung je Kennzahl tatsächlich wohnt:** verstreut als `body`-Satz an den einzelnen
Aussagen. In `summary.ts` gibt es **10 Bauplätze mit 8 verschiedenen Kennungen** (`savings` zweimal:
`:175`, `:242`; `addon` zweimal: `:402`, `:416`; dazu `:296` `peak_shaving`, `:360` `load_shift`,
`:525` `partial_year`, `:555` `large_gap`, `:592` `standard_profile`, `:652` `estimated_pv`), dazu 2
in `recommendation.ts` (`:168`, `:283`) und 1 in `detail.ts` (`:223`). **Eine zusammenführende
Zuordnung „Kennzahl → Rechenweg" gibt es an keiner Stelle.**

### 6.7 Blocker, Tarifherkunft, Preisstand, Schluss-Vorbehalt — Umfang je Teil

Alle vier vom Fahrplan (Z. 74) genannten Teile sind vorhanden.

| Fundstelle | Zustand |
|---|---|
| `basis.ts:240-266` (`buildBlocker`, 27 Z.) | 1 Titel (`:250`), 1 Absatz mit der betroffenen Seite (`:251`), optional eine Liste „Betroffener Zeitraum" mit M Einträgen (`:252-258`), 2 Zusatzabsätze (`:259-264`). Dazu `SIDE_LABEL` mit **2** Werten (`:186-189`) und `KIND_HINT` mit **3** Texten (`:192-204`). Ausdrücklich **ohne Betrag** (`:228-231`) |
| `basis.ts:291-309` (`buildTariffSource`, 19 Z.) | **ein** Absatz, zwei Varianten: ohne gewählten Stand ein Satz (`:293-296`), mit Stand **zwei** Sätze (`:305-308` plus `tail` `:300-303`). Steht immer (`:322`) |
| `derive.ts:121-142` (22 Z.) | **zwei** Sätze Preisstand (`:137-141`), zwei Varianten im Anfangswort (mit/ohne Grundgebühr, `:133-135`), bedingt: entfällt bei abgeschlossenem Kalenderjahr (`:131`) |
| `content.ts:287-289` | **2 Sätze** Schluss-Vorbehalt, EINE Konstante, im Dokument zweimal gerendert (Deckblatt und hier, `document.tsx:1407`) |
| `basis.ts:161-173` (`buildDataQuality`, 13 Z.) | 1 Titel, 1 Zeile „Abgedeckt: X Tage · interpolierte Lücken: Y", die N Parser-Warnungen als Liste **ohne** Beschriftung (`list.label: null`, `:170` — der Renderer lässt sie dann weg, `document.tsx:843`), **0** Zusatzabsätze (`:171`) |

Die beiden Herkunftsabsätze sind als eigener Textstil geführt (`styles.provenance`,
`document.tsx:482`), der im gesamten Dokument **genau zweimal** benutzt wird — beide Male hier
(`:1398`, `:1399`).

### 6.8 Gegenprobe gegen den Bildschirm-Report

`Fahrplan_2026.md:74` behauptet: „Damit trägt das Dokument alle Bildschirm-Inhalte bis auf eine
benannte Ausnahme". Für **dieses** Kapitel geprüft:

| Bildschirm-Fundstelle | PDF-Pendant | Zustand |
|---|---|---|
| `print-assumptions-snapshot.tsx:51-79` (8 `Row`) | `basis.ts:91-94` + `:131-139` | dieselben 8 Beschriftungen, dieselbe `recommended`-Bedingung (`:62` gegen `basis.ts:128`), derselbe Text „keine Angabe (nicht einbezogen)" (`:75` / `basis.ts:138`). Unterschied nur in der Anordnung |
| `report.tsx:914-930` | `basis.ts:161-173` | gleiche Bedingung, gleicher Satz |
| `tariff-source-note.tsx:27-49` | `basis.ts:291-309` | wortgleich. Nicht 1:1: der Bildschirm setzt Netzebene und Gültig-ab in `<Num>` (`:41-43`), und die Anführung um den Stand ist typografisch verschieden |
| `tariff-vintage-note.tsx:33-61` | `derive.ts:121-142` | gleiche Bedingung, gleicher Wortlaut, je zwei Sätze |
| `report.tsx:940-944` | `content.ts:287-289` | inhaltsgleich, **ein Wort Unterschied**: „Zahlen sind noch nicht…" gegen „**Die** Zahlen sind noch nicht…" — genau diese Abweichung ist in `content.ts:279-282` benannt |
| `tariff-optimization-card.tsx:91-129` | `basis.ts:240-266` | inhaltsgleich, an anderer Stelle (am Bildschirm neben der Empfehlung, `report.tsx:775-779`). Ein Satz geändert: „Die Empfehlung nebenan gilt unverändert" (`:125`) → „Die Empfehlung und alle Zahlen der vorigen Kapitel gelten unverändert" (`basis.ts:262-263`) |
| `print-assumptions-snapshot.tsx:81-86` | `basis.ts:104-108` | umformuliert, nicht gestrichen (begründet `basis.ts:32-38`) |

**Was der Bildschirm MEHR hat:** `assumptions-panel.tsx` (419 Z.) — das editierbare Panel mit **8
Eingabefeldern** (`:295`, `:317`, `:329`, `:341`, `:353`, `:365`, `:378`, `:390`) plus **2 nicht
editierbaren Zeilen** (`:403-405`, `:407-409`), Zurücksetzen-Knopf (`:279-282`) und 2
Erläuterungsabsätzen. Es trägt `print:hidden` (`report.tsx:865`) und existiert im PDF nicht. **Vier
Grössen sind dadurch im PDF nirgends als Zahl zu sehen: Pauschale Förderung, Förderung in %,
Abschreibungsdauer und Steuersatz.** Gemessen:
`grep -rniE "förderung|subsid|abschreib|afa|steuersatz|taxrate|depreciation" apps/website/lib/pdf-report/`
→ 4 Treffer (`charts.tsx:296`, `recommendation.ts:164`, `basis.ts:135`, `basis.ts:203`), **alle
Prosa, keiner mit Zahl**. Das PDF zeigt nur ihr Ergebnis in der Zeile „Nettoinvestition (nach
Förderung/Steuervorteil)" (`basis.ts:135`). Dazu `report-request-panel.tsx` (353 Z.), ebenfalls
`print:hidden` (die Klasse steht in der Komponente selbst, `:212`).

**Was das PDF MEHR hat:** eine Kapitelüberschrift (der Bildschirm kennt die Zeichenkette „Annahmen
und Datengrundlage" nicht — Suche über `components/report/` → **0 Treffer**; Positivkontrolle
`Annahmen (&|&amp;) Rechenweise` → **6 Treffer**), den Lead-Satz `BASIS_INTRO` und den Blocker-Befund
an dieser Stelle.

**Ergebnis:** Der Schlussblock des Bildschirms (`report.tsx:903-944`) enthält sechs Bausteine — fünf
davon trägt das PDF-Kapitel; den sechsten (`PrintMethodology`, `report.tsx:912`) trägt das PDF in
einem eigenen, vorangehenden Kapitel.

### 6.9 Der Begriffsbefund

`grep -rnE "Datenquellen-Tabelle|Tarifkomponenten|Berechnungsmethodik"` über alle `*.md`, `*.ts`,
`*.tsx`, `*.sql` → **0 Treffer**. Positivkontrolle `Annahmen-Tabelle` in `*.md` → **4 Treffer**
(`Fahrplan_2026.md:74`, `Pflichtenheft_Kalkulator_Delta_PDF-Report.md:970`, `:997`, `:1059`). Die
Spezifikation `Pflichtenheft_Kalkulator_Delta_PDF-Report.md:968-972` nennt für das Kapitel **sechs**
Teile — „Annahmen-Tabelle (nativ, kein Bild) → Datenqualitäts-Kasten → Blocker-Befund → Tarifherkunft
→ Preisstand → Schluss-Vorbehalt" — und **alle sechs sind gebaut**. Die drei erfragten Strukturen
sind dort nicht genannt; ob sie unter anderer Bezeichnung gemeint waren, ist aus den Dokumenten nicht
messbar.

---

## 7. Frage 5 — Existiert die Fünf-Balken-Kostenvergleichs-Grafik?

**`MonthlyTariffChart` zeichnet drei Serien. Zwei der fünf genannten Balken haben im Kalkulator keine
Entsprechung.**

### 7.1 `cost-chart.tsx` (309 Z.) ist NICHT der gesuchte Vergleich

Die Datei heisst im Report „Kostenvergleich mit/ohne Batterie" (`report.tsx:384`), vergleicht aber
keine Tarifszenarien, sondern **zwei Zeitverläufe über den Investitionshorizont**: Linie „Ohne
Batterie" (`:266-275`), Linie „Mit Batterie" (`:276-284`), zwei `<Area>` als reine Bandfläche mit
`legendType="none"` (`:250-265`), eine `<ReferenceLine>` beim Break-even (`:285-292`). Die X-Achse
ist `year` mit Domain `[0, horizonYears]` (`:234-242`) — **kein Szenario auf der Achse**. Werte aus
`buildYearSeries` (`:41-55`).

Darunter hängt ein zweites, kleines Chart: `SavingsBreakdownBar` (`:155-198`), **ein einziger
gestapelter Balken mit DREI Segmenten** aus der Konstanten `BREAKDOWN` (`:92-111`):
`leistungspreisSavingPerYear` → „Spitzenkappung (Leistungspreis)" (`:94-95`),
`selfConsumptionSavingPerYear` → „Eigenverbrauch" (`:100-101`), `loadShiftSavingPerYear` →
„Tarifbewusstes Laden" (`:106-107`). **Das sind Ersparnis-Töpfe derselben Rechnung (§3.7-Attribution),
keine Tarif-Szenarien.**

### 7.2 `monthly-tariff-chart.tsx` (293 Z.) ist der gesuchte Vergleich — mit drei Balken

Die Konstante `SERIES` hat genau drei Einträge (`:60-76`):

| Fundstelle | Serie |
|---|---|
| `:62-63` | `currentTariffEur` → `label: 'Ihr Tarif heute'` |
| `:67-68` | `spotWithoutControlEur` → `label: 'aWATTar ohne Steuerung'` |
| `:72-73` | `spotWithBatteryEur` → `label: 'aWATTar mit Ihrem Speicher (Ladung optimiert)'` |

`SERIES.map(...)` erzeugt drei `<Bar>` in **einem** `BarChart` (`:172-180`); die X-Achse trägt die
**zwölf Kalendermonate** (`:38-51`, `:129-136`), nicht die Szenarien. Überschrift: „Das zahlen Sie
jetzt vs. mit aWATTar" (`:149`). Der Modulkopf sagt die Zahl selbst: „**DREI REIHEN AUS EINER
RECHNUNG**" (`:12-16`). **Die Szenarien liegen also als Farbserie vor; ein Diagramm mit Szenarien auf
der X-Achse existiert im Repo nicht.**

### 7.3 `tariff-optimization-card.tsx` (270 Z.) ist kein Chart — vergleicht aber in Textform zwei Szenarien

Die Datei importiert kein Recharts (der Treffer `LineChart` auf `:1` ist ein lucide-Icon). Zwei
einander ausschliessende Zustände: Blocker (`:91-130`) oder Ergebnis (`:151-269`). Im Ergebniszweig
steht **nicht nur eine Zahl** — davor liegt ein bedingter Warnblock:

| Fundstelle | Zustand |
|---|---|
| `:141` | `const totals = monthly …` — die Summen des Monatsvergleichs |
| `:148` | `const surcharge = totals ? totals.withBattery - totals.current : 0` |
| `:149` | `const awattarCostsMore = totals != null && surcharge > 0` |
| `:153-177` | der Warnblock, nur bei `awattarCostsMore` |
| `:160` | Überschrift „aWATTar wäre für Sie derzeit teurer als Ihr Tarif heute" |
| `:163`, `:164`, `:166`, `:167` | vier weitere Werte |

Damit stellt die Karte im Warnfall **zwei Szenarien in Euro gegenüber** — als Text, nicht als
Chart-Serie. Ihr Kopf ordnet sie dem Monatsvergleich unter: „Sie beantwortet EINE Frage: was die
Ladesteuerung INNERHALB von aWATTar wert ist. Sie beantwortet ausdrücklich NICHT, ob sich der Wechsel
zu aWATTar rechnet" (`:28-31`).

`charge-price-chart.tsx` (248 Z.) vergleicht keine Tarife: zwei Balken und eine Linie (`:173`,
`:174-179`, `:182-192`) in **ct/kWh** (`:65-66`), nicht in Euro-Kosten.

### 7.4 Serienzählung über alle Report-Charts

| Datei | `<Bar` | `<Line` | `<Area` |
|---|---|---|---|
| `charge-price-chart.tsx` | 2 | 1 | 0 |
| `cost-chart.tsx` | 1 (im `.map` über 3) | 2 | 2 |
| `energy-flow-chart.tsx` | 0 | 2 | 2 |
| `load-chart.tsx` | 0 | 2 | 0 |
| `marginal-benefit-chart.tsx` | 0 | 1 | 0 |
| `monthly-tariff-chart.tsx` | 1 (im `.map` über 3) | 0 | 0 |

⚠ Die Zählregel ist mitzulesen: in `cost-chart.tsx` stehen fünf Recharts-Elemente in **einem**
`<ComposedChart>`; zwei davon sind Bandflächen mit `legendType="none"` (`:250-265`) und tragen keine
eigene Aussage. **Nach Abzug dieser beiden erreicht keine Datei mehr als drei Datenserien mit eigener
Aussage.**

### 7.5 Die Szenarien als Rechengrösse

**Die drei existierenden.** `packages/engine/src/simulation/monthly-tariff-comparison.ts` führt genau
drei Akkumulatoren (`:148-150`) und füllt sie in **zwei** Schleifen:

| Fundstelle | Zustand |
|---|---|
| `:183` | `current[idx] += intervalCostEur(rawKw, deltaHours, currentPrice, feedInCt)` — **roher** Lastgang × Ist-Arbeitspreis |
| `:184` | `withoutControl[idx] += intervalCostEur(rawKw, …, spotPrice, …)` — **roher** Lastgang × Spotpreis |
| `:185` | `withBattery[idx] += intervalCostEur(afterKw, …, spotPrice, …)` — Netzbezug **nach** Dispatch × Spotpreis |
| `:218-223` | zweite Schleife über die zwölf Monate: Fixkostenaufschlag auf dieselben drei Reihen; „Der Netz-Grundpreis geht in ALLE DREI Reihen" (`:219-220`) |
| `:137`, `:139-143` | beide Preisreihen aus **derselben** Funktion `combinedIntervalPrices`, einmal mit, einmal ohne `energyPriceCtPerKwh` |
| `:238-243` | Rückgabe: genau diese drei Reihen plus `coveredMonths` und `fixedCosts` |

⚠ **Eine Präzisierung zu Balken 3:** „aWATTar ungesteuert" heisst im Code **ohne Speicher**, nicht
„Speicher ohne Lademanagement". Der Contract sagt es wörtlich: „aWATTar-Preise auf den ROHEN,
unveränderten Lastgang — ohne jeden Dispatch" (`packages/shared/src/tariff-pricing.ts:176`).

**Die abgeleiteten Differenzen.** `packages/shared/src/real-saving.ts` bildet aus denselben drei
Summen zwei Differenzen: `tariffSwitchEur = currentTariffEur - spotWithoutControlEur` (`:70`) und
`controlValueEur = spotWithoutControlEur - spotWithBatteryEur` (`:71`), `totalEur` als **Summe der
Teile** (`:76`). ⚠ Der Posten heisst „Reiner Tarifwechsel" (`recommendation-card.tsx:268`,
`summary.ts:186`), meint aber den Wechsel **zu aWATTar**, nicht zu einem anderen Fixtarif — die
Beschriftung sagt es: „Ihr Tarif heute gegenüber aWATTar ohne jede Steuerung"
(`recommendation-card.tsx:269`). **Das ist nicht der gesuchte Balken 2.**

### 7.6 Fehlanzeige „einfacher Tarifwechsel" — im Kalkulator-Pfad

Im Suchraum `packages/` + `apps/website/` **nicht vorhanden**. Belastbar gemessen am
Schlüssel-Literal statt am camelCase-Wortstamm: `tariffComparisonProviderName|…EnergyPriceCtPerKwh|
…BaseFeeEurPerMonth|…PriceBasis|TARIFF_COMPARISON_` trifft repo-weit **genau vier Dateien, alle in
`apps/web`** — `tariff-draft.ts` (11), `data-entry-actions-tarif.ts` (13), `data-entry-tarif.tsx`
(11), `data-entry-actions-tarif.test.ts` (15); **0 in `packages`, 0 in `apps/website`**.
Positivkontrolle `energyPriceCtPerKwh` in `packages` + `apps/website`: 187 Treffer.

⚠ **Der Wortstamm allein trägt den Befund NICHT:** case-insensitiv liefert derselbe Suchraum 46
Treffer (`MonthlyTariffComparison`, `TariffComparisonResult`).

Als **Erfassungsfeld** existiert der Vergleichstarif: vier Schlüssel in
`apps/web/lib/admin/tariff-draft.ts:37-40`, geschrieben in `data-entry-actions-tarif.ts:100-110`,
gelöscht ab `:130`. Die Begründung, dass er nicht gerechnet wird, steht am Feld
(`tariff-draft.ts:30-35`): „eine Batterie kann nur gegen ein PREISSIGNAL steuern, das sich über den
Tag bewegt (aWATTar); ein einzelner Fixtarif eines Mitbewerbers hat diese Bewegung nicht … er ist ein
separater, von der Batterie unabhängiger Ersparnis-Hebel, den der Report **nennen** soll, kein
Optimierungsgegenstand."

⚠ **Ausserhalb des Kalkulator-Pfads existiert die Rechnung sehr wohl** — und sie ist in `apps/web`
aktiv verdrahtet:

| Fundstelle | Zustand |
|---|---|
| `packages/tariff-monitor/src/types.ts:62-74` | `TariffComparisonResult` mit `current`, `alternatives[]` (`savingOngoingEurPerYear`, `savingFirstYearEur`), `recommendation` |
| `packages/tariff-monitor/src/compare/compare.ts:103-107` | `export function compareTariffs(userInput, candidates, preferences)` |
| `packages/tariff-monitor/src/compare/compare.ts:115-122` | Sortierung nach Dauerpreis-Ersparnis |
| `apps/web/components/monitor/gratis-check-client.tsx:29`, `:87` | Import und Aufruf im Browser |
| `apps/web/app/(site)/[locale]/strom-check/page.tsx:45` | die Seite, die ihn benutzt |
| `apps/web/package.json:41` | `"tariff-monitor": "workspace:*"` |

**Balken 2 fehlt also dem Kalkulator, nicht dem Repo.**

### 7.7 Fehlanzeige „aWATTar optimal"

Es gibt **eine** Ladesteuerung, und drei Stellen sagen sinngleich, dass sie nicht das Optimum ist:

| Fundstelle | Zustand |
|---|---|
| `monthly-tariff-chart.tsx:285-288` | „folgt … einer einfachen Schwellenregel und ist noch nicht gegen ein rechnerisches Optimum geprüft: **die Zahl gilt als vorläufige Untergrenze**" |
| `charge-price-chart.tsx:240-243` | dasselbe, bezogen auf den Abstand zum Durchschnitt |
| `pdf-report/insight.ts:384-385` | dasselbe als Zeichenkettenverkettung im PDF-Text |

Das Verfahren ist `packages/engine/src/simulation/daily-price-order.ts`: zwei Schranken auf dem
bestehenden Fahrplan, Überschrift „**ZWEI SCHRANKEN, KEIN ZWEITER DISPATCH-PFAD**" (`:35`), im Text
ausgeführt: „es entsteht kein zweiter Fahrplan und keine zweite Zahl (Prinzip 2)" (`:44-46`).

Gegenprobe über `packages` + `apps` inkl. `*.md`, case-insensitiv:
`awattar optimal|optimalsteuerung|optimal gesteuert|einfach gesteuert|optimale steuerung` → **0
Treffer**. Positivkontrolle „ohne Steuerung" im Quellraum → 15 Treffer.

⚠ **Beschriftungs-Kollision:** die dritte Serie heisst heute schon „aWATTar mit Ihrem Speicher
(**Ladung optimiert**)" (`monthly-tariff-chart.tsx:73`, wiederholt `:152`), während dieselbe Datei
weiter unten sagt, die Steuerung sei eine „einfache Schwellenregel" (`:285-288`). **Das Wort
„optimiert" ist also für das belegt, was der Auftrag Balken 4 nennt.**

### 7.8 Szenario-Vokabular in der Engine

Suchraum `packages/engine/src/tariff` (5 Dateien, 514 Z.) + `packages/engine/src/savings` (10
Dateien, 1.911 Z.): `szenari`, `scenario`, `ungesteuert`, `gesteuert`, `optimal`, `naiv`,
`unmanaged`, `uncontrolled` → **je 0**. Dagegen `static` → 31, `dynamic` → 21, `baseline` → 5,
`variant` → 3. **Die 31+21 Treffer sind kein Tarifszenario, sondern der `controlType` der Batterie:**
„`'dynamic'` → Spitzenkappung: voller Leistungspreis-Anteil kreditiert … `'static'` → NUR
Eigenverbrauch/Lastverschiebung, KEINE Spitzenkappung" (`savings/attribute.ts:287-292`).

Über den grösseren Suchraum `packages/engine/src` + `packages/shared/src`: 11 Treffer auf
`szenari|scenario`, nach Abzug von `AddonBatteryScenario` (`analysis-result.ts:236`) und
`addonScenarios` (`:254`) neun — alles Zusatzspeicher-Kommentare bzw. Testtext. **Null
Tarifszenarien.**

### 7.9 Die PDF-Seite baut keine eigenen Charts

`charts.tsx` (506 Z.) rastert die unveränderten Bildschirmkomponenten — **sieben** Importe (`:1-7`),
**sechs** `captureChart(`-Aufrufe (`:314`, `:351`, `:391`, `:427`, `:447`, `:469`). **Es gibt keinen
PDF-eigenen Chart-Typ, der fünf Balken tragen könnte.** Der Kostenchart ist eine von **zwei einander
ausschliessenden** Fassungen (`charts.tsx:346-362`): `costPlan.kind === 'monthly'` →
`MonthlyTariffChart`, sonst `CostChart`; der Plan stammt aus `detail.ts:64-67`, gesetzt `:118-124`.
Die begleitenden Textzeilen im PDF sind ebenfalls **drei** (`detail.ts:195-201`).

`comparison.ts` (365 Z.) ist trotz des Namens **kein** Kostenvergleich: das Kapitel heisst
„Speichergrösse und Gerätewahl" und trägt „die Grenznutzen-Kurve und eine kompakte Vergleichstabelle
der übrigen Kandidaten" (`:8-9`); `ComparisonVariant = 'catalog' | 'addon'` (`:61`),
`ComparisonChartPlan` (`:64-68`) wird in `charts.tsx:470` zu einem `MarginalBenefitChart` — **eine
Linie über Batteriegrössen**. Verglichen werden Geräte, nicht Tarife.

### 7.10 Der Retail-Tarifkatalog

`retail_tariffs` liefert in `apps` + `supabase` **48** Treffer. Der lesende Code-Zugriff ist **genau
einer**: `apps/web/app/admin/(intern)/lieferanten-tarife/page.tsx:85` (`.from('retail_tariffs')`). In
`apps/website/**` (Rechner/Report): **0 Treffer**; Positivkontrolle `spot_prices` dort → 3 Treffer,
u. a. `lib/tariff-data/spot-prices.ts:89`.

Der Entfall an der Tarif-Station ist zweimal dokumentiert:

| Fundstelle | Zustand |
|---|---|
| `…/kalkulator-projekte/[id]/dateneingabe/page.tsx:318-323` | „Bis PR #220 stand hier zusätzlich eine Abfrage auf `public.retail_tariffs` … Die Tabelle, ihr Formular und ihre Admin-Seite bleiben unangetastet — sie werden von HIER nur nicht mehr gelesen." |
| `apps/web/components/admin/data-entry-tarif.tsx:47-51` | „Bis zum 15.09.2026 stand hier eine Liste der offenen `retail_tariffs` des Segments. Sie ist ERSATZLOS entfernt" |

Vorhandener, aber vom Rechner ungenutzter Umfang: **1.448 Zeilen Anwendungscode** (Admin-Seite 322,
Formular 317, `lib/admin/retail-tariffs.ts` 232, Actions 252, Schema 124, Migration
`20260913120000_create_retail_tariffs.sql` 201) plus 249 Zeilen DB-Gate.

### 7.11 Die Tarif-Station des Wizards, den fünf Balken gegenübergestellt

`apps/web/lib/admin/data-entry-actions-tarif.ts` ist 149 Zeilen lang und hat **zwei** Actions
(Speichern `:66`, Löschen `:130`):

| Was | Wie erfasst | Fundstelle |
|---|---|---|
| aWATTar | **gar nicht erfasst** — nur ein 30-Tage-Durchschnitt zur Einordnung, „wird angezeigt und nirgends verrechnet" | `dateneingabe/page.tsx:315-316`, Berechnung `:343-345` |
| aWATTar-Grundgebühr | Konstante im Code, 4,79 €/Monat netto | `packages/shared/src/supplier-tariffs.ts:46-49` |
| ein selbst gefundener Vergleichstarif | vier Entwurfsfelder, „alle vier oder keines" | `tariff-draft.ts:37-40`, `data-entry-actions-tarif.ts:100-110` |
| Tarif-**Wahl** („behalten" vs. „optimieren") | am 15.09.2026 ersatzlos entfernt | `tariff-draft.ts:14-18`, `data-entry-actions-tarif.ts:32-38`, `data-entry-tarif.tsx:30-38` |

Die Station kennt **einen** Vergleichstarif als Angabe und **einen** automatischen aWATTar-Vergleich,
der nicht als Angabe existiert, sondern in der Engine hart verdrahtet ist. Die fünf Balken verlangen
dagegen **zwei** aWATTar-Steuerungsstufen und **einen** Fixtarif-Vergleich. Der erfasste
Vergleichstarif erreicht die Kalkulator-Engine nicht (§7.6), die beiden Steuerungsstufen existieren
nicht als zwei getrennte Rechnungen (§7.7).

### 7.12 Bilanz

| Balken laut Auftrag | Rechengrösse? | Chart-Serie? | Fundstelle |
|---|---|---|---|
| 1. „Heute" (Ist-Kosten) | **ja** | **ja** | `monthly-tariff-comparison.ts:183` · `monthly-tariff-chart.tsx:62-63` · `detail.ts:195` |
| 2. „einfacher Tarifwechsel" | **im Kalkulator nein** (nur 4 Entwurfsfelder in `apps/web`) — **im Repo ja**, als `compareTariffs` im Monitor-Produkt | **nein** | erfasst `tariff-draft.ts:37-40`; Begründung `:30-35`; Fremdrechnung `tariff-monitor/src/compare/compare.ts:103-107` |
| 3. „aWATTar ungesteuert" | **ja**, aber als *ohne Speicher* (roher Lastgang) | **ja** | `monthly-tariff-comparison.ts:184` · `tariff-pricing.ts:176-177` |
| 4. „aWATTar einfach gesteuert" | **ja** — die einzige gebaute Steuerung | **ja** (dort „Ladung optimiert" beschriftet) | `monthly-tariff-comparison.ts:185` · `daily-price-order.ts:35`, `:44-46` |
| 5. „aWATTar optimal" | **nein** — als ausdrücklich nicht gerechnet dokumentiert | **nein** | `monthly-tariff-chart.tsx:285-288` · `charge-price-chart.tsx:240-243` · `insight.ts:384-385` |

**3 von 5** Balken existieren im Kalkulator als Rechengrösse **und** als Chart-Serie, **2 von 5** in
keiner der beiden Formen — wobei Balken 2 als fertige Rechnung im Repo vorliegt, nur in einem anderen
Produkt. Zusätzlich existieren **zwei** der Balken bereits als *Differenz* (`real-saving.ts:70-71`)
und werden im Report als zweizeilige Aufschlüsselung ausgegeben (`recommendation-card.tsx:267-276`,
`summary.ts:185-194`) — also die Delta-, nicht die Niveau-Darstellung.

⚠ **Die Fünf-Balken-Fassung steht in keinem Repo-Dokument als Anforderung:**
`fünf Balken|5 Balken|Fünf-Balken` über alle `*.md` im Root → **0 Treffer**; Positivkontrolle
`Baukasten` im selben Suchraum → 7 Treffer. Sie stammt aus dem Auftrag dieser Bestandsaufnahme, nicht
aus einem Pflichtenheft.

---

## 8. Frage 6 — Stehen zwei unabhängige Ersparnis-Zahlen ohne klare Zuordnung nebeneinander?

**Ja, an fünf Orten.** Bezugspunkt ist Prinzip 2 aus `CLAUDE.md`: „Ein Dispatch, eine ehrliche Zahl …
Ersparnisanteile transparent aufschlüsseln, **nie** unabhängig addieren."

### 8.1 Inventar: elf Euro-Ersparnisgrössen im Contract

`packages/shared/src/financial.ts` (23 Z.) trägt **keine** Ersparnisgrösse — es ist ausschliesslich
das zod-Schema der Förder-/Steuereingaben (`:12-22`). Die Grössen verteilen sich auf drei Dateien:

| Nr. | Fundstelle | Grösse |
|---|---|---|
| 1 | `analysis-result.ts:175` | `leistungspreisSavingPerYear` — Spitzenkappung, ratenbasiert, konstruktionsbedingt Jahresgrösse |
| 2 | `analysis-result.ts:180` | `selfConsumptionSavingPerYear` — „PRO JAHR … die HOCHGERECHNETE Grösse" (`:176-179`) |
| 3 | `analysis-result.ts:182` | `loadShiftSavingPerYear` — „tarifbewusstes Laden; 0 ohne Tarif-Fenster. Ebenfalls hochgerechnet" |
| 4 | `analysis-result.ts:193` | `selfConsumptionSavingOverCoveredPeriod` — der GEMESSENE Zwilling von (2) |
| 5 | `analysis-result.ts:194` | `loadShiftSavingOverCoveredPeriod` — der GEMESSENE Zwilling von (3) |
| 6 | `analysis-result.ts:199` | `totalSavingPerYear` — „Summe aus DEMSELBEN Fahrplan (keine Doppelrechnung)" |
| 7 | `analysis-result.ts:213` | `netSavingOverHorizon` — Jahresersparnis × Horizont − Nettoinvestition |
| 8 | `real-saving.ts:49` | `tariffSwitchEur` — „Ihr Tarif heute − aWATTar OHNE Steuerung. Negativ, wenn der Wechsel allein teurer wäre." (`:48`) |
| 9 | `real-saving.ts:51` | `controlValueEur` — „aWATTar ohne Steuerung − aWATTar MIT dem Speicher." (`:50`) |
| 10 | `real-saving.ts:53` | `totalEur` — „Die Summe der beiden — die Zahl, die die Kopfkarte gross zeigt." (`:52`) |
| 11 | `analysis-bundle.ts:318` | `annualSavingEur` in `BaselineExtracts` — der eingefrorene Archiv-Auszug, gebildet als `recommended.totalSavingPerYear` (`:352`), also (6) unter anderem Namen |

Dazu zwei investitionsmindernde Beträge, die keine Ersparnis im engeren Sinn sind: `subsidyAmount`
(`:207`) und `taxBenefit` (`:208`).

**Teilmengen-Verhältnisse, wie sie im Code festgelegt sind:**

- (1)+(2)+(3) = (6) — Contract-Kommentar `analysis-result.ts:199`, Engine-Invariante
  `savings/attribute.test.ts:89-94` (`toBeCloseTo(sum, 10)`).
- (8)+(9) = (10), gebildet **durch Addition**, nicht als unabhängige Differenz (`real-saving.ts:70-77`,
  Begründung `:32-38`).
- (4)/(5) sind die ungerechneten Rohwerte zu (2)/(3); der Faktor steht daneben (`:195-196`).
- **(10) und (6) sind zwei verschiedene Rechenwege auf dieselbe Frage** — „Sie ist damit eine
  KASSEN-Grösse aus dem Monatsvergleich und keine Attributions-Grösse aus der §3.7-Buchhaltung"
  (`real-saving.ts:12-14`), mit drei benannten Restposten (`:16-24`).
- **(9) und (3) beantworten dieselbe Sachfrage auf zwei Wegen** und sind nicht wertgleich; (3) ist
  zusätzlich jahreshochgerechnet, (9) ausdrücklich nicht (`real-saving.ts:40-45`).
- ⚠ **Im Zusatzfall tragen alle Felder von (1)–(7) dieselben Namen, meinen aber Differenzen statt
  Bruttowerte.** `AddonBatteryScenario = BatteryResultEntry & BatteryRoiSummary & { combined }`
  (`analysis-result.ts:236-240`); **die Unterscheidung trägt allein der Kommentar (`:222-227`), nicht
  das Typsystem.**
- Die drei Reihen des Monatsvergleichs (`tariff-pricing.ts:175`/`:177`/`:179`) sind Kosten, keine
  Ersparnisse; ihre `fixedCosts` sind Aufschlüsselung und kein zusätzlicher Posten („wer die Zahlen
  hier zu einem Balken addiert, zählt sie doppelt", `:186-188`).

### 8.2 Euro-Grössen im Bildschirm-Report

| Fundstelle | Zustand |
|---|---|
| `recommendation-card.tsx:200-215` | Kopfzahl `\|real.totalEur\|` (Betrag, `:210`), Beschriftung direkt darüber „Ersparnis mit aWATTar" bzw. „Mehrkosten mit aWATTar" (`:201`), darunter „über N gemessene Monate — nicht hochgerechnet, exkl. MwSt." (`:212-215`) |
| `recommendation-card.tsx:267-276` | zwei `DeltaRow`: „Reiner Tarifwechsel" / „Wert der Ladesteuerung", je mit erklärendem `hint` in derselben Zeile (`:40-52`) |
| `recommendation-card.tsx:277-282` | Summenzeile „Gesamt" = `real.totalEur`, mit `border-t-2` |
| `recommendation-card.tsx:307-317` | `leistungspreisSavingPerYear` im Fliesstext, eingeleitet „**Nicht enthalten: die Spitzenkappung.**" (`:309`), geschlossen „er ist eine Jahresgrösse und deshalb oben nicht mitaddiert" (`:315`) |
| `recommendation-card.tsx:224-229` | Kopfzahl `entry.totalSavingPerYear`, Beschriftung „Zusätzliche Ersparnis / Jahr" (addon) bzw. „Ersparnis / Jahr" (`:225`) |
| `recommendation-card.tsx:340-349` | drei `SavingRow` plus „Gesamt" = `totalSavingPerYear` (`:348`) |
| `recommendation-card.tsx:381-389` | die beiden `…OverCoveredPeriod`-Rohwerte, nur bei `annualizationFactor > 1` (`:373`) |
| `tariff-optimization-card.tsx:202` | `loadShiftSavingPerYear` als `text-3xl`; Beschriftung darunter „pro Jahr **zusätzlich** (exkl. MwSt.) — durch Laden in günstigen und Entladen in teuren Viertelstunden" (`:203-206`) |
| `tariff-optimization-card.tsx:219` | `loadShiftSavingOverCoveredPeriod` im Hochrechnungssatz |
| `tariff-optimization-card.tsx:163-168` | drei Beträge des Monatsvergleichs im Warnkasten (`:160`) |
| `cost-chart.tsx:155-195` | gestapelter Balken „Ersparnis/Jahr", Beträge in der Legende (`:192`) |
| `monthly-tariff-chart.tsx:196-200` | drei absolute Summen mit Reihen-Beschriftung und „über N gemessene Monate" |
| `marginal-benefit-chart.tsx:198`/`:204` | `netSavingOverHorizon` des besten Punkts, Beschriftung „Netto über N Jahre, also Ersparnis abzüglich der Anschaffung" (`:137-141`) |

**Euro-Grössen, die ausdrücklich KEINE Ersparnis sind:** `load-chart.tsx:321-330` (kontrafaktische
Kostengrösse je angeklickter Spitze, mit Satz „Kontrafaktische Kostengröße — **nicht** die
Ersparnis", `:328-329`), `key-metric.tsx:22` („Leistungspreis-Kosten pro Jahr", `:24-26`),
`cost-chart.tsx:74`/`:79`/`:244` (kumulierte Kostenkurve; die Fläche zwischen den Kurven ist die
Ersparnis, begründet `:37`).

### 8.3 Euro-Ersparnisse im PDF-Report

| Fundstelle | Zustand |
|---|---|
| `summary.ts:174-209` | Aussage `savings`: Titel `:176-178`, Kopfzahl `\|real.totalEur\|` (Betrag) `:179-183`, zwei `deltaRow` + Summenzeile `:184-201`, Body `:202-208` |
| `summary.ts:214-224` | Alternativfassung: drei §3.7-Zeilen + „Gesamt" |
| `summary.ts:295-311` | Aussage `peak_shaving`: Kopfzahl `leistungspreisSavingPerYear` (`:299`), „pro Jahr, exkl. MwSt." (`:300`) |
| `summary.ts:359-377` | Aussage `load_shift`: Kopfzahl `loadShiftSavingPerYear` (`:363`) |
| `summary.ts:415-437` | Aussage `addon`: Kopfzahl `best.totalSavingPerYear` (`:419`), „zusätzlich pro Jahr" (`:420`), plus Investition/Amortisation/`netSavingOverHorizon` (`:425-436`) |
| `detail.ts:194-201` | die drei Monatsvergleichs-Summen, `amount: null` (`:231`) |
| `recommendation.ts:132-144` | „Ersparnis pro Jahr" und „Netto über N Jahre" des Katalog-Kandidaten |
| `comparison.ts:180`/`:182`/`:190`/`:193` | Tabellenspalten „Ersparnis/Jahr" und „Netto über N Jahre" je Kandidat |

**Kapitel ohne Kopfzahl.** `grep -rn "amount: null"` über `lib/pdf-report/` → **8 Fundstellen**;
`KEINE KOPFZAHL` → **6**; `lüde dazu ein` → **4**. Mit der Begründung „lüde dazu ein, ihn zu
addieren": `detail.ts:226-231`, `comparison.ts:316-318`, `recommendation.ts:285-289`,
`insight.ts:372-377`. Mit eigener Begründung: `insight.ts:306-310` („Die stärkste Zelle ist ein
Maßstab für das Bild und keine Ersparnis"), `comparison.ts:264-268` („Eine erfundene 0 … wäre eine
Zahl, die etwas anderes behauptet als der Satz darunter"). Ohne Kommentar: `summary.ts:404`,
`basis.ts:102`.

Alle vier Kernergebnis-Aussagen stehen auf **einer** `<Page>` (`document.tsx:1470-1474`, gerendert
`:1028-1029`, Kapitelfunktion ab `:994`), jede als eigener, nicht umbrechender Block (`:873-875`).

### 8.4 Die vier Risikomuster, einzeln geprüft

**(a) Tarifoptimierungs- neben Peak-Shaving-Ersparnis.** In derselben linken Spalte
(`report.tsx:736-780`) stehen untereinander: die `RecommendationCard` (`:763`) mit der Zeile
„Tarifbewusstes Laden" = `entry.loadShiftSavingPerYear` (`recommendation-card.tsx:345`) und
unmittelbar darunter die `TariffOptimizationCard` (`:775-779`) mit **derselben Grösse** als
`text-3xl`-Kopfzahl (`tariff-optimization-card.tsx:132`/`:202`). Die Karte bekommt `primaryEntry`
(`report.tsx:777`), und `primaryEntry` ist im Katalogfall genau `recommended` (`:170`) — **es ist
derselbe Zahlenwert, zweimal, unter zwei Beschriftungen** (begründet `report.tsx:770-773`).

Die Aussage über ihr Verhältnis lautet wörtlich: „Sie steckt bereits in der Gesamtersparnis der
Empfehlung (als „Lastverschiebung") und kommt nicht zusätzlich obendrauf." Sie steht in
`tariff-optimization-card.tsx:245-246` — **als `children` der `InfoHint`** (`:232-258`). `InfoHint`
startet zugeklappt (`info-hint.tsx:66`, `useState(false)`), rendert die Erklärung nur bei `open`
(`:84`) und blendet sie im Druck aus (`:87`, `print:hidden`); eine zweite, immer sichtbare Fassung
existiert nur für den Druck (`:98-102`, `hidden … print:block`, aktiviert über `printExplanation`,
`tariff-optimization-card.tsx:234` — die einzige Verwendung des Schalters in `apps/website`). **Am
Bildschirm steht die Aussage über das Verhältnis der beiden Zahlen also erst nach einem Klick.** Der
immer sichtbare Text lautet „pro Jahr zusätzlich (exkl. MwSt.) …" (`:203-206`) und „Ersetzt nicht den
Vergleich mit Ihrem aktuellen Tarif …" (`:194-198`).

Im PDF trägt die Aussage `peak_shaving` dafür einen fallabhängigen Satz `relation`
(`summary.ts:288-293`): entweder „Dieser Betrag steckt NICHT in der Zahl oben … Er kommt hinzu —
addieren lässt er sich trotzdem nicht, weil er eine Jahresgrösse ist und die Zahl oben ein
Zeitraumbetrag." oder „Dieser Betrag ist in der Gesamtersparnis oben bereits als erste Zeile
enthalten und kommt nicht zusätzlich obendrauf." Die Verzweigung hängt an einem **getypten
Rückgabewert**, nicht an einer Zeichenkette (`summary.ts:731-737`).

⚠ **Dieser eine PDF-Satz hat am Bildschirm ein immer sichtbares Gegenstück**:
`recommendation-card.tsx:307-317` im Realvergleichs-Zweig; im anderen Zweig ist die Spitzenkappung
die erste `SavingRow` über der Gesamt-Zeile (`:340-349`) und braucht den Satz strukturell nicht.

**(b) Spanne neben Einzelwert.** Eine **Euro**-Spanne existiert nicht. Von-bis-Angaben gibt es drei,
alle in anderen Einheiten und mit Beschriftung unmittelbar an der Zahl:
`pdf-report/recommendation.ts:236` (kW-Spanne der Kapp-Schwelle, gerendert `:246-248`),
`summary.ts:665-666` und `estimated-pv-note.tsx:62-68` (die PV-Wetterjahr-Spanne in kWh, am
Bildschirm ausdrücklich als Unsicherheit der Eigenverbrauchs-Ersparnis eingeführt, `:46-47`, `:73-78`).

**(c) Dasselbe Wort in unterschiedlicher Bedeutung — fünf Fälle.**

1. **„Wert der Ladesteuerung".** Im Bestandsfall mit Monatsvergleich stehen in derselben Spalte:
   `recommendation-card.tsx:273` (`DeltaRow`, Wert `controlValueEur` — Kassendifferenz, nicht
   hochgerechnet) und `tariff-optimization-card.tsx:186` (Karte „Wert der Ladesteuerung **unter
   aWATTar**", Wert `loadShiftSavingPerYear` — §3.7-Attribution, jahreshochgerechnet). Die
   Beschriftungen unterscheiden sich um **drei Wörter**. Der PDF-Report benennt genau diesen Abstand
   in einem eigenen Satz und begründet ihn mit der Bildschirm-Situation: „Am Bildschirm liegen die
   beiden in getrennten Karten; auf dieser Seite stehen sie wenige Zeilen auseinander, und zwei fast
   gleiche Zahlen unter zwei fast gleichen Beschriftungen liest jeder als Fehler."
   (`summary.ts:346-348`). Der daraus gebaute Satz `reconcile` (`:352-356`) erklärt den Unterschied
   Kassen- gegen Zuordnungsgrösse. **Ein Gegenstück dazu steht im Bildschirm-Code nicht** — und die
   beiden Karten liegen dort ebenfalls untereinander in einer Spalte (`report.tsx:746-779`), nicht in
   getrennten Ansichten.
2. **„Ersparnis" jährlich gegen Zeitraum.** Kopfzahl der Bestandskarte: „Ersparnis mit aWATTar" über
   einem **Zeitraum**betrag (`recommendation-card.tsx:201`, Caption `:212-215`); Karte darunter:
   „pro Jahr" (`tariff-optimization-card.tsx:204`). Für dieses Paar steht kein klärender Satz im
   sichtbaren Bildschirmtext.
3. **„Ersparnis" mit/ohne Investition.** `netSavingOverHorizon` als „Netto über N Jahre, also
   Ersparnis abzüglich der Anschaffung" (`marginal-benefit-chart.tsx:137-141`) und als Spalte neben
   „Ersparnis/Jahr" (`comparison.ts:180`/`:182`). Ausgeschrieben an drei Orten
   (`marginal-benefit-chart.tsx:21-27`, `comparison.ts:323-325`, `recommendation.ts:158-160`).
4. **Eigenverbrauch im Bestandsfall.** Die `InfoHint` verweist auf einen Anteil „(„Eigenverbrauch")
   in der Ersparnis-Aufschlüsselung" (`tariff-optimization-card.tsx:255-257`) und auf „die
   Gesamtersparnis der Empfehlung" (`:245`). Liegt ein Monatsvergleich vor, rendert die Karte darüber
   aber gerade **nicht** die drei §3.7-Zeilen, sondern die zwei `DeltaRow` (Verzweigung
   `recommendation-card.tsx:254`, begründet `:257-266`). **Die verwiesenen Beschriftungen sind in
   dieser Konstellation im Dokument nicht vorhanden.**
5. **Identische Feldnamen für Brutto und Differenz** — s. §8.1, `analysis-result.ts:236-240`.

**(d) Zusatzspeicher-/Grenznutzen-Wert neben der Hauptempfehlung.** Am Bildschirm steht der
Zusatzspeicher-Abschnitt weiter unten auf derselben Seite (`report.tsx:839-846`, Sektion `:584-653`).
Immer sichtbar ist die Grenznutzen-Kurve mit einem Euro-Betrag im Fliesstext
(`marginal-benefit-chart.tsx:198`/`:204`); die Karten mit „Zusätzliche Ersparnis / Jahr" liegen hinter
einer Accordion (`report.tsx:606-629`). Die Differenz-Natur ist an drei Stellen ausgeschrieben
(`report.tsx:588-593`, `recommendation-card.tsx:331-338`, `:466-471`). **Eine Aussage über das
Verhältnis zur Kopfzahl des primären Blocks steht an keiner dieser Stellen.**

Im PDF steht die Zusatzspeicher-Aussage als **vierter Block auf derselben Kernergebnis-Seite** wie
die Kopfzahl (`summary.ts:739-744`). Ihr Fliesstext grenzt gegen die **bestehende Anlage** ab („Alle
Beträge hier sind das, was über Ihre bestehende Anlage hinaus herauskommt", `:441-443`), **nicht**
gegen die Kopfzahl der Aussage `savings` einige Zeilen darüber. ⚠ **Anders als `peak_shaving`
(`:273-277`) und `load_shift` (`:327-331`) bekommt `buildAddon` den Schalter
`savingsIsRealComparison` gar nicht übergeben** (Signatur `:392`, Aufruf `:743`).

Ein zweiter PDF-Ort: im Bestandsfall trägt das Empfehlungs-Kapitel die Überschrift „Falls Sie
stattdessen neu kaufen würden: <Gerät>" (`recommendation.ts:169-170`) mit der Zeile „Ersparnis pro
Jahr" = `totalSavingPerYear` des Katalog-Kandidaten (`:132-136`) — eine **Bruttozahl eines
Ersatzkaufs** eine Seite hinter den Differenzbeträgen. Die Abgrenzung steht als `framing`-Satz
(`:153-157`).

### 8.5 Vorhandene Schutzmechanismen

| Fundstelle | Zustand |
|---|---|
| `engine/savings/attribute.test.ts:89-94` | Kern-Invariante: Summe der drei Anteile == `totalSavingPerYear`, `toBeCloseTo(sum, 10)` |
| `attribute.test.ts:150-155` | dieselbe Invariante für `static` (Leistungspreis 0) |
| `engine/savings/attribute.ts:80-91` | „ist keine kWh doppelt gezählt → Summe = total (Prinzip 2)" |
| `shared/real-saving.test.ts:31-48` | Wächter: Kopfzahl ist bit-genau die Summe der beiden angezeigten Zeilen, über 6 Eingänge |
| `real-saving.test.ts:56-62` | pinnt, dass die Summe **gebildet** und nicht unabhängig gerechnet wird |
| `real-saving.test.ts:111-128` | Durchstich Reihe → `sumCovered` → Aufschlüsselung an den dokumentierten Urbanz-Werten |
| `shared/real-saving.ts:100-102` | `sumCovered` als **eine** Definition; vier Konsumenten (begründet `:84-98`) |
| `recommendation-card.tsx:84-112` | diskriminierte Props-Union statt optionaler ROI-Felder — „Ein `entry.totalInvestment` im `existing`-Zweig ist damit … ein Compile-Fehler" (`:81-82`) |
| `summary.ts:731-736` | `isRealComparison` reist als **Rückgabewert** und wird NICHT aus erzeugtem Text zurückgelesen |
| `pdf-report/statement.ts:51-59` | `amount` ist im geteilten Darstellungstyp null-fähig: „eine erfundene 0 an dieser Stelle wäre eine Zahl, die etwas anderes behauptet als der Satz darunter" — die typseitige Wurzel aller acht `amount: null`-Stellen |
| `content.ts:52-62` | PDF-Methodikkapitel, **immer** gerendert (`document.tsx:1352-1364`, Seite `:1504-1508`): „nie getrennt gerechnet und addiert … keine Kilowattstunde zählt doppelt" |
| `print-methodology.tsx:53-58` | wortgleiche Aussage im CSS-Druckweg — Container `hidden print:block` (`:40`), am Bildschirm also **nicht** sichtbar |
| `app/pdf-report-probe/summary-probe-kinds.ts:11-38` | manuelle Prüfroute mit **12 benannten Fällen** (u. a. `bestand`, `zusatz`, `teiljahr`) — der einzige Ausführungsweg über die Anzeigeschicht, aber **kein automatisierter Test** |
| `apps/web/app/admin/(intern)/analysen/[id]/page.tsx:259-262`, `analysen/page.tsx:80` | Admin-Archivansicht zeigt je genau **eine** Ersparniszahl (`baseline_annual_saving_eur`) |

**Rechnerisch — und nicht nur sprachlich — ausgeschlossen ist eine Doppelzählung an genau vier
Stellen:** `attribute.test.ts:89-94`, `:150-155`, `real-saving.test.ts:31-48`, `:56-62`. **Alle vier
liegen in `packages/**`; in `apps/website` existiert kein ausführbarer Test** (0 Testdateien, kein
`test`-Skript in `apps/website/package.json:5-11`).

### 8.6 Die fünf Risikoorte, neutral beschrieben

1. **`report.tsx:736-780` (linke Spalte).** Kopfzahl/Aufschlüsselung der `RecommendationCard` und
   Kopfzahl der `TariffOptimizationCard` untereinander; im Katalogfall ist die untere Zahl
   bit-identisch mit der Zeile „Tarifbewusstes Laden" darüber. Die Beschriftung darunter lautet
   wörtlich „pro Jahr zusätzlich (exkl. MwSt.) …". Eine Aussage über ihr Verhältnis steht an dieser
   Stelle **nur im per Vorgabe zugeklappten** `InfoHint`-Inhalt und im Druck-Pendant.
2. **Dieselbe Spalte im Bestandsfall mit Monatsvergleich.** `DeltaRow` „Wert der Ladesteuerung"
   (`controlValueEur`) und Karte „Wert der Ladesteuerung unter aWATTar" (`loadShiftSavingPerYear`);
   verschiedene Rechenwege. Eine Aussage über ihr Verhältnis steht im Bildschirm-Code **nicht**; der
   entsprechende Satz existiert ausschliesslich im PDF (`summary.ts:352-356`) und **benennt die
   Bildschirm-Anordnung dabei als „getrennte Karten"**.
3. **PDF-Kernergebnis-Seite** (`document.tsx:1470-1474`), bis zu vier Euro-Kopfzahlen. Für
   `peak_shaving` und `load_shift` steht je ein Verhältnis-Satz. Für `addon` steht ein
   Abgrenzungssatz gegen die bestehende Anlage, **keiner gegen die Kopfzahl der Aussage `savings`**;
   `buildAddon` erhält den dafür vorgesehenen Schalter nicht.
4. **PDF-Empfehlungs-Kapitel im Bestandsfall** (`recommendation.ts:167-178`): Brutto-Jahresersparnis
   eines Ersatzkaufs eine Seite hinter den Differenzbeträgen; Zeilenbeschriftung „Ersparnis pro
   Jahr" (`:133`), Einordnung im Fliesstext (`:153-157`).
5. **`report.tsx:839-846`:** Zusatzspeicher-Abschnitt mit Euro-Beträgen nach dem primären Block.
   Beschriftungen sagen „über Ihre bestehende Anlage hinaus" bzw. „Zusätzliche Ersparnis / Jahr";
   eine Aussage über das Verhältnis zur Kopfzahl des primären Blocks steht im Code **nicht**.

Dazu, eine Ebene tiefer: **im Contract selbst** tragen Brutto- und Differenzgrössen identische
Feldnamen (`analysis-result.ts:236-240`); die Unterscheidung existiert als Kommentar und in der
Anzeigeschicht, **nicht im Typsystem**.

### 8.7 Wodurch die Zuordnung heute gehalten wird

Wo sie eindeutig ist, hält sie eine von drei Techniken: **(a)** die Layout-Summenzeile mit
`border-t-2` unmittelbar unter den Teilbeträgen (`recommendation-card.tsx:277`, `:346`); **(b)**
Beschriftung direkt an der Zahl statt in einer Fussnote (`:200-215`, begründet `:194-198`); **(c)** im
PDF explizite Verhältnis-Sätze aus einem getypten Schalter (`summary.ts:288-293`, `:352-356`,
`:731-736`) sowie ein getyptes `amount: null` für Kapitel, die bewusst keine zweite Zahl setzen
(`statement.ts:51-59`).

---

## 9. Frage 7 — Ist das dreistufige Report-Freiheitsmodell ausgearbeitet?

**Nein.** Die Stufen sind entschieden, der Inhalt des Baukastens ist der offene Punkt.

### 9.1 Fundort und Umfang

| Fundstelle | Zustand |
|---|---|
| `Pflichtenheft_Kalkulator_Delta_KI-Interface.md:174-191` | §5 vollständig: **18 Zeilen**, 343 Wörter, 2.804 Bytes (§6 beginnt bei 193) |
| `…:176-183` | §5.1 Freiheitsmodell: **8 Zeilen**, 168 Wörter |
| `…:177` | ein Revisionsvermerk: „Revidiert gegenüber dem ursprünglichen Vorschlag dieser Sitzung (**der nur Formulierung freigab**) — auf ausdrücklichen Wunsch, mehr Freiheit zuzulassen, weil der Urbanz-Fall selbst durch Iteration und Annahme von KI-Vorschlägen entstand" |
| `…:179`, `:180`, `:181` | die drei Stufen selbst: **3 Zeilen**, 22 + 32 + 4 = **58 Wörter** |
| `…:183` | ein Absatz „Bewusste Grenze bei Stufe 2" (1 Zeile) |
| `…:185-186` | §5.2 Reproduzierbarkeit/Archivierung: Überschrift + **1** Fliesstextzeile |
| `…:188-189` | §5.3 Kennzeichnung Annahme/Messwert: Überschrift + **1** Fliesstextzeile |

### 9.2 Die drei Stufen, wörtlich

- **`:179`** — „**Zahlen/Berechnung — fest.** Kommen unverändert aus der deterministischen Engine
  (`AnalysisResult`). Daran ändert dieses Delta nichts; das ist eine Zusage, kein Diskussionspunkt."
- **`:180`** — „**Auswahl & Struktur — frei aus einem Baukasten.** Welche Kapitel, welche Grafik-Art,
  welche Reihenfolge, was wird betont — hier bekommt die KI echte Kompositionsfreiheit, nicht nur ein
  Regelwerk mit mehr Bedingungen."
- **`:181`** — „**Formulierung — frei.**"

Knapp: **Zahlen fest · Auswahl und Struktur frei innerhalb eines Baukastens · Sprache frei.** Dazu
eine einzige ausformulierte Einschränkung (`:183`): Freiheit nur bei „Auswahl und Kombination aus
einem deutlich erweiterten, aber weiterhin typisierten und geprüften Baukasten an
Grafik-/Abschnitts-Bausteinen — nicht Freiheit, völlig neue Grafik-Arten frei zu erfinden"; der
Baukasten dürfe „über die heutigen sieben festen Grafiken deutlich hinauswachsen".

⚠ **Auslegung des Wortlauts, ausdrücklich als solche gekennzeichnet:** Die drei Stufen sind dem Text
nach **keine drei Alternativen, aus denen eine zu wählen wäre**, sondern drei Schichten mit je
eigenem Gegenstand (Zahlen · Auswahl/Struktur · Formulierung) und je eigenem Freiheitsgrad. Eine
Stelle, an der das Dokument eine Wahl zwischen 1, 2 und 3 anbietet, gibt es nicht.

### 9.3 Konkretheitsgrad — gemessen, nicht geschätzt

Im gesamten §5 (18 Zeilen) stehen **vier verschiedene** in Backticks gesetzte Bezeichner mit zusammen
**sechs** Vorkommen, und **alle vier benennen Bestehendes**:

| Bezeichner | Vorkommen | Art |
|---|---|---|
| `AnalysisResult` | 3× | bestehender Engine-Contract |
| `platform.analyses` | 1× | bestehende Tabelle (B14-1) |
| `inputs` | 1× | bestehende Spalte |
| `result` | 1× | bestehende Spalte |

**Kein neuer Typname, kein neuer Tabellen- oder Feldname, keine Kapitelliste, keine
Baustein-Aufzählung.** Der Abschnitt nennt drei Regeln — (a) Zahlen unangetastet (`:179`), (b) der
ausgelieferte Report wird vollständig archiviert, „Struktur **und** Text, nicht nur die
zugrundeliegenden Zahlen" (`:186`), (c) die KI komponiert „ausschliesslich aus vorqualifizierten
Aussage-Bausteinen", die ihre Annahme/Messwert-Kennzeichnung bereits tragen (`:189`) — **aber keine
Struktur, in der diese Regeln ausgedrückt wären.**

### 9.4 Ist die Wahl offen?

| Fundstelle | Zustand |
|---|---|
| `…:248` (§9 Punkt 5) | „**Baukasten-Inhalt für Teil 3** (§5.1) — welche zusätzlichen Grafik-/Abschnitts-Typen über die bestehenden sieben hinaus, konkret." — **nicht durchgestrichen**, also offen (zum Vergleich: die erledigten Punkte 1, 7, 9 tragen `~~…~~`, Z. 233, 250, 262) |
| `…:304-306` (§10) | „**Teil 3 ist unangetastet.**" |
| `…:392` (§10, Tabelle „Nächste Schritte") | `\| Report-Baukasten \| §5 \| — \|` — die Inhaltsspalte trägt **nur die Paragraphennummer**. **Zwei** der neun Datenzeilen sind so gehalten (`:391` „§2.3/2.4", `:392` „§5"); die übrigen sieben tragen ausformulierte Inhalte |
| `…:34` (§0) | Einzeiler in der Spalte „Entscheidung": „Dreistufiges Freiheitsmodell: Zahlen fix (Engine unverändert) · Auswahl & Struktur frei aus erweitertem, typisiertem Baukasten · Formulierung frei." |

**Die Stufen selbst sind also entschieden; offen ist ausschliesslich der Inhalt des Baukastens.**
Nur einer der elf Punkte in §9 verweist auf §5.

Zwei weitere Dokumente führen dieselbe Entscheidung, ohne sie auszuarbeiten:
`README_Doku-Struktur.md:38` und `CLAUDE.md:137` („**Nächster grosser Schritt: der Report-Baukasten
(Teil 3)** — bislang unangetastet, nichts davon existiert für den neuen Wizard-Entwurf").
`grep -rn "Freiheitsmodell" --include="*.md" .` liefert genau **vier** Treffer: `Fahrplan_2026.md:75`,
`README_Doku-Struktur.md:38`, `Delta:34`, `Delta:176`.

### 9.5 Die Baustandstabelle §10 endet bei Schritt 10

| Fundstelle | Zustand |
|---|---|
| `…:318` | „**⚠ DIESE TABELLE ENDET BEI SCHRITT 10 (PR #181, 10.09.2026) UND IST SEITHER NICHT FORTGESCHRIEBEN.**" |
| `…:319-322` | benennt namentlich, was fehlt: „Der WIZARD-Strang vom 11.09.2026 … steht **nicht** darin." |
| `…:327-338` | Tabellenkopf + Trennzeile + **10 Datenzeilen**; letzter Eintrag `:338` = Schritt 10, PR #181 |
| `…:339` | leer — die Tabelle endet hier |
| `Fahrplan_2026.md:75`, `:292` | bestätigen dasselbe aus der übergeordneten Quelle |

Der jüngste dort geführte PR ist **#181 vom 10.09.2026**, während der Wizard-Strang laut
`Fahrplan_2026.md:75` bis **#214 (13.09.2026)** reicht.

### 9.6 `B24_KI-Interface_Kalkulator.md` TEIL 3 — der frühere Konzeptstand

TEIL 3 beginnt Z. 237 und endet Z. 300 — **64 Zeilen**, gegliedert in 3.1 (`:241`), 3.2 (`:256`),
3.3 (`:277`).

**3.1 — was die Sitzung gezeigt hat:** drei nummerierte Beobachtungen am Urbanz-Report — „Er wählte
selbst, was hervorzuheben ist" (`:245`), „Er baute Grafiken passend zum tatsächlich Gefundenen —
nicht aus einem festen Chart-Katalog ausgewählt, sondern zur konkreten Datenlage gebaut" (`:249`),
„Er erzeugte Abschnitte, die es nur gibt, WEIL bestimmte Datenlücken oder Befunde aufgetreten sind"
(`:252`).

**3.3 — die offene Architekturfrage:** zwei Fragen, beide ausdrücklich unbeantwortet. `:279` „**Frage
1: Wie tief geht die Dynamik?**" mit **Variante A** (`:280-282`: „Die Engine läuft weiter wie heute …
und eine **KI-Schicht obendrauf** baut nur Auswahl, Narrativ und Chart-Zusammenstellung") und
**Variante B** (`:283`: „Die Dynamik geht tiefer."). `:288` „**Frage 2: Wie verträgt sich „dynamisch,
KI-gebaut" mit den bestehenden Zusagen an Kunden?**" mit Reproduzierbarkeit (`:290`),
Nachvollziehbarkeit (`:294`), Kennzeichnung Annahme/Messwert (`:296`). `:300`: „Beide Fragen sind
**hier bewusst offen gelassen.**" Die Sammlung am Dokumentende führt sie als Punkt 10 (`:329`) und
11 (`:330-331`).

**Verhältnis der beiden Dokumente, gemessen:** Das Delta nimmt zu beiden Fragen Stellung. Zu Frage 1
sagt §5.1 Stufe 1 (`:179`): „Kommen unverändert aus der deterministischen Engine … Daran ändert
dieses Delta nichts"; §7 `:213` wiederholt es in der Prinzipientabelle („2. Ein Dispatch, eine
ehrliche Zahl | Nein — Engine unverändert"). ⚠ **Die Bezeichnung „Variante A" benutzt das Delta dabei
NICHT** — `grep -n "Variante"` liefert dort 6 Treffer (`:28`, `:87`, `:90`, `:142`, `:160`, `:233`),
alle zur Eingabe-Variante B oder zur „Leistungsmessungs-Variante". Die Gleichsetzung mit Variante A
ist eine **Ableitung aus dem Inhalt**, keine Aussage des Dokuments. Zu Frage 2 antworten §5.2 (`:186`)
und §5.3 (`:189`).

In Stufe 2 geht das Delta zugleich **weiter**, als Variante A es beschrieb: dort war die KI-Schicht
auf „Auswahl, Narrativ und Chart-Zusammenstellung" beschränkt, §5.1 `:180` gibt zusätzlich „welche
Kapitel … welche Reihenfolge, was wird betont" frei — mit der Gegengrenze aus `:183`.

### 9.7 Kein Gegenstück im PDF-Report-Pflichtenheft

`Pflichtenheft_Kalkulator_Delta_PDF-Report.md` (1.966 Z.) enthält kein Gegenstück. Case-insensitiv:
`Baukasten` **0×**, `Dynamik` **0×**, `KI-gebaut` **0×**. `dynamisch` trifft 2× (`:1350`, `:1728`),
beide Male in der Bedeutung *dynamischer Modul-Import*. `Freiheit` trifft 1× (`:153`) — als
Bestandteil von „Barrierefreiheit/PDF-Tags". Positivkontrolle im identischen Dokument: „sieben
Report-Grafiken" → `:402`, `:566`; „sieben Grafiken" → `:1370`.

### 9.8 Im Code existiert vom Freiheitsmodell nichts

Suche über `packages`, `apps` und `supabase` (`*.ts`, `*.tsx`, `*.sql`), case-insensitiv, deutsch und
englisch, snake_case und camelCase, nach `freiheitsmodell|freedom.?model|baukasten|bausteinkatalog|
kompositionsfreiheit|report_?blueprint|report_?plan|compose_?report|section_?catalog|block_?catalog|
statement_?block|aussage.?baustein|narrative_?block|chapter_?catalog|chart_?catalog`: **0 Treffer.**
Positivkontrollen im identischen Suchraum: `AnalysisResult` → **42 Dateien**, `ReportSection` → **15
Treffer**.

Was es im Code gibt, ist die **Vorgängerschicht**, an die §5.3 anschliesst: `pdf-report/statement.ts`
(149 Z.) definiert `ReportStatement` (`:55`) mit stabiler `id` (`:57`), beschrieben als „B23c-2 — die
Darstellungsform einer Kernaussage, geteilt von allen Kapitel-Ableitungen" (`:2`), 28 Vorkommen im
Verzeichnis. **Eine Baukasten-Struktur, aus der ausgewählt würde, ist das nicht** — die Aussagen
entstehen je Kapitel in `summary.ts`/`recommendation.ts`.

Ergänzend: in `lib/pdf-report/` (20 Dateien, 7.072 Z.) trifft `anthropic` **0×**, `prompt` **0×** und
`claude` case-insensitiv genau **1×** (`content.ts:284`, ein Verweis auf `CLAUDE.md`). `react-pdf`
trifft 48×. **Die Report-Pipeline enthält keine KI-Anbindung.**

Die Archivierungsforderung aus §5.2 hat ebenfalls keine Entsprechung:
`rendered_report|report_pdf|report_blob|report_structure|report_snapshot|delivered_report|report_html|
report_json|report_bytes|report_document|report_archive|archived_report|pdf_bytes|pdf_gzip|report_gzip`
über `supabase/migrations/`, `packages` und `apps` → **0×** (Positivkontrolle im identischen
Suchraum: `source_file` über `supabase/migrations/` → 45 Treffer). `platform.analyses` speichert
`inputs jsonb not null` (`20260724150000:98`) und `result jsonb not null` (`:101`), fünf typisierte
Auszüge (`:114-120`) und die gzip-komprimierte Quelldatei (`source_file_gzip bytea not null`, `:135`)
samt SHA-256 (`:129`) — **nicht das gerenderte Dokument**. Dasselbe ist in
`KI-Interface_Kalkulator_Bestandsaufnahme.md:506-515` bereits gemessen. **Genau diesen Zustand
benennt §5.2 `:186` selbst.**

Die einzige Stelle, an der der Report im Wizard-Strang überhaupt auftaucht, ist ein ausgewiesener
Platzhalter: `apps/web/app/admin/(intern)/kalkulator-projekte/[id]/page.tsx:210-219` — `id="report"`
(`:211`), `title="Report"` (`:212`), `description="Noch nicht gebaut — folgt als eigener Schritt."`
(`:213`), im Rumpf „Hier entsteht die Auswertung über alle Zählpunkte des Projekts. Gerechnet wird
unverändert in der Engine; dieser Bereich wählt aus, was davon im Report steht." (`:215-218`). Ein
Wächter hält die Kachel als Platzhalter fest: `apps/web/lib/admin/data-entry-ui.test.ts:204-208`
(`expect(report).toContain('Platzhalter')`, `expect(report).not.toContain('href')`).

---

## 10. Was keine der sieben Fragen berührt

Die Fragen decken den Report-Baukasten nicht vollständig ab. Sieben Bereiche sind eigenständig
messbar und für eine Bestandsaufnahme tragend; die Cutover- und Artefakt-Befunde stehen bereits in
§2.

### 10.1 Das Report-Gate — und der Lead-Dialog daneben, der nichts speichert

Die einzige Stelle, an der ein Kunde heute etwas am Report parametriert:

| Fundstelle | Zustand |
|---|---|
| `packages/shared/src/report-gate.ts:42` | `REPORT_GATE_SOURCE_KEY = 'rechner-report'` |
| `packages/shared/src/report-gate.ts:53` | `REPORT_GATE_CONSENT_PURPOSE = 'offer_contact'` — ausdrücklich **nicht** `result_delivery` |
| `apps/website/lib/report-gate/store.ts:102-119` | `captureReportGateLead` → `service.rpc('capture_lead', …)` |
| `apps/website/components/flow/step-result.tsx:349-389` | **zwei Zustände, ein Knopf**: vor dem Gate öffnet er das Formular, danach exportiert er direkt |
| `step-result.tsx:341` (CSV) und `:395-404` (Analyse-Bündel JSON) | beide Ausgabewege stehen **ausserhalb** der Gate-Verzweigung |
| `report-gate-dialog.tsx:70-74` | die Anschrift wird „weder gespeichert noch übertragen … sie lebt im Zustand dieses Dialogs" |

Daneben, im selben Bildschirm-Report und unabhängig vom Gate:

| Fundstelle | Zustand |
|---|---|
| `apps/website/components/report/lead-dialog.tsx:19-20` | `// STUB (§5.1): erfasst die Pflichtfelder + Consent, PERSISTIERT ABER NICHTS.` |
| `apps/website/components/report/report.tsx:477` | `<LeadDialog />` — live gerendert, in einem `print:hidden`-Container |
| `report-gate-dialog.tsx:67-68` | benennt ihn: „der alte Stub `lead-dialog.tsx` tut bis heute genau das mit ‚Funktion/Rolle'" |

**Der Report führt damit zwei Lead-Formulare nebeneinander; eines davon verwirft seine Eingaben.**

### 10.2 `report-request` (Delta 18) — der einzige gebaute Freiheitsmechanismus am Report

Q7 kommt für das Freiheitsmodell zu „0 Treffer im Code". Das ist für die drei Stufen aus §5.1
richtig, lässt aber den Baustein aus, der einem Nutzer **heute schon** Einfluss auf den Report gibt:

| Fundstelle | Zustand |
|---|---|
| `packages/shared/src/report-request.ts` | 385 Zeilen; Kopfzeile „Delta 18 — DER VERTRAG DER REPORT-ANFRAGE-ÜBERSETZUNG" |
| `report-request.ts:52-61` | `REPORT_REQUEST_FIELDS` — **acht** Grössen: `billingModel`, `horizonYears`, `subsidyPercent`, `fixedSubsidyEur`, `depreciationYears`, `taxRatePercent`, `roundTripEfficiencyPercent`, `pricePerKwh` |
| `report-request.ts:11-14` | „ES ENTSTEHT KEIN NEUER PARAMETER … Das Feld ist eine ÜBERSETZUNG, keine Erweiterung." |
| `report-request.ts:22-25` | „ES KOMMT KEIN FREITEXT DES MODELLS ZURÜCK" |
| `apps/website/lib/report-request/` | 4 Dateien, 348 Zeilen; `ai-client.ts:50` `REPORT_REQUEST_MODEL = 'claude-sonnet-5'`; `limits.ts:22` `MAX_REPORT_REQUEST_CHARS = 400` |
| `apps/website/components/report/report.tsx:855` | `<ReportRequestPanel …>` — **produktiv gerendert** |

**Die Freiheit reicht heute also über acht Annahmen, nicht über Auswahl, Struktur oder
Formulierung.** Das ist die Ausgangslage, gegen die §5.1 zu lesen ist.

### 10.3 B23d ist gebaut — unter einem anderen Namen

`Pflichtenheft_Kalkulator_Delta_PDF-Report.md:126` führt B23d als „offen, hängt an einer noch nicht
getroffenen Entscheidung: Kontakthinweis gegen QR-Code". Gemessen existiert die
**Kontakthinweis-Variante vollständig**:

| Fundstelle | Zustand |
|---|---|
| `apps/website/lib/pdf-report/document.tsx:698` | `function Outro({ input }: { input: PdfReportInput })` |
| `document.tsx:1521-1523` | die zehnte `<Page>`, `styles.navyPage`, `<Outro input={input} />` |
| `apps/website/lib/company.ts:51-56` | `REPORT_CONTACT` — Name, Rolle, Telefon, E-Mail |
| `document.tsx:1517-1520` | bewusst ohne `SectionAnchor` und ohne Agenda-Eintrag |

Gebaut wurde sie nicht als B23d, sondern als **D22** am 06.09.2026 (`CLAUDE_4089ddf.md:481`, `:488`:
„[DIE ABSCHLUSSSEITE BEANTWORTET GENAU EINE FRAGE] Wen rufe ich an").

**Fehlanzeige mit Positivkontrolle:** Der **QR-Code-Zweig** der Entscheidung ist nicht gebaut.
`qr-code|qrcode|call-to-action|calls-to-action` (case-insensitiv) über `apps/website` und `packages`
→ **0 Treffer** (die beiden Repo-Treffer liegen in `packages/db-tests/src/lead-source-stats.test.ts:182`,
`:262` und betreffen den B1-1-Lead-Einstiegspunkt). Positivkontrolle `Abschlussseite` im selben
Suchraum → 7 Treffer. Reichweite der Zeichenfolge `B23d` im ganzen Repo: **4 Treffer in 3
Dokumenten** (`Delta-PDF:126`, `:145`, `Fahrplan_2026.md:74`, `README_Doku-Struktur.md:34`), **0 in
`apps/**`, `packages/**`, `supabase/**`**.

### 10.4 Der Weg vom Wizard zum Report existiert nicht

| Fundstelle | Zustand |
|---|---|
| `apps/web/app/admin/(intern)/kalkulator-projekte/` | **3** Dateien: `page.tsx`, `[id]/page.tsx`, `[id]/dateneingabe/page.tsx` — **keine Report-Route** |
| `…/[id]/page.tsx:210-219` | die Platzhalter-Kachel (s. §9.8) |
| `apps/web/lib/admin/data-entry-ui.test.ts:204-208` | ein Wächter hält sie als Platzhalter fest |

**Fehlanzeige mit Positivkontrolle:** `react-pdf|pdf-report` über `apps/web` (`*.ts`, `*.tsx`,
`package.json`) → **0 Treffer**; Positivkontrolle `pdf` im selben Suchraum → 12+ Treffer
(`data-entry-invoice.tsx:261`, `tariff-scan-panel.tsx:82`, `data-entry-actions-shared.ts:80` u. a.).

**Folge, zusammen mit §2.4:** Weil `apps/web` weder `engine` noch `@react-pdf/renderer` führt und die
Bausteine app-lokal in `apps/website` liegen, ist heute **keiner** der gebauten Report-Bausteine von
der Wizard-Seite aus erreichbar.

### 10.5 `apps/website` hat 0 Testdateien und kein `test`-Skript

| Fundstelle | Zustand |
|---|---|
| `apps/website` | **0** Dateien `*.test.ts` / `*.test.tsx` / `*.spec.ts` |
| `apps/website/package.json:5-11` | 5 Skripte: `dev`, `build`, `start`, `typecheck`, `lint` — **kein `test`** |
| Positivkontrolle `apps/web` | **89** Testdateien |
| Positivkontrolle `packages/engine` | **37** Testdateien |

Ungetestet sind damit: `lib/pdf-report/**` (7.072 Z.), `components/report/**` (5.708 Z.),
`components/flow/step-result.tsx` (498 Z.). Das einzige Prüfinstrument ist die Route
`app/pdf-report-probe/**` (**8 Dateien, 3.091 Zeilen**) — ein manuell zu bedienender Prüfstand, kein
Wächter. Das Pflichtenheft sagt es an zwei Stellen selbst (D7-Absatz und
`Pflichtenheft_Kalkulator_Delta_PDF-Report.md:1962`).

### 10.6 Die report-relevante Contract-Lücke §3.9 (Finanzierungsmodelle)

`CLAUDE.md` führt sie unter „Offene Abhängigkeiten": „Contract-Lücke (keine Blockade):
Finanzierungsmodelle-Vergleichsansicht (§3.9, Kauf vs. Subscription/Contracting)". Sie betrifft eine
Report-Ansicht und wird von keiner der sieben Fragen berührt.

**Fehlanzeige mit Positivkontrolle:** `contracting|subscription|leasing|miete|monatliche rate`
(case-insensitiv) über `packages/shared/src/analysis-result.ts`,
`packages/shared/src/financial.ts` und `apps/website/lib/pdf-report/*.ts` → **0 Treffer**;
Positivkontrolle `subsidyPercent` in `financial.ts` → Treffer auf `:15`.

### 10.7 Die Archivierungs-Anforderung aus §5.2 gegen `platform.analyses`

`Pflichtenheft_Kalkulator_Delta_KI-Interface.md:186` setzt eine **neue, fest gesetzte Anforderung**:
„der tatsächlich ausgelieferte Report (Struktur **und** Text, nicht nur die zugrundeliegenden Zahlen)
wird vollständig archiviert". Die Messung dazu steht in §9.8: `platform.analyses` hat **keine Spalte
für ein gerendertes Dokument**. Für die Bestandsaufnahme relevant ist die Reichweite: die bindenden
Regeln für `platform.analyses` aus `CLAUDE.md` — **nie nachrechnen**, **keine Fremdschlüssel auf
veränderliche Konfiguration**, enge Append-only-Ausnahme — gelten für jede künftige Erweiterung
dieser Tabelle unverändert weiter.

---

## 11. Widersprüche in den Dokumenten und im Code

Benannt, nicht aufgelöst.

### W.1 `Pflichtenheft_Kalkulator_Delta_PDF-Report.md` widerspricht sich selbst

| Fundstelle | Zustand |
|---|---|
| `…:125` | Zerlegungstabelle: „**B23c-3/4** … \| **offen**" |
| `…:1156` | „**Gebaut am 04.09.2026.** Damit trägt das Dokument **alle** Inhalte des Bildschirm-Reports" |
| `…:400`, `:564`, `:748`, `:927`, `:1154` | die Kapitel D14–D18 — die Bauberichte zu genau diesen Punkten |
| `Fahrplan_2026.md:74` | „**B23a+b+c vollständig gebaut, Cutover offen**" |
| Code | `insight.ts` (429 Z.), `comparison.ts` (365 Z.), `basis.ts` (346 Z.) existieren und sind in `document.tsx:1489`, `:1497`, `:1510` verdrahtet |

**Die Zerlegungstabelle (Z. 119–127) ist gegenüber dem eigenen Fliesstext desselben Dokuments zwei
Bauschritte im Rückstand.** Dasselbe gilt für `:126` (B23d, s. §10.3). Beide Zeilen tragen **keinen**
Revisionsvermerk, während §3.1 des KI-Interface-Deltas einen solchen ausdrücklich trägt — ob das
Absicht (historischer Stand) oder ein Nachtrags-Versäumnis ist, geht aus dem Dokument nicht hervor.

### W.2 Ein Code-Kommentar behauptet eine Lücke, die im Nachbarmodul geschlossen ist

| Fundstelle | Zustand |
|---|---|
| `apps/website/lib/pdf-report/recommendation.ts:262-266` | „⚠ **BENANNTE LÜCKE**: der STRUKTURIERTE Befund des Blockers … erscheint damit im PDF **noch gar nicht**. … gehört … in dasselbe Kapitel wie Datenqualität und Warnungen (B23c-4)" |
| `apps/website/lib/pdf-report/basis.ts:240-263` | `function buildBlocker(…): ReportNotice \| null` — baut genau diesen Befund, mit `SIDE_LABEL` (`:186`), `KIND_HINT` (`:192`) und `list.items` aus `status.ranges` (`:252-257`) |
| `basis.ts:321`, `:332` | `blocker: ReportNotice \| null` / `blocker: buildBlocker(...)` |
| `document.tsx:1396` | der Renderaufruf |

**Der Kommentar ist seit B23c-4 (04.09.2026) überholt und steht unverändert im Code.** Er ist im
Pflichtenheft ebenfalls noch als `[OFFEN]` geführt (D10-Liste). Wer §6 dieses Dokuments gegen
`recommendation.ts` hält, findet den Widerspruch dort.

### W.3 Zwei Zeitregime im selben Report

Der Contract trägt **eine hochgerechnete und eine nicht hochgerechnete Grössenfamilie im selben
Report**, jeweils gekennzeichnet — s. §5.3(e). Vier sichtbare Kennzeichnungen „nicht hochgerechnet"
(`recommendation-card.tsx:213`, `:295-297`, `monthly-tariff-chart.tsx:279`, `summary.ts:181`) stehen
vier Annotationen „hochgerechnet" gegenüber (`summary.ts:233-234`, `:335-336`,
`recommendation.ts:276-279`, `recommendation-card.tsx:373-391`). Ein Leser, der nur §5 liest, könnte
annehmen, alles im Report sei annualisiert.

### W.4 Der Fahrplan trägt zu Teil 3 zwei Stände nebeneinander

`Fahrplan_2026.md:298` führt weiterhin „wie tief die Dynamik des Reports geht (KI-Schicht über
unveränderter Engine oder tiefer)" und die Verträglichkeitsfrage unter „**⚠ Nichts davon ist
entschieden**"; `:300` schliesst mit „**Nächster Schritt: keiner.**" — beides ist der Wortlaut des
B24-Konzeptstands **vor** der Advisor-Sitzung. Im selben Dokument nennt `:75` dagegen
`Pflichtenheft_Kalkulator_Delta_KI-Interface.md` kanonisch für B24, **mit** dem „dreistufigen
Report-Freiheitsmodell". Die Zeilen 294–300 stehen als Fliesstext unterhalb der Tabellenzeile 292 und
sind dort **nicht als überholt gekennzeichnet**.

### W.5 Ein Wortlaut-Gegensatz, der in drei Dokumenten steht

`B24_KI-Interface_Kalkulator.md:249` beobachtet Grafiken, die „**nicht aus einem festen Chart-Katalog
ausgewählt, sondern zur konkreten Datenlage gebaut**" wurden. `Delta-KI:183` schliesst genau das aus
(„freie Diagramm-Generierung durch die KI ist eine grundsätzlich andere, hier nicht beauftragte
Baustelle"). Derselbe Satz steht zweimal im Fahrplan, und zwar mit Stand 13.09.2026, also **nach**
dem Delta vom 09.09.2026: `Fahrplan_2026.md:75` und `:292` („dass der Report **dynamisch aus dem
tatsächlich Gefundenen** entstehen soll statt aus einem festen Chart-Katalog").
`grep -rn "Chart-Katalog" --include="*.md" .` → **4 Treffer** (`Fahrplan:75`, `:292`, `B24:249`,
`README_Doku-Struktur.md:36`).

### W.6 `CLAUDE.md` und `Fahrplan_2026.md` sind zum Wizard-Stand auseinander

`Fahrplan_2026.md:75` sagt mit Stand 13.09.2026 „VIER der fünf Zählpunkt-Stationen fertig … nur noch
die Tarif-Station offen"; `CLAUDE.md:119` sagt mit Stand 15.09.2026 „Alle fünf vollständig, in allen
Wegen" und führt die Tarif-Station als gebaut (`CLAUDE.md:125`). Für den Report-Baukasten ohne
unmittelbare Folge, aber beim Lesen der Fahrplan-Zeile mitzudenken.

### W.7 `REPORT_AGENDA` gegen `buildReportAgenda`

`Fahrplan_2026.md:298` benennt „`REPORT_AGENDA` ist seit B23c-3 eine Funktion". Der Bezeichner
existiert im Code **nicht mehr** — `content.ts:316` heisst `buildReportAgenda`; `REPORT_AGENDA` steht
nur noch in zwei Kommentaren (`content.ts:183`, `:337`). Sachlich trägt die Fahrplan-Aussage.

### W.8 „Sieben Grafiken" ist eine Bildschirm-, keine PDF-Zahl

`Delta-KI:183` spricht von „den heutigen sieben festen Grafiken". `ReportChartRasters`
(`charts.tsx:70-141`) hat **sechs** Rasterfelder plus zwei Felder, die eine davon in einander
ausschliessende Fassungen teilen (`costKind` `:90`, `comparisonVariant` `:124`). **Höchstens sechs
Rasterungen je Dokument** ist die belegbare Zahl; die „sieben" verankert
`Pflichtenheft_Kalkulator_Delta_PDF-Report.md:1369-1370` ausdrücklich im **Bildschirm**-Report („Der
Bildschirm-Report führt sieben Grafiken, aber Monatsvergleich und kumulierter Kostenvergleich
schliessen einander aus"). Am Bildschirm stehen sogar **acht** Zeichenflächen (§2.4).

---

## Anhang — wie gemessen wurde

- **Verfahren.** Je Frage ein Rechercheur gegen den echten Code, danach ein **unabhängiger
  adversarischer Gegenprüfer**, der jede angegebene Datei:Zeile einzeln nachgegriffen, jede
  Fehlanzeige mit eigenen, breiteren Suchmustern wiederholt und nach Überdehnungen gesucht hat;
  zuletzt eine Vollständigkeits-Kritik über alle acht Ergebnisse. Insgesamt 17 Läufe, 973
  Werkzeugaufrufe. Die Gegenprüfung hat je Frage zwischen 3 und 14 falsch zitierte Zeilenangaben
  korrigiert; die hier stehenden Angaben sind die korrigierten.
- **Werkzeuge.** Ausschliesslich lesend: `git rev-parse`, `git show`, `git log`,
  `git status --porcelain`, `git diff --stat`, `grep -n`/`-rn`/`-c`, `sed -n`, `awk`, `wc -l`,
  `find`, `ls`. Kein Build, kein Testlauf, keine Wächter-Probe, kein Live-Lauf, keine
  Datenbankabfrage. Suchräume schliessen `node_modules/` und `.next/` durchgängig aus.
- **Fehlanzeigen.** Jede ist mit dem ausgeführten Suchmuster, dem Suchraum **und** einer
  Positivkontrolle im **selben** Suchraum belegt. An drei Stellen hat die Gegenprüfung ein zu enges
  Erstmuster aufgedeckt und den Befund präzisiert: das Herkunfts-Vokabular in `basis.ts` (§6.4),
  das Tarifkomponenten-Vokabular (§6.5) und `backfill` gegen `nachlade` bei den Marktpreisen (§5.5).
  Diese Präzisierungen stehen im Text, weil sie zeigen, wo eine Fehlanzeige belastbar ist und wo
  nicht.
- **Ein methodischer Fallstrick, weil er sich wiederholen kann:** ein Grep-Durchlauf mit den Pfaden
  in einer Shell-Variablen lieferte 0 Treffer bei **allen** Mustern einschliesslich der
  Positivkontrollen — zsh splittet Variablen nicht bei Wortgrenzen. Erst die Positivkontrolle hat das
  aufgedeckt (§4.1).
- **Nicht gemessen.** (a) Der Live-Zustand von `NEXT_PUBLIC_PDF_REPORT_ENGINE` im Vercel-Projekt
  `peak-shaving-website` — belegt ist nur der Repo-Zustand und die Aussage von `DEPLOYMENT.md` (§2.2).
  (b) Kein Lauf über die echte Oberfläche, weder Rechner noch Prüfroute. (c) Keine Abfrage gegen
  Cloud- oder lokale Datenbank — alle `platform`-Aussagen stammen aus den Migrationsdateien.
- **Gültigkeit.** Alle Zeilenangaben gelten für `4dc3231`. Zitate aus `[GEBAUT: B23 …]`-Absätzen
  tragen die Zeilennummer der Fassung `git show 4089ddf:CLAUDE.md` (1.719 Zeilen), nicht der
  aktuellen.
- **Datum aller Messungen:** 16.09.2026.
