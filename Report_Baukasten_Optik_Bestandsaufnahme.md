# Bestandsaufnahme: Report-Optik — aktueller Stand gegen das Urbanz-Zielbild

> **Stand:** 18.09.2026, Commit `0ca5d31` (Report-Baukasten C). **Reine Messung, keine
> Bewertung, kein Bau** — dasselbe Format wie `Report_Baukasten_KI-Schicht_Bestandsaufnahme.md`
> und `Report_Baukasten_Instanzen_Verifikation.md`. Am Produktivcode ist nichts geändert.
>
> **Gegenstand:** Bauabschnitt **D15** (`Pflichtenheft_Kalkulator_Delta_Report-Baukasten.md` §D15
> „Design/McKinsey-Optik"). Zielbild ist ausdrücklich `Urbanz_Wirtschaftlichkeitsanalyse V2.pdf`
> im Repo-Root.
>
> **Vorgelagert:** `Report_Baukasten_Bestandsaufnahme.md` (was es gibt) ·
> `Report_Baukasten_Instanzen_Verifikation.md` (die 28 Bausteine einzeln) ·
> `Report_Baukasten_Auswahlschicht_Verifikation.md` (Stufe C) ·
> `Report_Baukasten_KI-Schicht_Bestandsaufnahme.md` (wohin es später geht).
>
> **Die eine Zahl, die man zuerst wissen muss:** Zielbild **15 Seiten**, aktueller Report
> **12 Seiten** — und die Farbpalette ist **identisch**. Die Lücke liegt nicht in den Tokens,
> sondern in ihrer Verwendung.

---

## 1 — Wie gemessen wurde

### 1.1 Das Zielbild

`Urbanz_Wirtschaftlichkeitsanalyse V2.pdf` (576 kB, 15 Seiten, A4 595,28 × 841,89 pt) ist **nicht**
vom Rechner erzeugt: Producer ist `ReportLab PDF Library`, Autor `COOLiN ENERGY`, Titel
„Wirtschaftlichkeitsanalyse – Markus Urbanz", CreationDate 09.09.2026. Es ist ein von Hand
gesetztes Zielbild, kein Ausgabestand des Produkts.

Gemessen wurde am **Inhaltsstrom**, nicht am Augenschein: alle 15 Seitenströme
(ASCII85 + Flate) entpackt, Text über die eingebetteten `ToUnicode`-CMaps zurückübersetzt, dazu
Füll-/Strichfarben (`rg`/`RG`), Linienstärken (`w`), Rechtecke (`re`) und Pfade (`m`/`l`)
mitgeführt. Eingebettete Schriften: **Inter-Regular, Inter-SemiBold, Inter-Bold** (TrueType,
subsetted) — dieselben drei Schnitte wie `PDF_FONT_SOURCES`. Die sechs Diagramme liegen als
RGB-Bilder mit SMask vor (1520 px Breite) und wurden als PNG herausgezogen und angesehen; die
Farbverteilung je Bild wurde zusätzlich ausgezählt.

⚠ **Fallstrick beim Nachmessen:** ReportLab schreibt Farben als auf drei Nachkommastellen
gerundete Floats. Wer `int(x*255)` rechnet statt `round(x*255)`, liest durchgehend **jeden Kanal
um 1 zu niedrig** und kommt zu dem falschen Schluss, das Zielbild benutze eine leicht andere
Palette (`#17336E` statt `#18336F` usw.). Es benutzt dieselbe.

### 1.2 Der aktuelle Report

Erzeugt aus **`ReportDocument` selbst** (`apps/website/lib/pdf-report/document.tsx`, Stand
`0ca5d31`) über `renderToBuffer`, in einem vitest-Harness ohne Browser; anschliessend mit derselben
Werkzeugkette ausgewertet wie das Zielbild (react-pdf schreibt Type0/Identity-H mit
`bfrange`-Array-Form — der CMap-Leser muss beide Formen können).

Gerechnet wurde nicht neu; die Eingabe ist der **Urbanz-Fall in Contract-Form**: Bestandsspeicher
19,2 kWh / 10,6 kW / η 0,9, Netzebene 7 ohne Leistungsmessung (Leistungspreis 0), PV vorhanden mit
PV-Ausfall Februar–April 2026, 209 abgedeckte Tage / 8 Monate, Tarifvergleich rechenbar,
kein Zusatzgerät wirtschaftlich. Das ist die **Fallgestalt** des Zielbildes; die Beträge sind
übertragen, nicht nachgerechnet.

Um alle 28 Bausteine wenigstens einmal zu sehen, wurden zwei weitere Fälle gerendert:

| Fall | Gestalt | Seiten | Zweck |
|---|---|---|---|
| **A** | Urbanz (Bestand, rechenbar, kein Zusatzgerät) | **12** | der Vergleichsfall |
| **B** | Katalogfall, Leistungspreis > 0, Standardprofil, geschätzte PV, Teiljahr, 40-Tage-Lücke | **14** | `peak_shaving`, die vier Kernergebnis-Hinweise, `catalog_alternatives`, `table_candidates`, `data_quality`, Kapitel 4 |
| **C** | Bestand + Börsenpreis-Blocker + ein sich rechnendes Zusatzgerät | **11** | `addon_table`, `tariff_blocker` |

Über A/B/C ist **jede der 28 Kennungen mindestens einmal `DA`** (Nachweis: die drei
Registry-Durchläufe, Tabelle in §5).

### 1.3 ⚠ Zwei Grenzen dieser Messung, ausdrücklich benannt

1. **Kein Chart-Bild.** Die Rasterung (`charts.tsx` → `chart-capture.ts`) braucht ein DOM und
   mehrere Frames; im Harness gibt es keinen Browser. Alle sieben Bildplätze stehen deshalb auf
   „nicht gerastert", und das Dokument zeigt an ihrer Stelle den `missing`-Satz. **Die
   Chart-Optik in §4.7 ist deshalb aus den Chart-Komponenten selbst gelesen**
   (`components/report/*.tsx`, Farbkonstanten und Recharts-Props), nicht aus einem Bild. Für
   Farbe, Reihenbelegung und Beschriftung ist das exakt; für Achsenraum und Balkenbreite nicht.
2. **Kein Emblem.** `<Image src="/brand/coolin-emblem.png">` ist ein Pfad auf die eigene Herkunft;
   im Node-Lauf schlägt er fehl (react-pdf protokolliert und rendert weiter). Die Kachel ist im
   gemessenen PDF also leer — **dass** sie da ist und wie gross (64 × 64 pt auf den Navy-Seiten,
   13 × 13 pt in der Kopfzeile), steht in `document.tsx` und ist in §4.1/§4.2 danach beschrieben.

---

## 2 — Das Farb- und Typografie-System

### 2.1 Die Palette ist identisch — das ist der wichtigste Befund dieses Berichts

Alle 17 im Zielbild vorkommenden Farbwerte, ausgezählt über alle 15 Seiten:

| Hex | Vorkommen | Entsprechung in `lib/pdf-report/theme.ts` |
|---|---:|---|
| `#1E293B` | 339 | `PDF_COLORS.text` ✓ |
| `#0F172A` | 181 | `PDF_COLORS.ink` ✓ |
| `#475569` | 103 | `PDF_COLORS.textMuted` ✓ |
| `#E2E8F0` | 97 | `PDF_COLORS.border` ✓ |
| `#0F766E` | 96 | `PDF_COLORS.accent` ✓ |
| `#FFFFFF` | 66 | `PDF_COLORS.onNavy` ✓ |
| `#F8FAFC` | 40 | `PDF_COLORS.surfaceAlt` ✓ |
| `#2CC3C1` | 20 | `PDF_COLORS.accentOnNavy` ✓ |
| `#A7B1C8` | 16 | `PDF_COLORS.onNavyMuted` ✓ |
| `#B45309` | 6 | `PDF_COLORS.warning` ✓ |
| `#B91C1C` | 4 | `PDF_COLORS.negative` ✓ |
| `#18336F` | 4 | `PDF_COLORS.navy` ✓ |
| `#15803D` | 4 | `PDF_COLORS.positive` ✓ |
| **`#F0FDFA`** | 6 | **nicht in `theme.ts`** — aber in `globals.css` als `--color-accent-subtle` („Teal 50 – Flächen/Callouts“) vorhanden; Hintergrund des Positiv-Kastens |
| **`#FFFBEB`** | 6 | **kein Token, nirgends** — Hintergrund des Warn-Kastens (Amber 50); das Gegenstück zu `--color-accent-subtle` fehlt auch am Bildschirm |
| **`#2A4180`** | 2 | **kein Token, nirgends** — Trennlinie auf der Abschlussseite (Navy aufgehellt) |
| `#000000` | 29 | ReportLab-Zurücksetzung zwischen Blöcken, ohne sichtbare Wirkung |

Dazu in den **Diagrammen** genau eine weitere Farbe: **`#99D8D3`** (helles Teal) für die
„rechnerisches Optimum"-Säule und die „ohne PV"-Säulen. Die übrigen Diagrammfarben sind
`#0F766E`, `#475569`, `#0F172A`, `#15803D`, `#B91C1C`, `#E2E8F0` — allesamt Tokens.

**Folgerung: D15 ist keine Farbumstellung.** Die Zieloptik braucht **vier** Werte, die `theme.ts`
heute nicht führt — und davon existiert einer (`#F0FDFA`) am Bildschirm bereits als
`--color-accent-subtle`, ist bloss nie ins PDF-Theme abgeschrieben worden. Wirklich neu sind
**drei**: `#FFFBEB` (Amber-Pendant zu `accent-subtle`, fehlt auch in `globals.css`), `#2A4180`
(Navy-Trennlinie) und `#99D8D3` (Diagramm-Tint). Alles andere ist bereits da und bereits an
einer Stelle.

### 2.2 Typografie — dieselben drei Schnitte, andere Stufenleiter

| Rolle | Zielbild | aktueller Report | Abweichung |
|---|---|---|---|
| Deckblatt-Titel | Bold **30** / 36 | Bold **30** (`PDF_TYPE.cover`) / 1,18 | Durchschuss 1,20 vs 1,18 — praktisch gleich |
| Deckblatt-Untertitel | Regular **12** / 17 | Regular **12** (`coverSub`) / 1,35 | Durchschuss 1,42 vs 1,35 |
| Kapitel-Überschrift | **Bold** 14 / 17 | **SemiBold** 14 / 1,25 | **Gewicht** (Bold vs SemiBold), Durchschuss |
| Kapitel-Vorspann | Regular 9,5 / 13,0 | Regular 9,5 `#475569` | gleich |
| **Fliesstext** | Regular **9,7** `#1E293B` / **14,5 (1,49)** | Regular **9,5** `#475569` / **11,9 (1,25)** | **Farbe und Durchschuss — die auffälligste Einzelabweichung** |
| Zwischenüberschrift | SemiBold **11,5** / 14,0 | SemiBold **9,5** (`statementTitle`) | **2 pt kleiner** |
| Sekundärabsatz („wie wir verglichen haben") | Regular 8,8 `#475569` / 13,0 | — kein Gegenstück | fehlt als eigene Stufe |
| Kennzahl (KPI) | Bold **27** / 30 | Bold **22** (`headlineValue`) | 5 pt kleiner |
| Betrag im Baustein | — (Zielbild kennt die Form nicht) | Bold 15 (`statementAmount`) | nur im Ist |
| Tabellenkopf | SemiBold **7,6** weiss auf Navy | SemiBold **8,5** `#0F172A` auf weiss | s. §4.6 |
| Tabellenzelle | Regular/SemiBold 7,8 / 10,5 | Regular 8,5 `#1E293B` | 0,7 pt grösser |
| Anhang-Fliesstext | Regular 8,3 / 12,0 | — kein Anhang-eigener Grad | fehlt als eigene Stufe |
| Fusszeile | Regular 7,6 / 9,1 | Regular **7,0** (`PDF_TYPE.footer`) | 0,6 pt kleiner |

⚠ **Der Durchschuss ist eine bewusst getroffene, gegenteilige Entscheidung.** `theme.ts`
begründet `lineHeight: 1.25` ausdrücklich damit, dass 1,45 „für 9,5 pt zu locker" sei und den
Report „weniger nach Beratungsdokument als nach Handout" aussehen lasse. Das Zielbild setzt den
Fliesstext mit **1,49**. Wer D15 baut, kippt damit eine dokumentierte Entscheidung — und
verschiebt den Seitenumbruch des ganzen Dokuments samt aller Agenda-Seitenzahlen (die Warnung
steht im selben Kommentar). Das ist keine Kleinigkeit, sondern ein `[MARTIN]`-Punkt.

### 2.3 Satzspiegel

| | Zielbild | aktuell |
|---|---|---|
| Seitenrand links/rechts | **56,69 pt** (20 mm) | **48 pt** (`PDF_LAYOUT.pageHorizontal`) |
| Textspaltenbreite | **481,89 pt** | **499,28 pt** (`PDF_CONTENT_WIDTH_PT`) |
| Inhalt auf Navy-Seiten eingerückt auf | 62,69 pt (= Rand + 6) | 48 pt (kein Versatz) |
| Anhang-Tabellen | **487,60 pt** — ragen 5,7 pt über die Textspalte hinaus | Tabellen = Textspalte |
| Kopfzeilen-Grundlinie | 804,5 pt | ≈ 806 pt (`headerTop` 30) |
| Kopfzeilen-Trennlinie | 796,54 pt | direkt unter der Wortmarke |
| Fusszeilen-Trennlinie | 39,69 pt | `footerBottom` 26 + `paddingTop` 4 |
| Fusszeilen-Grundlinie | 29,2 pt | ≈ 30 pt |

Die Zieloptik ist also **schmaler gesetzt** (481,9 statt 499,3 pt, rund 3,5 % weniger Zeilenlänge)
und lässt die Anhang-Tabellen bewusst ausbrechen.

---

## 3 — Seite für Seite: 15 Zielseiten gegen 12 Ist-Seiten

Die Zuordnung ist inhaltlich, nicht positionell — das Zielbild ordnet nach Erzählung, der aktuelle
Report nach Kapitel-Datenstruktur (`content.ts`).

| Zielseite | Was darauf steht | Entsprechung im aktuellen Report | Optik-Befund |
|---|---|---|---|
| **1** Deckblatt | Navy vollflächig, Wortmarke zweifarbig, Titel 3-zeilig, drei Label/Wert-Blöcke an einer senkrechten Teal-Linie | S. 1 Deckblatt (`Cover`) | **weicht ab** — s. §4.1 |
| **2** Zusammenfassung | zwei KPI 27 pt nebeneinander (`€1.061` ink, `€53 – €207` accent), Hairline darunter, zwei Fliesstextblöcke, Teal-Kasten „Ausserdem schon geklärt" | S. 3 Kernergebnisse (`savings`, `addon`) | **weicht ab** — KPI-Grad, KPI-Rahmen, Kastenfarbe; s. §4.3/§4.4 |
| **3** Voraussetzungen | Überschrift + **3-Zeilen-Kennzahlenstreifen** (zebra), dann Amber-Kasten; darunter „Ihr Verbrauch heute" + zweiter Streifen + zweiter Amber-Kasten | verteilt: Anlagedaten stehen in Kapitel 8 (`assumptions`, `table_tariff_components`) | **strukturell** — es gibt keine vorangestellte Voraussetzungs-Seite |
| **4** Ihr Lastgang | ganzseitiges Diagramm + Bildunterschrift 8 pt muted | S. 4 (Lastgang-Bild in Kapitel 2) | Bildunterschrift-Optik passt; Platzierung anders (dort mit Empfehlung auf einer Seite) |
| **5** Drei Wege | Balkendiagramm + Bildunterschrift, dann „Weg 1/2/3" als SemiBold-11,5-Zwischenüberschriften mit **farbigen Beträgen im Fliesstext** | S. 5 Kostenverlauf (`monthly_comparison`, Kostenvergleich-Bild) | **weicht ab** — drei statt fünf Reihen, keine farbigen Inline-Beträge, Zwischenüberschrift 9,5 statt 11,5 |
| **6** (Fortsetzung Weg 3) | 2-Zeilen-Kennzahlenstreifen + Teal-Kasten „Wichtig zu wissen" | — | **strukturell** — die Gegenüberstellung „einfache vs. maximale Steuerung" existiert nicht |
| **7** Ladeverhalten | Tagesdiagramm (grün/rot/Preislinie) + Heatmap, beide mit Bildunterschrift; Zwischenüberschriften 11,5 | S. 6 Ladeverhalten (`hour_flow`, `charge_price`) | **weicht ab** — Heatmap ja, Tagesdiagramm mit Preislinie nein (der Tages-Energiefluss steht auf S. 5 und zeigt andere Reihen); s. §4.7 |
| **8** Ganzes Jahr | erklärender Fliesstext + Sekundärabsatz 8,8 + **5-Zeilen-Streifen** + Teal-Kasten | — (Engine kennt `annualProjection`, das Dokument zeigt sie im Urbanz-Fall nicht) | **strukturell** — keine eigene Hochrechnungs-Seite |
| **9** Ihre PV-Anlage | Monatsdiagramm mit „Ausfall"-Beschriftung + Kostendiagramm + 2-Zeilen-Streifen + Amber-Kasten „Einordnung" | `pv_outage` (Hinweis) + `method_pv_outage`, beide in Kapitel 8 | **strukturell** — der Befund ist ein Hinweiskasten hinten, kein eigenes Kapitel mit zwei Diagrammen |
| **10** Zusatzspeicher? | **„Nein" in Bold 27 `#B91C1C`**, darunter ein Absatz mit rot ausgezeichnetem Betrag | `addon` (Kap. 1) und `addon_none` (Kap. 6) | **weicht ab** — der Klarsatz steht heute als gewöhnliche Aussage in 9,5 pt ohne Verdikt-Zahl |
| **11** Was wir vorschlagen | vier nummerierte Punkte mit **Teal-Ziffer Bold 13**, dann „Wie diese Zahlen entstanden sind" mit fünf **Teal-Lead-ins** im Fliesstext, dann Kleingedrucktes 8,8 | Kapitel 7 „Methodik & Vorbehalte" (6 feste `METHODOLOGY_ITEMS`) | **strukturell** — es gibt keine Handlungsempfehlungs-Liste; die Methodik-Punkte tragen SemiBold-Titel statt Teal-Lead-ins |
| **12** Anhang Teil 1 | „Anhang: Methodik im Detail" Bold 16 + Vorspann; **Tabelle 1 Datenquellen** und **Tabelle 2 Tarif-/Netzkomponenten**, beide mit **Navy-Kopfzeile und Zebra** | S. 9–10 Kapitel 8 (`table_data_sources`, `table_tariff_components`) | **weicht ab** — Inhalt deckungsgleich, Tabellenoptik grundverschieden; s. §4.6 |
| **13** Anhang Teil 2 | „3. Berechnungsmethodik je Kennzahl" (6 Teal-Titel + 8,3-pt-Absätze), Exkurs-Überschrift, „4. Bekannte Einschränkungen" als Bullet-Liste | S. 10–11 (`method_*`, `limitations`) | **weicht ab** — Inhalt deckungsgleich (D9!), aber Titel SemiBold ink statt Teal, keine nummerierten Anhang-Abschnitte |
| **14** (Fortsetzung Einschränkungen) | weitere Bullets | S. 11 | Umbruch-Folge, keine eigene Abweichung |
| **15** Abschlussseite | Navy vollflächig, Wortmarke Bold 11, zweizeilige Fuss­zeile links **und rechts**, kurze Teal-Linie über dem Kontaktblock | S. 12 (`Outro`) | **weicht ab** — s. §4.8 |
| — | **kein Inhaltsverzeichnis** | **S. 2 „Inhalt" (Agenda mit Seitenzahlen)** | **strukturell, in der Gegenrichtung:** der aktuelle Report hat eine Seite, die das Zielbild nicht kennt |

**Zwei Seiten des Ist-Reports haben im Zielbild überhaupt kein Gegenstück:** die Agenda (S. 2) und
Kapitel 7 „Methodik & Vorbehalte" (S. 8) — Letzteres geht im Zielbild in S. 11 und S. 13 auf.

---

## 4 — Die Querschnitts-Elemente im Einzelnen

### 4.1 Deckblatt

| Element | Zielbild | aktuell (`Cover` / `NavyLockup`) |
|---|---|---|
| Fläche | `#18336F` vollflächig 595,3 × 841,9 | identisch |
| Logo | **nur Wortmarke, zweifarbig**: „COOLiN" weiss Bold 13 + „ENERGY" `#2CC3C1` Bold 13; darunter Regular 8 `#A7B1C8` | **Emblem-Bild 64 × 64 pt auf weisser Kachel (`borderRadius` 12, `padding` 7)** + Wortmarke einfarbig weiss Bold 17, `letterSpacing` 1,6 |
| Akzentstrich | **62,4 × 2,2 pt Teal, waagerecht, unter der Wortmarke** (y 660,5) | **54 × 3 pt Teal, waagerecht, über dem Titel** (`coverRule`) |
| Titel | Bold 30 weiss, dreizeilig, x 62,69 | Bold 30 weiss, x 48 |
| Untertitel | Regular 12 `#A7B1C8` | identisch |
| Kundenblock | **drei Label/Wert-Paare gestapelt** („ERSTELLT FÜR" / „AUSGEWERTETER ZEITRAUM" / „ERSTELLT AM"), Label SemiBold 8 `#2CC3C1` versal, Wert Regular 10,5 weiss; **eine** senkrechte Teal-Linie 2 pt über alle drei (119 pt hoch), Inhalt +10 pt eingerückt | **zwei getrennte Blöcke**: `coverCustomer` mit Teal-Linie links (Label 8,5 ls 1,2, Firma SemiBold 13, Name 9,5, Adresse `#A7B1C8`) und `coverMeta` mit **0,5-pt-Oberlinie `#A7B1C8`** und **zweispaltigen Zeilen** (Label 150 pt breit muted, Wert SemiBold weiss) |
| Adresse | einzeilig („Zuckerkandlgasse 67, 1190 Wien") | mehrzeilig, je Zeile ein `Text` |

**Abweichungen: Emblem-Kachel (strukturell), Position/Länge des Akzentstrichs, Aufbau des
Metablocks (zweispaltig vs. gestapelt), Wortmarken-Grad und -Farbigkeit.**

### 4.2 Kopfzeile

| | Zielbild | aktuell (`PageFurniture`) |
|---|---|---|
| Logo | **keins** — „COOLiN" `#18336F` Bold 9,5 + „ENERGY" `#0F766E` Bold 9,5 | **Emblem 13 × 13 pt** + „COOLiN ENERGY" SemiBold 8,5 `#18336F`, `letterSpacing` 0,6, **einfarbig** |
| rechts | **„Wirtschaftlichkeitsanalyse · Markus Urbanz", Regular 8 `#475569`, ab x 374,9** | **nichts** |
| Trennlinie | **Teal `#0F766E`, 1,6 pt**, volle Textbreite | **Navy `#18336F`, 2 pt, gefülltes Rechteck** (`headerBar`), volle Textbreite |
| auf dem Deckblatt | nicht vorhanden | nicht vorhanden (bewusst, s. Kommentar in `document.tsx`) |

### 4.3 Fusszeile

| | Zielbild | aktuell |
|---|---|---|
| Trennlinie | `#E2E8F0`, **0,7 pt**, y 39,69 | `#E2E8F0`, **0,5 pt** (`borderTopWidth`) |
| links | „COOLiN ENERGY · Karl-Popper-Straße 22 · 1100 Wien, Österreich", Regular **7,6** `#475569` | identischer Wortlaut, Regular **7,0** `#475569` |
| rechts | „www.coolin.at · Seite N von 15" | „www.coolin.at · Seite N von 12" (`render`-Rückruf) |
| Deckblatt | **ohne** Fusszeile, Zählung beginnt mit „Seite 2 von 15" | identische Konvention |

Die Fusszeile ist das Element mit der **kleinsten** Abweichung: gleicher Wortlaut, gleiche
Anordnung, gleiche Zählkonvention — Unterschied sind 0,6 pt Schriftgrad und 0,2 pt Linienstärke.

### 4.4 Hinweiskästen (`ReportNotice`)

Gemessen an vier Kästen im Zielbild und an allen acht Hinweisen über die Fälle A/B/C:

| | Zielbild | aktuell (`styles.notice` + `TONE_COLOR`) |
|---|---|---|
| Hintergrund | **tonabhängig**: `#F0FDFA` (Teal 50) für den positiven, `#FFFBEB` (Amber 50) für den warnenden | **immer `#F8FAFC`** (`surfaceAlt`), unabhängig vom Ton |
| Linke Kante | **2,6 pt**, `#0F766E` (positiv) bzw. `#B45309` (Warnung) | **2 pt**, `PDF_COLORS.positive` / `warning` / **`text` (`#1E293B`) für `neutral`** |
| Breite | 475,89 pt (Kasten), Linie steht links davor → zusammen 478,5 | Kasten = volle Textspalte, Linie innen |
| Titel | SemiBold **10,3** `#0F172A` | SemiBold **9,5** `#0F172A` |
| Text | Regular **9,2** `#1E293B` / 13,5 | Regular **9,5** `#475569` |
| Liste | im Zielbild nicht vorgekommen | `· `-Präfix, `#1E293B` |

⚠ **Der neutrale Ton ist der auffälligste Einzelfall:** ein neutraler Hinweis bekommt heute eine
**dunkelgraue** Kante (`#1E293B`) auf grauem Grund. Im Zielbild gibt es keinen neutralen Kasten —
jeder Kasten ist entweder teal oder amber. Das ist eine offene Frage, keine reine Kosmetik: `tone`
ist laut `statement.ts` „Information, kein Dekor".

### 4.5 Kennzahlen — zwei verschiedene Formen

**(a) Die KPI-Zeile.** Zielbild S. 2 und S. 10: zwei bzw. eine Zahl in **Bold 27**, Bildunterschrift
Regular 8,7 `#475569` darunter, **kein Rahmen, kein Hintergrund**, darunter eine Hairline 0,8 pt
`#E2E8F0` über die volle Textbreite. Farbe trägt Bedeutung: `#0F172A` für die Ist-Kosten,
`#0F766E` für die Ersparnisspanne, `#B91C1C` für das „Nein".

Aktuell (`styles.headline`): zwei Zellen in **Bold 22** in einem Kasten mit `backgroundColor`
`#F8FAFC` und `borderWidth` 0,5 `#E2E8F0`, `padding` 14, `gap` 24; Bildunterschrift 8,5 `#475569`.
Farbe: `ink` bzw. `negative` (`headlineValueCost`).

**(b) Der Kennzahlenstreifen.** Zielbild S. 3, 6, 8, 9: Label/Wert-Zeilen mit **Zebra**
(`#F8FAFC` / `#FFFFFF`), Zeilenhöhe 26,5 pt (einzeilig) bzw. 39 pt (zweizeilig), Hairlines 0,5 pt,
Label Regular 9,3 `#1E293B` links, Wert SemiBold 9,5 `#0F172A` rechts.

Aktuell (`styles.row` / `StatementRow`): Label `#475569` links, Wert SemiBold rechts,
`borderTopWidth` 0,5 `#E2E8F0`, `paddingTop/Bottom` 2,5 — **ohne Zebra**, ohne feste Zeilenhöhe;
die Summenzeile bekommt `borderTopWidth` 1.

### 4.6 Tabellen

| | Zielbild (Anhang S. 12) | aktuell (`styles.table`) |
|---|---|---|
| Kopfzeile | **gefülltes Rechteck `#0F172A`, 17,5 pt hoch**, Text **weiss** SemiBold 7,6 | **kein Hintergrund**, Text `#0F172A` SemiBold 8,5, darunter `borderBottomWidth` 1 `#E2E8F0` |
| Datenzeilen | **Zebra `#F8FAFC` / `#FFFFFF`**, Höhe 18,5 pt (einzeilig) / 29 pt (zweizeilig) | kein Zebra, `borderBottomWidth` 0,5 `#E2E8F0` |
| Erste Spalte | SemiBold 7,8 `#0F172A` (hervorgehoben) | Regular 8,5 `#1E293B` wie alle Zellen |
| Übrige Zellen | Regular 7,8 `#1E293B` | Regular 8,5 `#1E293B` |
| Hairlines | 0,4 pt innen, 0,5 pt aussen | 0,5 pt |
| Breite | **487,6 pt — bewusst breiter als die Textspalte** | = Textspalte |
| Gruppenzeile | im Zielbild nicht vorhanden | `tableGroupRow` (D9, „Lastgang / Tarif / Batterie") |
| Fussnote | Regular 7,4 `#475569` unter der Tabelle | `styles.footnote` 8,5 mit Oberlinie |

⚠ Die **Gruppenzeilen** der Datenquellen-Tabelle (D9, `heading: true`) sind eine Eigenschaft des
Ist-Reports, die das Zielbild nicht kennt — hier ist der aktuelle Stand **reicher**, nicht ärmer.
Eine Zebra-Einführung muss sie mitdenken (eine Gruppenzeile darf nicht als Datenzeile eingefärbt
werden).

### 4.7 Diagramme

**Im Zielbild (sechs Bilder, Farben ausgezählt):**

| Bild | Reihen und Farben | Hervorhebung |
|---|---|---|
| S. 4 Lastgang | eine Linie `#475569` mit heller Flächenfüllung; Gitter `#E2E8F0` waagerecht; keine Kapp-Linie | — |
| S. 5 Drei Wege (5 Säulen) | Ist-Zustand **`#475569`**, drei erreichbare Wege **`#0F766E`**, rechnerisches Optimum **`#99D8D3` mit diagonaler Schraffur** | **Wertbeschriftung über jeder Säule, Bold `#0F172A`**; die Schraffur ist die Aussage „Obergrenze, keine Prognose" |
| S. 7 Beispieltag | Ladesäulen **`#15803D`**, Entladesäulen **`#B91C1C`**, Preislinie **`#0F172A`** mit Punkten, **zwei Achsen**, Nulllinie, **Legende unterhalb**, **fetter Diagrammtitel im Bild** | Vorzeichen-Farbigkeit |
| S. 7 Heatmap | **divergierende Skala rot ↔ weiss ↔ grün** mit beschrifteter Farbleiste (−200 … +200 kWh) | Farbleiste als Legende |
| S. 9 PV je Monat | Säulen `#0F766E` | **Wertbeschriftung über jeder Säule**; Ausfallmonate tragen statt einer Säule das Wort **„Ausfall" in `#B91C1C` fett** |
| S. 9 PV-Kosten | abwechselnd `#0F766E` (mit PV) und `#99D8D3` (ohne PV), **senkrechte gestrichelte Trennlinie** zwischen „209 Tage" und „volles Jahr" | Wertbeschriftung über jeder Säule |

**Aktuell (aus den Komponenten gelesen):**

| Komponente | Reihen und Farben |
|---|---|
| `load-chart` | Linie `--color-text-muted`, Kapp-Linie `--color-accent`, gefangene Spitzen `--color-warning`; Gitter `--color-border` gestrichelt |
| `monthly-tariff-chart` | drei Reihen: `--color-text-muted` · `color-mix(accent 50%, surface)` · `--color-accent` |
| `cost-chart` | drei gestapelte Segmente in Accent-Abstufungen (100 % / 85 % / 65 %), **`LabelList` innerhalb der Segmente**, Break-even-Verlauf mit `--color-negative`/`--color-positive` bei 18 % Deckkraft |
| `energy-flow-chart` | `--color-ink` · `--color-text-muted` · `--color-accent` · `--color-accent-hover` |
| `battery-flow-heatmap` | Laden `--color-accent` (**teal**), Entladen `--color-ink` (**navy**), leere Zelle gestrichelter Rahmen |
| `charge-price-chart` | `--color-accent` · `color-mix(accent 45%, surface)` · `--color-text-muted` |
| `marginal-benefit-chart` | Kurve `--color-accent`, Nulllinie `--color-text-muted` |

**Die drei Befunde:**

1. **Der aktuelle Chart-Satz ist monochrom-teal.** `--color-positive`/`--color-negative`
   kommen in genau **einem** Diagramm vor, und dort nur als Flächenwaschung bei 18 %
   Deckkraft (`cost-chart.tsx:229-230`, Break-even-Verlauf) — nie als Reihenfarbe. Die
   Heatmap kodiert Laden/Entladen als **teal vs. navy** statt **grün vs. rot**. Das Zielbild
   benutzt die semantischen Töne auch im Bild, und zwar tragend.
2. **Es gibt keine Wertbeschriftung an Säulen.** `LabelList` wird genau einmal verwendet
   (`cost-chart`, *innerhalb* gestapelter Segmente). Alle Säulendiagramme des Zielbildes tragen
   ihren Wert fett über der Säule.
3. **Es gibt keine Auszeichnung von Extrem-/Modellwerten.** Weder eine Schraffur für „rechnerisches
   Optimum", noch eine gestrichelte Gruppentrennlinie, noch eine In-Plot-Textmarke wie „Ausfall".
   Im Ist-Report übernimmt diese Aufgabe der Text neben dem Bild.

Dazu ein **Unterschied im Legendenort**: das Zielbild zeichnet die Legende **ins Bild**
(S. 7 unten), der Ist-Report setzt sie als `styles.legend` mit `legendSwatch` 8 × 8 pt
**unter** das Rasterbild in react-pdf.

### 4.8 Abschlussseite

| | Zielbild | aktuell (`Outro`) |
|---|---|---|
| Fläche | `#18336F` vollflächig | identisch |
| Logo | Wortmarke zweifarbig Bold **11** | Emblem-Kachel 64 × 64 + Wortmarke einfarbig Bold **17** |
| Headline | Bold **22** weiss | Bold **20** weiss |
| Lead | Regular 10,5 `#A7B1C8` | Regular **12** `#A7B1C8` |
| Kontaktblock | **kurze waagerechte Teal-Linie 45,4 × 2 pt darüber**, Block selbst **ohne** linke Kante; Label SemiBold 8 `#2CC3C1`, Name SemiBold 12, Rolle 9,5 `#2CC3C1`, Zeilen 9,5 `#A7B1C8` | **linke Kante 2 pt Teal** (`outroContact`); Label 8,5 ls 1,2, Name SemiBold 13, Rolle 9,5 `#A7B1C8`, Zeilen 9,5 weiss |
| Fuss | **zweizeilig links UND rechts** (Adresse/Web links, Dokumenttitel/Zeitraum rechts), 7,6 `#A7B1C8`, darüber Hairline **`#2A4180` 0,7 pt** bei y 56,69 | einzeilig, 8,5 `#A7B1C8`, darüber `borderTopWidth` 0,5 **`#A7B1C8`** |

---

## 5 — Die 28 Bausteine einzeln

Legende: **= Zielbild** — die Optik dieses Bausteins entspricht dem Zielbild bereits ·
**≈ kosmetisch** — dieselbe Form, abweichende Werte (Farbe/Grad/Abstand) ·
**≠ strukturell** — Form fehlt oder ist eine andere ·
**∅ kein Gegenstück** — im Zielbild kommt dieser Baustein nicht vor (dann ist „Abweichung" nicht
bestimmbar, und das ist ein ausdrückliches Ergebnis).

| # | Kennung | Form | gemessen in | Optik-Befund |
|---:|---|---|---|---|
| 1 | `savings` | Statement (Betrag + Zeilen + Text) | A, B, C | **≈ kosmetisch** — Betrag Bold 15 `#15803D`, Zeilen ohne Zebra, Fliesstext `#475569`. Zielbild S. 2: KPI 27 pt, Zeilenstreifen mit Zebra, Fliesstext `#1E293B`. Form stimmt, Werte nicht. |
| 2 | `peak_shaving` | Statement | B, C | **∅ kein Gegenstück** — der Urbanz-Anschluss hat keinen Leistungspreis; das Zielbild sagt das auf S. 3 in einem **Amber-Kasten**, nicht in einer Aussage. Optik heute: Standard-Statement. |
| 3 | `load_shift` | Statement | A, B | **≈ kosmetisch** — entspricht S. 5 „Weg 3"; dort Zwischenüberschrift SemiBold **11,5** und Betrag **im Fliesstext farbig**, hier Titel 9,5 + abgesetzter Betrag Bold 15. |
| 4 | `addon` | Statement (ohne Betrag) | A, C | **≠ strukturell** — Zielbild S. 10 macht daraus eine **eigene Seite mit „Nein" in Bold 27 `#B91C1C`** und einem rot ausgezeichneten Betrag im Absatz. Heute: Titelzeile 9,5 + Absatz, kein Verdikt, keine Zahl. |
| 5 | `standard_profile` | Notice `neutral` | B | **≈ kosmetisch** — Kasten vorhanden; Hintergrund `#F8FAFC` statt `#F0FDFA`/`#FFFBEB`, **linke Kante `#1E293B`** (dunkelgrau), Titel 9,5 statt 10,3. |
| 6 | `estimated_pv` | Notice `neutral` | B | **≈ kosmetisch** — wie 5. Inhaltlich der längste Hinweis des Katalogs (drei Absätze + Handlungssatz); im Zielbild kein Gegenstück dieser Länge. |
| 7 | `partial_year` | Notice `warning` | B | **≈ kosmetisch** — Kante `#B45309` stimmt bereits; es fehlen Hintergrund `#FFFBEB` und Kantenstärke 2,6 pt. |
| 8 | `large_gap` | Notice `warning` | B | **≈ kosmetisch** — wie 7. |
| 9 | `recommendation` | Statement (Betrag + 4 Zeilen) | A, B, C | **≠ strukturell** — Zielbild S. 11 setzt Empfehlungen als **nummerierte Liste mit Teal-Ziffern Bold 13**. Heute: Amortisationszahl Bold 15 `#B45309` + Investitionszeilen. Zwei verschiedene Darstellungsideen. |
| 10 | `load_control` | Statement | A, B | **≈ kosmetisch** — entspricht S. 5/6; dort Zwischenüberschrift 11,5 und ein **2-Zeilen-Kennzahlenstreifen mit Zebra** für „einfach vs. maximal". Heute: Titel 9,5 + Fliesstext, kein Streifen. |
| 11 | `monthly_comparison` | Statement (3 Zeilen) | A, B | **≈ kosmetisch** — Zielbild S. 8 zeigt dieselbe Aufstellung als 5-Zeilen-Zebra-Streifen mit Werten „€2.960 / Jahr". Heute: drei Zeilen ohne Zebra, Werte SemiBold `#1E293B`. |
| 12 | `hour_flow` | Statement (3 Zeilen) + Bild | A, B, C | **≠ strukturell** (Bild) / **≈ kosmetisch** (Aussage) — die Heatmap gibt es, aber **teal/navy statt grün/rot** und ohne beschriftete Farbleiste. |
| 13 | `charge_price` | Statement (3 Zeilen) + Bild | A, B, C | **∅ kein Gegenstück** — das Zielbild hat kein Ø-Ladepreis-Diagramm. |
| 14 | `addon_none` | Statement | A | **≠ strukturell** — dasselbe wie 4: Zielbild macht daraus ein grosses „Nein". Zusätzlich steht der Klarsatz heute **zweimal** (Kap. 1 als `addon`, Kap. 6 als `addon_none`) — im Zielbild genau einmal. |
| 15 | `addon_table` | Statement | C | **∅ kein Gegenstück** — im Urbanz-Fall rechnet sich kein Zusatzgerät; das Zielbild zeigt deshalb keine Zusatzgeräte-Tabelle. |
| 16 | `catalog_alternatives` | Statement | B | **∅ kein Gegenstück** — dito (Bestandsfall). |
| 17 | `table_candidates` | Table (6 Spalten) | B, C | **≠ strukturell** — Tabelle vorhanden, aber ohne Navy-Kopfzeile und ohne Zebra; Zielbild-Tabellenoptik s. §4.6. |
| 18 | `assumptions` | Statement (5 Zeilen) | A, B, C | **≈ kosmetisch** — entspricht inhaltlich dem Zielbild-Streifen S. 3 „Voraussetzungen"; dort **zebragestreift und vorn im Dokument**, hier ohne Zebra in Kapitel 8. |
| 19 | `data_quality` | Notice `neutral` | B | **≈ kosmetisch** — wie 5. |
| 20 | `tariff_blocker` | Notice `warning` | C | **≈ kosmetisch** — wie 7. |
| 21 | `pv_outage` | Notice `warning` + Liste | A, B, C | **≠ strukturell** — im Zielbild ist der PV-Befund eine **ganze Seite (S. 9) mit zwei Diagrammen, einem Kennzahlenstreifen und einem Amber-Kasten**; heute ein Hinweiskasten mit Monatsliste in Kapitel 8. Der grösste Einzelunterschied des Katalogs. |
| 22 | `limitations` | Notice `neutral` | A, B, C | **≈ kosmetisch** — Zielbild S. 13/14: **Bullet-Liste unter einer nummerierten Anhang-Überschrift**, Fliesstext 8,3. Heute: Hinweiskasten mit Absätzen in 9,5. |
| 23 | `table_tariff_components` | Table (3 Spalten) | A, B, C | **≈ kosmetisch** — Spalten („Position / Wert / Status") **wortgleich** mit Zielbild-Tabelle 2; nur die Tabellenoptik weicht ab (§4.6). Der D9-Gewinn ist hier gut sichtbar. |
| 24 | `table_data_sources` | Table (3 Spalten) | A, B, C | **≈ kosmetisch** — Spalten („Quelle / Was daraus verwendet wurde / Zeitraum / Stand") **wortgleich** mit Zielbild-Tabelle 1. Zusätzlich hat der Ist-Report Gruppenzeilen, die das Zielbild nicht kennt. |
| 25 | `method_current_tariff` | MethodItem | A, B | **≈ kosmetisch** — Zielbild S. 13: Titel **`#0F766E` Regular 8,3**, Absatz 8,3. Heute: Titel SemiBold 9,5 `#0F172A`, Absatz 9,5 `#475569`. |
| 26 | `method_spot_uncontrolled` | MethodItem | A, B | **≈ kosmetisch** — wie 25. |
| 27 | `method_load_control` | MethodItem | A, B | **≈ kosmetisch** — wie 25. |
| 28 | `method_pv_outage` | MethodItem | A, B, C | **≈ kosmetisch** — wie 25. |

**Bilanz über die 28:** 4 ohne Gegenstück im Zielbild (2, 13, 15, 16) · 5 strukturell abweichend
(4, 9, 14, 17, 21, dazu 12 auf der Bildseite) · 19 kosmetisch abweichend · **0 Bausteine, deren
Optik dem Zielbild heute schon entspricht.** Das liegt daran, dass die drei querschnittlichen
Abweichungen — Fliesstextfarbe/-durchschuss (§2.2), Kastenhintergrund (§4.4) und Tabellen-/
Zebra-Optik (§4.5/§4.6) — **jeden** Baustein berühren.

---

## 6 — Theme-Datei oder verstreutes Styling?

**Es gibt eine zentrale Datei, und sie ist vollständig.** `apps/website/lib/pdf-report/theme.ts`
führt drei Objekte:

| Export | Inhalt | Konsumenten |
|---|---|---|
| `PDF_COLORS` | 13 Farbwerte | `document.tsx` (alle Stile), `chart-raster.ts` |
| `PDF_LAYOUT` | 7 Geometriewerte (Ränder, Kopf-/Fusszeilenlage) | `document.tsx`, `PDF_CONTENT_WIDTH_PT` |
| `PDF_TYPE` | Familie, `lineHeight`, 7 Schriftgrade | `document.tsx`, `fonts.ts` |
| `PDF_FONT_SOURCES` | 3 Schriftdateien | `fonts.ts` **und** `chart-raster.ts` |
| `PDF_CONTENT_WIDTH_PT` | 499,28 pt | `document.tsx`, `chart-probe.tsx` |

**Gemessen: in `document.tsx` steht kein einziger Hex-Wert und keine nackte Zahl für eine
Farbe.** Der gesamte Stilsatz (`StyleSheet.create`, Zeilen 111–512, 98 benannte Stile) liest
ausschliesslich über `PDF_COLORS.*`, `PDF_LAYOUT.*` und `PDF_TYPE.*`. Die einzigen Literale sind
Geometrie (Abstände, Breiten, `borderRadius`) und die drei Ausnahme-Schriftgrade 22 / 17 / 20 /
15 / 13, die **nicht** über `PDF_TYPE` laufen (`headlineValue` 22, `navyWordmark` 17,
`outroHeadline` 20, `statementAmount` 15, `coverCompany`/`outroPerson` 13).

**Für die Chart-Seite gilt das NICHT im selben Mass.** Die sieben Chart-Komponenten unter
`components/report/` beziehen ihre Farben über **CSS-Variablen** (`var(--color-accent)` usw. aus
`app/globals.css`) und bilden Zwischentöne mit `color-mix()` — **je Komponente eigens
ausgeschrieben**, mit unterschiedlichen Mischverhältnissen für denselben Zweck:

- `monthly-tariff-chart.tsx`: `color-mix(… accent 50 %, surface)`
- `charge-price-chart.tsx`: `color-mix(… accent 45 %, surface)`
- `cost-chart.tsx`: `color-mix(… accent 85 %, surface)` und `… 65 %, surface`

Das sind **vier verschiedene Aufhellungen derselben Akzentfarbe an vier Stellen**, keine davon
benannt. Das Zielbild benutzt dafür genau **einen** Wert (`#99D8D3`).

### Antwort auf die Leitfrage

**Die Stufe „Optik" ist zu rund zwei Dritteln ein zentraler Umbau und zu einem Drittel
Baustein-für-Baustein-Arbeit.**

- **Zentral (eine Datei, wirkt überall):** Fliesstextfarbe und -durchschuss, Schriftgrad-Leiter,
  Seitenränder/Satzbreite, Kopf-/Fusszeilen-Optik, Kasten-Hintergründe, Tabellen-Kopfzeile und
  Zebra, Kennzahlen-Grad. Das sind Änderungen an `theme.ts` plus an den betroffenen Stilen in
  `document.tsx` — **vier neue Tokens** (zwei Kasten-Hintergründe, Navy-Trennlinie, Chart-Tint — davon einer
  nur abzuschreiben, s. §2.1) und ein Dutzend geänderter Werte.
- **Je Baustein (Text und Struktur, nicht Stil):** die fünf strukturellen Fälle aus §5
  (`addon`/`addon_none` als Verdikt-Seite, `recommendation` als nummerierte Liste, `pv_outage`
  als eigenes Kapitel, `table_candidates`-Tabellenform) sowie die Seiten, für die es heute keinen
  Baustein gibt (Zielseiten 3, 6, 8).
- **Eigener Strang:** die Chart-Optik. Sie wohnt nicht in `theme.ts`, sondern in sieben
  Komponenten mit CSS-Variablen und vier ungleichen `color-mix()`-Aufhellungen. **Ein
  Chart-Token-Satz fehlt.**

⚠ **Eine Auflage, die aus `theme.ts` selbst kommt:** der Dateikopf verlangt, dass jeder Wert die
wörtliche Abschrift des gleichnamigen Tokens aus `app/globals.css` ist und dass beide gemeinsam
geändert werden — es gibt dafür bewusst keinen automatischen Abgleich. Von den vier D15-Werten hat
genau einer dort ein Gegenstück (`#F0FDFA` = `--color-accent-subtle`) und ist schlicht
abzuschreiben; `#FFFBEB`, `#2A4180` und `#99D8D3` haben **keines** und sind entweder in
`globals.css` anzulegen oder als ausdrücklich PDF-eigene Werte zu kennzeichnen, wie es
`onNavyMuted` und `accentOnNavy` bereits sind.

---

## 7 — Priorisierte Kurzliste

Sortiert nach Wirkung je Aufwand. **S = strukturell** (Komponente/Chart/Seite fehlt),
**K = kosmetisch** (Farbe/Abstand/Grad).

### Zuerst — zentral, billig, wirkt auf jeder Seite

| # | Art | Was | Wo |
|---:|:--:|---|---|
| 1 | **K** | Fliesstext von `#475569` auf `#1E293B` — heute liest der ganze Report in Sekundärgrau | `document.tsx`: `statementBody`, `noticeBody`, `itemBody`, `lead` |
| 2 | **K** | Durchschuss 1,25 → ~1,49 ⚠ **kippt eine dokumentierte Entscheidung und verschiebt jeden Seitenumbruch** — `[MARTIN]` | `theme.ts` `PDF_TYPE.lineHeight` |
| 3 | **K** | Kasten-Hintergrund tonabhängig (`#F0FDFA` / `#FFFBEB`), Kante 2 → 2,6 pt; **den neutralen Ton klären** (Zielbild kennt ihn nicht) | `theme.ts` + `styles.notice`, `TONE_COLOR` |
| 4 | **K** | Tabellen: Navy-Kopfzeile mit weissem Text + Zebra; Gruppenzeilen ausnehmen | `styles.tableHeader`, `tableRow`, `tableGroupRow` |
| 5 | **K** | Kennzahlenstreifen (`StatementRow`) zebragestreift, feste Zeilenhöhe | `styles.row` |
| 6 | **K** | KPI 22 → 27 pt, Kasten und Rahmen weg, Hairline darunter | `styles.headline*` |
| 7 | **K** | Kopfzeile: Wortmarke zweifarbig, Trennlinie Teal 1,6 pt statt Navy-Balken 2 pt, Dokumenttitel rechts | `PageFurniture` |
| 8 | **K** | Zwischenüberschriften 9,5 → 11,5 pt; Kapitel-Überschrift SemiBold → Bold | `statementTitle`, `itemTitle`, `h2` |
| 9 | **K** | Seitenrand 48 → 56,69 pt ⚠ ändert die Chart-Rasterbreite (`PDF_CONTENT_WIDTH_PT`) mit | `PDF_LAYOUT.pageHorizontal` |
| 10 | **K** | Fusszeile 7,0 → 7,6 pt, Trennlinie 0,5 → 0,7 pt | `styles.footer` |

### Danach — Diagramme (eigener Strang, mittlerer Aufwand)

| # | Art | Was |
|---:|:--:|---|
| 11 | **S** | **Wertbeschriftung über Säulen** — in keinem Säulendiagramm vorhanden; das Zielbild hat sie in allen dreien |
| 12 | **S** | Heatmap auf **divergierend grün/rot** mit beschrifteter Farbleiste statt teal/navy |
| 13 | **S** | Tages-Diagramm mit **Preislinie auf zweiter Achse** und grün/rot-Säulen — der Ist-`energy-flow-chart` zeigt andere Reihen |
| 14 | **S** | **Schraffur/Muster für Modellwerte** („rechnerisches Optimum") — es gibt heute keine Auszeichnung „Obergrenze, keine Prognose" im Bild |
| 15 | **K** | **Ein** benannter Chart-Tint (`#99D8D3`) statt vier ungleicher `color-mix()`-Aufhellungen |
| 16 | **S** | In-Plot-Textmarken (z. B. „Ausfall" in `#B91C1C` an Nullmonaten) |
| 17 | **K** | Legende ins Bild statt als react-pdf-Block darunter (betrifft `styles.legend`) |

### Zuletzt — Struktur (echte Bauabschnitte, je eigener Prompt)

| # | Art | Was |
|---:|:--:|---|
| 18 | **S** | **`addon`/`addon_none` als Verdikt** — grosses „Nein"/„Ja" + Betrag, heute ein Absatz in 9,5 pt; zugleich die **Doppelung** zwischen Kapitel 1 und Kapitel 6 auflösen |
| 19 | **S** | **PV-Befund als eigenes Kapitel** mit zwei Diagrammen und Kennzahlenstreifen (Zielseite 9), heute ein Hinweiskasten hinten |
| 20 | **S** | **`recommendation` als nummerierte Handlungsliste** mit Teal-Ziffern (Zielseite 11) |
| 21 | **S** | **Voraussetzungs-Seite vorn** (Zielseite 3) — Anlagedaten stehen heute nur hinten in `assumptions` |
| 22 | **S** | **Jahres-Hochrechnungs-Seite** (Zielseite 8) — `annualProjection` ist in der Engine da (D6), im Dokument fehlt die Seite |
| 23 | **S** | **Anhang-Gliederung** mit nummerierten Abschnitten „1. … 4." und eigener Anhang-Textgrösse 8,3 pt |
| 24 | **S** | **Agenda** — der Ist-Report hat sie, das Zielbild nicht. **Entscheidung nötig**, nicht Umsetzung: die Agenda ist mit dem Zwei-Pass-Renderer und `measurementsAgree` teuer erkauft (D5) |

---

## 8 — Was dieser Bericht ausdrücklich nicht sagt

- **Nichts über die Zahlen.** Die Beträge des Zielbildes stammen aus einer von Hand gerechneten
  Auswertung (Python/scipy, s. Zielseite 13), nicht aus der Engine. Ob Engine und Zielbild
  übereinstimmen, ist eine andere Frage als diese hier — und `annualProjection`, die
  Fünf-Wege-Aufstellung und die PV-Rekonstruktion des Zielbildes berühren den Contract, nicht die
  Optik.
- **Nichts über Reihenfolge und Querverweise.** Stufe D ist ein eigener Schritt
  (`Report_Baukasten_Instanzen_Verifikation.md` §2, `…_Auswahlschicht_Verifikation.md` §7); die
  13 ortsgebundenen Textverweise sind hier nicht angefasst. **Jede Umstellung aus §7 Nr. 18–22
  verschiebt Bausteine zwischen Kapiteln und berührt sie damit** — das ist der Grund, warum die
  strukturellen Punkte hinten stehen und nicht vorn.
- **Nichts über die Chart-Geometrie.** Achsenraum, Balkenbreite und Schriftgrössen *im Bild* sind
  im Harness nicht messbar (§1.3); für einen Bau-Prompt zu Nr. 11–17 ist ein Lauf mit Browser und
  echter Rasterung nötig.
