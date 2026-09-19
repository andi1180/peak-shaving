# Verifikation: Report-Baukasten, Baustein-Ebene (17.09.2026, f1ac6d5)

Vertiefung von `Report_Baukasten_KI-Schicht_Bestandsaufnahme.md` §1 und §4. Keine Code-Änderung, kein Commit, kein Build. Jede Aussage mit Fundstelle.

> **Hinweis zur Rekonstruktion:** Diese Datei ist aus dem Chat-Verlauf nachgebaut, nachdem der ursprüngliche CC-Lauf sie nie geschrieben hatte (nur als Bericht zurückgegeben, nie als Datei angelegt). Inhaltlich unverändert gegenüber dem Original-Bericht vom 17.09.2026.

---

## Vorbemerkung zur Zahl 28

Die 28 stimmt — wenn man stabile `id`-Werte zählt, nicht Code-Stellen. Die Differenz ist relevant, sobald eine Auswahl-Schicht Bausteine adressieren soll:

| Sorte | stabile id | Objekt-Literale im Code | Abweichung |
|---|---|---|---|
| ReportStatement | 13 | 14 | `savings` und `addon` haben je zwei Erzeugungsstellen (summary.ts:176/:243, :403/:417); `addon_table`/`catalog_alternatives` teilen sich eine Stelle (comparison.ts:312) |
| ReportNotice | 8 | 8 | — |
| ReportTable | 3 | 3 | Tabellen haben keine id — sie sind nur über ihren Erzeuger und ihr Feld in `BasisChapter`/`ComparisonChapter` identifizierbar |
| BasisMethodItem | 4 | 4 | — |

Dazu: `monthly_comparison` hat eine id und eine Erzeugungsstelle, aber zwei Rendering-Orte (Kapitel 3 und 4, document.tsx:1251 bzw. :1289).

---

## 1 — Vollständige Instanzliste

### 1.1 ReportStatement (13 ids / 14 Stellen)

| # | id | Datei:Zeile | Erzeuger (Signatur) | Sichtbarkeitsbedingung | Kapitel |
|---|---|---|---|---|---|
| 1 | savings (Kassen) | summary.ts:176 | `buildSavings(analysis: PdfReportAnalysis, entry: BatteryResultEntry): { statement; isRealComparison }` — :151 | `existingBatteryAnalysis` und `tariffOptimization.computable === true` (:160) | 1 |
| 2 | savings (§3.7) | summary.ts:243 | dieselbe Funktion, zweiter Rückgabepfad | sonst; entfällt ganz ohne Kandidat (:730) | 1 |
| 3 | peak_shaving | summary.ts:297 | `buildPeakShaving(analysis, entry, savingsIsRealComparison: boolean): SummaryStatement | null` — :274 | `entry.leistungspreisSavingPerYear > 0` (:279) | 1 |
| 4 | load_shift | summary.ts:361 | `buildLoadShift(analysis, entry, savingsIsRealComparison: boolean): SummaryStatement | null` — :328 | `tariffOptimization?.computable === true` (:333) | 1 |
| 5 | addon (Klarsatz) | summary.ts:403 | `buildAddon(analysis): SummaryStatement | null` — :393 | Bestandsfall und kein Szenario mit `netSavingOverHorizon > 0` | 1 |
| 6 | addon (positiv) | summary.ts:417 | dieselbe Funktion | Bestandsfall und mindestens eines positiv | 1 |
| 7 | recommendation | recommendation.ts:168 | `buildRecommendation(analysis, entry: BatteryRoiEntry): ReportStatement` — :105 | `recommendedEntryOf(…) ≠ undefined` (:310) | 2 |
| 8 | load_control | recommendation.ts:283 | `buildLoadControl(analysis, primary): ReportStatement | null` — :268 | `computable === true` und primärer Eintrag (:272-273) | 2 |
| 9 | monthly_comparison | detail.ts:232 | `buildMonthly(comparison: MonthlyTariffComparison, isExisting: boolean)` — :196 | Bestandsfall ⇒ Kapitel 3 (:126); sonst ⇒ Kapitel 4 (:430) | 3 oder 4 |
| 10 | hour_flow | insight.ts:304 | `buildHourFlow(plan: InsightHourFlowPlan): { figure; statement }` — :271 | `batteryFlowByHourMonth` und `summarizeHourFlow(…).hasData` (:214) | 5 |
| 11 | charge_price | insight.ts:370 | `buildChargePrice(price: MonthlyChargePrice): { figure; statement }` — :333 | `dispatchTrace.monthlyChargePrice` (:217) | 5 |
| 12 | addon_none | comparison.ts:262 | `buildVerdict(horizonYears: number): ReportStatement` — :260 | `shown.length === 0` (:355) | 6 |
| 13 | addon_table oder catalog_alternatives | comparison.ts:312 | `buildTableStatement(variant, considered, horizonYears): ReportStatement` — :291 | `shown.length > 0`; id verzweigt an `variant === 'addon'` | 6 |
| 14 | assumptions | basis.ts:123 | `buildAssumptions(analysis): ReportStatement` — :111 | immer | 8 |

