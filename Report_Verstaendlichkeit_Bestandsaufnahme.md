# Report-Verständlichkeit — Bestandsaufnahme gegen den echten Code

> **Stand 08.09.2026. KEIN Bau, KEINE Bewertung, KEINE Empfehlung.** Diese Datei prüft acht Behauptungen
> gegen den tatsächlichen Code und die tatsächlich gerechneten Zahlen. Jeder Befund ist entweder mit
> `Datei:Zeile` belegt oder ausdrücklich als **falsch** bzw. **abweichend** korrigiert. Wo eine Behauptung
> aus einem Pflichtenheft oder aus `CLAUDE.md` stammt und der Code etwas anderes sagt, gilt hier der Code.
>
> Der Gegenstand ist der **Bildschirm-Report** (`apps/website/components/report/report.tsx`), nicht der
> react-pdf-Weg (`apps/website/lib/pdf-report/**`, B23). Wo beide auseinanderlaufen, ist das vermerkt.

---

## 0 — Wie gemessen wurde

Drei Werkzeuge, alle drei nach dem Lauf wieder entfernt (`git status` sauber):

**(a) Rechenlauf gegen die Engine.** Eine temporäre vitest-Datei in `packages/engine/src/` hat die
Aufrufreihenfolge aus `apps/website/lib/analysis.worker.ts:191-322` (`computeAnalysis`) Zeile für Zeile
nachgebaut und mit den Eingaben des bestehenden Prüfstands gefahren
(`apps/website/app/pdf-report-probe/summary-fixtures.ts`, `chart-fixtures.ts`). **⚠ Das ist eine
NACHGEBAUTE Orchestrierung, kein Aufruf des Workers** — der läuft nur im Browser (`new Worker(...)`,
`analysis-run.ts:216`). Was daraus folgt, ist unten je Befund benannt.

**(b) Render-Probe der echten Komponenten.** Ein esbuild-Bündel (esbuild 0.28.1 aus dem pnpm-Store) hat
`RecommendationCard`, `TariffOptimizationCard` und `KeyMetric` **unverändert** mit `renderToStaticMarkup`
gegen die unter (a) gerechneten `AnalysisResult`-Werte gerendert. Gemessen wurde am erzeugten HTML, nicht
an einer Ableitung. Das ist die Grundlage der Anwesenheits-/Abwesenheits-Tabellen (Punkt 4c) und der
Zahlenfolgen in Punkt 2 und 8. Vier Läufe: `BESTAND`, `BLOCKER`, `KATALOG` (Tabelle unten) und der leere
Fall aus Punkt 8.

**(c) Statische Ablesung** von `report.tsx` und den Karten für Reihenfolge und Bedingungen.

**Prüf-Eingaben** (aus `summary-fixtures.ts`, unverändert): Volljahrgang 35.040 Werte / Jahreshöchstwert
50,78 kW · Wiener Netze NE 3 (Leistungspreis 38,52 €/kW·a, Netzverlust 0,109 ct, Arbeitspreis Netz
0,49 ct) · `annual_max` · Arbeitspreis 25 ct · Einspeisevergütung 8 ct · Bestandsspeicher
19,2 kWh / 10,6 kW / η 0,9 · Betrachtungszeitraum 10 Jahre · Spotpreis-Reihe synthetisch mit Tages- und
Jahresgang. Drei Fälle:

| Fall | Bestandsanlage | `tariffPricing` | Ergebnis |
|---|---|---|---|
| `BESTAND` | ja (19,2 kWh) | vollständig | `tariffOptimization.computable = true`, `monthlyComparison` vorhanden |
| `BLOCKER` | ja (19,2 kWh) | `spotPrices: null` | `computable = false`, `side: spot_price`, `kind: unavailable`, `ranges: []` |
| `KATALOG` | nein | vollständig | `computable = true`, **kein** `monthlyComparison` |

**Bau und Prüfungen:** `pnpm build` und `pnpm test` root-weit grün, Testzahlen unverändert —
shared **264** · engine **321** · tariff-monitor **62** · apps/web **705**. Es wurde keine Zeile
Produktionscode geändert.

---

## 1 — Tatsächliche Kartenreihenfolge in `report.tsx`

Aus dem JSX des `return`-Blocks abgelesen (`apps/website/components/report/report.tsx:655-945`), nicht aus
der Doku übernommen.

