# Bestandsaufnahme: Report-Baukasten und die Frage nach einer KI-Schicht

> **Stand:** 17.09.2026, Commit `f1ac6d5` (D9-Abschluss). **Reine Messung, keine Bewertung, keine
> Empfehlung** — dasselbe Format wie `KI-Interface_Kalkulator_Bestandsaufnahme.md`.
> Jede Aussage trägt eine Fundstelle; „nicht vorhanden" trägt einen Absenz-Beleg (was gesucht wurde
> und was der Suchlauf ergab).
>
> **Gegenstand:** der Report-Pfad nach den Änderungen dieser Session (D3, D5, D6, D7, D9, D12).
> **Bezugsdokumente:** `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §5,
> `Pflichtenheft_Kalkulator_Delta_Report-Baukasten.md` (D1–D15),
> `Report_Baukasten_Bestandsaufnahme.md` (16.09.2026, Stand `4dc3231`) als Vorher-Messung.

---

## 1 — Baukasten-Inventar (Delta-KI §5.1, Delta-Baukasten D10)

### 1.1 Die Darstellungstypen — acht, unverändert

`apps/website/lib/pdf-report/statement.ts` exportiert heute **acht** Typen, dieselbe Zahl wie am
Stand `4dc3231`, den D10 mit „acht Typen" zitiert:

| Typ | Fundstelle | Was er trägt |
|---|---|---|
| `ReportTone` | `statement.ts:18` | `positive \| warning \| neutral` |
| `ReportFigure` | `statement.ts:30` | Bildunterschrift + optionaler leiser Zusatz |
| `ReportRow` | `statement.ts:37` | Zeile einer Aufschlüsselung (Label, Hint, Wert, Ton, `total`) |
| `ReportStatement` | `statement.ts:55` | Kernaussage: `id`, Titel, optionale Kopfzahl, Zeilen, Fliesstext, `notes[]` |
| `ReportTableColumn` | `statement.ts:88` | Spaltenkopf + relatives Breitengewicht |
| `ReportTableRow` | `statement.ts:103` | Zeile; **neu seit D9:** `heading?: boolean` (Zwischenüberschrift) |
| `ReportTable` | `statement.ts:122` | Spalten + Zeilen |
| `ReportNotice` | `statement.ts:141` | Feststellung ÜBER die Zahlen: `id`, Ton (**kein** `positive`), Titel, Absatz, Liste, `hints[]` |

**Die Zahl acht ist also nicht überholt — gewachsen ist der Typ `ReportTableRow` um ein Feld, nicht
der Typenvorrat.** Zwei weitere Formtypen wohnen ausserhalb von `statement.ts` und werden von D10
nicht mitgezählt: `ChartLegend` (`recommendation.ts:61` — Bildunterschrift + Kapp-Aussage +
Ersatzsatz) und `BasisMethodItem` (`basis.ts:944`, **neu mit D9** — `id`/`title`/`body`).

### 1.2 Die Kapitel — sieben sind acht geworden

`content.ts` führt die Kapitel als Daten (`ReportSection`). Am Stand `4dc3231` waren es sieben;
**D7 hat ein achtes hinzugefügt** (`MONTHLY_SECTION`, `content.ts:196`).

| # | Kapitel | Fundstelle | Sichtbarkeit |
|---|---|---|---|
| — | Deckblatt | `document.tsx:1579` | immer, **ohne** Agenda-Eintrag |
| — | Agenda | `document.tsx:1583` | immer |
| 1 | Kernergebnisse | `content.ts:114` | **immer** |
| 2 | Empfehlung und Lastverlauf | `content.ts:133` | **immer** |
| 3 | Kostenverlauf und ein Tag im Detail | `content.ts:166` | **immer** |
| 4 | Ihr Stromtarif im Monatsvergleich | `content.ts:196` | **bedingt** — `hasMonthlyChapter` (`detail.ts:420`): Tarifvergleich `computable === true` **UND** keine Bestandsanlage |
| 5 | Das Ladeverhalten Ihres Speichers | `content.ts:223` | **bedingt** — `hasInsightChapter` (`insight.ts:222`): mindestens eines der beiden Bilder entsteht |
| 6 | Speichergrösse und Gerätewahl | `content.ts:252` | **bedingt** — `hasComparisonChapter` (`comparison.ts:124`): Bestandsfall ≥1 Zusatzszenario, sonst ≥1 Katalog-Alternative |
| 7 | Methodik & Vorbehalte | `content.ts:267` | **immer**; enthält 6 feste Unterpunkte (`METHODOLOGY_ITEMS`, `content.ts:42`), alle unbedingt |
| 8 | Annahmen und Datengrundlage | `content.ts:292` | **immer** — ausdrücklich kein viertes bedingtes Kapitel (`content.ts:281-289`); nur die Abschnitte darin entfallen |
| — | Abschlussseite | `document.tsx:1655` | immer, **ohne** Agenda-Eintrag |

### 1.3 Die Schalter — zwei sind drei geworden

`ReportChapterPresence` (`content.ts:323`) trug am Stand `4dc3231` genau zwei Felder (`insight`,
`comparison`); heute sind es **drei** — `monthly` kam mit D7 dazu. Ausgewertet wird **einmal** in
`document.tsx:1562-1564` und an Agenda (`buildReportAgenda`, `content.ts:357`) **und** Seitenbaum
gegeben.

### 1.4 Die Aussage-Bausteine — 13 `ReportStatement`, alle mit stabiler `id`

| `id` | Fundstelle | Kapitel | Sichtbarkeitsbedingung |
|---|---|---|---|
| `savings` (Kassen-Fassung) | `summary.ts:176` | 1 | Bestandsanlage **und** `tariffOptimization.computable === true` |
| `savings` (§3.7-Fassung) | `summary.ts:243` | 1 | sonst — schliesst die obere aus; entfällt ganz ohne durchgerechneten Kandidaten (`summary.ts:730`) |
| `peak_shaving` | `summary.ts:297` | 1 | mit primärem Eintrag; Text verzweigt an `isRealComparison` |
| `load_shift` | `summary.ts:361` | 1 | mit primärem Eintrag |
| `addon` (Klarsatz) | `summary.ts:403` | 1 | **nur Bestandsfall**, kein Zusatzgerät mit `netSavingOverHorizon > 0` |
| `addon` (positiv) | `summary.ts:417` | 1 | **nur Bestandsfall**, mindestens eines positiv |
| `recommendation` | `recommendation.ts:168` | 2 | `recommendedEntryOf` liefert einen Eintrag (`null` nur bei leerem Katalog) |
| `load_control` | `recommendation.ts:283` | 2 | `tariffOptimization.computable === true` **und** primärer Eintrag vorhanden |
| `monthly_comparison` | `detail.ts:232` | 3 **oder** 4 | im Bestandsfall in Kapitel 3 (ersetzt dort den Kostenverlauf), sonst in Kapitel 4 — **dieselbe Ableitung, zwei Orte** (`detail.ts:424`) |
| `hour_flow` | `insight.ts:304` | 5 | `batteryFlowByHourMonth` vorhanden **und** `summarizeHourFlow(...).hasData` |
| `charge_price` | `insight.ts:370` | 5 | `dispatchTrace.monthlyChargePrice` vorhanden |
| `addon_table` / `catalog_alternatives` | `comparison.ts:312` | 6 | mindestens eine Tabellenzeile (`shown.length > 0`) |
| `addon_none` | `comparison.ts:262` | 6 | Gegenstück dazu — schliesst `addon_table`/`catalog_alternatives` aus |
| `assumptions` | `basis.ts:123` | 8 | **immer** |

### 1.5 Die Hinweis-Bausteine — 8 `ReportNotice`

| `id` | Fundstelle | Kapitel | Ton | Sichtbarkeitsbedingung |
|---|---|---|---|---|
| `standard_profile` | `summary.ts:593` | 1 | neutral | `loadProfile.source === 'standard_profile'` |
| `estimated_pv` | `summary.ts:653` | 1 | neutral | `estimatedPv` gesetzt |
| `partial_year` | `summary.ts:526` | 1 | warning | `billingModel` beginnt mit `monthly` **und** `coveredMonths < 12` |
| `large_gap` | `summary.ts:556` | 1 | warning | `largestGapSlots > LARGE_GAP_SLOTS_THRESHOLD` |
| `data_quality` | `basis.ts:191` | 8 | neutral | `dataQuality.warnings.length > 0` (**nicht** an `gapsInterpolated` gemessen) |
| `tariff_blocker` | `basis.ts:273` | 8 | warning | `tariffOptimization` gesetzt **und** `computable === false`; `undefined` ⇒ kein Befund |
| `pv_outage` (**D5**) | `basis.ts:349` | 8 | warning | `hasPv === true` **und** `pvOutageMonths.length > 0` — beide nötig |
| `limitations` (**D9**) | `basis.ts:1119` | 8 | neutral | **immer**; ein bedingter Punkt darin hängt an `analysis.annualProjection` (`basis.ts:1103`) |

Die Reihenfolge der vier Hinweise auf der Kernergebnis-Seite ist fest (`buildNotices`,
`summary.ts:696`), nicht wählbar.

### 1.6 Tabellen und Methodik-Absätze — drei `ReportTable`, vier `BasisMethodItem`

| Baustein | Fundstelle | Sichtbarkeit |
|---|---|---|
| Kandidatentabelle | `buildCandidateTable`, `comparison.ts:171` | Kapitel 6, wenn `shown.length > 0` |
| **Tarifkomponenten** (D9) | `buildTariffComponents`, `basis.ts:885` | Kapitel 8, **immer**; eine Zeile je Feld, das den Render-Lauf erreicht — die übrigen bekommen **ausdrücklich keine** „keine Angabe"-Zeile (`basis.ts:772-789`) |
| **Datenquellen** (D9) | `buildDataSources`, `basis.ts:740` | Kapitel 8, **immer**; drei Gruppen (Lastgang / Tarif / Batterie) über `heading`-Zeilen (`groupRow`, `basis.ts:512`) |
| `method_current_tariff`, `method_spot_uncontrolled` | `basis.ts:962`, `:974` | Kapitel 8, wenn `tariffOptimization.computable === true` |
| `method_load_control` | `basis.ts:1003` | dasselbe **und** primärer Eintrag vorhanden |
| `method_pv_outage` | `basis.ts:1029` | genau dann, wenn der `pv_outage`-Hinweis steht (am Hinweis gemessen, `basis.ts:1064`) |

Die Überschrift „Berechnungsmethodik je Kennzahl" hängt an der Liste (`document.tsx:1502`) — leere
Liste, keine Überschrift.

### 1.7 Die Bilder — sieben Rasterplätze

`ReportChartRasters` (`charts.tsx:72`) führt heute **sieben** Bildplätze; am Stand `4dc3231` waren es
sechs, `monthly` kam mit D7 dazu (`charts.tsx:102`).

| Platz | Komponente | Sichtbarkeit |
|---|---|---|
| `load` | `load-chart` | Kapitel 2, immer versucht |
| `cost` (`costKind: 'monthly' \| 'cumulative'`) | `monthly-tariff-chart` bzw. `cost-chart` | Kapitel 3; `monthly` nur im Bestandsfall mit rechenbarem Vergleich, sonst `cumulative` (`detailChartPlan`, `detail.ts:117`) |
| `monthly` | `monthly-tariff-chart` | Kapitel 4, nur bei `hasMonthlyChapter` |
| `flow` | `energy-flow-chart` | Kapitel 3, nur wenn `representativeDays.length > 0` |
| `hourFlow` | `battery-flow-heatmap` | Kapitel 5, nur wenn `summarizeHourFlow(...).hasData` |
| `chargePrice` | `charge-price-chart` | Kapitel 5, nur mit echter Preiskurve |
| `comparison` (`comparisonVariant: 'addon' \| 'catalog'`) | `marginal-benefit-chart` | Kapitel 6, nur bei ≥2 zeichenbaren Punkten (`comparison.ts:104`) |

Ein fehlgeschlagenes Bild kostet das Dokument nicht (`charts.tsx:63-68`); jedes `…Missing`/`…Error`
trägt statt dessen einen Begründungssatz.

### 1.8 Abstand zur Delta-Formulierung „acht Typen, sieben Kapitel-Module, zwei Schalter"

Gemessen gegen `4dc3231` (die Grundlage, auf die sich D10 bezieht):

| Grösse | D10-Stand | heute | Differenz |
|---|---|---|---|
| Darstellungstypen in `statement.ts` | 8 | **8** | unverändert (ein Feld mehr in `ReportTableRow`) |
| Kapitel (`ReportSection`, Agenda) | 7 | **8** | +1 (`MONTHLY_SECTION`, D7) |
| Schalter (`ReportChapterPresence`) | 2 | **3** | +1 (`monthly`, D7) |
| `ReportStatement`-Bausteine (stabile `id`) | 13 | **13** | unverändert — nachgezählt an beiden Ständen; `monthly_comparison` hat mit D7 eine **zweite** Rendering-Stelle bekommen, aber keine zweite `id` |
| `ReportNotice`-Bausteine | 6 | **8** | +2 (`pv_outage` D5, `limitations` D9) |
| `ReportTable`-Instanzen | 1 | **3** | +2 (D9) |
| `BasisMethodItem` | 0 | **4** | +4 (D9, neuer Formtyp) |
| Bildplätze | 6 | **7** | +1 (D7) |

**Die Zahl „acht Typen" ist nicht überholt; „sieben Kapitel-Module" und „zwei Schalter" sind es.**
Gewachsen ist der Katalog in der Breite der Instanzen — **+2 Hinweise, +2 Tabellen, +4
Methodik-Absätze, +1 Kapitel, +1 Bild** —, nicht im Vorrat der Formtypen (dort kam ein Feld und,
ausserhalb von `statement.ts`, ein Typ hinzu). Die Aussage-Bausteine selbst sind in der Zahl
**unverändert**; die D9-Arbeit lag auf Tabellen und Hinweisen, die D5-Arbeit auf einem Hinweis.

### 1.9 Was von der D4-Matrix gebaut ist

Die Konditional-Matrix (D4) hat **keinen eigenen Commit**; gebaut wurden D3, D5, D6, D7, D9, D12
(`git log --oneline -60 | grep -E "^[0-9a-f]+ D[0-9]"`: keine D4-, D8-, D10-, D11-Zeile). Die
einzige Code-Erwähnung von D4 steht in `basis.ts:322` („D4-Matrix, Zeile ‚PV vorhanden'") und in
`types.ts` — **eine** Matrixzeile ist über D5 real geworden, die übrigen sind es als jeweils eigene
Bedingung an bestehenden Bausteinen (Abschnitte 1.4–1.7), nicht als benannte Matrix.

---

## 2 — KI-Aufruf im Report-Pfad

**Zwischen `AnalysisResult` und dem gerenderten PDF bzw. der Bildschirmseite gibt es keinen
LLM-Aufruf.**

**Absenz-Beleg:**
1. `grep -rn "@anthropic-ai/sdk" apps packages` liefert 21 Treffer — **keiner** davon liegt in
   `apps/website/lib/pdf-report/**` oder unter `apps/website/app/report/**`.
2. Die vollständige Importliste des Moduls `apps/website/lib/pdf-report/*` (24 Dateien) enthält
   ausschliesslich: `./`-Geschwister, `@/components/report/*`, `@/lib/{company,constants,format,
   local-time,report-copy}`, `@react-pdf/renderer`, `engine`, `react`, `react-dom/client`,
   `shared`, `vitest`. Kein Netzwerk-Client, kein SDK.
3. Die Leseroute `apps/website/app/report/[requestId]/report-client.tsx` importiert
   `@supabase/supabase-js`, `lucide-react`, die eigenen UI-Bausteine und — dynamisch —
   `@/lib/pdf-report/download` (`:103`). Sonst nichts.
4. `grep -rn "anthropic" packages/engine/src` → 0 Treffer.

**Eine Abgrenzung, damit der Befund nicht zu weit gelesen wird:** `apps/website` hat sehr wohl eine
KI-Anbindung im Umfeld des Bildschirm-Reports — `apps/website/lib/report-request/` („Delta 18 —
Report-Anfrage-Übersetzung", `ai-client.ts:6`, die fünfte KI-Anbindung des Repos), eingehängt über
`components/report/report-request-panel.tsx` in `components/report/report.tsx:43`. Sie sitzt
**vor** der Engine, nicht dahinter:

- Hinaus geht **genau ein vom Nutzer getippter Satz** — kein Lastgang, keine Rechnung, kein
  Ergebnis (`extract.ts:16-20`).
- Zurück kommen **acht Skalare plus eine geschlossene Ablehnungsliste**
  (`REPORT_REQUEST_FIELDS`, `packages/shared/src/report-request.ts:52`: `billingModel`,
  `horizonYears`, `subsidyPercent`, `fixedSubsidyEur`, `depreciationYears`, `taxRatePercent`,
  `roundTripEfficiencyPercent`, `pricePerKwh`) — kein Freitext, keine Begründung, keine Empfehlung.
- Angewendet wird nichts, vorgeschlagen alles; die Bestätigung führt zu einem **neuen Engine-Lauf**
  (`extract.ts:38-44`).

Der Report-**Inhalt** entsteht damit heute zu 100 % deterministisch aus `PdfReportInput`.

---

## 3 — Admin-Tool: gibt es eine Konfiguration für Report-INHALT?

**Nein.** Der einzige Hebel ist der Entwurf selbst (Daten), nicht eine Präsentationsentscheidung.

Was im Admin-Bereich tatsächlich existiert (`apps/web/app/admin/(intern)/`):

| Route | Was sie pflegt |
|---|---|
| `kalkulator-projekte/[id]/dateneingabe` | die fünf Wizard-Stationen — **Daten** |
| `kalkulator-projekte/[id]` Abschnitt „Report" (`page.tsx:220-261`) | **ein Knopf je Zählpunkt** (`Zählpunkt N rechnen`), sonst nichts |
| `ki-prompts` | zwei System-Prompt-Erweiterungen, `kind ∈ {kunde, ki_check}` — ausschliesslich **Chat**, „Ton und Feinschliff"; die Kern-Prompts stehen im Code (`ki-prompts/page.tsx:17-23`) |
| `analysen`, `netzbetreiber-tarife`, `lieferanten-tarife`, `leads`, `partner*`, `rueckfragen` | Archiv bzw. Fachdaten — kein Report-Inhalt |

Die auslösende Aktion `createReportRenderRequestAction`
(`apps/web/lib/admin/report-render-actions.ts:62`) nimmt **zwei** Formularfelder entgegen:
`projectId` und `meteringPointId` (`:63-70`). Alles Weitere ist fest verdrahtet:
`p_ttl_hours: 24` als Literal (`:242`), `report_input_meta` als **neun Felder und keines mehr**
(`:165`, aufgezählt `:185-218`). **Kein Parameter wählt ein Kapitel, eine Reihenfolge, eine
Grafikart oder einen Text.**

**Absenz-Beleg:** `grep -rn "report-render\|createReportRenderRequest\|/report/" apps/web` liefert
sechs Treffer, davon genau einen UI-Aufrufer (`kalkulator-projekte/[id]/page.tsx:251`).
`find apps/web/components/admin -name "*report*"` → 0 Treffer.

---

## 4 — Taugen `ReportStatement`/`ReportNotice` als Auswahlmenge für eine KI?

Gemessen, nicht bewertet — die Trennlinie verläuft zwischen **Darstellung** und **Erzeugung**:

### 4.1 Auf der Darstellungsseite ist die Bindung bereits gelöst

`document.tsx` rendert **jedes** Statement durch genau eine Komponente `Statement`
(`document.tsx:887`, Signatur `{ statement: ReportStatement }`) und **jeden** Hinweis durch `Notice`
(`:850`, `{ notice: ReportNotice }`). Beide kennen ihren Kontext nicht: sie lesen ausschliesslich die
Felder des Objekts. Dieselbe Generik bei `StatementTable` (`:941`) und `ChartFigure` (`:1104`).
Ein Statement ist an dieser Stelle **ortsunabhängig** — es liesse sich in jedem Kapitel rendern,
ohne eine Zeile Renderer anzufassen.

Die Annahme-/Messwert-Kennzeichnung ist dabei **im Objekt** und nicht im Renderer: `tone`
(`ReportNotice` kennt kein `positive`, `statement.ts:139`), `amount: null` wo es keine Zahl gibt
(`statement.ts:47-51`), `notes[]`/`hints[]` für die Vorbehalte. Das ist genau, was Delta-KI §5.3
„vorqualifizierte Aussage-Bausteine" nennt.

### 4.2 Auf der Erzeugungsseite ist die Bindung dreifach vorhanden

1. **Kein Objekt existiert unabhängig von seinem Erzeuger.** Es gibt keinen Katalog und keine
   Registry; jedes Statement entsteht in einer privaten `build…`-Funktion, die nur über ihre
   Kapitel-Fassade erreichbar ist. Exportiert sind ausschliesslich sechs Kapitel-Erzeuger
   (`buildReportSummary`, `buildRecommendationChapter`, `buildDetailChapter`,
   `buildMonthlyChapter`, `buildInsightChapter`, `buildComparisonChapter`, `buildBasisChapter`) —
   **kein einziger Baustein-Erzeuger ist einzeln exportiert** (`grep -n "^export function"` über
   die sechs Module).
2. **Die Signaturen sind ungleich.** `buildSavings(analysis, entry)` gibt ein Paar aus Statement
   und `isRealComparison` zurück (`summary.ts:151`), `buildPeakShaving(analysis, entry,
   savingsIsRealComparison)` nimmt diesen Rückgabewert als dritten Parameter (`summary.ts:274`),
   `buildBasisChapter(input)` nimmt den vollen `PdfReportInput`, `buildPvOutage(hasPv, months)`
   zwei Skalare. Ein einheitlicher Aufruf „baue alle Bausteine, die für diesen Fall in Frage
   kommen" existiert nicht.
3. **Der Text zeigt auf seine Nachbarn.** Die Körper referenzieren ihre Position im Dokument
   wörtlich: „steckt **NICHT in der Zahl oben**" (`summary.ts:301`), „Die Zeile ‚Wert der
   Ladesteuerung' in der **Aufschlüsselung oben**" (`summary.ts:344`), „steht bereits **auf der
   Kernergebnis-Seite**" (`recommendation.ts:286`), „wie die Empfehlung **im Kapitel ‚Empfehlung und
   Lastverlauf'**" (`comparison.ts:330`), „**Ob ein ZUSÄTZLICHES Gerät** … steht in den
   Kernergebnissen" (`recommendation.ts:152`). Zwei Bausteine sind sogar **gegenseitig**
   verschränkt: `buildPeakShaving` und `buildLoadShift` formulieren ihren Abgleichsatz abhängig
   davon, welche Fassung von `savings` oben steht (`summary.ts:290-301`, `:338-350`).

### 4.3 Der Befund in einem Satz

**Der Typ ist frei, der Text ist gebunden.** Ein Katalog bestehender Statement-**Objekte** liesse
sich einer KI übergeben, ohne die Objekte neu zu bauen — die Typen tragen alles Nötige und der
Renderer stellt keine Ortsbedingung. Was ein Umhängen heute nicht überstünde, sind die
Querverweise **im `body`**: sie sind für eine feste Reihenfolge geschrieben und würden bei freier
Auswahl/Anordnung auf Nachbarn zeigen, die nicht (mehr) dort stehen. Dazu kommt, dass es den
Katalog als Datenstruktur **nicht gibt** — er müsste aus sechs Kapitel-Fassaden mit ungleichen
Signaturen erst zusammengesetzt werden.

---

## 5 — DB-gepflegte Report-Konfiguration (Analogie zum Fragenkatalog, §4.2)

**Nicht vorhanden.**

**Absenz-Beleg:**
1. `grep -rn "rendered_report\|report_template\|report_section\|report_prompt\|report_blocks"
   supabase/migrations/` → **0 Treffer**.
2. `ls supabase/migrations | grep -i report` → **zwei** Dateien:
   `20260830090100_create_report_download_source.sql` (eine `lead_sources`-Zeile `rechner-report`,
   Delta 16b) und `20260916090000_create_report_render_requests.sql` (D12, s. Punkt 6). Keine
   Vorlagen-, Prompt- oder Kapitel-Tabelle.
3. Das Fragenkatalog-Muster existiert und ist der Gegenbeleg: `platform.question_catalog` +
   `question_catalog_deletions` (`20260910120000_create_question_catalog.sql`), dazu
   `platform.system_prompt_extensions` mit `kind`-Kette (`20260915120000_…`). Beide betreffen
   **Chat**, nicht den Report — `system-prompt-extensions.ts` kennt genau die zwei Werte
   `kunde` und `ki_check` (`apps/web/lib/admin/system-prompt-extensions.ts`,
   `PROMPT_EXTENSION_KINDS`).

Der gesamte Report-Inhalt ist damit **Code**, nicht Konfiguration: Kapitel in `content.ts`, Texte in
den sechs Ableitungsmodulen, Methodik-Punkte als Konstante (`METHODOLOGY_ITEMS`, `content.ts:42`).

---

## 6 — Archivierung, Ist-Stand

### 6.1 Was `platform.analyses` heute speichert

Migration `…_create_analysis_persistence.sql` (B14-1), Tabelle ab `:57`:

| Spalte | Art |
|---|---|
| `id`, `lead_id` (SET NULL), `created_by` (SET NULL), `created_at` (`clock_timestamp()`) | Verwaltung |
| `customer_label` (not null, denormalisiert), `site_label` | Zuordnung |
| `analysis_kind` (`betreut` \| `intern`), `supersedes_id` | Einordnung |
| `engine_version`, `engine_commit_sha`, `computed_at` | Womit gerechnet wurde |
| **`inputs jsonb`**, **`result jsonb`** | Eingangsgrössen und der vollständige `AnalysisResult`, **wortgleich wie berechnet** (`:96-101`) |
| `baseline_billed_kw_before/_after`, `baseline_annual_saving_eur`, `recommended_battery_label`, `recommended_capacity_kwh` | fünf typisierte Auszüge |
| `source_file_name`, `source_file_sha256`, `source_file_gzip` | die archivierte Quelldatei |

**Es gibt keine Spalte für den gerenderten Report.** Absenz-Beleg: `grep -rn "rendered_report"
supabase/migrations/` → 0 Treffer; die Spaltenliste oben ist vollständig (`:57-146`). Damit ist
`Report_Baukasten_Bestandsaufnahme.md` §10.7 unverändert gültig und **D11 ist nicht gebaut** (kein
D11-Commit, s. 1.9).

### 6.2 Was `platform.report_render_requests` speichert — und was es ausdrücklich nicht ist

Migration `20260916090000_create_report_render_requests.sql` (D12 Teil 1):

- **Spalten:** `id` (zufällige UUID), `created_by` (**not null**, `ON DELETE CASCADE`), `created_at`,
  `expires_at`, `analysis_result jsonb`, `load_profile jsonb`, `report_input_meta jsonb`.
- **TTL:** Spalten-Vorgabe `now() + 6 hours`; der Wrapper erzwingt `1 ≤ p_ttl_hours ≤ 24` (22023
  ausserhalb). Der einzige produktive Aufrufer setzt **24** (`report-render-actions.ts:242`) — die
  im Auftrag genannten „24h" sind also der gewählte Wert, nicht die Vorgabe.
- **Zugriff:** RLS an, **keine Policy, für keine Rolle ein Tabellenrecht**; Schreiben über
  `public.create_report_render_request` (authenticated + `is_admin()`), Lesen über
  `public.get_report_render_request` (anon + authenticated, **bewusst ohne Adminprüfung**).
  Es gibt **keine Auflistungsfunktion** — das ist laut Migrationskopf einer der drei Schutzpfeiler.
- **Kein Aufräum-Job** (Migrationskopf, letzter Absatz): abgelaufene Zeilen bleiben stehen, die
  Prüfung im Wrapper trägt die Korrektheit.
- Die Migration sagt ausdrücklich: „**KEIN Archiv** — das ist `platform.analyses`" und
  „`platform.analyses` wird von dieser Migration **NICHT** angefasst".

### 6.3 Wird Struktur und Text irgendwo als Ganzes gespeichert?

**Nein.** Gespeichert werden ausschliesslich **Eingangsgrössen**: `analysis_result`, `load_profile`
und neun Meta-Felder (`customerLabel`, `netzbetreiber`, `supplierBaseFeeEurPerMonth`, `hasPv`,
`pvOutageMonths`, `gridTariffValidFrom`, `invoicePeriods`, `meteringPointId`, `projectId` —
`report-render-actions.ts:185-218`; die Leseseite liest davon sieben, `build-report-input.ts:51`).
Der zusammengesetzte Baukasten-Output — `ReportSummary`, `RecommendationChapter`, `DetailChapter`,
`MonthlyChapter`, `InsightChapter`, `ComparisonChapter`, `BasisChapter` und die sieben Rasterbilder
— entsteht **im Browser des Admins** (`report-client.tsx:103`, dynamischer Import von
`downloadReportPdf`) und **wird nirgends zurückgeschrieben**.

**Absenz-Beleg für den Rückweg:** `grep -rn "admin_create_analysis" apps/website` → 0 Treffer;
`apps/website` besitzt keinen angemeldeten Schreibpfad nach `platform` (nur anon- und
service_role-Schlüssel). Das ist genau die in D11 als `[OFFEN]` markierte Lücke, unverändert offen.

---

## 7 — Rollup-Schicht (§2.4 / D13)

**Der Report-Pfad ist durchgängig auf genau einen Zählpunkt ausgelegt.** D4 berührt die
Mehrfach-Zählpunkt-Frage an keiner Stelle.

**Belege:**
1. `apps/web/lib/admin/report-render-actions.ts:33-36`: „**GENAU EIN ZÄHLPUNKT JE AUFRUF** — Kein
   Rollup über die Zählpunkte eines Projekts (D13)." Die Aktion verlangt `meteringPointId` als
   Pflichtfeld (`:68-70`).
2. Die Admin-Oberfläche erzeugt **einen Knopf je Zählpunkt**
   (`kalkulator-projekte/[id]/page.tsx:241-257`) — n Zählpunkte ergeben n unabhängige Übergaben,
   keine zusammengefasste.
3. `platform.report_render_requests` hält je Zeile **ein** `analysis_result` und **ein**
   `load_profile` (Migration `:52-56`) — die Struktur kennt keine Mehrzahl.
4. `PdfReportInput` (`types.ts`) trägt **ein** `analysis` und **ein** `loadProfile`, beide Pflicht;
   `meteringPointId`/`projectId` werden von der Leseseite bewusst **nicht** übernommen
   (`build-report-input.ts:41-44`).
5. `grep -rni "rollup" apps/web/lib apps/website/lib packages/engine/src packages/extractors/src`
   → **genau ein Treffer**, und der ist der Verneinungs-Kommentar aus (1).

Ein Projekt mit mehreren Zählpunkten bekommt heute also n Einzelreports; der in D13 vorgesehene
„explizite Blocker/Hinweis im Admin-Bereich" existiert **nicht** — die Oberfläche bietet die
Einzelläufe an, ohne die fehlende Zusammenfassung zu benennen.

---

## Anhang: was seit `4dc3231` gebaut wurde (Commit-Beleg)

| Baustein | Commits |
|---|---|
| D3 — Engine-Einstiegspunkt | `af96a3d`, `324a4fb`, `7fe8e73`, `35d5cb3`, `3abce6c`, `11b2a62`, `5809dbb` |
| D12 — Weg Wizard → Report | `6e7b95a`, `e188516`, `539f49e`, `5fcba8f` |
| D5 — PV-Ausfallerkennung | `de82e8b` |
| D6 — Jahres-Hochrechnung | `fc3356a`, `7591025`, `14ecdba` |
| D7 — Kostenvergleich (drei Balken, Vorbereitung) | `cef183e`, `cef149b`, `25c9ad5`, `0583814` |
| D9 — Annahmen/Datengrundlage | `042580c`, `3fdb8e7`, `ede8688`, `66f2e6d`, `f1ac6d5` |
| **D4, D8, D10, D11** | **kein Commit** |

Ergänzend gegen `Report_Baukasten_Bestandsaufnahme.md` §10.5 („`apps/website` hat 0 Testdateien und
kein `test`-Skript"): das gilt **nicht mehr** — `apps/website/package.json` führt `"test": "vitest
run"`, und im Report-Pfad liegen vier Testdateien (`basis.test.ts` 565 Zeilen,
`build-report-input.test.ts` 168, `detail.test.ts` 116, dazu `chart-probe.tsx`).
