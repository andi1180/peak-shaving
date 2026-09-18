# Report-Baukasten B3-2 — Plan: Verdikt-Optik und Kandidaten-Inhalt

> Erstellt am 18.09.2026 am Stand von `main` (`9d55c46`). **Kein Produktivcode geändert, keine
> Contract-Erweiterung, keine Umsetzung.**
>
> **Gegenstand:** Schritt **B3-2** aus `Report_Baukasten_Block3_Plan.md` §3.3 — die beiden
> Zusatzspeicher-Bausteine `addon` (Kapitel 1, `summary.ts:504`) und `addon_none` (Kapitel 6,
> `comparison.ts:276`): ihre Doppelung, ihre Verdikt-Form und die Frage, ob unter dem Klarsatz
> etwas über die gescheiterten Kandidaten stehen kann.
> **Nicht Gegenstand:** B3-3 (`recommendation`, Listenform), Nr. 19 (`pv_outage`), §7 Nr. 21–24.
>
> **Vorgelagert:** `Report_Baukasten_Block3_Plan.md` (`a36b84e`) · `Report_Baukasten_Optik_Bestandsaufnahme.md` ·
> `Report_Baukasten_Auswahlschicht_Verifikation.md` §2.2.
>
> **Erledigt seit dem Block-3-Plan:** **B3-1 ist gebaut** (`9d55c46`, PR #282) — `table_candidates`
> steht in `REPORT_OPTIONAL_SECTIONS` (`packages/shared/src/report-sections.ts:31`), `selectedTable`
> existiert (`document.tsx`), und die beiden unmigrierten Tabellensätze tragen jetzt `tableRef`
> (`comparison.ts:347-354`, `:368-380`, Helfer `:403-405`). §1.5 und §4.3 des Block-3-Plans sind
> damit abgearbeitet.

---

## 0 — Beleglage: was hier gemessen ist und was zitiert

Der Block-3-Plan musste die SOLL-Seite zitieren, weil das Zielbild seit `af0f26f` als Klasse aus
dem Repo ausgeschlossen ist. **Für diesen Plan ist es wieder gemessen** — die Datei liegt
ausserhalb des Arbeitsverzeichnisses (`~/Documents/…/Kunden/Markus Urbanz/Urbanz_Wirtschaftlichkeitsanalyse V2.pdf`),
und sie ist **nicht** ins Repo kopiert worden; die `.gitignore`-Regel bleibt unberührt. Gemessen
wurde mit `poppler` (Text-Bounding-Boxen, Vektor-Füllfarben, Glyphengeometrie), Schriftgrade über
die Versalhöhe von Inter (1490/2048 em = 0,7275).

Die IST-Seite ist an zwei Quellen gemessen:

1. **am Code** von `9d55c46` — jede Fundstelle unten mit Zeilenbezug;
2. **an einem echten Render des Bestandsfalls** (`~/Downloads/coolin-report-2026-09-18 (2).pdf`,
   erzeugt heute 10:27, also **vor** `5973b4f`/`d4f6b45`/`9d55c46`).

**⚠ Warum dieser Render trotzdem als IST-Beleg taugt:** `git diff 5973b4f~1..HEAD` über
`summary.ts`, `comparison.ts` und `document.tsx` zeigt an `buildAddon`, `buildVerdict` und dem
`Statement`-Renderer **keine Änderung** — was seither fiel, betrifft `addon_table`/
`catalog_alternatives` (die `tableRef`-Migration) und die Auswahlschicht. Für die beiden Bausteine
dieses Plans bildet der Render den heutigen Stand ab. Für alles andere ist er es nicht.

---

## 1 — Frage 1: Trägt die Kandidatentabelle die gescheiterten Geräte?

### 1.1 Nein — `shown` filtert vorher, und im Klarsatz-Fall ist die Tabelle gar nicht da

`buildCandidateTable` wird an **beiden** Aufrufstellen mit `shown` gefüttert, nie mit `considered`:

| Aufrufstelle | Argument |
|---|---|
| `comparison.ts:457` (`buildComparisonChapter`) | `hasTable ? buildCandidateTable(shown, …) : null` |
| `registry.ts:370-372` (Baustein `table_candidates`) | `hasTable ? buildCandidateTable(comparison.shown, …) : null` |

`shown` entsteht in `comparison.ts:433-436`: im Bestandsfall
`candidates.filter((c) => c.netSavingOverHorizon > 0)`, sonst `alternativesOf(analysis)`. Und
`hasTable` ist `shown.length > 0` (`comparison.ts:449`, `registry.ts:279`).

**Daraus folgt für den Fall, um den es geht:** `addon_none` entsteht *genau dann*, wenn `shown`
leer ist (`registry.ts:357-359`, `comparison.ts:454-457`). Es gibt in diesem Fall also nicht bloss
eine gefilterte Tabelle — **es gibt überhaupt keine**, und `ReportTable` ist `null`.

### 1.2 Die Daten sind trotzdem da — sie liegen einen Rahmen über dem Baustein

Das ist der eigentliche Fund. `ComparisonSelection` trägt **beide** Mengen:

```
comparison.ts:417-420
  /** ALLE betrachteten Geräte — die Grundlage der zwei Zeilen über der Tabelle. */
  considered: ComparisonCandidate[]
  /** Die Zeilen der Tabelle. Leer heisst: statt der Tabelle steht der Klarsatz. */
  shown: ComparisonCandidate[]
```

`considered` ist `candidates` aus `candidatesOf` — **ungefiltert** (`comparison.ts:438`), im
Bestandsfall also alle `existing.addonScenarios` (`comparison.ts:85`). Es steht an **beiden**
Stellen im Gültigkeitsbereich, an denen der Klarsatz gebaut wird: `comparison.ts:448` und
`registry.ts:278`. Was fehlt, ist allein die **Übergabe**:

```
comparison.ts:276   export function buildVerdict(horizonYears: number): ReportStatement
```

`buildVerdict` bekommt eine Zahl und sonst nichts. Der Baustein weiss deshalb nicht, dass es
Kandidaten gab — **nicht, weil die Information verloren wäre, sondern weil sie nie übergeben
wurde.** Das ist ein Parameter in einer Datei, keine Contract-Frage.

### 1.3 Was ein Kandidat mitbringt — und was nicht

`ComparisonCandidate = BatteryResultEntry & BatteryRoiSummary` (`comparison.ts:57`), im
Bestandsfall `AddonBatteryScenario` (`packages/shared/src/analysis-result.ts:237-241`). Je Gerät
liegen vor:

| Feld | Fundstelle | taugt als … |
|---|---|---|
| `battery` (Name, `usableCapacityKwh`, `maxPowerKw`) | `analysis-result.ts:174` | Benennung |
| `totalInvestment` | `:207` | Kosten |
| `totalSavingPerYear` | `:200` | Nutzen |
| `amortizationYears` | `:213` | Grund in Jahren (`formatYears(Infinity)` → „∞ Jahre", `comparison.ts:207`) |
| `netSavingOverHorizon` | `:214` | **der Grund in Euro** — negativ heisst: verdient sich nicht ein |
| `warnings: string[]` | `:201` | §3.8-Eignungshinweise (Betonsockel, separater Wechselrichter, „Leistung reicht nicht") |
| `combined` | `:240` | resultierende Gesamtgrösse |

**Vorhanden ist damit der ARITHMETISCHE Grund** (Investition über Ersparnis im Zeitraum), und zwar
je Gerät und in zwei Einheiten. Zudem ist `considered` bereits nach `netSavingOverHorizon`
absteigend sortiert (§3.8, festgehalten in `comparison.ts:76-77` und `:178-180`) — das erste
Element IST der bestgereihte Kandidat, ohne dass hier neu sortiert werden müsste.

**Nicht vorhanden ist ein KATEGORISIERTER Grund** — kein Feld sagt „zu gross für diesen Verbrauch"
gegen „zu teuer für diese Ersparnis". Dazu unten §2.3.

---

## 2 — Frage 2/3: Vorschlag für `addon_none` (Kapitel 6)

### 2.1 Was das Zielbild an dieser Stelle tut — gemessen, Seite 10

Die Zielseite trägt **keine Tabelle, kein Diagramm und keine Aufschlüsselung.** Sie trägt drei
Dinge und ist danach leer:

```
Lohnt sich ein zusätzlicher Speicher?          14,0 pt, fett, #0f172a, Grundlinie y=104,69
Nein                                           27,0 pt, fett, #b91c1c, Grundlinie y=142,65
Keines der geprüften Batteriegeräte … Das am besten abschneidende Gerät bliebe über 10 Jahre
gerechnet €5.388 im Minus. …                   9,7 pt, #1e293b, ab y=159,33
                                               „€5.388 im Minus" inline in #b91c1c
```

`pdfimages -list` weist für Seite 10 **kein Bild** aus (Diagramme liegen auf 4, 5, 7, 9). Die
einzige Zahl auf der Seite ist der Fehlbetrag des **besten** Geräts.

### 2.2 Konkreter Vorschlag: Fliesstext, keine Tabelle

**Welche Kandidaten:** genau einer — `considered[0]`, der bestgereihte. **Welcher Grund:** sein
`netSavingOverHorizon` als Betrag, plus die Zahl der geprüften Geräte als Bezugsgrösse.
**Welche Darstellung:** Fliesstext im bestehenden `body`, plus das Verdikt-Wort darüber (§3).

Drei Änderungen, alle innerhalb von `comparison.ts`:

1. **`buildVerdict(considered, horizonYears)`** statt `buildVerdict(horizonYears)`
   (`comparison.ts:276`). Beide Aufrufstellen haben `considered` bereits zur Hand
   (`comparison.ts:448`, `registry.ts:278`).
2. **Die Zahl der geprüften Geräte in den ersten Satz.** Heute: „Keines der Geräte aus unserem
   Katalog …" (`comparison.ts:287`). Vorgeschlagen: „Keines der **sechs** geprüften Katalog-Geräte
   …" — `considered.length`, kein neues Feld.
3. **Ein Satz mit dem Fehlbetrag des besten Geräts**, eingefügt nach dem zweiten Satz
   (`comparison.ts:288-290`, der heute schon sagt „über den Betrachtungszeitraum gerechnet bleibt
   sie nur unter dem, was das Gerät kostet" — der Vorschlag **belegt** diesen Satz mit der Zahl,
   statt ihn zu ersetzen).

**⚠ Eine Fallunterscheidung, die dabei nicht vergessen werden darf:** `drawablePoints`
(`comparison.ts:99-103`) filtert nicht-endliche Werte aus der Kurve, weil `Infinity` die Achse
zerstört. `considered` ist **nicht** gefiltert. Der Satz mit dem Fehlbetrag braucht deshalb einen
Kandidaten mit endlichem `netSavingOverHorizon`; gibt es keinen, entfällt der Satz, statt „€ ∞ im
Minus" zu drucken. Dieselbe Sorte Vorbedingung wie bei der Kurve, an derselben Datenlage.

### 2.3 Ausdrücklich KEINE Tabelle aller gescheiterten Kandidaten — drei Gründe

1. **Das Zielbild tut es nicht** (§2.1), und es hätte die Daten gehabt: die Vorlage rechnet
   dieselben Geräte durch.
2. **Eine Tabelle aus sechs Verlierern lädt zum Aussuchen ein.** Gereiht nach Netto-Ersparnis
   steht oben das „am wenigsten schlechte" Gerät mit einem konkreten Preis daneben — auf einem
   Blatt, dessen Kernaussage lautet, dass keines davon sich rechnet. Das ist dieselbe Überlegung,
   aus der die Kapitel-6-Aussage schon heute **keine Kopfzahl** trägt (`comparison.ts:37-40`).
3. **Die Kurve darüber führt die Kandidaten bereits**, und ihre Bildunterschrift sagt das
   ausdrücklich („Je Katalog-Gerät ein Punkt … Über der waagrechten Nulllinie rechnet sich ein
   Gerät im Betrachtungszeitraum, darunter nicht", `comparison.ts:246-250`). Im gemessenen Render
   liegen alle sechs Punkte unter der Nulllinie (Seite 9; an der Achse abgelesen grob −€5.000 bis
   −€72.000). Eine Tabelle danebenzusetzen hiesse, denselben Befund ein zweites Mal zu zeigen —
   genau die Doppelung, die dieser Schritt auflösen soll.

### 2.4 Die Contract-Lücke, die bleibt — und warum sie NICHT zu schliessen ist

Ein **kategorisierter** Scheiterngrund („zu gross für Ihren Verbrauch" gegen „zu teuer für diese
Ersparnis") existiert im Contract nicht (§1.3) und ist aus den vorhandenen Feldern nicht ableitbar,
ohne eine Deutung zu erfinden. **Umfang der Lücke, falls sie je gebraucht wird:** ein Feld an
`BatteryRoiSummary` (`analysis-result.ts:206-215`), seine Ableitung in `packages/engine/src/roi`,
und danach beide Oberflächen — also ein Schritt quer über Pakete, vergleichbar mit B3-3, nicht ein
Nachtrag in `comparison.ts`.

**Sie ist nicht Teil von B3-2**, und sie ist auch nicht das, was hier fehlt: das Zielbild fragt
nicht nach Kategorien, sondern nach einer Zahl — und die Zahl liegt vor. Analog zum
`representativeDays`-Fall wird die Lücke hier **benannt und nicht gefüllt**.

---

## 3 — Frage 4: Die Verdikt-Optik, gemessen statt zitiert

### 3.1 SOLL gegen IST, Zahl für Zahl

| | Zielbild S. 10 | Heute (Render S. 9 / Code) |
|---|---|---|
| Überschrift | **14,0 pt**, fett, `#0f172a` — und sie ist eine **Frage** | **11,5 pt**, halbfett, `#0f172a` (`PDF_TYPE.h3`, `theme.ts:306`; `styles.statementTitle`, `document.tsx:411`) — und sie ist eine **Feststellung** |
| Antwortwort | **„Nein" · 27,0 pt · fett · `#b91c1c`**, Grundlinie 37,96 pt unter der Frage, linksbündig am Satzspiegel | **existiert nicht** |
| Zahl | der Fehlbetrag des besten Geräts, **inline in `#b91c1c`** | **existiert nicht** (`amount: null`, `comparison.ts:284`) |
| Fläche/Kasten | **keiner** — reine Typografie auf Weiss | keiner |
| Stellung | **erstes Element der Seite**, Rest der Seite leer, kein Diagramm | **nach** Kurve und zwei Bildunterschrift-Absätzen, y=394 von 842 |
| Farben der Seite | `#0f172a`, `#1e293b`, `#475569`, `#0f766e` (Kopf), **`#b91c1c`** | `#0f172a`, `#1e293b`, `#475569`, `#0f766e`, `#18336f` — **kein Rot** |

**Es fehlt also kein Kasten.** Es fehlen: ein **Verdikt-Wort**, sein **Grad** (27 pt), seine
**Farbe** (`#b91c1c`), die **Zahl**, die es belegt, und die **Stellung** vor der Begründung.

### 3.2 Was davon im Code schon liegt — und was wirklich neu ist

- **Die Farbe gibt es.** `PDF_COLORS.negative = '#b91c1c'` (`theme.ts:96`) und
  `PDF_COLORS.positive = '#15803d'` — beide gemessen deckungsgleich mit dem Zielbild.
- **Den Grad gibt es.** `styles.headlineValueCost` ist **27 pt, fett, `PDF_COLORS.negative`**
  (`document.tsx:402`) — also exakt die gesuchte Form. Sie ist aber an die zweispaltige Kopfzahl
  von Kapitel 1 gebunden (`document.tsx:1238-1242`) und für einen Baustein nicht erreichbar.
- **Neu ist der Träger.** `ReportStatement.amount.tone` ist `Exclude<ReportTone, 'neutral'>`
  (`statement.ts:71`), also `positive | warning` — **`negative` ist typseitig ausgeschlossen**, und
  `TONE_COLOR` (`document.tsx:913-917`) kennt es folgerichtig nicht. Ein roter Betrag an einer
  Aussage ist heute nicht darstellbar, und `statementAmount` ist ohnehin 15 pt
  (`document.tsx:413`).

**Umfang von Nr. 18, präzisiert:** ein neues Feld an `ReportStatement` (ein Verdikt-Wort mit Ton —
`amount` taugt nicht, weil ein Wort kein Betrag ist und `amount.caption` eine Bezugsgrösse
verlangt, die es hier nicht gibt), ein Zweig im `Statement`-Renderer (`document.tsx:1036-1072`),
und die Öffnung des Tons. **Kein neuer Token, kein neuer Grad, keine neue Farbe.**

### 3.3 ⚠ Eine dokumentierte Annahme über das Zielbild ist falsch

`document.tsx:930-936` begründet, warum `neutral` keine teal Fläche bekommt:

> „Das Zielbild kennt nur teal und amber. Teal steht dort aber für eine **GUTE Nachricht** …
> `accentSubtle` steht im Theme und wartet auf einen Baustein, der ihn ehrlich tragen kann."

**Gemessen stimmt das nicht.** Das Zielbild hat genau drei teal Kästen (`#f0fdfa`, linke Kante
2,6 pt `#0f766e`) — auf den Seiten 2, 6 und 8:

| Seite | Titel | Inhalt |
|---|---|---|
| 2 | „Ausserdem schon geklärt" | **„Ein zusätzlicher Batteriespeicher lohnt sich für Sie derzeit nicht — dazu weiter unten mehr."** |
| 6 | „Wichtig zu wissen" | Vorbehalt zur €207-Zahl |
| 8 | „Gesamtersparnis im Jahresvergleich" | Hochrechnung mit zwei Einschränkungen |

Keiner der drei ist eine gute Nachricht; einer ist ausdrücklich eine schlechte. **Teal markiert im
Zielbild einen ERLEDIGTEN Nebenstrang, nicht einen Erfolg** — eine Bemerkung, die zum Kapitel
gehört, aber nicht in seiner Hauptlinie steht. Die Kasten-Masse: 475,3 × 46,45 pt, Titel 10,3 pt
(= `PDF_TYPE.noticeTitle`, `theme.ts:313`, dort schon aus dem Zielbild gesetzt), Text 9,2 pt,
Kante 2,6 pt (= `styles.notice.borderLeftWidth`, `document.tsx:558`).

**Folge für B3-2:** der Kommentar ist beim Bauen zu korrigieren, und `accentSubtle` (`theme.ts:115`,
heute ohne Konsument) hat seinen Baustein gefunden — s. §4.

---

## 4 — Die Doppelung: was das Zielbild entscheidet, und was daraus für Kante E folgt

### 4.1 Das Zielbild löscht keine der beiden Fassungen — es staffelt sie

Der Block-3-Plan §3.3 hat die Frage offen gelassen („bleibt der Klarsatz auf der Kernergebnis-Seite
oder unter der Grenznutzen-Kurve?") und angemerkt, das Zielbild beantworte sie nicht. **Gemessen
beantwortet es sie doch — mit „beide, in verschiedenen Formen":**

| | Zielbild | Heute |
|---|---|---|
| **Kapitel 1** | teal Kasten, Titel „Ausserdem schon geklärt", **EIN Satz** mit Vorwärtsverweis („dazu weiter unten mehr") | `ReportStatement` mit derselben Überschrift wie Kapitel 6 und **3 Sätzen**, davon 3 wortgleich mit dort (`summary.ts:512-524`) |
| **Kapitel 6** | Verdikt-Seite (§2.1, §3.1) | `ReportStatement`, 5 Sätze (`comparison.ts:286-295`) |

Die Doppelung verschwindet also **nicht durch Löschen, sondern durch Herabstufen der
Kapitel-1-Fassung auf einen Zeiger.** Das ist auch die inhaltlich richtige Lesart: die
Kernergebnis-Seite sagt, dass die Frage geklärt ist; die Antwort steht dort, wo ihre Begründung
liegt.

### 4.2 ⚠ Damit entfällt das Risiko aus Block-3-Plan §4.1

Der Block-3-Plan hat Fundstelle 10 (Kante E, `recommendation.ts:156-161`) als den einen Verweis
benannt, der bei B3-2 still ausfällt. Der Mechanismus stimmt unverändert:

- `present()` liefert für `block('addon')` genau dann `true`, wenn die Kennung in der Komposition
  steht (`layout.ts:71-73`);
- `section()` liefert `REPORT_SECTIONS[to.section].reference` — und `reference` trägt **nur**
  Kapitel 1 (`content.ts:138-143`, `layout.ts:80-83`);
- fehlt eines von beiden, fällt der Satz auf seine Ersatzfassung, und die ist `''`
  (`recommendation.ts:160`, `report-text.ts:190-196`).

**Unter der Zielbild-Entscheidung bleibt `addon` in Kapitel 1 und behält seine Kennung
(`registry.ts:198`, `:299`) — beide Bedingungen gelten weiter, und der Verweis überlebt
unverändert.** Die **Form** ist dem Resolver gleichgültig; er fragt nach Kennung und Kapitel, nicht
nach `statement`/`notice`/`table`. Auch der Wortlaut bleibt richtig: „steht auf der
Kernergebnis-Seite" trifft auf einen Kasten genauso zu wie auf eine Aussage.

**Die Auflage aus §4.1 gilt also nur noch für die beiden ANDEREN Ausgänge** (Kennung wechselt,
oder `addon` zieht aus Kapitel 1 heraus). Wer einen davon wählt, muss sie erfüllen.

**Und es gibt genau einen Verweis auf diesen Baustein:** `grep "'addon'"` über `apps/website/lib/pdf-report`
findet als Ref-Ziel ausschliesslich `recommendation.ts:158` — **kein** `amount('addon')`, **kein**
`row('addon', …)`. Die Kopfzahl und die vier Zeilen des positiven Zweigs (`summary.ts:530-549`)
sind von nirgends adressiert; ihre Form ist frei.

### 4.3 Der Preis der Zielbild-Form — und was er kostet

Ein Kasten in Kapitel 1 ist **nicht** einfach ein `ReportNotice`:

- `ReportNotice.tone` ist `Exclude<ReportTone, 'positive'>` (`statement.ts:169`) — ein teal Kasten
  ist darüber nicht erreichbar, und die Begründung dafür (`document.tsx:930-936`) beruht auf der in
  §3.3 widerlegten Annahme.
- `ReportNotice.body` ist `string` und **kein `ReportText`** (`statement.ts:172`) — ein Hinweis kann
  keinen Querverweis tragen. Für den heutigen `addon`-Körper (reiner String, `summary.ts:518-523`)
  reicht das; für den Vorwärtsverweis des Zielbildes („dazu weiter unten mehr" → Kapitel 6) reicht
  es nicht, und ausgeschriebene Ortswörter sind seit Stufe D ausgeschlossen.
- Der **positive** Zweig von `addon` trägt Kopfzahl und vier Zeilen (`summary.ts:530-549`). Ein
  `ReportNotice` kann beides nicht. Der Baustein kann seine Form also nicht wechseln, ohne den
  Bestandsfall mit wirtschaftlichem Zusatzgerät zu verlieren.

**Folgerung:** die Kapitel-1-Form ist eine **Fläche am `ReportStatement`**, nicht ein zweiter
Hinweistyp. `styles.statement` trägt heute nur `marginTop: 14` (`document.tsx:410`) — eine Fläche
plus linke Kante ist dort neu, aber sie ist die Form, die `Notice` schon benutzt
(`document.tsx:555-559`), nicht eine zweite daneben.

---

## 5 — Frage 5: Optik und Inhalt zusammen, oder zwei Schritte?

### 5.1 Optik und Inhalt zu trennen wäre der falsche Schnitt

Beide fassen **dieselben zwei Funktionen** an (`buildAddon`, `buildVerdict`) und brauchen
**dieselben Prüfläufe**. Getrennt gebaut hiesse: `buildVerdict` zweimal öffnen, die
Bestandsfall-Fixture zweimal durchziehen — und dazwischen steht ein Dokument mit einem grossen
roten „Nein" ohne die Zahl, die es belegt. Das ist ein schlechterer Zwischenstand als heute.

### 5.2 Der tragfähige Schnitt läuft entlang der Kapitel

| Schritt | Inhalt | Schichten |
|---|---|---|
| **B3-2a** | **Kapitel 6**: Verdikt-Feld an `ReportStatement` + Renderer-Zweig + Ton `negative` öffnen; `buildVerdict(considered, …)`; Verdikt VOR die Kurve | `statement.ts` · `document.tsx` · `comparison.ts` · `registry.ts` (Reihenfolge) · Prüflauf |
| **B3-2b** | **Kapitel 1**: `addon` auf den Ein-Satz-Zeiger herabstufen, teal Fläche am Statement, `accentSubtle` in Gebrauch nehmen, Kommentar `document.tsx:930-936` korrigieren; danach `addon` in `REPORT_OPTIONAL_SECTIONS` freigeben | `summary.ts` · `document.tsx` · `packages/shared/src/report-sections.ts` · Kante-E-Nachweis |

**Reihenfolge ist bindend:** B3-2a zuerst. Die Kapitel-1-Fassung wird zum Zeiger auf eine Antwort —
steht die Antwort noch nicht in ihrer Form da, verweist der Zeiger auf denselben Absatz, den er
gerade ersetzt hat.

**Empfehlung: zwei Sessions, eine je Schritt.** B3-2a allein fasst Contract, Renderer, Ableitung,
Registry und Prüflauf an — das ist der Umfang, den der Block-3-Plan §5 für den grössten Schritt
veranschlagt hat. B3-2b bringt eine zweite Renderform (Fläche am Statement) plus die Freigabe plus
den Kante-E-Nachweis dazu. Beides in einer Session ist das Muster, an dem der Kontext in dieser
Codebasis reisst (CLAUDE.md Regel 6/7).

**Vor B3-2a zu entscheiden, und im Prompt mitzugeben:**

1. **Das Verdikt-Wort.** „Nein" wie im Zielbild — oder „Nicht wirtschaftlich"? Ein Wort, das die
   Ableitung nicht erfinden darf.
2. **Stellung zur Kurve.** Das Zielbild gibt dem Verdikt eine eigene Seite **ohne** Diagramm; der
   Code begründet die Kurve ausdrücklich als **Beleg** des Klarsatzes („ein Klarsatz ohne Bild wäre
   eine Behauptung, die der Leser nicht nachprüfen kann", `comparison.ts:26-31`). **Vorschlag:
   Kurve behalten, Verdikt darüber** — Antwort zuerst, Beleg darunter. Das ist die Stellung des
   Zielbildes ohne den Verlust seiner Begründung, und es ändert nur die Reihenfolge innerhalb des
   Kapitels, nicht den Bestand.

**Was in JEDEN der beiden Prompts wörtlich gehört** (CLAUDE.md Regel 6): der `ref(...)`-Ausschnitt
aus `recommendation.ts:156-161` samt seiner leeren `absent`-Fassung, §4.2 dieses Plans, und für
B3-2a zusätzlich §2.2 Punkt „nicht-endlich".

### 5.3 Die Fixture-Lage

`existing-case.test.ts` (`d4f6b45`) betritt ausdrücklich den **positiven** `addon`-Zweig
(`:181-182`, `:203`: ein Gerät über der Schwelle, eines darunter). Der Klarsatz-Zweig ist heute nur
über `registry.test.ts:440` (`BLOCKER_FALL`) abgedeckt, **und zwar auf `not.toBeNull()`** — es gibt
keine Render-Fixture, die `addon_none` durchs Dokument führt. B3-2a braucht deshalb eine
Fixture-Variante mit **allen** Szenarien unter der Schwelle; ohne sie ist das Verdikt gebaut, aber
nie gerendert worden.

---

## 6 — Was dieser Plan nicht sagt

- **Nichts über den Wortlaut des Verdikts** — §5.2 nennt die Entscheidung, trifft sie nicht.
- **Nichts über B3-3** (`recommendation`, 20a/20b) und nichts über Nr. 19 (`pv_outage`). Die
  Reihenfolge-Auflage aus Block-3-Plan §3.3 gilt unverändert: B3-2 vor B3-3.
- **Nichts über die Kapitel-Doppelreihenfolge** (`content.ts:398` und der JSX-Seitenbaum, von Hand
  synchron). B3-2 fügt kein Kapitel hinzu und verschiebt keines.

### 6.1 ⚠ Zwei Nebenbefunde aus der Messung — nicht Gegenstand, aber festgehalten

1. **Der Zeilenabstand läuft vom Zielbild weg.** Gemessen setzt das Zielbild seinen Fliesstext mit
   **14,48 pt Durchschuss bei 9,7 pt** (Faktor ≈ **1,50**) — auf Seite 2 und Seite 10 identisch.
   Der Report setzt **11,88 pt bei 9,5 pt** (Faktor **1,25**, `theme.ts:294`). Der Kommentar dort
   begründet den Wechsel von 1,45 auf 1,25 damit, dass 1,45 „zu locker" sei — **die verworfene Zahl
   war die des Zielbildes.** Das ist eine bewusst getroffene Gestaltungsentscheidung und keine
   Abweichung, die B3-2 zu heilen hätte; sie steht hier, weil der Kommentar sich auf eine Vorlage
   beruft, die anders misst. Wer sie ändert, ändert den Seitenumbruch des ganzen Dokuments
   (`theme.ts:287-289`).
2. **Der Satzspiegel ist um 6 pt versetzt.** Das Zielbild setzt Text bei x = 62,69, seine
   Kopflinie aber bei x = 56,69; der Report setzt beides bei 56,69. Kosmetisch, dokumentweit, und
   ebenfalls nicht Gegenstand dieses Schritts.