| # | Element | Zeile | Sichtbarkeitsbedingung |
|---|---|---|---|
| 1 | `KeyMetric` (Jahreshöchstwert + Leistungspreis-Kosten) | 657–659 | **unbedingt** |
| 2 | Alert „Auf Basis eines Standardlastprofils" | 661–680 | `isStandardProfile` = `loadProfile.source === 'standard_profile'` (Def. Z. 217) |
| 3 | `EstimatedPvNote` | 689 | Prop `estimatedPv != null`; die Komponente selbst hat keinen `null`-Zweig (`estimated-pv-note.tsx:38`) |
| 4 | Alert „Nur X von 12 Monaten mit Daten" (+ Knopf „Mit Jahreshöchstwert rechnen") | 691–710 | `showPartialYearWarning` = `billingModel.startsWith('monthly') && dataQuality.coveredMonths < 12` (Def. 180–181) |
| 5 | Alert „Grosse Datenlücke: N Tage am Stück" | 712–733 | `showLargeGapWarning` = `largestGapSlots > LARGE_GAP_SLOTS_THRESHOLD` (Def. 200–202; Schwelle `4*7*96 = 2688`, `lib/constants.ts:54`) |
| 6 | Raster `lg:grid-cols-3` | 735–830 | **unbedingt** |
| 6a | ↳ linke Spalte: `RecommendationCard` **primär** | 746–764 | `existingAnalysis ? <… variant="existing" primary monthlyComparison={…}> : recommended && <… primary>` |
| 6b | ↳ linke Spalte: `TariffOptimizationCard` | 775–779 | im JSX **unbedingt**; die Komponente gibt `null` zurück bei `status === undefined` (`tariff-optimization-card.tsx:89`) |
| 6c | ↳ rechte Spalte: Kasten „Lastgang mit Kapp-Linie" (`LoadChart`) | 782–799 | **unbedingt**; Unterzeile wechselt an `isExisting` (791) |
| 6d | ↳ rechte Spalte: inneres Raster `sm:grid-cols-2 print:grid-cols-1` | 806–828 | **unbedingt** |
| 6d-i | ↳↳ **Bestandsfall:** `monthlyTariffBox` · `energyFlowBox` · `nextStepBox` | 814–818 | `monthlyTariffBox` nur bei vorhandenem `monthlyComparison` (Def. 429–433), sonst `null` |
| 6d-ii | ↳↳ **Katalogfall:** `costChartBox` · Spalte(`energyFlowBox`, `nextStepBox`) | 820–826 | `costChartBox` unbedingt (Def. 382–396) |
| 7 | `dispatchInsightSection` — Heatmap + Ø-Ladepreis | 837 (Def. 502–520) | `primaryEntry && (hourFlow \|\| chargePrice)`; darin `hourFlow && <BatteryFlowHeatmap>` (515) und `chargePrice && <ChargePriceChart>` (518). **⚠ `BatteryFlowHeatmap` gibt zusätzlich `null` zurück bei `!anyCovered \|\| maxAbs === 0`** (`battery-flow-heatmap.tsx:86`) |
| 8a | **Bestandsfall:** `addonSection` („Lohnt sich ein zusätzlicher Speicher?") | 840 (Def. 584–653) | `existingAnalysis != null`; darin Grenznutzen-Kurve **unbedingt** (601–605), darunter entweder Aufklappliste (606–629, `netSavingOverHorizon > 0`, Def. 580–582) **oder** Klarsatz-Alert (631–650) |
| 8b | **Katalogfall:** `catalogMarginalBenefit` + `alternativesAccordion` | 843–844 | Kurve unbedingt (Def. 547–549); Aufklappliste nur bei `alternatives.length > 0` (Def. 522–540, `.slice(0,3)` in 148) |
| 9 | `ReportRequestPanel` (Freitext-Anfrage) | 855–860 | **unbedingt**, `print:hidden` in der Komponente |
| 10 | Accordion „Annahmen & Rechenweise" | 862–901 | **unbedingt**, `print:hidden` (865) |
| 11 | `PrintAssumptionsSnapshot` | 904 | **nur Druck** (`hidden print:block`) |
| 12 | `PrintMethodology` | 912 | **nur Druck** |
| 13 | Alert „Datenqualität" | 914–930 | `dataQuality.warnings.length > 0` |
| 14 | `TariffSourceNote` | 934 | **unbedingt** — die Komponente hat keinen `null`-Zweig und rendert auch für `source === null` einen eigenen Satz (`tariff-source-note.tsx:27`) |
| 15 | `TariffVintageNote` | 938 | Komponente gibt `null` zurück ohne letzten Messwert (`tariff-vintage-note.tsx:44`) oder wenn das Zeitraumende **vor** dem laufenden Kalenderjahr liegt (48) |
| 16 | Demo-Disclaimer („Zahlen sind noch nicht … validiert") | 940–944 | **unbedingt** |

**Befund:** Die Reihenfolge stimmt mit dem, was `CLAUDE.md` beschreibt, überein. Drei Punkte, die aus der
Doku allein nicht hervorgehen und hier ergänzt sind:

- **Die Reihenfolge der vier Hinweise über dem Raster ist fest** (Standardprofil → geschätzte PV →
  Teiljahr → Datenlücke) und in `report.tsx:682-688` ausdrücklich begründet.
- **`dispatchInsightSection` steht ZWISCHEN dem Raster und dem Empfehlungs-/Zusatzspeicher-Block**
  (Zeile 837 vor 839), nicht darunter.
- **Der Kasten `dispatchInsightSection` kann leer sein**: seine Bedingung liest das blosse Vorhandensein
  von `hourFlow`, die Heatmap darin gibt aber bei `maxAbs === 0` selbst `null` zurück (s. Punkt 8).

---

## 2 — Dieselbe Zahl in zwei visuellen Rahmungen

### 2.1 Die beiden namentlich genannten Behauptungen

**Behauptung A — „`totalSavingPerYear` als Kopfzahl der Tarifoptimierungs-Karte":
STIMMT NICHT.**
Die Kopfzahl der Tarifoptimierungs-Karte ist `loadShiftSavingPerYear`, nicht `totalSavingPerYear`:

```
tariff-optimization-card.tsx:132   const saving = recommended?.loadShiftSavingPerYear ?? 0
tariff-optimization-card.tsx:202   <Num className="block text-3xl …">{formatEur(saving)}</Num>
```

`totalSavingPerYear` kommt in `tariff-optimization-card.tsx` **0×** vor (Auszählung aller Vorkommen von
`totalSavingPerYear` / `loadShiftSavingPerYear` / `selfConsumptionSavingPerYear` /
`leistungspreisSavingPerYear` über `apps/website/components/report/`).

**Behauptung B — „`loadShiftSavingPerYear` als Kopfzahl der Zusatzspeicher-Karte":
STIMMT NICHT.**
Die Kopfzahl der Zusatzspeicher-Karte (`RecommendationCard` mit `variant='addon'`) ist
`entry.totalSavingPerYear` unter der Beschriftung „Zusätzliche Ersparnis / Jahr":

```
recommendation-card.tsx:225   {addon ? 'Zusätzliche Ersparnis / Jahr' : 'Ersparnis / Jahr'}
recommendation-card.tsx:228   {formatEur(entry.totalSavingPerYear)}
```

**Die beiden Behauptungen sind gegeneinander verschoben.** Was tatsächlich existiert, ist die Kombination
aus beiden Hälften:

> **`loadShiftSavingPerYear` steht als Kopfzahl der Tarifoptimierungs-Karte
> (`tariff-optimization-card.tsx:202`) UND als Zeile „Tarifbewusstes Laden" in der §3.7-Aufschlüsselung
> der Empfehlungskarte (`recommendation-card.tsx:345`).**

**Gemessen (Render-Probe, Fall `KATALOG`):** beide Stellen zeigen **€ 1.634** — dieselbe Zahl, zweimal,
in zwei **unmittelbar untereinander stehenden Karten derselben (linken) Spalte** des Rasters
(`report.tsx:746-764` Empfehlungskarte, `:775-779` Tarifoptimierungs-Karte).

**Und `totalSavingPerYear` ist ebenfalls doppelt gerahmt — nur innerhalb EINER Karte:**

```
recommendation-card.tsx:228   Kopfzahl  „Ersparnis / Jahr"  {formatEur(entry.totalSavingPerYear)}
recommendation-card.tsx:348   Summenzeile „Gesamt"          {formatEur(entry.totalSavingPerYear)}
```

Gemessen (Fall `KATALOG`): **€ 2.789** an beiden Stellen.

### 2.2 Weitere Fälle desselben Musters (offene Suche)

Ermittelt durch Auszählen aller `formatEur`/`formatEur2`/`formatYears`-Aufrufe in
`apps/website/components/report/*.tsx` und Abgleich der gelesenen Contract-Felder.

| # | Grösse | Rahmung 1 | Rahmung 2 (und 3) | Gilt im Fall | Gemessen |
|---|---|---|---|---|---|
| a | `loadShiftSavingPerYear` | Kopfzahl aWATTar-Karte, `tariff-optimization-card.tsx:202` | Zeile „Tarifbewusstes Laden", `recommendation-card.tsx:345` | Katalog; Bestand **ohne** `monthlyComparison` | € 1.634 / € 1.634 |
| b | `totalSavingPerYear` | Kopfzahl „Ersparnis / Jahr", `recommendation-card.tsx:228` | Zeile „Gesamt", `:348` — **und ein drittes Mal** im `rationale`-Satz des Kastens „Nächster Schritt" (`report.tsx:474`, erzeugt in `packages/engine/src/recommendation/rank.ts:130`) | Katalog | € 2.789 · € 2.789 · **„€2789"** |
| c | `real.totalEur` | Kopfzahl „Ersparnis mit aWATTar", `recommendation-card.tsx:210` (als `Math.abs`) | Zeile „Gesamt", `:280` | Bestand **mit** `monthlyComparison` | € 11.405 / € 11.405 |
| d | `leistungspreisSavingPerYear`, `selfConsumptionSavingPerYear`, `loadShiftSavingPerYear` (alle drei) | Zeilen der Aufschlüsselung, `recommendation-card.tsx:340-345` | **Legende des Kostenvergleich-Charts**, `cost-chart.tsx:192` (`{b.label}: {formatEur(entry[b.key])}`), zusätzlich als Segment-Beschriftung im Balken (`:133`, `:178`) | **nur Katalog** (`costChartBox` entfällt im Bestandsfall, `report.tsx:369-381`) | € 1.156 / € 0 / € 1.634 |
| e | `netSavingOverHorizon` der Empfehlung | Text unter der Grenznutzen-Kurve, `marginal-benefit-chart.tsx:204` (`best` = Maximum, und `perBattery` ist danach sortiert, `rank.ts:167-175`) | `rationale`-Satz, `report.tsx:474` / `rank.ts:132` | Katalog | € 8.795 vs. **„€8795"** |
| f | `amortizationYears` | Kopfzahl „Amortisation", `recommendation-card.tsx:248` (`formatYears`) | `rationale`-Satz (`rank.ts:121-124`, `toFixed(1)`) | Katalog | **„6,8 Jahre" vs. „nach 6.8 Jahren"** |
| g | `sumCovered(currentTariffEur)` und `sumCovered(spotWithBatteryEur)` | Legende des Monatsvergleichs, `monthly-tariff-chart.tsx:197` | Warnblock „aWATTar wäre teurer", `tariff-optimization-card.tsx:164` und `:166` | Bestand **mit** `monthlyComparison` **und** `surcharge > 0` | — (im Prüffall `surcharge < 0`, Block erscheint nicht) |
| h | `totalInvestment` | Zeile „Gesamtinvestition", `recommendation-card.tsx:455` | Druck-Snapshot, `print-assumptions-snapshot.tsx:69` | Katalog, **im Druck beide gleichzeitig sichtbar** | € 19.100 |
| i | `foundationCost` / `extraInverterCost` | Kostenzeilen „Betonsockel" / „Separater Wechselrichter", `recommendation-card.tsx:451-452` | Warnungstexte derselben Karte, `:481` (erzeugt in `rank.ts`) | Katalog | **„€ 1.800" / „€ 3.200" vs. „€1800" / „€3200"** |

**Vollständige Euro-Folge des gerenderten Katalog-Falls** (Render-Probe, sichtbarer Text in
Renderreihenfolge, `RecommendationCard` + `TariffOptimizationCard` + `rationale`):

```
€ 2.789 · € 1.156 · € 0 · € 1.634 · € 2.789 · € 14.100 · € 1.800 · € 3.200 · € 19.100
· €1800 · €3200 · € 1.634 · €2789 · €8795.
```

14 Beträge, davon **9 verschiedene Werte**: `€ 2.789` steht 3×, `€ 1.634` 2×, `€ 1.800` 2×, `€ 3.200` 2×.

### 2.3 Beiläufiger Befund: zwei Schreibweisen derselben Währung

`formatEur` (`apps/website/lib/format.ts:46-48`) liefert de-AT mit schmalem Leerzeichen und
Tausenderpunkt („€ 2.789"). Der Engine-Satz `buildRationale` (`rank.ts:130-133`) formatiert dagegen mit
`toFixed(0)` und ohne Trennzeichen („€2789"), und `formatAmortization` (`:121-124`) mit `toFixed(1)`, also
mit **englischem Dezimalpunkt** („nach 6.8 Jahren") — während `formatYears` (`format.ts:55-57`) dieselbe
Zahl als „6,8 Jahre" ausgibt. Beide Formen stehen im selben Report auf derselben Seite.

---

## 3 — Kassengrösse gegen Zuordnungsgrösse im Bestandsfall

**Behauptung: STIMMT.** Zwei Zahlen tragen im selben Report dieselbe Beschriftung „Wert der
Ladesteuerung" und kommen aus zwei verschiedenen Rechnungen.

| | Kassengrösse | Zuordnungsgrösse |
|---|---|---|
| Beschriftung | **„Wert der Ladesteuerung"** | **„Wert der Ladesteuerung unter aWATTar"** |
| Ort | `DeltaRow` in der Empfehlungskarte, `recommendation-card.tsx:272-276` | Kartentitel + Kopfzahl, `tariff-optimization-card.tsx:186` und `:202` |
| Feld | `real.controlValueEur` = `sumCovered(spotWithoutControlEur) − sumCovered(spotWithBatteryEur)` (`packages/shared/src/real-saving.ts:71`) | `recommended.loadShiftSavingPerYear` (§3.7-Attribution, `packages/engine/src/savings/attribute.ts:381`) |
| Zeitbezug | Summe über die **gemessenen** Monate, ausdrücklich **nicht** hochgerechnet (`recommendation-card.tsx:136-139`) | **auf ein Jahr hochgerechnet** (`annualizationFactor`, `attribute.ts:384`) |
| Platzierung | linke Spalte, obere Karte | linke Spalte, **direkt darunter** (`report.tsx:746-779`) |

**Gemessen am Prüffall `BESTAND`** (Rechenlauf (a) und Render-Probe (b), identische Zahlen):

```
sumCovered(currentTariffEur)      = 20 720,674151047493
sumCovered(spotWithoutControlEur) =  9 765,953903532505
sumCovered(spotWithBatteryEur)    =  9 315,592065652505

KASSE      real.controlValueEur    =  450,36183788000017   → gerendert  "€ 450"
ZUORDNUNG  loadShiftSavingPerYear  =  451,2376512133333    → gerendert  "€ 451"
ABSTAND                            =    0,8758133333331557  (0,194 %)
```

Der Prüf-Lastgang deckt 12 Monate ab, `annualizationFactor = 1` — die Hochrechnung trägt zum Abstand hier
**nichts** bei; er stammt vollständig aus den drei in `CLAUDE.md` (02.09.2026) benannten Posten (Clamp,
Start-SoC, Restenergie am Periodenende).

**Gerendert nebeneinander** (Render-Probe, sichtbarer Text, gekürzt):

> … Reiner Tarifwechsel *Ihr Tarif heute gegenüber aWATTar ohne jede Steuerung* **€ 10.955**
> **Wert der Ladesteuerung** *aWATTar ohne Steuerung gegenüber aWATTar mit Ihrem Speicher* **€ 450**
> Gesamt **€ 11.405** … [Karte darunter] **Wert der Ladesteuerung unter aWATTar** … **€ 451** pro Jahr
> zusätzlich …

**Bestätigung am echten Kundenfall:** `CLAUDE.md` hält für den Urbanz-Referenzfall (02.09.2026) dieselben
zwei Zahlen fest — Kopfkarte € 450, Attribution € 451.

**⚠ Ergänzender Befund — der Bildschirm-Report benennt den Abstand NICHT, der PDF-Report schon.**
Im Bildschirm-Report gibt es in beiden Karten keinen Satz, der auf die jeweils andere Zahl verweist: der
Kommentar in `recommendation-card.tsx:136-139` und der Erklärabsatz in
`tariff-optimization-card.tsx:241-257` erklären den Unterschied zur **Kopfzahl** (€ 11.405 gegen € 451),
nicht den zwischen den beiden gleichnamigen Zeilen. **Gemessen:** die Zeichenketten „Kassen…" /
„Zuordnungsgrösse" kommen in `apps/website/components/` **0×** vor.

Im react-pdf-Weg steht dagegen genau dieser Satz (`apps/website/lib/pdf-report/summary.ts:352-357`,
Zweig `savingsIsRealComparison`):

> „Die Zeile ‚Wert der Ladesteuerung' in der Aufschlüsselung oben beantwortet dieselbe Frage aus der
> Kassensicht des Monatsvergleichs; diese Zahl hier stammt aus der Zuordnung der einzelnen
> Kilowattstunden. Die beiden Wege unterscheiden sich um wenige Euro — das ist kein Rechenfehler, sondern
> der Abstand zwischen einer Kassen- und einer Zuordnungsgrösse."

Der Bildschirm-Report und der PDF-Report verhalten sich an dieser Stelle **verschieden** (zweiter Fall
dieser Art neben dem in 4c).

---

## 4 — Die drei Zeilen-Zustände einer Ersparnis-Kategorie

Alle Zeilen entstehen in `recommendation-card.tsx:340-345` (`SavingRow`, Def. `:23-30`).

### 4a — berechnet, Wert > 0

**Beleg (Rechenlauf (a)):** Repo-Fixture `dev-fixtures/demo-baeckerei-mit-pv-netzlastgang-2023.csv`
(35.040 Werte, `source: net_signed`) über `parseLoadProfile`, Tarif mit Leistungspreis 100 €/kW·a und
Nachtfenster 22:00–06:00 zu 12 ct. Empfehlung `PeakStore C60` (`controlType: 'dynamic'`):

```
Spitzenkappung (Leistungspreis)  2 999,9916858673096  → "€ 3.000"
Eigenverbrauch                     630,1008639364236  → "€ 630"
Tarifbewusstes Laden             1 036,6173000730046  → "€ 1.037"
Gesamt                           4 666,709849876737   → "€ 4.667"
```

Alle drei Kategorien > 0 in **einem** Lauf.

### 4b — berechnet, Wert = 0 (legitim)

Drei verschiedene Ursachen, je einzeln belegt:

| Ursache | Beleg | Wirkung | Warnsatz in `entry.warnings` |
|---|---|---|---|
| **keine Einspeisung im Lastgang** | Prüffall `KATALOG`, gerendert: „Eigenverbrauch **€ 0**" | `selfConsumptionSavingPerYear = 0` | keiner — es ist eine gerechnete Null ohne Blocker |
| **`controlType: 'static'`** (jede Bestandsanlage, `battery-combination.ts:101`, und jede Kombination, `:149`) | Prüffall `BLOCKER` (ebenfalls eine Bestandsanlage), gerendert: „Spitzenkappung (Leistungspreis) **€ 0**". Im Prüffall `BESTAND` ist derselbe Wert ebenfalls 0, die Zeile wird dort aber gar nicht gerendert (s. Punkt 7) | `leistungspreisSavingPerYear = 0`, `newBilledKw = oldBilledKw` (`attribute.ts:310-312`) | „Statische Steuerung: nur Eigenverbrauch/Lastverschiebung, keine Spitzenkappung …" (`attribute.ts:322-327`) |
| **Tarif ohne Leistungspreis** (`leistungspreisEurPerKwYear === 0`) | Rechenlauf H0-Profil + Leistungspreis 0: `lp/sc/ls/total = 0/0/0/0`, drei Warnsätze | Blocker `no_demand_charge` (`peak-shaving.ts:76`) | „Tarif ohne Leistungspreis: es gibt keinen Leistungspreis-Anteil, der sich kappen liesse …" (`attribute.ts:362-367`) |

Die vier Blocker-Gründe stehen abschliessend in `packages/engine/src/simulation/peak-shaving.ts:53-78`:
`static_control` · `standard_profile` · `estimated_pv` · `no_demand_charge`.

### 4c — nicht berechenbar (`computable: false`)

**Beleg:** Prüffall `BLOCKER` (`spotPrices: null`, `summary-fixtures.ts:192-195`). Gemessener Status:

```json
{"computable":false,"side":"spot_price","kind":"unavailable","ranges":[],
 "message":"Tarifoptimierung nicht berechenbar: Die Börsen-Strompreise konnten nicht gelesen werden. …"}
```

**Render-Probe, EIN Suchmechanismus über alle drei Fälle** (Beschriftung im flachgelegten sichtbaren Text,
gefolgt von einem Euro-Betrag; bzw. `data-testid` im erzeugten HTML). Die Spalten `BESTAND`/`KATALOG` sind
die geforderte **Positivkontrolle**:

```
ZEILEN-SONDE (Beschriftung + folgender Euro-Betrag)
Beschriftung                      | BESTAND    | BLOCKER    | KATALOG
----------------------------------+------------+------------+-----------
Spitzenkappung (Leistungspreis)   | —          | € 0        | € 1.156
Eigenverbrauch                    | —          | € 0        | € 0
Tarifbewusstes Laden              | —          | € 0        | € 1.634
Gesamt                            | € 11.405   | € 0        | € 2.789
Reiner Tarifwechsel               | € 10.955   | —          | —
Wert der Ladesteuerung            | € 450      | —          | —

KARTEN-SONDE (data-testid im gerenderten HTML)
realer-vorteil                    | JA         | nein       | nein
tarifoptimierung-ergebnis         | JA         | nein       | JA
tarifoptimierung-blocker          | nein       | JA         | nein
```

**Befund — und er weicht von der Behauptung ab:**

- **Was im nicht berechenbaren Fall NACHWEISLICH FEHLT, ist die KARTE**, nicht die Zeile:
  `data-testid="tarifoptimierung-ergebnis"` und der Titel „Wert der Ladesteuerung unter aWATTar" kommen im
  `BLOCKER`-HTML **0×** vor; an ihre Stelle tritt `tarifoptimierung-blocker` mit dem Titel „Vergleich mit
  Börsen-Strompreisen: nicht berechenbar" (`tariff-optimization-card.tsx:91-129`). Positivkontrolle:
  derselbe Selektor liefert in `BESTAND` **und** `KATALOG` einen Treffer.
- **⚠ Die ZEILE „Tarifbewusstes Laden" verschwindet NICHT — sie steht mit „€ 0" da.** Gemessen:
  `loadShiftSavingPerYear = 0`, gerendert „Tarifbewusstes Laden € 0". Grund im Code:
  `packages/engine/src/simulation/tou.ts:429-438` — bei einem Blocker füllt `intervalTariffRates` alle
  Raten mit `energyPriceCtPerKwh`, setzt alle Flags auf `false` und `touActive = false`; die Differenz
  „Entladepreis − Ladepreis" ist dadurch überall exakt 0. **Die Zeile ist damit im Report von einer
  gerechneten Null (Fall 4b) nicht unterscheidbar** — beide zeigen „€ 0".
- **Der vollständige gerenderte `BLOCKER`-Text** trägt fünf Euro-Beträge, alle „€ 0":
  Kopfzahl „Ersparnis / Jahr € 0", dann „Spitzenkappung (Leistungspreis) € 0 · Eigenverbrauch € 0 ·
  Tarifbewusstes Laden € 0 · Gesamt € 0".
- **Abgrenzung zum PDF-Weg:** dort ist es anders gelöst — `buildLoadShift` beginnt mit
  `if (analysis.tariffOptimization?.computable !== true) return null`
  (`apps/website/lib/pdf-report/summary.ts:332`), die Ladesteuerungs-Aussage **entfällt dort also ganz**
  statt als „€ 0" zu erscheinen. Bildschirm-Report und PDF-Report verhalten sich an dieser Stelle
  **verschieden**.

---

## 5 — Netzebene 7: Sperre in Schritt 2

**Behauptung: STIMMT — mit einer benannten, beabsichtigten Ausnahme.**

**Die Sperre.** `apps/website/components/flow/step-tariff.tsx`:

```
:321        const REGULATION_PENDING_NETZEBENE = 7
:461        const isRegulationPending = netzebeneNum === REGULATION_PENDING_NETZEBENE
:607-624    const pending = … (nur wenn isRegulationPending; sonst null)
:636        const noPowerMeasurement = showMeteringVariant && meteringVariant === 'ohne_leistungsmessung'
:668-672    const blocked = (pending != null && !noPowerMeasurement) || netzentgelt.kind === 'loading'
                            || netzentgelt.kind === 'missing' || netzentgelt.kind === 'failed'
:736        if (blocked) return          ← in handleSubmit, VOR jeder Übernahme
:1351       <Button … disabled={blocked || pricingBusy}>
```

Die Sperre sitzt an **zwei** Stellen: am Knopf (sichtbar) und als erste Anweisung in `handleSubmit`
(wirksam). Ein erzwungener Klick kann sie nicht umgehen.

**Gemessen (Aufruf der echten B11-Datenschicht, Stichtag 08.09.2026):**

```
NE 3 → pendingAcrossAllBetreiber: null                       hasMeteringVariant: false
NE 4 → "not_yet_recorded"                                    false
NE 5 → "not_yet_recorded"                                    false
NE 6 → "not_yet_recorded"                                    false
NE 7 → "awaiting_tariff_regulation"                          true
NE 7 / wiener_netze | netz_noe | salzburg_netz → alle drei: pending_regulation / awaiting_tariff_regulation
```

**Vollständige Aufzählung der NE-7-Pfade** (`METERING_VARIANTS = ['mit_leistungsmessung',
'ohne_leistungsmessung', 'unterbrechbar']`):

| Messvariante | `pending` | `noPowerMeasurement` | `blocked` | Angezeigte Meldung |
|---|---|---|---|---|
| noch nicht gewählt (`NOT_SET`) | ≠ null | false | **ja** | `TarifMessvarianteOffen` (`step-tariff.tsx:1025-1026`) |
| `mit_leistungsmessung` | ≠ null | false | **ja** | `TarifNichtVerfuegbar` / `awaiting_tariff_regulation` (1029-1035) |
| `unterbrechbar` | ≠ null | false | **ja** | dieselbe Meldung — es gibt für diese Variante **keinen eigenen Status** |
| `ohne_leistungsmessung` | ≠ null | **true** | **nein** | `TarifOhneLeistungsmessung` (1027-1028) — s. Punkt 6 |
| Netzbetreiber „Nicht angeben" | `pendingAcrossAllBetreiber(7)` ≠ null | je nach Variante | wie oben | wie oben |

**Es existiert genau EIN Pfad, der mit Netzebene 7 den Report erreicht: „ohne Leistungsmessung".** Das ist
Delta 9a und beabsichtigt. Dabei wird `leistungspreisEurPerKwYear` auf 0 vorbelegt (`:684-689`), womit die
Engine den Blocker `no_demand_charge` setzt und die Spitzenkappung mit 0 ausweist (Punkt 4b, dritte Zeile).

**Gegenprobe — existiert ein Test?** **Nein.**
- `apps/website` hat **keinen Testlauf** (`apps/website/package.json` führt kein `test`-Skript, es gibt
  keine `vitest.config.*` in dieser App), und Playwright ist in keiner `package.json` des Repos als
  Abhängigkeit geführt.
- Die drei `data-testid`-Werte (`tarif-nicht-verfuegbar`, `tarif-ohne-leistungsmessung`,
  `tarif-messvariante-offen`) kommen ausschliesslich in `tarif-nicht-verfuegbar.tsx:53/95/126` und in
  Prosa (`CLAUDE.md`, `Fahrplan_2026.md`, Delta-Pflichtenheft) vor — in **keiner** Testdatei.
- Die in `CLAUDE.md` (31.08.2026) dokumentierten Playwright-Läufe waren einmalige Messungen; die Skripte
  lagen ausserhalb des Repos und sind entfernt.

**Was daraus folgt:** Die Sperre ist als Code-Pfad belegt und war am 31.08.2026 einmal live gemessen; es
gibt **keine** automatisierte Absicherung, die einen Rückfall fangen würde.

---

## 6 — „Ohne Leistungsmessung": keine Sperre, neutrale Färbung

**Behauptung: STIMMT in allen vier Teilen.** Beleg
`apps/website/components/flow/tarif-nicht-verfuegbar.tsx` und `step-tariff.tsx`:

| Teilbehauptung | Beleg |
|---|---|
| Leistungspreis wird mit **0** vorbelegt | `step-tariff.tsx:684-689` — `applyMeteringVariant` setzt bei `'ohne_leistungsmessung'` `leistungspreisEurPerKwYear: '0'` **und** `minBillableKw: '0'`. Wortgleich ein zweites Mal im Anfangszustand für den Rechnungs-Scan-Weg (`:212-215`). Das Feld bleibt editierbar (Text: `tarif-nicht-verfuegbar.tsx:63`). |
| **neutrale** Färbung | `tarif-nicht-verfuegbar.tsx:53` — `<Alert data-testid="tarif-ohne-leistungsmessung">` **ohne** `variant`; `alert.tsx:17` setzt `defaultVariants: { variant: 'default' }`, also `border-border bg-surface-alt text-text` (`:12`). Die beiden Verweigerungen benutzen dagegen `variant="warning"` (`:126`) bzw. ebenfalls `default` (`:168`, s. u.). |
| **keine** Sperre | `step-tariff.tsx:669` — `pending != null && !noPowerMeasurement`; bei `noPowerMeasurement === true` fällt der erste Summand weg. |
| **kein** Warteliste-Link | `WARTELISTE_URL` kommt in `tarif-nicht-verfuegbar.tsx` genau **1×** vor (`:144`), und zwar im `awaiting_tariff_regulation`-Zweig von `TarifNichtVerfuegbar`. |

**Abgrenzung zu den zwei echten Blockern in derselben Datei** (die Datei führt insgesamt **sechs**
exportierte Meldungen, drei davon aus B21-3d für den Datenbankweg):

| Komponente | Zeile | Variante | Warteliste-Link | Sperrt |
|---|---|---|---|---|
| `TarifOhneLeistungsmessung` | 51–73 | `default` (neutral) | nein | **nein** |
| `TarifMessvarianteOffen` | 93–107 | `default` (neutral) | nein | ja (über `blocked`, weil `pending` gesetzt bleibt) |
| `TarifNichtVerfuegbar` / `awaiting_tariff_regulation` | 124–157 | **`warning`** | **ja** (`:142-150`) | ja |
| `TarifNichtVerfuegbar` / `not_yet_recorded` | 167–187 | `default` | nein | ja |
| `NetzentgeltWirdGeprueft` / `NetzentgeltNichtHinterlegt` | 220–274 | `default` | nein | ja |
| `NetzentgeltNichtAbrufbar` | 291–342 | `warning` | nein (Wiederholen-Knopf bei `request_failed`) | ja |

Die sechs Zweige sind im JSX **gegenseitig ausschliessend** (eine einzige `? :`-Kette) und in fester
Reihenfolge verzweigt (`step-tariff.tsx:1025-1048`): offene Messvariante → ohne Leistungsmessung →
Verweigerung → `loading` → `missing` → `failed`.

---

## 7 — Katalog-Fall gegen Bestandsfall: verschiedene Kategorien

**Behauptung: STIMMT — mit einer wichtigen Präzisierung.**

Die Verzweigung liegt in `recommendation-card.tsx:254` (`{real && comparison ? … : …}`), und `real`
entsteht nur, wenn `props.variant === 'existing'` **und** `props.monthlyComparison` gesetzt ist
(`:141-148`).

| | **Katalog-Fall** (und `addon`) | **Bestandsfall MIT `monthlyComparison`** |
|---|---|---|
| Überschrift | „Ersparnis aufgeschlüsselt" (`:323`) | „Woraus sich das zusammensetzt" (`:256`) |
| Zeilen | „Spitzenkappung (Leistungspreis)" (`:341`) · „Eigenverbrauch" (`:344`) · „Tarifbewusstes Laden" (`:345`) | „Reiner Tarifwechsel" (`:268`) · „Wert der Ladesteuerung" (`:273`) |
| Summe | „Gesamt" = `totalSavingPerYear` (`:348`) | „Gesamt" = `real.totalEur` (`:280`) |
| Zeilentyp | `SavingRow` (immer grün, `:23-30`) | `DeltaRow` (**vorzeichenbewusst**, `:40-52`) |
| Spitzenkappungs-Zeile | **ja** | **nein** |
| Zeitbezug | auf ein Jahr hochgerechnet | Summe über die gemessenen Monate |

**Gemessen (Render-Probe):** siehe Tabelle in 4c — im Fall `BESTAND` liefern die drei
§3.7-Beschriftungen **keinen** Treffer, im Fall `KATALOG` und `BLOCKER` alle drei.

**Warum keine Spitzenkappungs-Zeile im Bestandsfall — die Begründungskette:**

1. `buildExistingBatteryCandidate` setzt `controlType: 'static'`, fest und nicht abgeleitet
   (`packages/shared/src/battery-combination.ts:101`; dieselbe Setzung für die Kombination in `:149`).
2. `peakShavingBlockers` liefert daraufhin `['static_control']`
   (`packages/engine/src/simulation/peak-shaving.ts:65`).
3. `computeBatterySavings` setzt `leistungspreisSavingPerYear = 0` und `newBilledKw = oldBilledKw`
   (`packages/engine/src/savings/attribute.ts:310-312`) und hängt den Warnsatz an (`:322-327`).

**Gemessen (Fall `BESTAND`):** `leistungspreisSavingPerYear = 0`, `warnings` enthält genau den einen
static-Satz. Im Fall `KATALOG` (Empfehlung `PeakStore C60`, `controlType: 'dynamic'`):
`leistungspreisSavingPerYear = 1 155,5968554382325`.

**⚠ Präzisierung — ein Absatz der Bestandsfall-Karte ist strukturell unerreichbar.** Im `real`-Zweig
steht ein Absatz „**Nicht enthalten: die Spitzenkappung**" mit dem Betrag
`entry.leistungspreisSavingPerYear`, bedingt auf `> 0` (`recommendation-card.tsx:307-317`). Da jede
Bestandsanlage `static` ist (Schritt 1 oben), ist dieser Wert dort **immer 0** — der Absatz kann im
heutigen Aufbau nicht erscheinen. **Gemessen:** die Render-Probe findet die Zeichenkette „Nicht enthalten:
die Spitzenkappung" in **keinem** der drei Fälle.

**Ergänzend zum `addon`-Zweig:** Zusatzspeicher-Karten benutzen dieselben drei `SavingRow`-Kategorien
(`:340-345`), ihre Zahlen sind aber **Differenzen** (`analysis.worker.ts:137-143`) — und weil auch die
Kombination `static` ist, ist ihre Spitzenkappungs-Zeile ebenfalls strukturell 0. Die Karte sagt das über
die Beschriftung („Zusätzliche Ersparnis aufgeschlüsselt", `:323`) und einen eigenen Absatz (`:331-338`),
aber **nicht** über die Zeile selbst.

---

## 8 — Der leere Fall: Standardprofil (H0) ohne PV, ohne aWATTar-Optimierung

### 8.1 Existiert ein Fixture?

**Nein — die Kombination existiert nirgends im Repo.**

- Der Prüfstand kennt einen `standardprofil`-Fall (`summary-probe-kinds.ts:19`, `:76`), aber er fährt
  **mit** vollständiger Preisreihe: `buildSummaryProbePayload` gibt `tariffPricing` an alle Fälle ausser
  `blocker`/`blocker_luecke` (`summary-fixtures.ts:487-492`). Gemessen: `tariffOptimization.computable =
  true`, `loadShiftSavingPerYear = 130,73640058828494`.
- Es gibt **keinen** Fall, der `standard_profile` **und** fehlendes/leeres `tariffPricing` kombiniert.
- Die Engine-Tests decken die Standardprofil-Sperre ab
  (`packages/engine/src/savings/standard-profile-no-peak-shaving.test.ts`), aber ohne Report-Bezug.
- `apps/website` hat keinen Testlauf (s. Punkt 5).

### 8.2 Was der Report heute zeigt — gemessen

Rechenlauf (a) mit `generateStandardLoadProfile({ annualConsumptionKwh: 4500, customerClass: 'privat',
year: 2025, timeZone: 'Europe/Vienna' })`, Tarif wie oben (Leistungspreis 38,52 €/kW·a),
**ohne** `tariffPricing`, **ohne** PV, **ohne** Bestandsanlage:

```
loadProfile.source        = 'standard_profile'   pvSource = undefined
dataQuality               = 365 Tage / 12 Monate / 0 Lücken / 1 Warnung
current.billedKw          = 1,4422098298941168      → KeyMetric "1,4 kW"
current.leistungspreisCostPerYear = 55,55392264752138 → KeyMetric "€ 56"
tariffOptimization        = undefined            → TariffOptimizationCard rendert NICHTS
Empfehlung                = HomeStore R10 (controlType 'static')
  leistungspreisSavingPerYear = 0
  selfConsumptionSavingPerYear = 0
  loadShiftSavingPerYear       = 0
  totalSavingPerYear           = 0
  totalInvestment              = 5 500
  netSavingOverHorizon         = −5 500
  amortizationYears            = Infinity
ALLE SECHS Katalog-Kandidaten: lp = sc = ls = total = 0
  netSavingOverHorizon: −5 500 · −6 750 · −10 000 · −11 500 · −19 100 · −67 000
```

**Wörtlich, was im UI steht** (Zitate aus dem Code, Zahlen aus dem Lauf oben):

| Ort | Wortlaut / Wert |
|---|---|
| `KeyMetric` (`key-metric.tsx:12-27`) | „Ihre teuerste Lastspitze — **1,4 kW** Jahreshöchstwert im Netzbezug" · „**€ 56** Leistungspreis-Kosten pro Jahr (abgerechnet: 1,4 kW)" |
| Alert Standardprofil (`report.tsx:664-677`) | „**Auf Basis eines Standardlastprofils — keine gemessenen Werte.** Diese Analyse rechnet mit einem *synthetischen Durchschnittsprofil* … Die oben gezeigten Leistungswerte sind dagegen die Spitzen dieser Durchschnittskurve und *keine gemessene Lastspitze* — eine Ersparnis beim Leistungspreis wird deshalb gar nicht erst ausgewiesen, statt sie zu schätzen. **Für die Leistungspreis-Dimension: echten Lastgang hochladen (Viertelstundenwerte Ihres Netzbetreibers).**" |
| Empfehlungskarte Kopfzahl (`recommendation-card.tsx:225-235`) | „Ersparnis / Jahr **€ 0**" · „exkl. MwSt." |
| Empfehlungskarte Amortisation (`:246-249`) | „Amortisation **∞ Jahre**" (gemessen: `formatYears(Infinity)` in de-AT ergibt „∞ Jahre") |
| Aufschlüsselung (`:340-348`) | „Spitzenkappung (Leistungspreis) **€ 0**" · „Eigenverbrauch **€ 0**" · „Tarifbewusstes Laden **€ 0**" · „Gesamt **€ 0**" |
| Hindsight-Hinweis (`:354-357`, `lib/report-copy.ts`) | „Eigenverbrauch & tarifbewusstes Laden sind mit vollem Rückblick auf das Jahresprofil gerechnet (Bestmarke). Der Spitzenschutz-Anteil ist davon nicht betroffen." |
| Investition (`:444-456`) | „Investition — Speicher (5 kW / 10 kWh) **€ 5.500**" · „Gesamtinvestition **€ 5.500**" · „Förderung & Steuervorteil: keine Angabe (nicht in die Rechnung einbezogen)." |
| Warnungen der Karte (`:476-487`) | zwei Sätze: „Statische Steuerung: nur Eigenverbrauch/Lastverschiebung, keine Spitzenkappung …" **und** „Synthetisches Standardlastprofil: die Spitzenkappung wird nicht gerechnet und nicht kreditiert …" |
| `TariffOptimizationCard` | **rendert nichts** (`status === undefined`, `tariff-optimization-card.tsx:89`) |
| `CostChart` (`report.tsx:382-396`) | Kasten „Kostenvergleich mit/ohne Batterie" **erscheint**; Break-even-Linie entfällt (`cost-chart.tsx:285`, `Number.isFinite(Infinity)` ist false), Band durchgehend rot (`:218-220`); Legende „Spitzenkappung (Leistungspreis): **€ 0** · Eigenverbrauch: **€ 0** · Tarifbewusstes Laden: **€ 0**" (`:192`) |
| `EnergyFlowChart` (`energy-flow-chart.tsx:334-345`) | **Leerzustand**: „**Kein Energiefluss-Tag verfügbar** — HomeStore R10 ist statisch gesteuert — sie kappt keine Spitzen (nur Eigenverbrauch/Lastverschiebung), daher gibt es keinen Tag mit einer abgefangenen Spitze. Zusätzlich liegt kein PV-Erzeugungsprofil vor, das einen alternativen Tag liefern könnte." (gemessen: `representativeDays = []`) |
| „Nächster Schritt" (`report.tsx:471-475`) | der Engine-Satz: „**HomeStore R10 spart voraussichtlich €0 pro Jahr und amortisiert sich innerhalb des Betrachtungszeitraums nicht — Netto-Ersparnis über 10 Jahre: €-5500.**" |
| `dispatchInsightSection` (`report.tsx:502-520`) | erscheint; darin **nur** die Heatmap (gemessen: `monthlyChargePrice = undefined`, `ChargePriceChart` entfällt). Die Heatmap rendert (gemessen: `maxAbs = 0,8201844916235308 kWh` — die Batterie gibt einmal ihren Start-SoC ab; bei exakt 0 gäbe sie `null` zurück und der Abschnitt bliebe **leer**, `battery-flow-heatmap.tsx:86`) |
| `MarginalBenefitChart` (`marginal-benefit-chart.tsx:195-200`) | „**Keine der Grössen liegt über der Nulllinie.** Am nächsten kommt HomeStore R10 mit **-€ 5.500** — auch dort bleibt die Ersparnis über 10 Jahre unter der Anschaffung." |
| Alternativen-Aufklappliste | „3 Alternativen ansehen" (`report.tsx:530`) — drei Karten mit je „Ersparnis / Jahr € 0" |
| Alert Datenqualität (`report.tsx:914-930`) | erscheint (1 Warnung): „Abgedeckt: 365 Tage · interpolierte Lücken: 0" + „Synthetisches Standardlastprofil (H0, Privathaushalt) für das Jahr 2025, linear auf 4 500 kWh/Jahr skaliert. Es sind KEINE gemessenen Werte …" |
| Demo-Disclaimer (`:940-944`) | „Demo-Berechnung mit Beispieldaten. Zahlen sind noch nicht gegen einen echten Lastgang und eine echte Netzrechnung validiert." |

### 8.3 Zusammenfassung des Befunds

- **Es gibt kein Fixture für diese Kombination.** Sie ist über den Rechner erreichbar (Einstieg
  „Standardprofil" in Schritt 1, Börsenpreis-Hebel in Schritt 2 nicht eingeschaltet) und in keinem
  Prüflauf abgedeckt.
- **Der Report ist in diesem Fall vollständig, nicht leer**: alle Kästen erscheinen ausser der
  Tarifoptimierungs-Karte.
- **Gemessen an der Render-Probe** (Kern-Kennzahl + Empfehlungskarte + Tarifoptimierungs-Karte +
  „Nächster Schritt"-Satz, also der obere linke Teil des Reports): **10 Euro-Beträge, davon 5 exakt
  „€ 0"** — dazu ein sechster als „€0" im Engine-Satz. Die Folge in Renderreihenfolge lautet

  ```
  € 56 · € 0 · € 0 · € 0 · € 0 · € 0 · € 5.500 · € 5.500 · €0 · €-5500.
  ```

  Die Karte `tarifoptimierung-ergebnis` und die Karte `tarifoptimierung-blocker` kommen im erzeugten
  HTML **beide 0×** vor; „∞ Jahre" ist enthalten.
- **Die einzige „echte" Zahl des Reports ist die Kern-Kennzahl** (1,4 kW / € 56), und genau sie wird vom
  Alert unmittelbar darunter als „keine gemessene Lastspitze" gekennzeichnet.
- **Die zwei Warnsätze der Karte und der Alert oben sagen dasselbe zweimal** (Standardprofil), zusätzlich
  steht die Parser-Warnung ein drittes Mal im Datenqualitäts-Alert.
- **Ein zweiter Nebenbefund, gemessen:** kommt zum Standardprofil noch „ohne Leistungsmessung" hinzu
  (Leistungspreis 0, Punkt 6), trägt die Karte **drei** Warnsätze statt zwei — `static_control`,
  `standard_profile`, `no_demand_charge` — und die Kern-Kennzahl fällt von „€ 56" auf **„€ 0"**
  (`current.leistungspreisCostPerYear = 0`, `billedKw` unverändert 1,4422098298941168). Damit trägt der
  Report in diesem Fall **keine** von null verschiedene Euro-Zahl mehr ausser der Investition.

---

## Anhang — offene Punkte dieser Bestandsaufnahme

Ausdrücklich **keine Bewertung**, nur was die Messung nicht abdeckt:

1. **Die Orchestrierung ist nachgebaut, nicht aufgerufen.** Der echte Weg läuft über einen Web Worker
   (`analysis.worker.ts`), der ausserhalb eines Browsers nicht startet. Die nachgebaute Kette folgt
   `computeAnalysis` Zeile für Zeile; abgewichen wurde nur dort, wo der Prüfaufbau es verlangt
   (kein `pvProfile`, kein `financial` ausser im Förderungsfall, kein `batteryOverride`).
2. **Die Render-Probe deckt drei der Report-Komponenten ab** (`RecommendationCard`,
   `TariffOptimizationCard`, `KeyMetric`). Die Recharts-Kästen (`CostChart`, `MonthlyTariffChart`,
   `MarginalBenefitChart`, `EnergyFlowChart`, `ChargePriceChart`) wurden **nicht** gerendert — sie
   brauchen einen Messkasten (`ResponsiveContainer`), den es serverseitig nicht gibt. Ihre Zahlen sind aus
   dem Code abgelesen und mit den gerechneten Contract-Werten belegt, nicht am erzeugten DOM gemessen.
3. **Keine Messung an einer laufenden Oberfläche.** Playwright ist im Repo nicht installiert; die letzten
   Live-Läufe sind die in `CLAUDE.md` dokumentierten Einzelmessungen.
4. **Die Spotpreis-Reihe des Prüfstands ist synthetisch** (`summary-fixtures.ts:88-126`). Die Beträge in
   Punkt 3 (€ 450 / € 451) sind damit nicht die eines echten Kunden — sie reproduzieren aber die für den
   Urbanz-Referenzfall dokumentierten Zahlen (€ 450 / € 451) der Grössenordnung nach exakt.
5. **Nicht geprüft:** der react-pdf-Weg (B23) über den Vergleich in 4c hinaus, der Druck-Stylesheet-Weg,
   die `apps/web`-Admin-Ansicht archivierter Analysen.