### 1.2 ReportNotice (8)

| id | Datei:Zeile | Erzeuger (Signatur) | Bedingung | Kap. |
|---|---|---|---|---|
| standard_profile | summary.ts:593 | `buildStandardProfileNotice(loadProfile: Pick<LoadProfile,'source'>)` — :587 | `source === 'standard_profile'` | 1 |
| estimated_pv | summary.ts:653 | `buildEstimatedPvNotice(summary: EstimatedPvSummary | undefined)` — :645 | Argument gesetzt | 1 |
| partial_year | summary.ts:526 | `buildPartialYearNotice(analysis)` — :520 | `billingModel.startsWith('monthly')` und `coveredMonths < 12` | 1 |
| large_gap | summary.ts:556 | `buildLargeGapNotice(analysis)` — :550 | `largestGapSlots > LARGE_GAP_SLOTS_THRESHOLD` | 1 |
| data_quality | basis.ts:191 | `buildDataQuality(analysis)` — :186 | `dataQuality.warnings.length > 0` | 8 |
| tariff_blocker | basis.ts:273 | `buildBlocker(analysis, timeZone: string)` — :265 | `tariffOptimization` gesetzt und `computable === false` | 8 |
| pv_outage | basis.ts:349 | `buildPvOutage(hasPv: boolean|undefined, months: PvOutageMonth[]|undefined)` — :339 | `hasPv === true` und `months.length > 0` | 8 |
| limitations | basis.ts:1119 | `buildLimitations(analysis): ReportNotice` — :1096 | immer; ein Punkt bedingt an `annualProjection` (:1103) | 8 |

Reihenfolge der vier Kernergebnis-Hinweise ist fest in `buildNotices` (summary.ts:696), nicht im Renderer (document.tsx:1066).

### 1.3 ReportTable (3) — ohne id

| Tabelle | Datei:Zeile | Signatur | Bedingung | Kap. |
|---|---|---|---|---|
| Kandidatentabelle | comparison.ts:171 | `buildCandidateTable(candidates: ComparisonCandidate[], horizonYears: number): ReportTable` — der einzige exportierte Baustein-Erzeuger im ganzen Katalog | `shown.length > 0` | 6 |
| Datenquellen | basis.ts:740 | `buildDataSources(input: PdfReportInput): ReportTable` (privat) | immer | 8 |
| Tarifkomponenten | basis.ts:885 | `buildTariffComponents(input: PdfReportInput): ReportTable` (privat) | immer; Zeilen je nach erreichtem Feld (:824, :850, :873) | 8 |

Die Überschriften „Tarifkomponenten"/„Datenquellen" stehen nicht in der Tabelle, sondern als Literal im JSX (document.tsx:1487, :1495).

### 1.4 BasisMethodItem (4)

| id | Datei:Zeile | Erzeuger | Bedingung (`buildMethodPerMetric`, basis.ts:1040) | Kap. |
|---|---|---|---|---|
| method_current_tariff | basis.ts:962 | `tariffMethodItems(): BasisMethodItem[]` — :959, ohne Parameter | `computable === true` (:1051-1052) | 8 |
| method_spot_uncontrolled | basis.ts:974 | dieselbe Funktion, zweites Element | dasselbe | 8 |
| method_load_control | basis.ts:1003 | `loadControlMethodItem(): BasisMethodItem` — :1001, ohne Parameter | `comparable && primaryEntryOf(analysis)` (:1061) | 8 |
| method_pv_outage | basis.ts:1029 | `pvOutageMethodItem(): BasisMethodItem` — :1027, ohne Parameter | `pvOutage !== null` — am Hinweis gemessen (:1064) | 8 |

**Befund zur Signatur-Ungleichheit:** von 14 Baustein-Erzeugern nimmt keiner denselben Parametersatz wie ein anderer — drei nehmen `(analysis, entry, boolean)`, einer `(hasPv, months)`, zwei `(input: PdfReportInput)`, drei gar nichts. Nur einer ist exportiert (`buildCandidateTable`).

---

## 2 — Querverweis-Graph

