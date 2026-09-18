# Report-Baukasten Stufe D — Plan: ortsunabhängige Querverweise

> Erstellt am 18.09.2026 am Stand von `main` (`a00759d`, „D15 Block 2"). **Kein Produktivcode
> geändert, keine Umsetzung.** Alle Zeilennummern sind an diesem Stand gemessen und weichen von
> `Report_Baukasten_Instanzen_Verifikation.md` (Stand 17.09.2026, vor PR #273 und D15) ab.
>
> **Frage dieses Plans:** Was muss geschehen, damit ein Baustein seinen Platz im Dokument wechseln
> oder wegfallen kann, ohne dass ein Satz an anderer Stelle ins Leere zeigt?
>
> Vorgelagert: `Report_Baukasten_KI-Schicht_Bestandsaufnahme.md` §4,
> `Report_Baukasten_Instanzen_Verifikation.md` §2, `Report_Baukasten_Auswahlschicht_Verifikation.md`
> §7, `Report_Baukasten_Optik_Bestandsaufnahme.md` Block 3 (§7 „Zuletzt — Struktur").

---

## 0 — Was Stufe D ist und was sie nicht ist

Stufe B2 hat den Katalog gebaut: 28 Bausteine, je eine stabile `id`, `registry.get(id).build()`
(`registry.ts`). Stufe C hat die erste Abwahl gebaut: vier Bausteine, ein additives Feld
`optionalSections`, die Filterung an der QUELLE (`dataQualityNoticeOf`/`pvOutageNoticeOf`,
`basis.ts:407-415`).

**Stufe D löst das, was beides heute begrenzt:** die Körper der Bausteine sind für EINE feste
Reihenfolge geschrieben. `Report_Baukasten_Auswahlschicht_Verifikation.md` §2.2 hat `addon` und
`table_candidates` ausdrücklich deshalb von der Auswahl ausgenommen; `Report_Baukasten_Optik_Bestandsaufnahme.md`
§8 nennt denselben Grund dafür, dass die strukturellen Punkte 18–22 hinten stehen.

**Nicht Teil von Stufe D:** eine KI-Auswahl, eine freie Reihenfolge in der Oberfläche, die
Rollup-Schicht (D13), der Report-Archiv-Rückweg (D11). Stufe D macht die Texte nur *fähig*, einen
Umbau zu überstehen — sie baut keinen Umbau.

---

## 1 — Vollständige Fundstellenliste

Gemessen über alle sechs Kapitel-Erzeuger, **Kommentarzeilen ausgeschlossen** (nur Text, der
tatsächlich im PDF landet). Suchmuster:

```
grep -v -E "^\s*(\*|//|/\*)" <datei> | grep -E "oben|unten|darüber|darunter|daneben|vorne|
  nebenan|Kernergebnis|im Kapitel|Kapitel „|auf der Seite|Seite „|weiter vorn|weiter hint|
  weiter unten|voriger|vorigen|davor|danach|zuvor|obendrauf|darin|dort"
```
und ein zweiter Durchlauf über alle `„…"`-Literale (Namen fremder Kapitel, Zeilen, Spalten und
Tabellen) sowie über die Formulierungen ohne Ortswort („Dieselbe Rechnung", „beim empfohlenen
Gerät", „steht in den Kernergebnissen").

**29 Fundstellen.** Sie zerfallen in vier Sorten:

| Sorte | Zeichen | Was aufgelöst werden muss |
|---|---|---|
| **P** — Position | „oben", „weiter unten", „darüber", „im Kapitel davor" | die Leserichtung zwischen zwei Bausteinen |
| **N** — Name | „im Kapitel „Empfehlung und Lastverlauf"", „in der Tabelle „Tarifkomponenten"" | der Titel eines fremden Bausteins/Kapitels als Literal |
| **Z** — Zeile/Spalte | „die Zeile „Wert der Ladesteuerung"", „die Spalten „Ersparnis/Jahr" und „Netto"" | eine Beschriftung INNERHALB eines fremden Bausteins |
| **A** — Abwesenheit | „weist der Report keine Leistungspreis-Ersparnis aus" | eine Aussage darüber, dass ein Baustein NICHT dasteht |

### 1.1 `summary.ts` — 9 Fundstellen

| # | Zeile | Baustein / Feld | Wortlaut (gekürzt) | Ziel | Sorte |
|---|---|---|---|---|---|
| 1 | 326–328 | `peak_shaving`, `relation` (Kassen-Zweig) | „Dieser Betrag steckt NICHT in **der Zahl oben** … weil er eine Jahresgrösse ist und **die Zahl oben** ein Zeitraumbetrag." | `savings` (Kopfzahl) | P |
| 2 | 329–330 | `peak_shaving`, `relation` (§3.7-Zweig) | „Dieser Betrag ist in der **Gesamtersparnis oben** bereits als **erste Zeile** enthalten…" | `savings` → Zeile „Spitzenkappung (Leistungspreis)" | P + Z |
| 3 | 390–393 | `load_shift`, `reconcile` | „Die Zeile **„Wert der Ladesteuerung"** in der **Aufschlüsselung oben** beantwortet dieselbe Frage…" | `savings` → Zeile | P + Z |
| 4 | 403–404 | `load_shift`, `selfConsumptionNote` (Kassen) | „…steckt in der Zeile **„Wert der Ladesteuerung"** in der **Aufschlüsselung oben** mit drin" | `savings` → Zeile | P + Z |
| 5 | 405–406 | `load_shift`, `selfConsumptionNote` (§3.7) | „…steht als eigener Anteil (**„Eigenverbrauch"**) **daneben**" | `savings` → Zeile | P + Z |
| 6 | 577–580 | `partial_year` (Notice) | „Der abgerechnete **Leistungswert oben** unter dem Modell „…"" | Kopfzahl (`SummaryHeadline`) | P |
| 7 | 609–611 | `large_gap` (Notice) | „…der abgerechnete **Leistungswert oben** und die daraus abgeleitete Ersparnis…" | Kopfzahl + `savings` | P |
| 8 | 646–648 | `standard_profile` (Notice) | „Die **oben gezeigten** Leistungswerte … eine Ersparnis beim Leistungspreis **wird deshalb gar nicht erst ausgewiesen**" | Kopfzahl + Abwesenheit `peak_shaving` | P + A |
| 9 | 723–725 | `estimated_pv` (Notice, `hints[1]`) | „…**weist der Report keine Leistungspreis-Ersparnis aus**." | Abwesenheit `peak_shaving` | A |

**Nicht gezählt** (self-referenziell, kein fremder Baustein): `:489` „Alle Beträge **hier** sind das,
was über Ihre bestehende Anlage hinaus herauskommt", `:494` „**hier** steht das bestgereihte" — beide
meinen die Zeilen des eigenen Bausteins.

**Positiv-Kontrolle:** `auf Seite|siehe Seite|Seite [0-9]|nächste Seite|Anhang|weiter hinten|
am Ende dieses Reports` über die Nicht-Kommentarzeilen → **0 Treffer**. Es gibt in dieser Datei
keinen expliziten Seitenverweis, nur relative Ortswörter.
**Falle:** `:707` matcht das Muster `dort`, ist aber „am Stand**ort**" — kein Verweis.

### 1.2 `recommendation.ts` — 5 Fundstellen

| # | Zeile | Baustein / Feld | Wortlaut (gekürzt) | Ziel | Sorte |
|---|---|---|---|---|---|
| 10 | 142–143 | `recommendation`, `framing` (Bestandsfall) | „Ob sich ein ZUSÄTZLICHES Gerät … lohnt, steht **in den Kernergebnissen**; die **dortigen** Beträge sind Differenzen…" | `addon` (Kap. 1) | P + N |
| 11 | 265–267 | `load_control`, `annualized` | „…die Zahl auf der **Kernergebnis-Seite** ist von diesem Zeitraum auf ein Jahr hochgerechnet…" | `load_shift` | N |
| 12 | 276–277 | `load_control`, `embeddedNote` (Kassen) | „Er steckt in der Zeile **„Wert der Ladesteuerung"** in der Aufschlüsselung der **Kernergebnis-Seite** bereits mit drin" | `savings` → Zeile | N + Z |
| 13 | 278–279 | `load_control`, `embeddedNote` (§3.7) | „Er steckt in der **Gesamtersparnis** bereits als **„tarifbewusstes Laden"**…" | `savings` → Zeile | Z |
| 14 | 282–284 | `load_control`, `selfConsumptionNote` | „…steckt in **derselben Zeile** mit drin" / „…steht als eigener Anteil (**„Eigenverbrauch"**) **daneben**" | `savings` → Zeile | P + Z |

**Positiv-Kontrolle:** dasselbe Seitenverweis-Muster wie oben → **0 Treffer**. Der Kommentar bei
`:133` („steht bereits auf der Kernergebnis-Seite") und bei `:306` („Der Betrag steht auf der
Kernergebnis-Seite") sind **Kommentare** und landen nicht im PDF — sie sind hier bewusst nicht
gezählt, dokumentieren aber dieselbe Kopplung und sind beim Umbau mit nachzuziehen.

### 1.3 `detail.ts` — 5 Fundstellen

| # | Zeile | Baustein / Feld | Wortlaut (gekürzt) | Ziel | Sorte |
|---|---|---|---|---|---|
| 15 | 225–226 | `monthly_comparison`, `closing` (Bestand) | „Die **Kernergebnis-Seite** zeigt die DIFFERENZEN zwischen diesen drei Summen; **hier** stehen sie absolut." | `savings` (Kassen-Fassung) | N |
| 16 | 227–229 | `monthly_comparison`, `closing` (Katalog) | „Der **„Wert der Ladesteuerung"** auf der **Kernergebnis-Seite** ist NICHT aus diesen drei Summen gebildet…" | `load_shift` bzw. `savings`-Zeile | N + Z |
| 17 | 254–256 | `monthly_comparison`, `body` | „NICHT enthalten ist der Leistungspreis — er steht als Jahreszahl auf der **Kernergebnis-Seite**" | `peak_shaving` | N |
| 18 | 234–236 | `monthly_comparison`, `figure.caption` | „Die drei Balken eines Monats stehen in derselben Reihenfolge wie **die Zeilen darunter**" | die `rows` DESSELBEN Bausteins | P |
| 19 | 301–303 | Kostenverlauf, `figure.note` | „Der Schnittpunkt liegt bei … — dieselbe Zahl wie **im Kapitel davor**, **hier** als Verlauf." | `recommendation` (Kap. 2) | P |

**⚠ Nr. 18 ist die einzige INNER-Baustein-Kopplung der Liste** und trotzdem ortsgebunden: Bild und
Aufschlüsselung sind ein Paar (`{figure, statement}`), aber „darunter" behauptet die Reihenfolge
Bild→Zeilen, die heute allein `document.tsx` setzt. Sie fällt, sobald Punkt 19 oder 22 aus Block 3
das Kapitel umstellt.

**Positiv-Kontrolle:** Seitenverweis-Muster → **0 Treffer**.
**Fallen:** `:296` „bis dahin rot und **danach** grün" (Farbverlauf im Bild), `:329` „über der
Nulllinie lädt er, **darunter** entlädt er" (Bildgeometrie), `:386` ein Inline-Kommentar — keiner
davon ist ein Querverweis.

### 1.4 `insight.ts` — 0 Fundstellen

**Kein einziger Querverweis im ausgegebenen Text.** Das deckt sich mit
`Report_Baukasten_Instanzen_Verifikation.md` §2.1 („Ohne Querverweis im Text: … `hour_flow`,
`charge_price` …") und ist der Grund, warum die beiden in Stufe C freigegeben werden konnten.

**Positiv-Kontrolle:** `oben|darüber|daneben|Kernergebnis|im Kapitel|vorne|obendrauf` über die
Nicht-Kommentarzeilen → **0 Treffer**. Zweite Kontrolle über alle `„…"`-Literale in
Nicht-Kommentarzeilen → **0 Treffer**.
**Falle:** `:315` „die liegt auf der Ladeseite um den Wirkungsgrad **darunter**" — eine
physikalische Aussage über Energiemengen, kein Ort.
**⚠ Aber:** der Kommentar bei `:368-371` („der Preisvorteil in Euro steht als „Wert der
Ladesteuerung" bereits auf der Kernergebnis-Seite und im Empfehlungs-Kapitel") begründet die
Abwesenheit einer Kopfzahl mit der Anwesenheit zweier fremder Bausteine. Das ist eine **stumme**
Kopplung: sie steht in keinem Text, wirkt aber auf den Inhalt. Sie gehört in §2.4.

### 1.5 `comparison.ts` — 4 Fundstellen

| # | Zeile | Baustein / Feld | Wortlaut (gekürzt) | Ziel | Sorte |
|---|---|---|---|---|---|
| 20 | 334–336 | `addon_table`, `body` | „…die **Spalten „Ersparnis/Jahr" und „Netto"** sind also Differenzen…" | `table_candidates` → Spaltenköpfe (`:190`, `:193`) | Z |
| 21 | 338–339 | `addon_table`, `body` | „…die übrigen stehen als Punkte in der **Kurve darüber**." | Grenznutzen-Bild desselben Kapitels | P |
| 22 | 340–343 | `catalog_alternatives`, `body` | „…derselben Grösse wie die **Kurve darüber** und wie die Empfehlung **im Kapitel „Empfehlung und Lastverlauf"**. Das empfohlene Gerät steht deshalb hier nicht noch einmal: es ist **dort** vollständig aufgeschlüsselt." | Bild + `recommendation` | P + N |
| 23 | 344–346 | `catalog_alternatives`, `body` | „…stehen hier aber nicht je Zeile — sie stehen **beim empfohlenen Gerät**." | `recommendation` | N (ohne Ortswort) |

**⚠ Nr. 22 ist die einzige Stelle im ganzen Katalog, die einen fremden Kapiteltitel WÖRTLICH
ausschreibt** („Empfehlung und Lastverlauf"). Der Titel steht als Datum in
`RECOMMENDATION_SECTION.title` (`content.ts:133 ff.`); das Gegenbeispiel, wie es richtig geht,
existiert bereits: `RESULTS_FOOTNOTE` bildet seinen Kapitelverweis aus
`${METHODOLOGY_SECTION.title}` (`content.ts:390-392`, Ziel `:267`). Das ist der einzige heute schon aufgelöste
Verweis im Dokument — und er steht in einer Fussnote, nicht in einem Baustein.

**Positiv-Kontrolle:** Seitenverweis-Muster → **0 Treffer**.
**Falle:** `:245` „Über der waagrechten Nulllinie rechnet sich ein Gerät …, **darunter** nicht" —
Bildgeometrie.

### 1.6 `basis.ts` — 6 Fundstellen

| # | Zeile | Baustein / Feld | Wortlaut (gekürzt) | Ziel | Sorte |
|---|---|---|---|---|---|
| 24 | 133–135 | `assumptions`, `body` | „Die Tarifgrössen selbst stehen **weiter unten** in der **Tabelle „Tarifkomponenten"**, mit ihrer Herkunft daneben." | `table_tariff_components` | P + N |
| 25 | 288–290 | `tariff_blocker`, `hints[1]` | „Die Empfehlung und **alle Zahlen der vorigen Kapitel** gelten unverändert." | Kapitel 1–7 pauschal | P |
| 26 | 589 | `table_data_sources`, Zelle „Zeitraum / Stand" | „(Slot-Zählung: Messwerte ÷ 96, **wie im Datenqualitäts-Hinweis oben**)" | `data_quality` | P + N |
| 27 | 1039–1041 | `method_current_tariff`, `body` | „Der Leistungspreis steht bewusst nicht darin — er ist die eigene Jahreszahl **weiter vorne** und würde hier ein zweites Mal zählen." | `peak_shaving` (Kap. 1) | P |
| 28 | 1046–1047 | `method_spot_uncontrolled`, `body` | „**Dieselbe Rechnung** über dieselben Viertelstunden, nur tritt an die Stelle …" | `method_current_tariff` | P (ohne Ortswort) |
| 29 | 1186–1188 | `limitations`, `hints[letzter]` | „Die **Tabelle „Tarifkomponenten"** zeigt die erfassten Parameter…" | `table_tariff_components` | N |

**⚠ Nr. 26 ist die einzige Fundstelle, die NICHT in einem `body`/`hints`/`caption` steht, sondern in
einer TABELLENZELLE** (`ReportTableRow.cells[2]`). Jeder Mechanismus, der nur `body` behandelt,
übersieht sie. Sie ist zugleich die einzige, deren **Bedingung** schon heute korrekt am Ziel hängt:
`loadProfileRows(… hasDataQualityNotice)` bekommt durchgereicht, OB der Hinweis im Dokument steht
(`basis.ts:579`, Baukasten C).

**Ebenfalls schon gelöst, als Vorbild zu lesen:** die Titelkopplung `pv_outage` ↔
`method_pv_outage`. Beide beziehen ihren Titel aus **einer** Funktion `pvOutageTitle(months)`
(`basis.ts:346`, benutzt bei `:364` und `:1100`) — statt zwei getrennt gepflegter Literale. Das
ist der Sorte-N-Fall in seiner billigsten Form und braucht keine Registry.

**Positiv-Kontrolle:** Seitenverweis-Muster → **0 Treffer**.
**Fallen:** `:278` „Betroffen ist die **Seite** „…"" — gemeint ist die Tarif-**Seite**
(Netz/Energie), keine Blattseite; `:367` „…gegen null und … **darunter**" (Physik); `:607` „aus
**Stand**ort und Anlagendaten"; `:1051` „es wird nichts versch**oben**". Vier Treffer des
Suchmusters, null Verweise.

### 1.7 Zusammenfassung

| Datei | Fundstellen | davon P | N | Z | A |
|---|---:|---:|---:|---:|---:|
| `summary.ts` | 9 | 8 | – | 4 | 2 |
| `recommendation.ts` | 5 | 2 | 3 | 4 | – |
| `detail.ts` | 5 | 3 | 3 | 1 | – |
| `insight.ts` | 0 | – | – | – | – |
| `comparison.ts` | 4 | 3 | 2 | 1 | – |
| `basis.ts` | 6 | 5 | 3 | – | – |
| **gesamt** | **29** | **21** | **11** | **10** | **2** |

(Mehrfachzählung: eine Fundstelle kann mehrere Sorten tragen.)

**Ziel-Verteilung:** 13 der 29 zeigen auf `savings` oder eine seiner Zeilen, 5 auf
`recommendation`, 3 auf die Kopfzahl, 3 auf `table_tariff_components`, je 1 auf `addon`,
`load_shift`, `peak_shaving`, `data_quality`, `method_current_tariff`, die Kandidatentabelle, die
Grenznutzen-Kurve (2×) und „alle vorigen Kapitel".

---

## 2 — Der Mechanismus

### 2.1 Die Grundentscheidung: getippter Verweis statt Marke in der Zeichenkette

`body` ist heute `string` und wird direkt gerendert (`document.tsx:1048` bzw. `:995`). Zwei Wege:

- **Marke im String** (`'…steckt nicht in {{ref:savings}}…'`), aufgelöst durch eine Funktion vor
  dem Rendern. Billig, aber **untypisiert**: ein Tippfehler in der Kennung wird zu einem sichtbaren
  `{{ref:savngs}}` im ausgelieferten PDF. Genau die Sorte Fehler, gegen die `ReportBaukastenId` als
  Literal-Union angelegt wurde (`registry.ts:93-95`: „ein Tippfehler in einer Kennung ist damit
  ein Compile-Fehler und nicht ein Baustein, den niemand wiederfindet").
- **Getippte Textteile.** `body` wird `ReportText = ReadonlyArray<string | ReportRef>`, gebaut über
  einen Tagged Template, damit die Erzeuger lesbar bleiben:

```ts
body: t`Dieser Betrag steckt NICHT in ${ref('savings')}: der Monatsvergleich führt nur …`
```

**Empfehlung: der zweite Weg.** Er kostet einmalig die Umstellung von sechs Textträgern (s. 2.5),
gibt dafür Compile-Sicherheit über alle 29 Stellen und ist die Voraussetzung dafür, dass eine
Auflösung überhaupt entscheiden kann, WIE sie formuliert (siehe 2.3) — eine Marke im String kann
nur ersetzen, nicht umformulieren.

### 2.2 Was ein Verweis benennen können muss

```ts
export type ReportRef =
  | { kind: 'block';   id: ReportBaukastenId }
  | { kind: 'row';     id: ReportBaukastenId; row: ReportRowKey }
  | { kind: 'column';  id: ReportBaukastenId; column: ReportColumnKey }
  | { kind: 'section'; id: ReportSectionKey }        // SECTION_ID-Werte
  | { kind: 'figure';  id: ReportFigureKey }         // die sieben Rasterbilder
```

Vier davon gibt es heute noch nicht als adressierbare Sache und sie sind die eigentliche Arbeit:

1. **`ReportRow` hat keinen Schlüssel.** `ReportTableRow` hat einen (`key`, `statement.ts:105`), `ReportRow`
   nicht. Zehn Fundstellen (Sorte Z) zeigen auf eine Zeile — heute über ihre Beschriftung als
   Literal. **Auflage: `ReportRow` bekommt ein `key`**, und die Beschriftung wird daraus gelesen
   statt zweitgeschrieben. Das ist derselbe Schritt wie bei `pvOutageTitle` (§1.6), nur über
   Zeilen.
2. **Die Kandidatentabelle hat keine Spaltenschlüssel.** Nr. 20 zeigt auf „Ersparnis/Jahr" und
   „Netto"; die Köpfe stehen als Literal in `buildCandidateTable` (`comparison.ts:191`, `:193`).
   **Auflage: `ReportTableColumn` bekommt ein `key`.**
3. **Die Kopfzahl ist kein Baustein.** Drei Fundstellen (6, 7, 8) zeigen auf `SummaryHeadline`
   (`summary.ts:148`), die in der Registry nicht vorkommt — sie ist kein Statement, kein
   Notice, keine Tabelle, keine Methodik. **Entscheidung nötig:** entweder eine 29. Kennung
   (`headline`, Form `headline`) oder ein eigener Ref-Typ. Die Kennung ist billiger und macht die
   Kopfzahl zugleich für Stufe E adressierbar.
4. **Die Bilder sind keine Bausteine.** Nr. 21/22 zeigen auf die Grenznutzen-Kurve. Sie ist im
   Katalog nicht geführt (`Report_Baukasten_Auswahlschicht_Verifikation.md` §4: „Das Bild ist kein
   Teil des Bausteins"). Für Stufe D reicht ein **eigener, kleiner Schlüsselraum** über die sieben
   Rasterbilder — die Registry deshalb umzubauen wäre Stufe E.

### 2.3 Die Auflösung: was der Resolver kennen muss

Aufgelöst wird **nach der Zusammenstellung, vor dem Rendern**. Der Resolver bekommt eine
Beschreibung des Dokuments, wie es in diesem Lauf tatsächlich aussieht:

```ts
type ReportLayout = {
  /** Steht dieser Baustein in diesem Dokument? Registry-`build() !== null` UND Auswahl UND Kapitel-Schalter. */
  present: (id: ReportBaukastenId) => boolean
  /** Leseposition — laufende Nummer über die tatsächlich gerenderte Reihenfolge. */
  orderOf: (id: ReportBaukastenId) => number | null
  /** In welchem Kapitel er steht. */
  sectionOf: (id: ReportBaukastenId) => ReportSectionKey | null
  /** Der Titel, wie er im Dokument steht — Baustein, Zeile, Spalte, Kapitel. */
  titleOf: (ref: ReportRef) => string | null
}
```

Daraus bildet der Resolver je Verweis die Formulierung:

| Fall | Auflösung |
|---|---|
| Ziel im selben Kapitel, **vor** dem Verweis | „oben" / „darüber" |
| Ziel im selben Kapitel, **nach** dem Verweis | „weiter unten" |
| Ziel in einem **früheren** Kapitel | „im Kapitel „<Titel>"" (Titel aus `content.ts`, nie als Literal) |
| Ziel in einem **späteren** Kapitel | „im Kapitel „<Titel>"" — dieselbe Form, damit kein „weiter hinten" entsteht, das eine Seitenzahl suggeriert |
| Ziel ist eine **Zeile/Spalte** | „die Zeile „<Beschriftung>"" + die Ortsangabe des tragenden Bausteins |
| Ziel **nicht vorhanden** | s. 2.4 |

**⚠ Die Ortswörter werden damit erzeugt und nicht mehr geschrieben.** Ein Erzeuger darf nach Stufe D
kein „oben" mehr im Fliesstext tragen — das ist die Regel, die den Zustand hält, und sie ist
maschinell prüfbar (s. 2.6).

### 2.4 Abwesenheit ist der härtere Teil — und er ist nicht mit Textersetzung zu lösen

Ein fehlendes Ziel darf **nicht** dazu führen, dass nur der Verweis verschwindet: der Restsatz
behauptete dann etwas anderes. Beispiel Nr. 2 — fiele `savings` weg, bliebe „Dieser Betrag ist in
der Gesamtersparnis bereits als erste Zeile enthalten und kommt nicht zusätzlich obendrauf"
stehen und verwiese auf nichts.

**Deshalb: der Verweis trägt seine Alternative mit.**

```ts
ref('savings', { absent: null })        // fällt der Satz weg, der ihn trägt
ref('savings', { absent: '…' })         // Ersatzformulierung für denselben Satz
```

und für ganze Satzteile ein Prädikat statt eines Platzhalters:

```ts
const relation = present('savings')
  ? t`Dieser Betrag steckt NICHT in ${ref('savings')}: …`
  : ''
```

**⚠ Das ist genau die Form, die heute schon existiert** — nur dass die Bedingung heute
`savingsIsRealComparison` heisst und eine andere Frage beantwortet (s. §3). Der Umbau ersetzt eine
FACHLICHE Verzweigung durch eine über die Dokument-Zusammenstellung; er erfindet keine neue
Mechanik.

**Zwei Fundstellen der Sorte A (Nr. 8, 9) sind der Sonderfall:** sie sagen ausdrücklich, dass ein
Baustein FEHLT („weist der Report keine Leistungspreis-Ersparnis aus"). Sie sind damit `!present`-
Sätze und müssen bei `present('peak_shaving') === true` verschwinden — heute tun sie das nicht,
weil die Bedingung dieselbe ist, die auch die Ersparnis verhindert (Engine-Blocker
`estimated_pv`/`standard_profile`). Das hält, solange niemand `peak_shaving` abwählen kann. **Sobald
Stufe D das ermöglicht, ist die Bedingung an `present` zu hängen, nicht an den Blocker** — sonst
sagt der Report, er zeige etwas nicht, das eine Seite höher steht.

### 2.5 Sechs Textträger, nicht einer

Der Mechanismus muss alle Stellen erreichen, an denen die 29 Verweise stehen:

| Träger | Typ | betroffene Fundstellen |
|---|---|---|
| `ReportStatement.body` | `string` → `ReportText` | 1–5, 10, 12–17, 20–23, 24, 27, 28 |
| `ReportStatement.notes[]` | `string[]` → `ReportText[]` | (heute keiner — aber derselbe Träger) |
| `ReportNotice.body` | `string` → `ReportText` | 6, 7, 8 |
| `ReportNotice.hints[]` | `string[]` → `ReportText[]` | 9, 25, 29 |
| `ReportFigure.caption` / `.note` | `string` → `ReportText` | 18, 19 |
| `ReportTableRow.cells[]` | `string[]` → `ReportText[]` | **26** |

**⚠ Der letzte ist der leicht zu vergessende.** Ein Plan, der nur `body` umstellt, deckt 24 von 29
Stellen ab und lässt ausgerechnet die eine liegen, die schon einmal ins Leere zeigte (PR #273).

### 2.6 Der Wächter, der den Zustand hält

Nach der Umstellung ist die Regel maschinell prüfbar und gehört als Test in `apps/website`:

```
kein Ortswort in ausgegebenem Text — über alle sechs Kapitel-Erzeuger:
  grep -v Kommentarzeilen | grep -E "oben|darüber|daneben|weiter unten|weiter vorne|
    im Kapitel|Kernergebnis-Seite|in den Kernergebnissen"  →  0 Treffer
```

**⚠ Der Wächter trifft seine eigene Verneinung.** Die vier Fallen aus §1 (`Standort`,
`verschoben`, `Seite` als Tarifseite, `darunter` als Physik) lassen ein naives Muster anschlagen.
Er ist deshalb entweder auf ganze Wörter (`\b`) einzugrenzen oder — besser — **nicht auf den
Quelltext, sondern auf die erzeugten Objekte** zu setzen: über die fünf Referenzfälle aus
`registry.test.ts` alle 28 `build()` aufrufen und die noch nicht aufgelösten `ReportText`-Teile
prüfen. Ein Verweis, der in diesem Lauf nicht auflösbar ist, ist dann ein Testfehler und kein
Fund im PDF.

### 2.7 Keine Seitenzahlen im Fliesstext — eine bindende Auflage

Die Versuchung liegt nahe: „steht auf Seite 4" wäre die präziseste Auflösung. **Sie ist hier nicht
baubar, und der Grund ist gemessen.**

`page-numbers.ts` beschreibt den Zwei-Pass-Mechanismus und seine drei am 03.09.2026 gemessenen
Aufbauten. Aufbau C ist der entscheidende: **Sentinels für Unterpunkte innerhalb einer
umbrechenden `<Page>` melden alle dieselbe Zahl** — ein Baustein ist also gar nicht seitengenau
messbar, nur ein Kapitel. Dazu kommt die Rückkopplung: eine aufgelöste Seitenzahl im Fliesstext
ändert die Zeilenlänge, damit den Umbruch, damit womöglich die Seite, auf die sie zeigt.
`measurementsAgree` **erkennt** das (und liefert dann ohne Zahlen aus), **löst** es aber nicht.

**Auflage: die Auflösung geschieht VOR dem ersten Messlauf und kennt keine Seitenzahlen.**
Reihenfolge und Kapitelzugehörigkeit stehen zu diesem Zeitpunkt fest; Seitenzahlen bleiben, wo sie
heute sind — in der Agenda. Damit ist Stufe D **unabhängig von der Agenda-Entscheidung** (Block 3
Nr. 24).

---

## 3 — `buildPeakShaving` / `buildLoadShift`: die Datenabhängigkeit

### 3.1 Was heute wirklich gekoppelt ist

`buildSavings` liefert `{ statement, isRealComparison }` (`summary.ts:187`, Rückgaben `:247`/`:299`); derselbe Wert
entsteht report-weit einmal als `context.isRealSavingsComparison` (`context.ts`) und stammt aus der
exportierten Ableitung `isRealSavingsComparison(analysis)` (`summary.ts:179`). Er geht als
dritter Parameter in `buildPeakShaving` (`summary.ts:310`) und `buildLoadShift`
(`summary.ts:364`); `buildLoadControl` in `recommendation.ts:261` leitet ihn selbst ab, weil
dort kein `entry` vorliegt.

**Das ist keine Textersetzung, sondern eine Abhängigkeit vom INHALT eines fremden Bausteins.** Der
Kommentar bei `summary.ts:788-792` sagt ausdrücklich, warum der Wert als Rückgabewert reist und
nicht aus einer Zeilenbeschriftung zurückgelesen wird: „eine Umformulierung [würde sie] still
umdrehen".

### 3.2 Der Fehler, den der boolesche Wert nach Stufe D macht

Er beantwortet **eine** Frage („Kassen-Fassung oder §3.7-Aufschlüsselung?"), wird aber für **drei**
benutzt:

| Verwendung | Tatsächliche Frage | Fundstellen |
|---|---|---|
| `relation` | Ist der Leistungspreis in der Kopfzahl von `savings` bereits enthalten? | 1, 2 |
| `reconcile` / `embeddedNote` | Gibt es eine Zeile „Wert der Ladesteuerung", auf die ich zeigen kann? | 3, 4, 12, 13 |
| `selfConsumptionNote` | Gibt es eine Zeile „Eigenverbrauch", auf die ich zeigen kann? | 5, 14 |

Die erste ist eine **fachliche** Frage über den Inhalt (sie bleibt richtig, auch wenn `savings` an
einer anderen Stelle steht). Die zweite und dritte sind **Existenzfragen über Zeilen** — und die
haben nach Stufe D einen dritten Zustand, den ein `boolean` nicht ausdrücken kann: **`savings`
steht gar nicht im Dokument.** Dann ist `false` die falsche Antwort, weil der `false`-Zweig auf die
§3.7-Zeilen zeigt, die es ebenfalls nicht gibt.

### 3.3 Vorschlag

**Den `boolean` durch eine Beschreibung der tatsächlich platzierten Fassung ersetzen**, gebildet
an derselben Stelle wie heute (Kontext), aber aus der Zusammenstellung statt allein aus `analysis`:

```ts
export type SavingsPlacement =
  | { kind: 'cash' }          // Kassen-Fassung: rows = tariff_switch | control_value | total
  | { kind: 'attribution' }   // §3.7: rows = peak | self_consumption | load_shift | total
  | { kind: 'absent' }        // kein primärer Block, oder abgewählt
```

Damit:

- **`relation`** verzweigt weiter fachlich an `kind` — `'cash'` heisst „Leistungspreis nicht
  enthalten", `'attribution'` heisst „erste Zeile", `'absent'` heisst: den Satz gibt es nicht.
- **`reconcile`, `embeddedNote`, `selfConsumptionNote`** verzweigen **nicht mehr an `kind`**,
  sondern am Verweis selbst: `ref({ id: 'savings', row: 'control_value' }, { absent: … })`. Der
  Resolver weiss aus `SavingsPlacement`, ob es die Zeile gibt, und wählt Text oder Alternative.
  Dass die Kassen-Fassung eine Zeile `control_value` hat und die §3.7-Fassung nicht, ist dann eine
  Eigenschaft der Zeilen und steht nur noch an einer Stelle — **`buildSavings` selbst**.
- **`recommendation.ts` hört auf, es selbst abzuleiten.** `isRealSavingsComparison(analysis)` bei
  `recommendation.ts:261` ist nach Stufe D falsch, sobald die Auswahl `savings` entfernen kann: die Ableitung sagt
  „Kassen-Fassung", das Dokument zeigt nichts. Der Wert kommt aus dem Kontext, wie überall sonst.

**⚠ Die Reihenfolge des Baus ist dadurch festgelegt:** `SavingsPlacement` muss **vor** der
Umstellung der Texte stehen, sonst bekommen die Verweise einen Zustand geliefert, den sie nicht
unterscheiden können.

### 3.4 Zwei weitere Datenabhängigkeiten derselben Art (heute folgenlos, nach Stufe D nicht)

- **`load_control` → `load_shift`** (Fundstelle 11): der Hochrechnungssatz nennt „die Zahl auf der
  Kernergebnis-Seite". Beide hängen heute an `computable === true` **und** an einem primären Block
  und erscheinen deshalb immer gemeinsam. Sobald einer von beiden abwählbar wird, ist das eine
  echte Kopplung — sie gehört als `present('load_shift')` formuliert, nicht als geteilte Bedingung.
- **`hour_flow`/`charge_price` → `load_shift` + `recommendation`** (`insight.ts:368-371`,
  **Kommentar**): die Abwesenheit der Kopfzahl ist mit der Anwesenheit zweier fremder Bausteine
  begründet. Es steht kein Text im Weg, aber die Begründung fällt, wenn beide Ziele abgewählt sind
  — dann fehlt der Betrag im ganzen Dokument. **Keine Textarbeit; ein Punkt für die Prüfliste.**

---

## 4 — Abgleich mit der Optik-Bestandsaufnahme, Block 3

Block 3 sind die sieben strukturellen Punkte Nr. 18–24 (§7 „Zuletzt — Struktur"). §8 desselben
Berichts sagt bereits, warum sie hinten stehen: „Jede Umstellung aus §7 Nr. 18–22 verschiebt
Bausteine zwischen Kapiteln und berührt sie damit."

| Nr. | Punkt | Was Stufe D direkt abdeckt | Was eigene Arbeit bleibt |
|---|---|---|---|
| **18** | `addon`/`addon_none` als Verdikt; **Doppelung Kap. 1 ↔ Kap. 6 auflösen** | **Die Doppelung, vollständig.** Fundstelle 10 (`recommendation` → `addon`) und 22/23 (`catalog_alternatives` → `recommendation`) sind nach Stufe D id-basiert; `addon` wird damit verschiebbar und abwählbar — genau die Sperre aus `…Auswahlschicht_Verifikation.md` §2.2. | Die **Form**: grosses „Ja"/„Nein" + Betrag ist ein neuer Renderer bzw. ein neues Feld an `ReportStatement`. Und die Entscheidung, WELCHE der beiden Fassungen bleibt (`addon` in Kap. 1 oder `addon_none` in Kap. 6) — eine fachliche, keine technische. |
| **19** | PV-Befund als eigenes Kapitel | **Die Titelkopplung** `pv_outage` ↔ `method_pv_outage` ist bereits über `pvOutageTitle` gelöst (§1.6); die Bedingungskopplung „am HINWEIS gemessen" (`basis.ts:1137`) trägt einen Kapitelwechsel unverändert, weil sie eine Bedingung und keine Position ist. Stufe D fügt nichts hinzu — **der Befund hat keinen ausgehenden Verweis.** | Alles Übrige: neues Kapitel (`ReportSection`, Agenda-Eintrag, eigene `<Page>` nach `page-numbers.ts` Regel 1), zwei Diagramme, Kennzahlenstreifen, ein neuer Kapitel-Schalter. **⚠ Und ein neuer bedingter Kapitel-Schalter muss die Stufe-C-Auswahl kennen** — sonst entsteht das leere Kapitel aus `…Auswahlschicht_Verifikation.md` §4. |
| **20** | `recommendation` als nummerierte Handlungsliste | **Die fünf eingehenden Verweise** (10, 11, 19, 22, 23). Zwei davon sind heute besonders fragil: Nr. 22 schreibt den Kapiteltitel wörtlich aus, Nr. 23 nennt das Ziel gar nicht („beim empfohlenen Gerät"). Nach Stufe D überstehen beide eine Umgestaltung. | Die Form selbst: nummerierte Liste mit Teal-Ziffern ist Renderer + ein Listen-Feld, das `ReportStatement` nicht hat. |
| **21** | Voraussetzungs-Seite **vorn** (Anlagedaten stehen heute hinten in `assumptions`) | **Der Kern des Punktes.** Er dreht die Leserichtung: Fundstelle 24 („weiter **unten** in der Tabelle „Tarifkomponenten"") und 27 („die eigene Jahreszahl weiter **vorne**") werden durch das Vorziehen **falsch**. Genau diese Umkehr ist das, was der Resolver automatisch richtig stellt. | Die neue Seite, ihr Inhalt und die Entscheidung, was aus `assumptions` **wegzieht** und was bleibt (eine geteilte Annahmen-Liste wäre dieselbe Zahl an zwei Orten). |
| **22** | Jahres-Hochrechnungs-Seite | **Der bedingte Punkt in `limitations`** (`basis.ts:1176`) ist heute bewusst an `analysis.annualProjection` gehängt, „damit der Satz am Tag der Verdrahtung von selbst entsteht". Nach Stufe D hängt er richtiger an `present('annual_projection')` — an der Anwesenheit der Seite, nicht am Vorhandensein der Zahl. | Die Seite, ihre Bausteine, die Verdrahtung des Contract-Feldes in die Übergabe (im Code als D4/D10 benannt). |
| **23** | Anhang-Gliederung mit nummerierten Abschnitten „1. … 4." | **Die Regel.** Eine Nummerierung erzeugt sofort neues Ortsvokabular („siehe Abschnitt 3"). Stufe D legt fest, dass solche Nummern **erzeugt und nie geschrieben** werden — sonst entsteht genau die Bindung wieder, die Stufe D auflöst. | Die Gliederung selbst, die eigene Anhang-Textgrösse (8,3 pt) und die Frage, ob die Nummern in die Agenda gehören (`page-numbers.ts` Regel 2: Unterpunkte bekommen **keine** Seitenzahl). |
| **24** | Agenda — behalten oder nicht (Entscheidung, nicht Umsetzung) | **Nichts, und das ist Absicht.** Durch die Auflage aus §2.7 (keine Seitenzahlen im Fliesstext) berührt Stufe D den Zwei-Pass-Mechanismus nicht. Die Entscheidung kann vorher oder nachher fallen. | Die Entscheidung selbst — sie wiegt `measurementsAgree` und den Zwei-Pass-Aufwand gegen den Nutzen einer gedruckten Agenda. |

### 4.1 Der Satz, auf den es beim Abgleich ankommt

**Stufe D deckt von Block 3 keinen einzigen Punkt vollständig ab — sie macht fünf von sieben (18,
20, 21, 22, 23) überhaupt erst gefahrlos baubar.** Bei Nr. 19 leistet sie nichts, weil der PV-Befund
zufällig keinen ausgehenden Verweis trägt; bei Nr. 24 ist sie durch die Auflage aus §2.7
absichtlich unbeteiligt.

Die Reihenfolge, die daraus folgt: **Stufe D vor 18/20/21/22/23.** Nr. 19 und Nr. 24 sind
unabhängig und können jederzeit.

---

## 5 — Vorgeschlagene Bauabschnitte

1. **D-1 — Adressierbarkeit.** `ReportRow.key`, `ReportTableColumn.key`, die Kopfzahl als 29.
   Kennung, ein Schlüsselraum über die sieben Bilder. Kein Text angefasst. Prüfbar über
   `registry.test.ts` (unveränderte Werte) plus je einen Test pro neuem Schlüssel.
2. **D-2 — `SavingsPlacement`.** Der `boolean` fällt, `recommendation.ts` hört auf, selbst
   abzuleiten. Immer noch kein Verweis umgestellt — nur die Verzweigung bekommt ihren dritten
   Zustand. (§3)
3. **D-3 — `ReportText` und der Resolver.** Die sechs Textträger, `ReportLayout`, die Auflösung vor
   dem ersten Messlauf. Umgestellt werden die 29 Fundstellen in einem Zug, weil ein halb
   umgestellter Träger zwei Formen desselben Verweises nebeneinander hätte.
4. **D-4 — Der Wächter.** Auf den erzeugten Objekten, nicht auf dem Quelltext (§2.6).
5. **D-5 — Die Freigabe.** `addon` und `table_candidates` in die Stufe-C-Auswahl aufnehmen; das
   ist der Nachweis, dass Stufe D wirkt (`…Auswahlschicht_Verifikation.md` §2.2 nennt genau diese
   zwei als gesperrt).

---

## 6 — Offene Entscheidungen, die vor D-3 zu treffen sind

- **Wie heisst ein Kapitel, das NACH dem Verweis kommt?** „im Kapitel „X"" ist vorgeschlagen (§2.3),
  weil „weiter hinten" eine Seitenzahl suggeriert, die es im Fliesstext nicht gibt. Alternative:
  gar kein Verweis nach vorn — dann müssten Nr. 24 („weiter unten in der Tabelle
  „Tarifkomponenten"") und die durch Punkt 21 umgedrehten Verweise anders formuliert werden.
- **Was wird aus Fundstelle 25** („alle Zahlen der **vorigen Kapitel** gelten unverändert",
  `basis.ts:288-290`)? Sie zeigt auf keinen Baustein, sondern auf „alles davor". Aufgelöst über
  `orderOf` ergäbe sie eine Aufzählung, die niemand lesen will. Vorschlag: **unverändert lassen und
  als bewusste Ausnahme kennzeichnen** — sie ist richtig, solange der Blocker-Hinweis im letzten
  Kapitel steht, und das ist eine Eigenschaft, die der Wächter prüfen kann
  (`sectionOf('tariff_blocker') === SECTION_ID.basis`).
- **Bleibt Nr. 18** („wie die Zeilen darunter", `detail.ts:234-236`) ein Verweis, oder wird das
  Bild-Aussage-Paar als **eine** Einheit deklariert? Das Zweite wäre ehrlicher (sie entstehen aus
  einer Funktion und werden immer zusammen gerendert), verlangt aber einen Paar-Typ, den die
  Registry heute nicht kennt.
- **Trägt der Resolver die Auflösung ins Archiv?** `platform.analyses` friert `inputs`/`result` ein,
  nicht den gerenderten Report (D11 ist nicht gebaut). Solange das so bleibt, ist die Frage offen;
  sobald D11 kommt, ist der **aufgelöste** Text zu archivieren und nicht die Vorlage — sonst läse
  eine Wiedergabe 2027 die Ortsangaben einer Dokumentfassung, die es dann nicht mehr gibt.

---

## 7 — Was dieser Plan ausdrücklich nicht sagt

- **Nichts über die Optik.** Block 3 ist nicht angefasst; §4 ordnet nur zu, was Stufe D davon
  ermöglicht.
- **Nichts über eine KI-Auswahl.** Sie braucht zusätzlich eine content-lose Eignungs-Schicht, die
  die Registry bewusst nicht hat (`registry.ts:62-70`). Stufe D ist ihre Voraussetzung, nicht ihr
  Anfang.
- **Nichts über die Reihenfolge-Freiheit in der Oberfläche.** Stufe D macht die Texte
  ortsunabhängig; wer die Reihenfolge wählen darf und wo diese Wahl reist, ist eine eigene Frage
  (`…Auswahlschicht_Verifikation.md` §5: als WERT in der Übergabe, nicht als Verweis).
- **Nichts über die Kapitel-Doppelreihenfolge.** `buildReportAgenda` (`content.ts:352`) und der
  JSX-Seitenbaum (`document.tsx`) führen die Reihenfolge zweimal, von Hand synchron gehalten. Der
  Resolver braucht **eine** Leseordnung; welche der beiden Listen sie liefert — oder ob die
  Doppelung vorher aufzulösen ist — ist vor D-3 zu entscheiden und in diesem Plan bewusst offen
  gelassen.
