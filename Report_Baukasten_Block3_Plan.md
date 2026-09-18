# Report-Baukasten Block 3 — Plan: die fünf strukturellen Bausteine

> Erstellt am 18.09.2026 am Stand von `main` (`af0f26f`). **Kein Produktivcode geändert, keine
> Umsetzung.**
>
> **Gegenstand:** die fünf Bausteine, die `Report_Baukasten_Optik_Bestandsaufnahme.md` §6
> („Antwort auf die Leitfrage") als strukturelle Fälle nennt und §7 Block 3 als Nr. 18–20 führt:
> `addon`, `addon_none`, `recommendation`, `pv_outage`, `table_candidates`.
> **Nicht Gegenstand:** §7 Nr. 21–24 (Voraussetzungs-Seite, Jahres-Hochrechnung, Anhang-Gliederung,
> Agenda-Entscheidung).
>
> **Vorgelagert:** `Report_Baukasten_Optik_Bestandsaufnahme.md` (Stand 18.09., Commit `0ca5d31`) ·
> `Report_Baukasten_Stufe_D_Plan.md` §4 · `Report_Baukasten_Instanzen_Verifikation.md` §2.1
> (Kantenbenennung A–W).
>
> **⚠ Warum dieser Plan überhaupt nötig war:** die Optik-Bestandsaufnahme hat am Stand `0ca5d31`
> gemessen. Seither liegen **fünf Commits auf dem Report** — D15 Block 1 (`f02e169`), D15 Block 2
> (`a00759d`) und die drei Stufe-D-Schritte (`6df6b56`, `8e23b9d`, `5973b4f`). **Drei der fünf
> Ist-Befunde sind dadurch überholt** (§1). Übernommen wurde hier keiner; jeder ist am Code von
> heute neu belegt.
>
> **⚠ Eine Grenze dieses Plans, ausdrücklich benannt:** das Zielbild
> (`Urbanz_Wirtschaftlichkeitsanalyse V2.pdf`) liegt seit `b40e45c`/`af0f26f` nicht mehr im
> Arbeitsverzeichnis und ist als Klasse aus dem Repo ausgeschlossen. Die SOLL-Seite ist deshalb
> aus `Report_Baukasten_Optik_Bestandsaufnahme.md` zitiert und **nicht** nachgemessen. Die
> IST-Seite ist durchgehend am Code gemessen.

---

## 1 — Ist/Soll je Baustein, neu gemessen

| # | Baustein | Optik-Befund 18.09. (`0ca5d31`) | Stand heute (`af0f26f`) | Rest-Aufgabe |
|---|---|---|---|---|
| 4 | `addon` | „Titelzeile 9,5 + Absatz, kein Verdikt, keine Zahl" | **Titel ist 11,5** (Block 1), Verdikt und Zahl fehlen weiterhin | Verdikt-Form + Doppelung |
| 14 | `addon_none` | „dasselbe wie 4; Klarsatz steht zweimal" | **Doppelung gemessen und bestätigt** (unten) | dieselbe Entscheidung wie 4 |
| 9 | `recommendation` | „Zielbild setzt Empfehlungen als nummerierte Liste" | unverändert; **die Zuordnung selbst ist strittig** (unten) | Inhaltsfrage vor Formfrage |
| 21 | `pv_outage` | „ganze Seite mit zwei Diagrammen … der grösste Einzelunterschied" | unverändert; **die Datengrundlage dafür gibt es nicht** (unten) | zurückstellen, s. §2 |
| 17 | `table_candidates` | „ohne Navy-Kopfzeile und ohne Zebra" | **beides gebaut** (Block 1 Punkt 4) | nur noch die Freigabe |

### 1.1 `addon` (`summary.ts:504`) — der Titel stimmt schon, das Verdikt fehlt

Der Optik-Befund nennt „Titelzeile **9,5**". Das ist überholt: `statementTitle` liest seit Block 1
über `PDF_TYPE.h3`, und der Token steht auf **11,5** (`theme.ts:306`, `document.tsx:411`). Punkt 8
der Kurzliste ist damit für diesen Baustein erledigt.

**Offen ist der Rest, und der ist grösser als „eine Schriftgrösse":**

- Der Negativ-Zweig (`summary.ts:512-526`) trägt `amount: null` und einen reinen `string`-Körper —
  kein Betrag, keine Auszeichnung, kein Verdikt.
- Der Positiv-Zweig (`summary.ts:527-557`) trägt eine Kopfzahl, aber über `styles.statementAmount`
  mit **15 pt** (`document.tsx:413`). Das Zielbild verlangt 27 pt in `#B91C1C` bzw. `#15803D`.
- `ReportStatement` (`statement.ts:66-82`) kennt kein Verdikt-Feld. Die 27-pt-Form existiert im
  Dokument genau einmal (`styles.headlineValue`, `document.tsx:400`) und ist an die zweispaltige
  Kopfzahl von Kapitel 1 gebunden (`document.tsx:1236-1245`). **Ein neues Feld plus ein neuer
  Renderer** — das ist der eigentliche Umfang von Nr. 18.

### 1.2 `addon_none` (`comparison.ts:276`) — die Doppelung ist gemessen, nicht vermutet

Gemessen an einem Fall mit Bestandsanlage und **einem** Zusatzszenario mit
`netSavingOverHorizon < 0` (die Bedingung, unter der beide Bausteine entstehen:
`registry.ts:299` für `addon`, `registry.ts:357-359` für `addon_none`, `comparison.ts:409-414` für
`shown.length === 0`):

| | `addon` (Kap. 1) | `addon_none` (Kap. 6) |
|---|---|---|
| Titel | „Ein zusätzlicher Speicher lohnt sich derzeit nicht" | **wortidentisch** |
| Körper | 3 Sätze | 5 Sätze — **Satz 1, 2 und 4 wortgleich** mit `addon` |

Beide stehen **im selben Dokument**, und beide tragen **dieselbe Überschrift**. Der Code weiss das
und begründet es (`comparison.ts:269-274`: „Die Kernergebnis-Seite trägt eine gekürzte Fassung
derselben Feststellung; hier steht sie vollständig"). Das Zielbild setzt den Befund **einmal**
(Zielseite 10).

**⚠ Die Entscheidung, welche Fassung bleibt, ist fachlich und nicht technisch** — und sie hat eine
Folge, die man ihr nicht ansieht: `addon` steht in **Kapitel 1**, dem **einzigen** Kapitel mit
einem Verweisnamen (`content.ts:138-143`). Was aus Kapitel 1 herauswandert, verliert die
Nennbarkeit. S. §4.

### 1.3 `recommendation` (`recommendation.ts:99 ff.`) — die Zuordnung der Bestandsaufnahme ist in sich uneins

**Das ist der Befund, der nicht übernommen werden darf.** Die Optik-Bestandsaufnahme ordnet
Zielseite 11 an zwei Stellen **verschieden** zu:

- §3 (Seitentabelle): Zielseite 11 → **„Kapitel 7 Methodik & Vorbehalte (6 feste
  `METHODOLOGY_ITEMS`)"**, Befund „es gibt keine Handlungsempfehlungs-Liste".
- §5 Nr. 9 und §7 Nr. 20: Zielseite 11 → **`recommendation`**, Befund „zwei verschiedene
  Darstellungsideen".

Am Code ist die Sache eindeutig: `recommendation` beantwortet **„welches Gerät und was kostet
es"** — Kopfzahl ist die Amortisation (`recommendation.ts:176-180`), die Zeilen sind Investition,
Jahresersparnis und Netto über den Horizont (`recommendation.ts:110-136`). Eine Liste „Was wir
vorschlagen" beantwortet **„was tun Sie als Nächstes"**. Das ist kein anderes Aussehen desselben
Bausteins, sondern ein zweiter Baustein mit Inhalt, den **kein Contract-Feld liefert**.

**Folgerung:** Nr. 20 zerfällt in zwei Dinge, und nur das erste ist Optik.

- **20a — die Form.** Eine nummerierte Liste mit Teal-Ziffern ist ein Feld an `ReportStatement`
  (das heute `rows` und `notes` kennt, aber keine geordnete Liste — `statement.ts:66-82`) plus ein
  Renderer. Baubar, sobald jemand sie braucht.
- **20b — der Inhalt.** Vier Handlungspunkte sind eine **redaktionelle** Frage (wie der
  Fragenkatalog in B24). Sie gehört nicht in einen Optik-Bauabschnitt und ist ohne Vorgabe von
  Andreas/Martin nicht entscheidbar.

`recommendation` selbst in eine Handlungsliste **umzubauen** wäre der falsche Schluss aus dem
Befund: dann stünde die Gerätewahl nirgends mehr.

### 1.4 `pv_outage` (`basis.ts:359`) — die Zielseite ist heute nicht baubar

Der Befund („eine ganze Seite mit zwei Diagrammen, einem Kennzahlenstreifen und einem
Amber-Kasten") steht unverändert. Was sich seit dem 18.09. geändert hat, ist das **Wissen darüber,
warum er offen ist** — D15 Block 2 hat ihn beim Bauen gestreift und abgelegt (Commit `a00759d`,
Punkt 16 nicht gebaut: „wir haben kein PV-Monatsdiagramm, der PV-Befund ist ein Hinweis").

Drei Messungen am Code, die zusammen die Aussage tragen:

1. **Es gibt keine Monatsreihe zum Zeichnen.** `PvOutageMonth`
   (`packages/engine/src/pv-anomaly/outage-months.ts:84-98`) trägt `year`, `month`,
   `daysWithDayWindowData` und `minDayWindowKw` — und `detectPvOutageMonths` liefert
   **ausschliesslich die betroffenen Monate** (`:164-166`, `filter(minKw >= PV_NEAR_ZERO_KW)`). Ein
   Zwölf-Monats-Diagramm mit „Ausfall"-Marke an den Nullmonaten braucht die **unauffälligen**
   Monate genauso — die kennt der Report nicht.
2. **Das zweite Diagramm ist ausdrücklich verboten.** Ein Kostendiagramm zum PV-Ausfall ist der
   entgangene Ertrag in Euro, und dazu steht eine Auflage im Code selbst
   (`basis.ts:342-347`): „HIER STEHT KEIN ENTGANGENER ERTRAG IN EURO … eine hier hingeschriebene
   Hausnummer wäre genau die Zahl aus anderer Grundlage, vor der Delta 15 warnt". Das ist kein
   Optik-Schritt, sondern eine PV-Gegenrechnung — ein eigener Baustein mit Erzeugungsmodell.
3. **Die Form trägt kein Kapitel.** `ReportNotice` (`statement.ts:166-190`) hat `body: string`,
   kein `figure`, keine `rows` und **keinen `ReportText`** — ein Hinweis kann nicht einmal einen
   Querverweis tragen. Ein Kapitel, dessen ganzer Inhalt dieser eine Kasten ist, wäre genau der
   Fall, gegen den `hasComparisonChapter` argumentiert (`comparison.ts:112-118`, D14: „ein
   Agenda-Eintrag auf eine Seite, die nur sagt, dass sie leer ist").

**Folgerung: Nr. 19 gehört nicht in Block 3.** Was heute baubar wäre (ein Kapitel um einen
Warnkasten), ist schlechter als der Ist-Zustand. Was das Zielbild zeigt, braucht vorher
Engine-Arbeit. Die Kapitelfrage ist trotzdem zu beantworten, weil sie die Reihenfolge bindet — §2.

### 1.5 `table_candidates` (`comparison.ts:182`) — der Optik-Befund ist erledigt, die Aufgabe eine andere

„Ohne Navy-Kopfzeile und ohne Zebra" ist **überholt**. D15 Block 1 Punkt 4 hat beides gebaut, und
zwar an der einen Rendering-Stelle, durch die alle drei Tabellen laufen:
`styles.tableHeader` mit `backgroundColor: PDF_COLORS.ink` und weisser Schrift
(`document.tsx:463-488`), Zebra über die Datenzeilen (`document.tsx:483`, Zähler
`document.tsx:1168`). **Die Tabellenoptik dieses Bausteins entspricht dem Zielbild.**

Was für `table_candidates` aus Block 3 übrig bleibt, steht nicht in der Optik-Bestandsaufnahme,
sondern im Stufe-D-Plan §5 als **D-5**: die Aufnahme in die Stufe-C-Auswahl. Sie war gesperrt,
weil ein Satz nebenan die Spalten beim Namen nennt; dieser Satz ist seit `8e23b9d` migriert
(`comparison.ts:347-351`, `column(CANDIDATE_TABLE_ID, 'saving_per_year')`).
`REPORT_OPTIONAL_SECTIONS` führt die Tabelle weiterhin nicht
(`packages/shared/src/report-sections.ts:25-30`: `hour_flow`, `charge_price`, `data_quality`,
`pv_outage`).

**⚠ Und die Freigabe ist mit dem migrierten Verweis NICHT fertig — das ist der Fund dieses
Abschnitts.** Beide Konsumenten der Tabelle tragen **weitere** Sätze über sie, die **nicht** in
einem `ref` stehen:

| Fundstelle | Satz | Was ohne Tabelle daraus wird |
|---|---|---|
| `comparison.ts:351` (`addon_table`) | „**Gezeigt sind die Geräte**, die ihre Anschaffung im Betrachtungszeitraum wieder einspielen; die übrigen stehen als Punkte in der Kurve darüber." | Gezeigt ist gar nichts. |
| `comparison.ts:365` (`catalog_alternatives`) | „**Diese Tabelle** sagt, was die Alternativen dagegen leisten" · „stehen hier aber **nicht je Zeile**" | Verweis auf eine Tabelle, die es nicht gibt. |

Der bestehende Prüflauf misst nur den Spaltensatz (`report-text.test.ts:421-449`) und bliebe grün.

**Dazu ein zweiter Punkt am Renderpfad:** die Tabelle kommt in `ComparisonChapter` aus
`buildComparisonChapter` und nicht aus der Registry (`document.tsx:1731-1733`) — die Auswahl
erreicht sie heute überhaupt nicht. Es gibt `selectedStatement` und `selectedNotice`
(`document.tsx:1594-1613`), aber **kein `selectedTable`**.

---

## 2 — `pv_outage` als eigenes Kapitel: bedingt oder unbedingt?

### 2.1 Es kann nur bedingt sein, und zwar aus zwei unabhängigen Gründen

1. **Datenlage.** `buildPvOutage` liefert `null`, wenn keine PV angegeben ist oder kein Monat
   erkannt wurde (`basis.ts:359-364`). Ohne Anlage ist ein fehlender Mittagseinbruch kein Befund.
2. **Admin-Auswahl.** `pv_outage` ist einer der vier abwählbaren Bausteine
   (`packages/shared/src/report-sections.ts:25-30`), gefiltert an der Quelle durch
   `pvOutageNoticeOf` (`basis.ts:420-423`).

Ein **unbedingtes** Kapitel müsste in beiden Fällen eine Seite mit Überschrift und nichts darunter
erzeugen — D14/D15, dieselbe Überlegung wie bei `hasComparisonChapter` (`comparison.ts:112-118`)
und beim Ladeverhalten (`document.tsx:1932-1941`).

### 2.2 Damit gilt die Stufe-D-Regel unverändert — kein Sonderfall

`ReportSection.reference` bliebe **leer**. Die Regel steht in `content.ts:38-43`: „KEIN BEDINGTES
KAPITEL DARF IHN BEKOMMEN … ein Satz, der sie beim Namen nennt, zeigte in den übrigen Fällen ins
Leere." Der Resolver setzt sie durch: `layout.ts:80-83` liefert `null`, und `report-text.ts:191`
lässt jeden Satz mit `REF_SECTION` auf seine Ersatzfassung fallen.

**Ein Sonderfall wäre auch nicht zu begründen**, denn `pv_outage` ist von den bedingten Kapiteln
das am **wenigsten** verlässliche: Kapitel 4, 5 und 6 hängen allein an der Datenlage, dieses
zusätzlich an einer Einstellung im Admin-Bereich.

**Und es kostet nichts:** `pv_outage` hat **keinen eingehenden Textverweis**
(`Report_Baukasten_Instanzen_Verifikation.md` §2.1 führt ihn ausdrücklich unter „Ohne Querverweis
im Text"). Die einzige Kopplung ist Kante V — die Titelgleichheit mit `method_pv_outage`, und die
läuft über **eine Funktion** (`pvOutageTitle`, `basis.ts:353-357`, benutzt bei `:371` und `:1102`)
und übersteht jeden Kapitelwechsel.

### 2.3 Der Kapitel-Schalter existiert bereits als Wert

`context.pvOutage !== null` ist die vollständige Antwort — Datenlage **und** Auswahl stecken schon
darin (`context.ts:107`). Zu bauen wäre:

- ein vierter Eintrag in `ReportChapterPresence` (`content.ts:369-388`),
- ein Zweig in `buildReportAgenda` (`content.ts:398-411`),
- eine `<Page>` in `document.tsx` (Regel 1 aus `page-numbers.ts`: eigene Seite, sonst bekommt der
  Agenda-Eintrag die Seitenzahl des Nachbarkapitels),
- ein `SECTION_OF`-Eintrag (`registry.ts:215`), der `pv_outage` aus `basis` herauszieht.

**Der Ort:** nach Kapitel 6, vor der Methodik — das ist die Stellung des Zielbildes (Seite 9 von
15, vor Anhang und Abschluss). `method_pv_outage` bleibt in Kapitel 8 bei den übrigen
Methodik-Absätzen; die Titelkopplung trägt das (s. o.).

### 2.4 Empfehlung

**Zurückstellen, nicht jetzt bauen** (§1.4). Die Kapitelentscheidung ist damit getroffen und
festgehalten — **bedingt, ohne Verweisnamen** —, und der Schritt lässt sich später ohne erneute
Klärung aufnehmen.

---

## 3 — Abhängigkeiten und Baureihenfolge

### 3.1 Verschiebt ein PV-Kapitel die Nummerierung der übrigen Kapitel-8-Inhalte?

**Nein — der Report nummeriert seine Kapitel nicht.** `ReportSection` (`content.ts:24-62`) trägt
`id`, `title` und `level`, keine Nummer; die Agenda zeigt Titel und **gemessene** Seitenzahl
(`page-numbers.ts`, D5). Seitenzahlen verschieben sich, aber sie werden gemessen und nicht
gepflegt.

**⚠ Das gilt genau so lange, bis §7 Nr. 23 gebaut wird** (Anhang-Gliederung „1. … 4."). Ab dann
gibt es Ordnungszahlen, und dann ist der Auszug eines Bausteins aus Kapitel 8 eine Umnummerierung.
Der Stufe-D-Plan §4 hat die Auflage dafür bereits formuliert („solche Nummern werden **erzeugt und
nie geschrieben**"). **Reihenfolge-Auflage: Nr. 19 vor Nr. 23 — oder Nr. 23 erzeugt seine Nummern.**

Die **Leseordnung innerhalb von Kapitel 8** ändert sich durch den Auszug nicht in einer Richtung:
`entries` (`registry.ts:373-380`) führt `assumptions` → `data_quality` → `tariff_blocker` →
`pv_outage` → `table_tariff_components` → `table_data_sources`. `pv_outage` liegt **zwischen** den
verweisenden Paaren, nicht darin — Kante L und Kante N behalten ihre Richtung (§4).

### 3.2 Die Kanten zwischen den fünf

```
  addon (Kap. 1) ◄──── E ──── recommendation (Kap. 2)          recommendation.ts:157-161
      │                            ▲
      │ dieselbe Aussage            │ K1/K2
      ▼                            │
  addon_none (Kap. 6)          catalog_alternatives (Kap. 6)    comparison.ts:365-369
                                     │ (Zwilling von addon_table,
                                     │  gegenseitig ausschliessend)
  addon_table (Kap. 6) ──── Z ──► table_candidates (Kap. 6)     comparison.ts:347-351

  pv_outage (Kap. 8) ····· keine Textkante ·····  (nur Kante V, Titel, über eine Funktion)
```

| Von | Nach | Art | Folge für die Reihenfolge |
|---|---|---|---|
| `addon` | `addon_none` | dieselbe Aussage, zwei Kennungen | **eine Entscheidung, ein Schritt** — getrennt gebaut stünde die Doppelung zwischendurch in einer dritten Fassung da |
| `recommendation` | `addon` | Kante E, migriert (`recommendation.ts:157-161`) | **`addon` zuerst** — `recommendation.ts` muss danach ein existierendes Ziel benennen |
| `catalog_alternatives` | `recommendation` | Kanten K1/K2, migriert (`comparison.ts:365-369`) | ortsunabhängig, keine Bindung |
| `addon_table` | `table_candidates` | Spaltenverweis, migriert (`comparison.ts:347-351`) | **unabhängig** von der Verdikt-Frage: `addon_table` und `addon_none` schliessen einander aus (`comparison.ts:409-414`) |
| `pv_outage` | — | keine | **unabhängig, jederzeit** |

### 3.3 Abgeleitete Baureihenfolge

| Schritt | Inhalt | Warum hier |
|---|---|---|
| **B3-1** | `table_candidates` freigeben: `selectedTable`, Aufnahme in `REPORT_OPTIONAL_SECTIONS`, die zwei unmigrierten Tabellensätze (§1.5) | kleinster Schritt, kein Formumbau, keine offene Entscheidung — und der Nachweis, dass Stufe D trägt |
| **B3-2** | `addon`/`addon_none`: Doppelung auflösen **und** Verdikt-Form; danach `addon` (bzw. die Nachfolgekennung) freigeben | grösster Schritt; muss vor B3-3 liegen, weil Kante E daran hängt |
| **B3-3** | `recommendation`: **20a** (Listenform an `ReportStatement` + Renderer) | nach B3-2; **20b (der Inhalt) braucht vorher eine redaktionelle Vorgabe** |
| **(später)** | `pv_outage` als Kapitel (Nr. 19) | erst nach der PV-Gegenrechnung; **vor Nr. 23** |

**⚠ Vor B3-2 ist genau eine Frage zu beantworten, und sie ist fachlich:** bleibt der Klarsatz auf
der Kernergebnis-Seite (Kapitel 1, wo er unbedingt steht und einen Verweisnamen trägt) oder unter
der Grenznutzen-Kurve (Kapitel 6, wo die Begründung daneben liegt)? Das Zielbild gibt ihm eine
eigene Seite und beantwortet die Frage damit nicht. Die technische Folge steht in §4.

---

## 4 — Richtungswechsel unter den 17 migrierten Fundstellen

Geprüft wurde jede der 17 (`6df6b56` 5 · `8e23b9d` 11 · `5973b4f` 5, Zählung nach `d4f6b45`) gegen
die vier Umbauten. Zwei Formen sind zu unterscheiden: ein Verweis mit `{place}` trägt eine
**Richtung** (`layout.ts:84-92`), einer mit `{section}` einen **Kapitelnamen**
(`layout.ts:80-83`).

### 4.1 Genau eine wechselt — und sie wechselt nicht die Richtung, sondern verschwindet

**Fundstelle 10, Kante E** (`recommendation.ts:157-161`):

```
ref(block('addon'),
    ` Ob sich ein ZUSÄTZLICHES Gerät neben Ihrer Anlage lohnt, steht auf der ${REF_SECTION}; …`,
    '')
```

Der Satz trägt `{section}`, nicht `{place}`. `section()` liefert einen Namen **nur** für Kapitel 1
(`content.ts:142` — das einzige Kapitel mit `reference`). `resolveReportText` lässt einen Satz mit
`{section}` auf seine Ersatzfassung fallen, sobald der Name fehlt (`report-text.ts:189-196`), und
die Ersatzfassung ist hier `''`.

| Ausgang von B3-2 | Was der Resolver tut | Was der Leser sieht |
|---|---|---|
| `addon` bleibt in Kapitel 1 | unverändert | unverändert |
| `addon` entfällt (`addon_none` überlebt) | `present()` false → `absent` | **der Satz ist weg** |
| `addon` zieht nach Kapitel 6 oder auf eine eigene Verdikt-Seite | `section()` null → `nameable` false → `absent` | **der Satz ist weg** |

**Verloren ginge ausgerechnet der Satz, der einen Bestandskunden davon abhält, die Ersatz-Zahlen
mit den Zusatz-Zahlen zu vergleichen.** Der Code hat den Fall vorausgesagt
(`recommendation.ts:152-154`: „Der Satz überlebt damit ein Abwählen von `addon`, aber nicht sein
Verschieben (Block 3 Nr. 18)"); hier ist er am Mechanismus bestätigt.

**Auflage für B3-2:** der Verweis ist auf die überlebende Kennung umzuhängen **und** der Wortlaut
auf die generische Form (`{place}` → „im Kapitel „X"") umzustellen, sonst fällt der Satz still
aus. Dass er fällt, sieht man dem Dokument nicht an — es fehlt nichts, wo etwas fehlen würde.

### 4.2 Die übrigen 16 überstehen alle vier Umbauten

| Fundstellen | Form | Warum unberührt |
|---|---|---|
| 1, 2 (`summary.ts:403` via `:368`/`:371`), 3 (`:446`), 4 (`:468`), 5 (`:473`) | `{place}`/`{label}`, innerhalb Kapitel 1 | `addon` ist der **letzte** Eintrag des Kapitels (`registry.ts:297`); sein Wegfall lässt `savings` → `peak_shaving` → `load_shift` unverändert |
| 11 (`recommendation.ts:291`), 12 (`:305`), 13 (`:315`), 14 (`:324`) | `{section}`/`{label}`, Ziel `savings`/`load_shift` | keiner der vier Umbauten fasst Kapitel 1 an |
| 15, 16 (`detail.ts:229-237`) | `{section}`, Ziel `savings`/`load_shift` | dito |
| **22 (2×), 23** (`comparison.ts:365-369`, `:380`) | `{place}` + Festwort, Ziel `recommendation` | selbst wenn `recommendation` ans Dokumentende zöge, bliebe es ein **fremdes** Kapitel — der dritte Zweig von `place()` ist bewusst richtungslos (`layout.ts:88-92`). **Hier zahlt sich Stufe D aus** |
| 20 (`comparison.ts:347-351`) | `{label}`, Spalte | kein Ortswort; die Ersatzfassung ist gemessen (`report-text.test.ts:421-449`) |
| **24, Kante L** (`basis.ts:141-145`) | `{place}`, innerhalb Kapitel 8 | `pv_outage` liegt **zwischen** `tariff_blocker` und `table_tariff_components` (`registry.ts:373-378`) und nicht zwischen `assumptions` und der Tabelle — „weiter unten" bleibt |
| **26, Kante N** (`basis.ts:592-595`) | `{place}`, innerhalb Kapitel 8 | `data_quality` steht vor `table_data_sources`, mit und ohne `pv_outage` — „oben" bleibt |

### 4.3 ⚠ Zwei UNmigrierte Fundstellen gehen kaputt, und sie sind die eigentlichen Kante-L-Fälle

Beide liegen in den 12, die `8e23b9d` mit benanntem Grund stehen liess. Keine von ihnen wird vom
Resolver geschützt, und keine fällt in einem Prüflauf auf.

**Fundstelle 19** (`detail.ts:305-307`): „Der Schnittpunkt liegt bei … — dieselbe Zahl wie **im
Kapitel davor**, hier als Verlauf."
Zeigt auf `recommendation`. Steht in `ReportFigure.note`, und `note` ist `string`
(`statement.ts:33-36`) — es gibt dort keinen Textträger, der einen `ref` aufnehmen könnte. **Der
Satz wird falsch, sobald B3-3 `recommendation` hinter das Detail-Kapitel zieht.** Solange 20a nur
die Form ändert, bleibt er richtig; er ist die Sperre gegen eine Positionsänderung.

**Fundstellen 21 / §1.5** (`comparison.ts:351`, `:365`): die Sätze über die Tabelle, die kein
`ref` tragen. **Sie werden falsch, sobald B3-1 `table_candidates` abwählbar macht** — und der
bestehende Test bliebe grün, weil er nur den Spaltensatz misst.

---

## 5 — Prompt-Umfang: alle fünf in einer Session?

**Nein.** Vier Sessions, entlang §3.3. Die Begründung ist nicht die Zeilenzahl, sondern die Zahl
der **Schichten**, die ein Schritt gleichzeitig anfasst: Erzeuger → Registry → Layout → Renderer →
Agenda/Seitenbaum → Prüflauf. Ein Schritt über zwei Bausteine hinweg fasst jede Schicht zweimal
an, und das ist das Muster, an dem der Kontext in dieser Codebasis reisst (CLAUDE.md Regel 6, und
zuletzt Regel 7).

Zur Einordnung, die **Dateien**, die ein Schritt aufmachen muss:
`document.tsx` 2050 · `basis.ts` 1287 · `summary.ts` 876 · `registry.ts` 481 · `content.ts` 436 ·
`comparison.ts` 435 · `recommendation.ts` 356 · `layout.ts` 176 — dazu `report-text.test.ts` 556 ·
`registry.test.ts` 527 · `optional-sections.test.ts` 415 · `existing-case.test.ts` 388.

| Schritt | Schichten | Umfang | Prompt |
|---|---|---|---|
| **B3-1** `table_candidates` freigeben | Renderer (`selectedTable`), `shared`-Liste, zwei Textstellen, zwei Fixtures | klein–mittel | **eine Session**, gut abgrenzbar |
| **B3-2** Verdikt + Doppelung | `summary.ts`, `comparison.ts`, `statement.ts` (neues Feld), `document.tsx` (neuer Renderer), `registry.ts`, `recommendation.ts` (Kante E), vier Prüfläufe | **der grösste** | **eine eigene Session, nichts daneben.** Die fachliche Entscheidung (§3.3) **vor** dem Prompt treffen und **im Prompt mitgeben** — nicht CC entscheiden lassen |
| **B3-3** Listenform (20a) | `statement.ts`, `document.tsx`, `recommendation.ts` | klein–mittel | eine Session — **20b nicht mit hineinnehmen** |
| **B3-4** PV-Kapitel (19) | Engine + Contract + `content.ts` + `registry.ts` + `document.tsx` + Charts | **gross, quer über Pakete** | zurückgestellt; wenn, dann in zwei Schritten (Engine-Daten / Kapitel) |

**⚠ Was in JEDEN dieser Prompts gehört, wörtlich und nicht als Leseauftrag** (CLAUDE.md Regel 6):

- Der betroffene `ref(...)`-Ausschnitt samt seiner `absent`-Fassung. Ein „lies, wie `basis.ts:141`
  es macht" ist genau der Auftrag, an dem der Kontext in der Stufe-D-Session zusammengebrochen ist.
- **Für B3-2 zusätzlich:** der Absatz aus §4.1 dieses Plans. Der Satz fällt sonst still aus, und
  ein grüner Lauf ist kein Gegenbeweis.
- **Für B3-1 zusätzlich:** die beiden Sätze aus §1.5. Der bestehende Test deckt sie nicht ab.

---

## 6 — Was dieser Plan ausdrücklich nicht sagt

- **Nichts über die Zieloptik selbst.** Das Zielbild liegt nicht mehr im Arbeitsverzeichnis
  (`.gitignore`, `af0f26f`); die SOLL-Seite ist zitiert, nicht nachgemessen. Wer Nr. 18 baut,
  braucht die genauen Grade und Farben aus `Report_Baukasten_Optik_Bestandsaufnahme.md` §3/§4.5.
- **Nichts über den Inhalt der Handlungsliste** (20b). Das ist eine redaktionelle Vorgabe, keine
  Ableitung aus dem Contract.
- **Nichts über §7 Nr. 21–24.** Die Voraussetzungs-Seite dreht Kante L und Fundstelle 27 — das
  steht im Stufe-D-Plan §4 und ist hier nicht angefasst.
- **Nichts über die Kapitel-Doppelreihenfolge.** `buildReportAgenda` (`content.ts:398`) und der
  JSX-Seitenbaum (`document.tsx:1963-2050`) führen die Reihenfolge weiterhin zweimal, von Hand
  synchron gehalten. Jeder Schritt, der ein Kapitel hinzufügt oder verschiebt, fasst **beide** an.
  Der Stufe-D-Plan §7 hat die Frage offen gelassen; sie ist es noch.