### 2.1 Die Kanten, wörtlich

| # | von → nach | Wortlaut | Fundstelle |
|---|---|---|---|
| A | savings(Kassen) → peak_shaving | „Die Spitzenkappung steckt in keiner der beiden Zeilen — sie hängt am Leistungspreis Ihres Netzbetreibers und nicht am Stromvertrag." | summary.ts:208-209 |
| B1 | peak_shaving → savings(Kassen) | „Dieser Betrag steckt NICHT in der Zahl oben: der Monatsvergleich führt nur Arbeits- und Netz-Arbeitspreis samt Grundgebühren. Er kommt hinzu — addieren lässt er sich trotzdem nicht…" | summary.ts:290-292 |
| B2 | peak_shaving → savings(§3.7) | „Dieser Betrag ist in der Gesamtersparnis oben bereits als erste Zeile enthalten und kommt nicht zusätzlich obendrauf." | summary.ts:293-294 |
| C | load_shift → savings(Kassen), Zeilen-Ebene | „Die Zeile „Wert der Ladesteuerung" in der Aufschlüsselung oben beantwortet dieselbe Frage aus der Kassensicht…" | summary.ts:354-357 |
| D | load_shift → savings(§3.7), Zeilen-Ebene | „…steht als eigener Anteil („Eigenverbrauch") daneben." | summary.ts:375 |
| E | recommendation → addon (Kap. 1) | „Ob sich ein ZUSÄTZLICHES Gerät neben Ihrer Anlage lohnt, steht in den Kernergebnissen; die dortigen Beträge sind Differenzen…" | recommendation.ts:156-157 |
| F | load_control → load_shift (Kap. 1) | „…die Zahl auf der Kernergebnis-Seite ist von diesem Zeitraum auf ein Jahr hochgerechnet…" | recommendation.ts:277-279 |
| G1 | load_control → savings(§3.7), Zeile | „Er steckt in der Gesamtersparnis bereits als „tarifbewusstes Laden" und kommt nicht zusätzlich obendrauf" | recommendation.ts:297-298 |
| G2 | load_control → savings(§3.7), Zeile | „…steht als eigener Anteil („Eigenverbrauch") daneben." | recommendation.ts:299-300 |
| H | monthly_comparison → Kopfzahl/peak_shaving (Kap. 1) | „NICHT enthalten ist der Leistungspreis — er steht als Jahreszahl auf der Kernergebnis-Seite" | detail.ts:246-247 |
| I | monthly_comparison → savings(Kassen) | „Die Kernergebnis-Seite zeigt die DIFFERENZEN zwischen diesen drei Summen; hier stehen sie absolut." | detail.ts:248-249 |
| J | addon_table → Grenznutzen-Kurve (gleiches Kap.) | „…die übrigen stehen als Punkte in der Kurve darüber." | comparison.ts:327-328 |
| K1 | catalog_alternatives → Kurve + recommendation | „…derselben Grösse wie die Kurve darüber und wie die Empfehlung im Kapitel „Empfehlung und Lastverlauf". Das empfohlene Gerät steht deshalb hier nicht noch einmal: es ist dort vollständig aufgeschlüsselt." | comparison.ts:329-332 |
| K2 | catalog_alternatives → recommendation | „…stehen hier aber nicht je Zeile — sie stehen beim empfohlenen Gerät." | comparison.ts:335 |
| L | assumptions → Tabelle Tarifkomponenten | „Die Tarifgrössen selbst stehen weiter unten in der Tabelle „Tarifkomponenten", mit ihrer Herkunft daneben." | basis.ts:132-133 |
| M | limitations → Tabelle Tarifkomponenten | „Die Tabelle „Tarifkomponenten" zeigt die erfassten Parameter, nicht alle in der Rechnung verwendeten…" | basis.ts:1113-1115 |
| N | Tabelle Datenquellen → data_quality | „…(Slot-Zählung: Messwerte ÷ 96, wie im Datenqualitäts-Hinweis oben)" | basis.ts:536-537 |
| O | standard_profile → Kopfzahl + Abwesenheit peak_shaving | „Die oben gezeigten Leistungswerte sind dagegen die Spitzen dieser Durchschnittskurve … eine Ersparnis beim Leistungspreis wird deshalb gar nicht erst ausgewiesen" | summary.ts:599-601 |
| P | estimated_pv → Abwesenheit peak_shaving | „…weist der Report keine Leistungspreis-Ersparnis aus." | summary.ts:676-678 |
| Q | partial_year → Kopfzahl | „Der abgerechnete Leistungswert oben unter dem Modell „…"" | summary.ts:530 |
| R | large_gap → Kopfzahl + savings | „…der abgerechnete Leistungswert oben und die daraus abgeleitete Ersparnis sind für diesen Datensatz eher zu niedrig als zu hoch." | summary.ts:563-564 |
| S | tariff_blocker → Kapitel 1–7 pauschal | „Die Empfehlung und alle Zahlen der vorigen Kapitel gelten unverändert." | basis.ts:286-288 |
| T | method_spot_uncontrolled → method_current_tariff | „Dieselbe Rechnung über dieselben Viertelstunden, nur tritt an die Stelle Ihres festen Arbeitspreises der Börsenpreis…" | basis.ts:977 |
| U | method_current_tariff → Kapitel 1 | „…er ist die eigene Jahreszahl weiter vorne und würde hier ein zweites Mal zählen." | basis.ts:970-971 |
| V | method_pv_outage → pv_outage (Titel-Kopplung) | Titel 'Monate ohne erkennbaren PV-Beitrag' — der Typkommentar verlangt „so benannt wie an der Stelle, an der sie im Report steht" | basis.ts:1030 gegen :947-948 |
| W | RESULTS_FOOTNOTE → METHODOLOGY_SECTION | „…steht im Kapitel „${METHODOLOGY_SECTION.title}"." | content.ts:390-392 |

Ohne Querverweis im Text: `addon` (beide Fassungen), `hour_flow`, `charge_price`, `addon_none`, `data_quality`, `pv_outage`, `method_load_control`, Kandidatentabelle, Tarifkomponenten-Tabelle.

### 2.2 Der Graph (ASCII, Original-Skizze)

```
 KAPITEL 1 ─ Kernergebnisse
   ┌──────────────┐  A ("steckt in keiner der beiden Zeilen")
   │   savings    │ ─────────────────────────────►┌──────────────┐
   │  (2 Fassgn.) │ ◄─────────────────────────────│ peak_shaving │   ⇦ GEGENSEITIG
   └──────────────┘  B1/B2 ("in der Zahl oben")   └──────────────┘
        ▲  ▲                                             ▲ ▲ ▲
        │C │D                                            │ │ │
   ┌────┴──┴────┐                          O ┌───────────┘ │ │ P
   │ load_shift │                            │ standard_   │ │ ┌──────────────┐
   └────────────┘                            │  profile    │ │ │ estimated_pv │
        ▲     ▲                              └─────────────┘ │ └──────────────┘
        │F    │                                 (Abwesenheit) │
        │     │                        Q ┌──────────────┐ R ┌─┴───────────┐
 KAP. 2 │     │                          │ partial_year │   │  large_gap  │
   ┌────┴─────┴───┐                      └──────┬───────┘   └──────┬──────┘
   │ load_control │ ──G1/G2──► savings(§3.7)    └──► Kopfzahl ◄────┘
   └──────────────┘                                     ▲  ▲
   ┌──────────────┐ ◄─K1/K2── catalog_alternatives      │H │
   │recommendation│ ◄─E────── (via Kap. 1: addon)  ┌────┴──┴──────────┐
   └──────────────┘                                │monthly_comparison│
                                                   └───────┬──────────┘
 KAP. 6                                                    │ I
   ┌──────────────────┐ ──J──► Grenznutzen-Kurve            └──► savings(Kassen)
   │ addon_table      │        (gleiches Kapitel)
   └──────────────────┘

 KAPITEL 8 ─ Annahmen und Datengrundlage
   ┌─────────────┐ ──L──►┌────────────────────┐◄──M── ┌──────────────┐
   │ assumptions │       │ Tab. Tarifkomponent│       │ limitations  │
   └─────────────┘       └────────────────────┘       └──────────────┘
   ┌────────────────┐ ──N──► ┌──────────────┐   (bedingt!)
   │ Tab. Datenquell│        │ data_quality │
   └────────────────┘        └──────────────┘
   ┌──────────────────────┐ ──T──► ┌───────────────────────┐ ──U──► Kap. 1
   │method_spot_uncontroll│        │ method_current_tariff │
   └──────────────────────┘        └───────────────────────┘
   ┌──────────────────┐ ··V··(Titel)··► ┌────────────┐
   │ method_pv_outage │                 │ pv_outage  │
   └──────────────────┘                 └────────────┘
   ┌────────────────┐ ──S──► „alle Zahlen der vorigen Kapitel"
   │ tariff_blocker │
   └────────────────┘
```

### 2.3 Der Beleg für „teils gegenseitig verschränkt" — und vier Verweise, die heute schon ins Leere zeigen

> **Stand 17.09.2026, vor PR #273.** Die vier hier beschriebenen Inkonsistenzen (D, G1/G2, I, N) sowie der Randfall V wurden mit PR #273 (`da9f982`) korrigiert. Dieser Abschnitt bleibt als historischer Befund stehen, weil er die Methodik belegt, mit der sie gefunden wurden.

Echte Gegenseitigkeit gibt es an genau einer Stelle: `savings ↔ peak_shaving` (A/B). Sie ist zusätzlich strukturell verschränkt, nicht nur textlich: `buildSavings` gibt `isRealComparison` als zweiten Rückgabewert heraus (summary.ts:151-155) und dieser Wert geht als dritter Parameter in `buildPeakShaving` und `buildLoadShift` (summary.ts:738-745). Drei Bausteine sind damit über einen Rückgabewert gekoppelt, nicht über Text.

Vier Verweise waren im damaligen Code bereits inkonsistent — sie sind der härteste Beleg dafür, dass die Körper für eine feste Reihenfolge geschrieben sind:

- **D** (summary.ts:375) stand unbedingt im `load_shift`-Body und verwies auf die Zeile „Eigenverbrauch". Die gibt es nur in der §3.7-Fassung (summary.ts:178). Im Bestandsfall mit rechenbarem Vergleich stand oben die Kassen-Fassung mit den Zeilen Reiner Tarifwechsel / Wert der Ladesteuerung / Gesamt (:146-163) — genau dann, wenn auch C greift. Der Satz zeigte also gerade dann auf eine Zeile, die nicht da war, wenn der Satz daneben (C) aktiv war.
- **G1/G2** (recommendation.ts:297-300): dasselbe, eine Seite weiter — „tarifbewusstes Laden" und „Eigenverbrauch" sind Zeilen der §3.7-Fassung; `load_control` erscheint aber auch im Bestandsfall (`computable === true`), wo oben die Kassen-Fassung steht.
- **I** (detail.ts:248-249): „Die Kernergebnis-Seite zeigt die DIFFERENZEN zwischen diesen drei Summen" — richtig in Kapitel 3 (Bestandsfall, Kassen-Fassung). Derselbe Text wurde von `buildMonthlyChapter` unverändert in Kapitel 4 gerendert (detail.ts:424-427), und dort stand auf der Kernergebnis-Seite die §3.7-Fassung, die keine Differenzen dieser drei Summen zeigt. Eine id, zwei Orte, ein Satz, der nur an einem stimmte.
- **N** (basis.ts:536-537): die Datenquellen-Tabelle steht immer, der Datenqualitäts-Hinweis nur bei `warnings.length > 0` (basis.ts:188). „wie im Datenqualitäts-Hinweis oben" zeigte im warnungsfreien Report auf nichts.

Dazu ein Randfall bei **V**: `pv_outage` wechselt seinen Titel auf Singular („Ein Monat ohne erkennbaren PV-Beitrag", basis.ts:351-353), `method_pv_outage` blieb Plural (basis.ts:1030) — obwohl der Typkommentar Gleichnamigkeit verlangt.

**Folgerung für eine Auswahl-Schicht:** von 22 Textkanten sind 13 ortsgebunden („oben", „daneben", „weiter vorne", „weiter unten", „darüber", „auf der Kernergebnis-Seite", „im Kapitel …"). Nur eine einzige Ortsangabe im ganzen Katalog wird aus der Datenstruktur gebildet statt ausgeschrieben (W, content.ts:392) — und die steht in einer Fussnote, nicht in einem Baustein.

---

## 3 — Kapitel-Ebene vs. Baustein-Ebene

Kapitel-Identität: Daten. Kapitel-Reihenfolge: doppelt geführt. Kapitel-Inhalt: JSX.

| Ebene | Wo | Datenstruktur? |
|---|---|---|
| Titel + id + level | `ReportSection`-Konstanten, content.ts:114–:296, Kennungen in `SECTION_ID` :103 | ja |
| Vorspann („lead") | acht eigenständige Konstanten (`RESULTS_INTRO` :381, `RECOMMENDATION_INTRO` :147, …) — nicht Feld von `ReportSection` | nein |
| Reihenfolge | zweimal: `buildReportAgenda` content.ts:355-365 und der JSX-Seitenbaum document.tsx:1596-1648 | nein — zwei Listen, per Hand synchron |
| Welche Bausteine ein Kapitel trägt | ausschliesslich das JSX der Kapitel-Komponente; der Baustein-Erzeuger wird im Renderer aufgerufen (document.tsx:1037, :1197, :1236, :1276, :1351, :1403, :1465) | nein |

Es gibt keine Abbildung Kapitel → Bausteine und keine Abbildung `ReportSection` → Komponente. Der einzige Bezug zwischen beiden Listen ist der `SectionAnchor id={…SECTION.id}` je Seite.

**Kann ein Kapitel leer sein und trotzdem eine Überschrift tragen?** Ja — bei fünf der acht Kapitel, und die Fälle sind erreichbar.

Überschrift und Vorspann stehen in jeder Kapitel-Komponente unbedingt (z. B. document.tsx:1041-1042, :1201-1202, :1240-1241). Für die drei bedingten Kapitel (4/5/6) hängt die Existenz am Schalter; für die fünf unbedingten (1, 2, 3, 7, 8) hängt sie an nichts:

- **Kapitel 1:** `statements: []` bei leerem Katalog (summary.ts:730) und `notices: []` ohne Befund ⇒ Überschrift + Vorspann + Kopfzahl + Fussnote, null Aussage-Bausteine.
- **Kapitel 2:** `recommendation: null` (leerer Katalog, recommendation.ts:310) und `loadControl: null` ⇒ Überschrift + ein Bild bzw. dessen Fehlmeldung, null Statements.
- **Kapitel 3:** `cost === null` und `flow === null` ⇒ zwei Begründungssätze, kein Bild, kein Statement (detail.ts:382-388).
- **Kapitel 8** ist faktisch nie leer (`assumptions`, zwei Tabellen und `limitations` stehen immer).

Für die drei bedingten Kapitel ist „erscheint" an den Schalter gebunden, und der Schalter ist jeweils ein Inhalts-Prädikat — bei Kapitel 6 ausdrücklich ein anderes als das der Grafik (comparison.ts:114-118: „Das Kapitel steht auch dann, wenn die Kurve nicht zustande kommt … solange es etwas ZU SAGEN gibt"). Für die fünf unbedingten ist „erscheint" nicht an „hat Inhalt" gebunden. Der Kommentar in content.ts:286-290 sagt das für Kapitel 8 ausdrücklich zu; für 1/2/3 ist es Nebenwirkung, nicht Zusage.

---

## 4 — Signaturen der drei Schalter und der D5-Bedingung

| Prädikat | Fundstelle | Signatur | Export | Rein? |
|---|---|---|---|---|
| hasMonthlyChapter | detail.ts:420 | `(analysis: PdfReportAnalysis) => boolean` | ja | ja |
| hasInsightChapter | insight.ts:222 | `(analysis: PdfReportAnalysis) => boolean` | ja | ja |
| hasComparisonChapter | comparison.ts:124 | `(analysis: PdfReportAnalysis) => boolean` | ja | ja |
| D5 PV-Bedingung | basis.ts:339-344 | `buildPvOutage(hasPv: boolean | undefined, months: PvOutageMonth[] | undefined) => ReportNotice | null` | nein | ja |

`PdfReportAnalysis` ist weder der ganze Contract noch ein Einzelfeld: ein `Pick<AnalysisResult, …>` über acht benannte Felder — `current`, `perBattery`, `recommendation`, `assumptions`, `tariffOptimization`, `existingBatteryAnalysis`, `annualProjection`, `dataQuality` (types.ts:113-123).

**Konsequenz für eine künftige D4-Funktion („welche Bausteine sind für diesen Fall zulässig"):**

- Die drei Kapitel-Schalter sind unverändert wiederverwendbar: gleiche Signatur, exportiert, seiteneffektfrei, ausschliesslich lesend auf `PdfReportAnalysis`. Sie werden heute schon genau so benutzt — einmal ausgewertet, an Agenda und Seitenbaum gegeben (document.tsx:1562-1564).
- Die D5-Bedingung ist es nicht, aus zwei unabhängigen Gründen: (a) sie ist nicht exportiert und existiert nicht als eigenes Prädikat, sondern nur als frühes `return null` innerhalb des Erzeugers; (b) ihre Eingangsgrössen (`hasPv`, `pvOutageMonths`) liegen ausserhalb von `PdfReportAnalysis` — sie sind Felder von `PdfReportInput` (types.ts:351, :372). Eine D4-Funktion, die auch die PV-Zeile der Matrix beurteilen soll, braucht also `PdfReportInput` als Eingang, nicht `PdfReportAnalysis` — und muss das Prädikat entweder neu bauen oder `buildPvOutage` exportieren.
- Dasselbe gilt für alle übrigen 24 Baustein-Bedingungen: keine davon existiert als eigenes Prädikat. basis.ts:1063 benennt das Muster ausdrücklich („Am HINWEIS gemessen und nicht an `hasPv`/`pvOutageMonths`: eine Bedingung, ein Ort") — die Bedingung wird dort durch Aufruf des Erzeugers und Prüfung auf `null` wiederverwendet, nicht durch ein getrenntes Prädikat. Das ist der Weg, den eine D4-Funktion heute am billigsten kopieren könnte: „alle Erzeuger aufrufen, `null` heisst unzulässig" — er kostet aber genau das, was D4 vermeiden will, nämlich die Erzeugung vor der Auswahl.
- Drei weitere Funktionen mit derselben Rolle, aber anderer Form, wären mitzunehmen: `detailChartPlan` (detail.ts:117), `insightChartPlan` (insight.ts:206), `comparisonChartPlan` (comparison.ts:104) — alle exportiert, alle `(analysis: PdfReportAnalysis)`, alle liefern statt `boolean` einen Plan bzw. `null`.

---

## 5 — BasisMethodItem: technischer Grund oder Bau-Reihenfolge?

**Kein technischer Grund.** Der Unterschied ist Darstellung und Verschachtelung — und der nächste Verwandte steht nicht in `statement.ts`, sondern in `content.ts`.

### Der Befund

`BasisMethodItem = { id, title, body }` (basis.ts:944-950) ist ein echter Teiltyp beider Baukasten-Typen:

| Feld | BasisMethodItem | ReportStatement (statement.ts:55) | ReportNotice (statement.ts:141) | MethodologyItem (content.ts:40) |
|---|---|---|---|---|
| id | ✓ | ✓ | ✓ | ✓ |
| title | ✓ | ✓ | ✓ | ✓ |
| body | ✓ | ✓ | ✓ | ✓ |
| weitere | — | `amount` (nullbar), `rows`, `notes?` | `tone`, `list` (nullbar), `hints` | `level: 1 | 2` |

- Nach `ReportStatement` verlustfrei: `amount: null` ist vorgesehen und begründet (statement.ts:51-53), `rows: []` wird vom Renderer bereits abgefangen (document.tsx:900), `notes` ist optional. Auf der Datenseite geht nichts verloren.
- Nach `ReportNotice` nicht verlustfrei: `tone` ist Pflicht und ist laut Typkommentar Information, kein Dekor (statement.ts:136-139) — ein Methodik-Absatz müsste sich einen erfinden, und `Notice` zeichnet daraus eine farbige Randlinie (document.tsx:852). Das wäre eine Aussage, die der Absatz nicht macht.

### Warum es trotzdem ausserhalb steht

Gerendert wird der Methodik-Absatz nicht als `Statement`, sondern mit demselben Paar, mit dem `METHODOLOGY_ITEMS` gerendert wird: `styles.itemTitle` / `styles.itemBody` (document.tsx:1506-1511 gegen :1431-1436). Er liegt zudem eine Ebene tiefer — innerhalb eines `styles.statement`-Blocks mit eigener Überschrift, und genau dafür wurden `methodList`/`methodItem` angelegt (document.tsx:341-344: „dieselben Bausteine eine Ebene tiefer … braucht deshalb weniger Luft nach oben als ein Kapitel-Aufmacher").

Gemessen ist der Stilunterschied zu `Statement` klein: `itemTitle` (:345) und `statementTitle` (:369) sind zeichengleich definiert; `itemBody` und `statementBody` unterscheiden sich in einem Wert (`marginTop: 1` gegen `6`), die Container in den Aussenabständen.

### Antwort

- **Technischer Grund: nein.** Es gibt keinen Kommentar, der den eigenen Typ begründet — und das fällt auf, weil D9 die Typvorrats-Frage an der Nachbarstelle ausdrücklich gestellt und gegen einen neuen Typ entschieden hat (`ReportTableRow.heading`, statement.ts:109-115: „Ein eigener Typ dafür wäre genau das ‚zweite Typsystem daneben', das D10 ausschliesst").
- **Was es tatsächlich ist:** ein dritter „Titel + Absatz"-Typ neben `MethodologyItem` — und diesem strukturell näher als beiden `statement.ts`-Typen. `MethodologyItem` unterscheidet sich von `BasisMethodItem` in genau einem Feld (`level`), das für Methodik-Absätze bedeutungslos ist, weil sie keinen Agenda-Eintrag bekommen (nur `METHODOLOGY_ITEMS` stehen in content.ts:363).
- **Überführbar:** nach `ReportStatement` datenseitig verlustfrei, darstellungsseitig zum Preis einer Renderer-Änderung (zwei Abstandswerte, plus die Entscheidung, ob ein `Statement` innerhalb eines `Statement`-Blocks stehen darf). Nach `ReportNotice` nicht ohne erfundenen `tone`. Die sauberste verlustfreie Zusammenlegung wäre `MethodologyItem` ⟷ `BasisMethodItem` — dann trüge der Baukasten drei statt vier „Titel+Absatz"-Formen, und die zwei D9-Absatz-Sorten (fest/bedingt) wären ein Typ mit zwei Quellen.

### Was daraus für D4/D10 folgt (ohne Empfehlung, nur als Messergebnis)

- Der Katalog ist über `id` adressierbar — aber 13 ids auf 14 Stellen, drei Tabellen ohne id, und `addon_table`/`catalog_alternatives` teilen sich einen Erzeuger.
- Die Auswahl-Freiheit aus Delta-KI §5.1 („Reihenfolge frei") kollidiert mit 13 ortsgebundenen Textverweisen, von denen vier schon heute in erreichbaren Fällen ins Leere zeigen (Stand vor PR #273 — s. §2.3).
- Wiederverwendbar ohne Umbau sind genau drei Prädikate (die Kapitel-Schalter) plus drei `…ChartPlan`-Funktionen. Für die 25 Baustein-Bedingungen gibt es kein Prädikat — nur den Erzeuger, der `null` zurückgibt.
- Die Kapitel-Reihenfolge existiert zweimal (`buildReportAgenda` und der JSX-Seitenbaum). Eine KI-gewählte Reihenfolge müsste beide bedienen oder die Doppelung vorher auflösen.

---

## Nachtrag 19.09.2026 — Nachbesserung B22 verschiebt zwei Bausteine im Urbanz-Fall

Keine Änderung am Katalog (weiterhin dieselben ids, dieselben Erzeuger, dieselben Bedingungen) — geändert hat sich, **welche Bedingung im realen Referenzfall zutrifft**.

Für einen Lastgang mit `source: 'import_only'` und einem Kunden, der bereits eine PV-Anlage besitzt (`hasPv === true`), wird die geschätzte PVGIS-Erzeugung **nicht mehr vom Lastgang abgezogen** (`pvGeneratorEligibility`, Grund `pv_already_in_grid_profile`). Der Netzbetreiber-Export misst am Anschlusspunkt; die Eigenversorgung steckt dort als gesenkter Bezug bereits drin, ein Abzug zählte dieselbe Energie ein zweites Mal. Am echten Urbanz-Lastgang gemessen: 4.321,17 kWh Netzbezug über 209 Tage gegen 5.212,67 kWh gegengerechnete Erzeugung — das **1,21-fache**.

Folgen für die Instanzliste, beide in Kapitel 1 bzw. 8:

| Baustein | vorher | jetzt |
|---|---|---|
| `estimated_pv` (Notice, §1.2, summary.ts:653) | erschien — `input.estimatedPv` war gesetzt | **erscheint nicht**: es entsteht keine Schätzung, die in die Rechnung eingeht (`estimatedPvMetadata` bleibt `undefined`) |
| `data_quality` (Notice, §1.2, basis.ts:191) | trug die Warnungen des Lastgangs | trägt **zusätzlich** einen Satz: die abgelegte Reihe liegt vor, wurde aber nicht abgezogen (`run-from-draft.ts`, angehängt an `dataQuality.warnings`) |

⚠ **Die Kopfzahlen der Zusammenfassung (D8) hingen an dem Defekt mit.** `currentTariffEur` entsteht aus `buildMonthlyTariffComparison` auf `payload.load.profile` — also bis hierher auf dem gekoppelten Lastgang. Damit war „Ihre Stromkosten heute" halbiert und „reiner Tarifwechsel" fälschlich negativ; beide stehen in Kapitel 1 und sind **keine** Bausteine der Registry (s. den D8-Absatz in `CLAUDE.md`), fallen also durch jede Baustein-seitige Prüfung.

⚠ **Nicht betroffen: die PV-Rekonstruktion des künftigen PV-Kapitels.** Sie geht die andere Richtung (Bruttoverbrauch = echter Netzbezug **+** geschätzte Erzeugung) und ist ausschliesslich die „ohne PV"-Vergleichsrechnung. Die geschätzte Reihe wird deshalb weiterhin erzeugt und abgelegt — der Wizard bietet den Generator unverändert an (`checkPvGeneratorEligibility` fragt nach dem ANGEBOT, nicht nach dem ABZUG). Bis das Kapitel gebaut ist, ist sie im Report ausschliesslich über den `data_quality`-Satz sichtbar.
