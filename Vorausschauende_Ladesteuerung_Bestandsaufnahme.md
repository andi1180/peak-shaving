# Vorausschauende Ladesteuerung (vereinfacht) — Bestandsaufnahme

> **Was dieses Dokument ist:** eine reine Bestandsaufnahme, entstanden am 21.09.2026 auf Commit
> `a1469a1`. Sie beantwortet die vier Fragen, die vor einem Pflichtenheft geklärt sein müssen, und
> sie beantwortet sie **gemessen**, nicht abgeleitet. Wo etwas nicht gemessen werden konnte, steht
> das als Fehlanzeige da.
>
> **Was dieses Dokument NICHT ist:** kein Pflichtenheft, keine Bauentscheidung, keine
> Fahrplan-Nummer. Es ist an **keiner** Zeile Anwendungscode etwas geändert worden. Die Messungen
> liefen in Skripten im Scratchpad gegen Dateien, die im Repo liegen bzw. auf dem Rechner —
> `git status` ist bis auf dieses Dokument und das Pflichtenheft daneben sauber.
>
> **Datenherkunft aller Zahlen (Regel 11):** der Verbrauchs-Teil (§2) ist am **echten Urbanz-Lastgang**
> gemessen (`Viertelstundenwerte-20250827-bis-20260826.csv`, Kundenordner, nicht im Repo — 35.040
> Zeilen, 20.060 mit Wert, 209 belegte Kalendertage, 4.321,17 kWh). Der PV-Teil (§1) ist an der
> **PVGIS-Fixture im Repo** gemessen (`packages/engine/src/pv-generation/__fixtures__/pvgis-seriescalc-wien-2014-2023-gekuerzt.json`,
> echte PVGIS-Antwort, gekürzt auf 768 Stunden über 4 Kalendertage). Der Code-Teil (§3/§4) ist gegen
> den Quellcode auf `a1469a1` gelesen, nicht gegen Pseudocode. **Keine Zahl in diesem Dokument
> stammt aus einem Engine-Lauf** — die Euro-Beträge in §4.3 sind aus
> `urbanz-referenzfall-liegt-auf-dem-rechner` bzw. der Root-`CLAUDE.md` zitiert und dort als
> Produktionspfad-Messung vom 19./21.09.2026 ausgewiesen (Cloud-Entwurf, `_provenance.source: measured`).
>
> **Vorgelagerte Quellen:** `Pflichtenheft_Kalkulator_MVP.md` §3.6/§3.6.1/§3.6.2/§3.7, §7 ·
> `Pflichtenheft_PV_Zeitreihengenerator.md` (B22) · `Fahrplan_2026.md`.

---

## Kurzfassung — die vier Befunde in je einem Satz

1. **Die PVGIS-Klimatologie liefert Stundenauflösung je Kalendertag und ist ohne eine Zeile Änderung
   wiederverwendbar** (`PvReferenceProfile.hourlyKw`, 8.760 Zellen über (Monat, Tag, Stunde)) —
   **aber sie ist eine Klimatologie und keine Prognose:** für **denselben** Kalendertag streuen die
   zehn Wetterjahre um den Faktor **4,2 bis 6,7** (Variationskoeffizient 34–49 %, Mittel **41 %**,
   n = 3 Tage). Die ± 5,8 % Jahresstreuung aus B22 §2.1 sagt über einen **einzelnen Tag** nichts.
2. **Das Leakage-Risiko ist real, quantifiziert — und es trifft ausgerechnet die feinste Einteilung
   am härtesten, die zugleich die schlechteste ist.** Bei `Wochentag(7) × Monat` sieht der
   selbst-einschliessende Wert **25 % besser** aus als der Leave-one-out-Wert (Tages-nMAE 25,5 %
   gegen 33,9 %); zwei Eimer sind unter Leave-one-out sogar **leer**. Unter Leave-one-out gewinnt
   die **gröbste** sinnvolle Einteilung: `nur Monat` (28,2 %) ≈ `WT/WE × Monat` (28,8 %)
   « `Wochentag(7) × Monat` (33,9 %).
3. **Es gibt keine LP-Formulierung, die wiederverwendet werden könnte — die Prämisse der Frage
   trifft nicht zu.** `packages/engine` hat drei Abhängigkeiten (`papaparse`, `shared`, `xlsx`) und
   **keinen Solver**; das Hindsight-Optimum entsteht aus einer chronologischen **Greedy-Heuristik**,
   und der Code sagt das selbst (`tou.ts:471`, §3.6.2 „Die LP-Lücke bleibt offen"). Wiederverwendbar
   ist etwas anderes und Besseres: **`daily-price-order.ts` ist bereits strukturell ein
   Ein-Kalendertag-Planer** — ihm fehlt nur, dass seine Eingaben heute **gemessen** statt
   **prognostiziert** sind.
4. **Ein untertägiges Nachschärfen ist derzeit nicht bloss ungebaut, es ist nicht definierbar.**
   Ohne Live-Zähleranbindung (0 Treffer auf `modbus`/`live_meter` im Code, §7 `[v2]`) gäbe es zur
   Mittagszeit keine neue Information — ein Re-Solve liefe gegen dieselbe statische Prognose und
   ergäbe denselben Plan.

---

## 1. Frage 1 — Liefert die PVGIS-Klimatologie Tagesauflösung?

### 1.1 Antwort: ja, stündlich je Kalendertag. Gegen den Code gelesen.

| Baustein | Fundort | Was er liefert |
|---|---|---|
| Das Profil | `packages/engine/src/pv-generation/reference-profile.ts:191-200` | `PvReferenceProfile.hourlyKw` — **8.760 Werte in kW**, lückenlos |
| Der Index | `reference-profile.ts:112-119` | `referenceHourIndex(month, day, hour) → 0…8.759` — die Zelle ist eine **(Monat, Tag, Stunde)-Kalenderposition**, keine Jahres- und keine Monatssumme |
| Der Zugriff über einen Zeitpunkt | `reference-profile.ts:121-126` | `referenceHourIndexForUtcMs(utcMs)` — beantwortet unmittelbar „was erzeugt diese Anlage am 12.10. um 14 Uhr" |
| Die Auflegung auf ein Gitter | `reference-profile.ts:256-277` | `expandReferenceToTimestamps(profile, timestamps)` — legt das Profil auf **beliebige** Ziel-Zeitstempel, als Treppenfunktion (die Minute wird verworfen) |
| Die Konstante | `pvgis.ts:36` | `PVGIS_WEATHER_YEARS = { from: 2014, to: 2023 }` |

**Für die Ladeoptimierung heisst das:** die Erzeugungsprognose für einen konkreten kommenden Tag ist
ein Aufruf von `expandReferenceToTimestamps` mit den 96 Zeitstempeln dieses Tages. **Null Änderung
am bestehenden Code**, und das Ergebnis ist bereits in kW und bereits auf dem 15-min-Gitter.

**Zusatzbefund, der den Zuschnitt vereinfacht:** die Zellen sind **UTC-Kalenderpositionen, nicht
Positionen im Quell-Array** (Modulkopf `reference-profile.ts`, ausdrücklich begründet). Das Profil
ist damit eine reine Eigenschaft des **Standorts** und kennt die Zeitzone des Kunden gar nicht —
ein Tagesplan über die lokale Wanduhr (so wie `daily-price-order.ts` gruppiert) fällt von selbst
richtig, auch an DST-Tagen mit 92 bzw. 100 Intervallen.

### 1.2 ⚠ Der Befund, der zählt: die Jahresgenauigkeit ist NICHT die Tagesgenauigkeit

B22 §2.1 belegt die Klimatologie mit **± 5,8 %** — das ist die Streuung der **Jahres**erträge
zwischen den zehn Wetterjahren, und sie trägt die Eigenverbrauchs-Rechnung, weil die über ein Jahr
summiert. Ein **Tagesplan** fragt etwas anderes.

**Gemessen an der echten PVGIS-Antwort im Repo** (Fixture oben; Tagessumme je Kalendertag über die
zehn Wetterjahre, Wien 48,2082/16,3738, Neigung 35°, Azimut 0°):

| Kalendertag | n Jahre | Mittel | kleinstes Jahr | grösstes Jahr | Verhältnis | Variationskoeffizient |
|---|---|---|---|---|---|---|
| 28.02. | 10 | 32.641 Wh | 12.518 Wh | 52.677 Wh | **4,2×** | 40 % |
| 01.03. | 10 | 30.281 Wh | 8.607 Wh | 55.058 Wh | **6,4×** | 49 % |
| 21.06. | 10 | 45.673 Wh | 9.439 Wh | 63.257 Wh | **6,7×** | 34 % |

**Mittlerer Variationskoeffizient der Tagessumme: 41 %.** Gegen ± 5,8 % im Jahr.

**Was daraus folgt, in einem Satz:** die Klimatologie beantwortet „was liefert ein **typischer**
21. Juni", nicht „was liefert **nächster Dienstag**". Für eine Wirtschaftlichkeitsrechnung über ein
Jahr ist das genau richtig (die Abweichungen mitteln sich heraus — das ist der ganze Sinn einer
Klimanormale). Für **einen** Tagesplan ist es die Kerngrenze des Vorhabens, und sie ist um ein
Vielfaches grösser als die in B22 ausgewiesene.

**⚠ Fehlanzeige, ausdrücklich:** n = 3 Kalendertage. Die Repo-Fixture ist auf 768 Stunden gekürzt
(die volle Zehn-Jahres-Antwort sind 8,2 MB und gehört bewusst nicht ins Repo, s. `averageWeatherYears`).
Eine Messung über alle 365 Tage wäre ein einzelner PVGIS-Aufruf und billig nachzuholen; die drei
gemessenen Tage decken bereits Winterausgang, Frühjahr und Sommersonnenwende ab und liegen alle
in derselben Grössenordnung, aber **drei Tage sind drei Tage**.

### 1.3 Zwei bereits dokumentierte Eigenschaften, die hier neu wiegen

- **Das Mittel glättet, und zwar messbar** (B22 §4.2, Modulkopf `reference-profile.ts`): die
  gemittelte Kurve erreicht als Spitze **6,18 kW**, die zehn Einzeljahre **7,55–8,30 kW**. Für die
  Jahresrechnung kostet das 4,9 % Optimismus. Für einen **Tagesplan** ist es schärfer: eine Prognose,
  die nie eine Wolkenkante zeigt, plant nie eine Nachladung ein, die eine Wolkenkante nötig machte.
- **Der 29. Februar bekommt die Werte des 28.** (`mapFeb29ToFeb28`). Für einen Tagesplan ist das
  folgenlos, aber es ist die Art von Regel, die man beim Zuschnitt kennen muss.

---

## 2. Frage 2 — Leakage beim Verbrauchsmuster (die kritische Frage)

### 2.1 Der Datensatz, an dem gemessen wurde

Echter Urbanz-Lastgang, 209 belegte Kalendertage (30.01.2026 – 26.08.2026), davon **208 vollständig**
(96 Slots); ein Randtag ist unvollständig und fällt heraus. 8 belegte Kalendermonate, 4.321,17 kWh.

**⚠ Die erste Eigenschaft dieses Kunden ist zugleich die wichtigste Einschränkung der ganzen
Messung:** sein Verbrauch ist **heizungsgetrieben** und damit extrem saisonal.

| Monat | n Tage | Mittel |
|---|---|---|
| 2026-01 | 2 | 76,18 kWh/Tag |
| 2026-02 | 28 | 50,23 kWh/Tag |
| 2026-03 | 30 | 38,90 kWh/Tag |
| 2026-04 | 30 | 29,66 kWh/Tag |
| 2026-05 | 31 | 7,52 kWh/Tag |
| 2026-06 | 30 | **2,24 kWh/Tag** |
| 2026-07 | 31 | 5,63 kWh/Tag |
| 2026-08 | 26 | 7,03 kWh/Tag |

Über alle Tage: Mittel **20,54 kWh**, Standardabweichung **20,29 kWh** —
**Variationskoeffizient 99 %**. 33 Tage liegen unter 1 kWh, 63 unter 5 kWh. Median 10,94 kWh bei
p90 = 49,19 kWh.

> **Folge für jede Fehlerangabe unten:** ein prozentualer Tagesfehler (MAPE) ist an diesem Kunden
> **unbrauchbar** — er explodiert an den 33 Tagen unter 1 kWh (roh gerechnet über 1.000 %). Alle
> Zahlen unten sind deshalb **auf den mittleren Tagesverbrauch normiert** (nMAE) angegeben, dazu der
> **Median** des prozentualen Fehlers. Das ist kein Kunstgriff, sondern der einzige Weg, an dem die
> Grössen zwischen den Schemata vergleichbar bleiben.

### 2.2 Eimerbelegung — wie viele Tage fallen in einen Eimer (208 vollständige Tage)

| Einteilung | Eimer | n je Eimer (min / median / max) | unter Leave-one-out | Eimer mit n = 1 ⇒ **LOO leer** |
|---|---|---|---|---|
| Wochentag (7) × Monat | 51 | 1 / 4 / 5 | 0 / 3 / 4 | **2** |
| WT/WE × Kalendermonat | 16 | 1 / 10 / 23 | 0 / 9 / 22 | **2** |
| WT/WE × Jahreszeit | 6 | 9 / 26 / 65 | 8 / 25 / 64 | 0 |
| nur WT/WE | 2 | 59 / 149 / 149 | 58 / 148 / 148 | 0 |
| alle Tage | 1 | 208 | 207 | 0 |

**Die unmittelbare Antwort auf die gestellte Frage:** bei `Wochentag × Monat` fallen **median 4 Tage**
in einen Eimer, unter Leave-one-out also **3**. Zwei Eimer haben **einen einzigen** Tag und sind unter
Leave-one-out **leer** — für diese Tage existiert überhaupt kein Vergleichswert.

### 2.3 ⚠ Das Leakage, in Zahlen: die feinste Einteilung lügt am meisten

Gemessen über alle 208 Tage; „selbst-einschliessend" heisst, der bewertete Tag steckt in seinem
eigenen Eimermittel, „LOO" heisst, er ist ausgeschlossen.

| Einteilung | Tages-nMAE selbst-einschl. | Tages-nMAE **LOO** | **Überschätzung** | Slot-nMAE selbst-einschl. → LOO |
|---|---|---|---|---|
| Wochentag (7) × Monat | 25,5 % | **33,9 %** | **−25 %** | 48,8 % → 64,8 % |
| WT/WE × Monat | 26,5 % | 28,8 % | −8 % | 53,3 % → 57,9 % |
| nur Monat | 26,9 % | 28,2 % | −5 % | 54,9 % → 57,5 % |
| WT/WE × Jahreszeit | 43,8 % | 45,3 % | −3 % | 66,3 % → 68,7 % |
| nur WT/WE | 84,4 % | 85,2 % | −1 % | 101,3 % → 102,3 % |

**Das Leakage skaliert exakt mit `1/n` des Eimers**, wie es die Theorie verlangt — und daraus folgt
der tragende Befund dieses Abschnitts: **je feiner die Einteilung, desto grösser die
Selbstbestätigung.** Bei `Wochentag × Monat` sieht das Ergebnis um ein Viertel besser aus, als es
ist; beim Slot-Fehler um ein Drittel.

### 2.4 ⚠ Und die feinste Einteilung ist obendrein die schlechteste

Unter Leave-one-out kehrt sich die Rangfolge um. Die Güte ist gegen den trivialen Vorhersager
(„alle Tage, ein Eimer") gerechnet; 0 % heisst „so gut wie gar kein Muster".

| Einteilung (LOO) | Tages-nMAE | Median-APE | **Formfehler** | Güte gegen „alle Tage" |
|---|---|---|---|---|
| **nur Monat** | **28,2 %** | **31 %** | 41,4 % | **+67 %** |
| **WT/WE × Monat** | 28,8 % | 34 % | 42,1 % | +66 % |
| Wochentag (7) × Monat | 33,9 % | 43 % | 46,4 % | +60 % |
| WT/WE × Jahreszeit | 45,3 % | 39 % | 41,6 % | +47 % |
| nur WT/WE | 85,2 % | 90 % | 46,8 % | **−0 %** |
| alle Tage (trivial) | 84,8 % | 88 % | 46,7 % | 0 % |

*Formfehler = mittlere absolute Abweichung der auf ihre Tagessumme normierten Tageskurve, halbiert.
0 % = identische Form, 100 % = kein gemeinsamer Anteil.*

**Drei Feststellungen daraus:**

1. **Der Monat trägt alles, der Wochentag nichts.** `nur Monat` ist **besser** als
   `WT/WE × Monat` und deutlich besser als `Wochentag(7) × Monat`. Die Wochentagsachse
   **verdünnt nur die Eimer**, ohne Information hinzuzufügen. `nur WT/WE` ist mit **−0 %** exakt so
   gut wie gar kein Muster.
2. **Der Wochentagseffekt ist an diesem Kunden nicht vorhanden**, und zwar nicht knapp: das
   Verhältnis Wochenende/Werktag schwankt je Monat zwischen **0,82 und 1,92** ohne Richtung
   (Feb 0,86 · Mär 1,02 · Apr 0,98 · Mai 1,33 · Jun 1,92 · Jul 0,85 · Aug 0,83), über alle Tage
   **0,97** (WT 20,71 kWh gegen WE 20,11 kWh).
3. **⚠ Die TAGESFORM wird von keinem Schema nennenswert getroffen.** Der Formfehler liegt bei
   **41–47 %** — und der triviale Vorhersager liegt bei **46,7 %**. Das beste Schema gewinnt gegen
   „gar kein Muster" also **5 Prozentpunkte Form**. Anders gesagt: **die Schemata sagen im
   Wesentlichen das Niveau des Tages voraus, nicht seinen Verlauf.** Für eine Ladeoptimierung, die
   entscheiden muss, in *welcher* Stunde geladen wird, ist das die unbequemste Zahl der ganzen
   Bestandsaufnahme.

### 2.5 ⚠ Was diese Messung ausdrücklich NICHT zeigt (Fehlanzeige)

- **n = 1 Kunde.** Alles oben ist ein einziger Lastgang.
- **Und es ist der falsche Kundentyp für die Zielgruppe.** Urbanz ist ein **Haushalt mit
  Heizungslast**; der Kalkulator richtet sich an **Gewerbebetriebe** (Root-`CLAUDE.md`: „Bäckerei mit
  Morgenspitze"). Bei einer Bäckerei ist genau die Achse zu erwarten, die hier nichts trägt —
  Werktag gegen Sonntag ist dort der Unterschied zwischen Betrieb und Stillstand. **Dass der
  Wochentag an diesem Kunden nichts trägt, sagt über einen Gewerbebetrieb nichts.**
- **Kein Euro-Betrag gemessen.** Was ein 28-%-Tagesfehler und ein 41-%-Formfehler den Fahrplan
  kosten, ist **nicht** gerechnet worden — dafür bräuchte es einen Engine-Lauf mit ausgetauschten
  Eingaben, und der gehört in den Bau, nicht in die Bestandsaufnahme.
- **Standardprofil-Kunden sind gar nicht messbar.** `generateStandardLoadProfile` ist
  deterministisch und rauschfrei (`h0.ts`, ausdrücklich: „Es gibt keinen Zufall in diesem Generator");
  ein daraus gebildetes Muster träfe den Tag **exakt**, weil Muster und Wahrheit dieselbe Formel
  sind. Ein daraus abgeleiteter Prognosefehler von 0 % wäre eine Selbstauskunft, keine Messung.

### 2.6 Der bestehende Präzedenzfall im Code — `h0.ts`

Zur Frage, ob es dafür ein Vorbild gibt: ja, und es stützt Befund 1 aus §2.4.

`generateStandardLoadProfile` bildet die Kurve aus **genau zwei** Achsen (`h0.ts:92-112` und
`h0.ts:133-140`):

- `dailyShape(h, weekday)` — eine **binäre** Unterscheidung `weekday >= 5`, also WT/WE.
  **Keine sieben Wochentage.**
- `seasonFactor(month)` — ein **stetiger Kosinus** über das Kalenderjahr, keine zwölf
  diskreten Monatseimer. Die Amplitude ist aus dem Zielverhältnis Winter/Sommer der Studie
  **zurückgerechnet**, nicht geschätzt (`H0_WINTER_SUMMER_RATIO = 1.32`).

**Die stetige Saisonfunktion ist der interessantere Teil des Vorbilds:** sie hat gar keine Eimer und
damit gar kein Leakage-Problem über die Monatsgrenze. Ein Muster, das die Saison **glatt** statt in
zwölf Stufen führt, hätte an jeder Stelle die volle Datenmenge zur Verfügung — genau das Gegenteil
der Verdünnung, die §2.3 misst.

---

## 3. Frage 3 — Lässt sich die bestehende LP-Formulierung wiederverwenden?

### 3.1 ⚠ Die Prämisse trifft nicht zu: es gibt keine LP-Formulierung

**Gemessen:**

- `packages/engine/package.json` — Abhängigkeiten sind `papaparse`, `shared`, `xlsx`. Sonst nichts.
- **0 Treffer** auf `simplex`, `glpk`, `lp_solve`, `linprog`, `milp`, `solver` über alle
  `package.json` des Monorepos.
- Der Code sagt es selbst:
  - `packages/engine/src/simulation/tou.ts:471` — *„⚠ Das bleibt eine Greedy-Schwelle und ist kein
    Optimierer (Delta 4 ‚LP-Lücke', Delta 11/14)."*
  - `Pflichtenheft_Kalkulator_MVP.md` §3.6.2, letzter Absatz — *„**Die LP-Lücke bleibt offen:** dies
    ist weiterhin eine Greedy-Heuristik und kein Optimierer."*
  - §7 führt *„Mathematische Ko-Optimierung von Peak/Eigenverbrauch/Lastverschiebung"* als `[v2]`.

Die beiden in der Pflichtlektüre genannten Dateien tragen etwas anderes:
`monthly-tariff-comparison.ts` ist eine **Kostenaufsummierung** über drei Preisreihen
(Modulkopf: „Es entsteht keine zweite Simulation und kein zweiter Preisweg") und
`real-saving.ts` ist die **Aufschlüsselung einer Differenz in zwei Ursachen**, 102 Zeilen ohne jede
Optimierung. Keine der beiden enthält Entscheidungsvariablen, Nebenbedingungen oder eine Zielfunktion.

### 3.2 Was das Hindsight-Optimum tatsächlich ist — vier Bausteine, alle greedy

| Baustein | Fundort | Verfahren | Rückblick-Horizont |
|---|---|---|---|
| Kapp-Schwellen-Suche | `simulation/peak-shaving.ts`, §3.6.1 | **Binäre Suche** über `cap`, je Abrechnungsperiode, ein durchgehender chronologischer Lauf | **ganze Periode** (Monat bzw. Jahr) |
| Spitzen-Reserve `socFloor(t)` | `simulation/reserve.ts:24-59` | **Rückwärts-Pass** über das ganze Jahr, `R[i]` aus `R[i+1]` | **ganze Periode** — ausdrücklich: „Der Rückblick ist BEWUSST voll" |
| Tages-Rangfolge | `simulation/daily-price-order.ts` | zwei Schranken (`chargeCeilingKwh`, `priceFloorKwh`), reine Ordnungsaussagen | **genau ein lokaler Kalendertag** |
| Dispatch | `simulation/dispatch.ts` | sechs Schritte, chronologisch, greedy | keiner (rein vorwärts) |

### 3.3 Der eigentliche Wiederverwendungs-Kandidat: `daily-price-order.ts` ist bereits ein Tagesplaner

Das ist der produktive Befund dieses Abschnitts, und er ist stärker als das, wonach gefragt war.

**§3.6.2 hat den Horizont am 02.09.2026 bereits auf genau einen Kalendertag festgelegt, und zwar
mit exakt der Begründung, die diesem Vorhaben zugrunde liegt:** *„aWATTar veröffentlicht den vollen
Folgetag gegen 14 Uhr vorab. Eine Lade-/Entladeentscheidung innerhalb eines Kalendertags ist damit
einer realen Steuerung tatsächlich bekannt und keine Hellsichtigkeit."*

Die Datei gruppiert bereits über die lokale Wanduhr (`localDayKey`), beendet beide Schranken an der
Tagesgrenze und trägt den SoC physikalisch darüber hinweg.

**Was ihr zur vorausschauenden Steuerung fehlt, ist eine Eingabe, keine Struktur.**
`DailyPriceOrderInputs` nimmt heute:

| Feld | heute | bei vorausschauender Steuerung |
|---|---|---|
| `rateCtPerKwh` | echte Preiskurve | **unverändert** — die Day-Ahead-Preise sind für morgen bekannt |
| `preferChargeInterval` | aus `tou.ts`, über dieselbe Preiskurve | **unverändert** |
| `draws` | **der gemessene Netzbezug des Tages** | **← hier sitzt die ganze Änderung**: prognostiziert |
| `capForInterval` | aus der Kapp-Suche über die **ganze Periode** | **← und hier die zweite**: die Kappschwelle darf morgen nicht aus dem Jahresrückblick kommen |
| `physics`, `deltaH` | Anlagendaten | unverändert |

### 3.4 ⚠ Die Constraints unterscheiden sich strukturell — aber an einer anderen Stelle als vermutet

Die Frage vermutete den Unterschied bei einer **Sicherheitsmarge für den Lastspitzenschutz**. Gegen
den Code gelesen liegt er woanders und ist grundsätzlicher:

- **`daily-price-order.ts` hat überhaupt keinen Spitzenschutz-Constraint.** Beide Schranken sind
  reine **Preis-Ordnungsaussagen**; die Spitzenkappung (Schritt 2) und die Spitzenbereitschaft
  (Schritt 5b) kennen sie ausdrücklich nicht („Die Spitzenkappung kennt keine der beiden Schranken —
  sie entlädt unbedingt, sobald `draw > cap`"). Eine Sicherheitsmarge wäre hier also gar nicht
  anzubringen.
- **Der Spitzenschutz sitzt in `reserve.ts`, und DER ist strukturell nicht auf einen Tag
  reduzierbar.** `computeSocFloor` ist ein Rückwärts-Pass über das **ganze Jahr**; sein Ergebnis an
  einem Dienstag im März hängt an einer Spitze, die im Mai kommt (der Modulkopf nennt das als
  Absicht: „ein Monat läuft nicht blind leer, wenn Anfang des Folgemonats eine Spitze steht"). Eine
  vorausschauende Steuerung mit Tageshorizont **kann diesen Wert nicht kennen**.
- **Dasselbe für die Kappschwelle selbst.** `cap` entsteht aus einer binären Suche über die ganze
  Periode. Morgen früh weiss niemand, welche Schwelle den Monat trägt.

**⇒ Die strukturelle Trennlinie verläuft nicht zwischen „Ist-Wert" und „Prognosewert", sondern
zwischen den beiden Ersparnis-Dimensionen:**

| Dimension | reduzierbar auf einen Tageshorizont? |
|---|---|
| Energie (Lastverschiebung, Eigenverbrauch) | **ja** — `daily-price-order.ts` tut es bereits |
| Leistungspreis (Spitzenkappung) | **nein** — `cap` und `socFloor` sind Periodengrössen |

Das deckt sich exakt mit der Arbeitsteilung, die §3.6 ohnehin schon festhält: *„Der
Leistungspreis-/Spitzenschutz-Anteil ist davon NICHT betroffen — er ist durch eine einfache
Schwellenwert-Regel (Schritt 2) auch reaktiv erreichbar."* Der Rückblick stört den Energie-Anteil;
der Spitzenanteil braucht gar keine Prognose, weil er reaktiv funktioniert.

---

## 4. Frage 4 — Re-Solve-Kadenz

### 4.1 Was bereits festliegt

§3.6.2 hat den Horizont auf **genau einen lokalen Kalendertag** festgelegt, mit der
14-Uhr-Veröffentlichung als Begründung. Der Code setzt das um (`localDayKey`). Ein untertägiges
Nachschärfen ist an keiner Stelle vorgesehen, und es gibt dafür auch keinen Begriff im Contract.

### 4.2 ⚠ Ohne Live-Zähler ist ein Re-Solve nicht bloss ungebaut — er ist nicht definierbar

**Gemessen:** **0 Treffer** auf `modbus`, `Modbus`, `live_meter`, `liveMeter` über `packages/` und
`apps/`. Der einzige Ort, an dem der Begriff überhaupt vorkommt, ist der Contract selbst als
`[v2]`-Vermerk (`Pflichtenheft_Kalkulator_MVP.md:484`, `source text -- 'csv_upload' | 'live_meter'[v2] | 'api'[v2]`)
und §7 („Live-Anbindung Zähler/Wechselrichter (Modbus/REST)").

**Die Folge ist logisch und nicht verhandelbar:** ein Re-Solve um 13 Uhr wäre ein zweiter Lauf
desselben Verfahrens über dieselben Eingaben. Die Preiskurve hat sich seit Mitternacht nicht
geändert (Day-Ahead ist fix), die PVGIS-Klimatologie ist eine Konstante des Kalendertags (§1.1) und
die Verbrauchsprognose kommt aus einem statischen Historienmuster (§2). **Es gibt bis zum Abend
keine einzige neue Information.** Ein Re-Solve ergäbe denselben Plan.

Untertägiges Nachschärfen setzt also **zwingend** eine Beobachtung voraus — SoC-Ist,
Verbrauchs-Ist, Erzeugungs-Ist. Alle drei kommen aus derselben Quelle, und die ist `[v2]`.

**⇒ Die Kadenz „ein Plan je Tag" ist in dieser Variante keine Modellierungspräferenz, sondern die
Folge einer fehlenden Eingabe.** Sie ist damit auch nicht durch besseres Rechnen zu verbessern.

### 4.3 Grössenordnung — worum es überhaupt geht

Damit die Frage „lohnt der Aufwand" eine Zahl hat. **Herkunft: Produktionspfad
(`run-from-draft.ts`), Cloud-Entwurf `_provenance.source: measured` vom 19.09.2026, echte
`grid_tariffs`/`spot_prices`, 209 Tage, Stand nach PR #295 (fünf Abgabenposten) — zitiert aus der
Root-`CLAUDE.md`, in dieser Bestandsaufnahme NICHT nachgerechnet:**

| Reihe | über 209 Tage |
|---|---|
| Ihr Tarif heute | 1.021,89 € |
| aWATTar ungesteuert | 963,34 € |
| aWATTar mit Speicher | 761,35 € |

Daraus nach `real-saving.ts`: `tariffSwitchEur` = **+58,55 €**, **`controlValueEur` = +201,99 €**,
`totalEur` = 260,54 €.

**Der Betrag, den eine Ladesteuerung überhaupt bewegt, ist `controlValueEur` — hier rund 202 € über
209 Tage.** Das ist zugleich die Zahl, die eine vorausschauende Variante **nach unten** korrigieren
würde: sie ist heute mit **vollem Rückblick** auf den Tag gerechnet (`draws` sind Ist-Werte, §3.3),
eine Prognose mit 28 % Tagesfehler und 41 % Formfehler erreicht sie nicht.

**⚠ Es ist nicht gemessen, wie viel davon bleibt.** Das ist die erste Zahl, die ein Bau-Schritt
liefern muss.

---

## 5. Was offen bleibt

| Punkt | Art | Stand |
|---|---|---|
| Tagesgenauigkeit der PVGIS-Klimatologie über das volle Jahr | **teilgemessen** | n = 3 Kalendertage aus der gekürzten Repo-Fixture (Faktor 4,2–6,7; CV 34–49 %). Ein einzelner PVGIS-Aufruf über alle 365 Tage wäre billig nachzuholen |
| Eimer-Einteilung des Verbrauchsmusters | **gemessen, aber n = 1 Kunde** | Unter LOO gewinnt `nur Monat` ≈ `WT/WE × Monat`; `Wochentag(7) × Monat` ist raus. **Die Wochentagsachse ist an einem HAUSHALT gemessen und für die Zielgruppe GEWERBE unbelegt** `[MARTIN]` |
| Was der Prognosefehler in Euro kostet | **Fehlanzeige** | Kein Engine-Lauf mit ausgetauschten Eingaben. Bezugsgrösse: `controlValueEur` ≈ 202 € / 209 Tage |
| Mindest-Datenmenge, ab der ein Muster überhaupt gebildet wird | **offen** | Gemessen ist nur, dass 208 Tage in der feinsten Einteilung bereits leere LOO-Eimer erzeugen |
| Verhalten bei `standard_profile` | **strukturell unmessbar** | Muster und Wahrheit wären dieselbe Formel (§2.5) |
| Umgang mit `cap`/`socFloor` unter Tageshorizont | **offen** | §3.4: beide sind Periodengrössen und auf einen Tag nicht reduzierbar |
| Untertägiges Nachschärfen | **entschieden durch Abwesenheit** | Ohne Live-Zähler (`[v2]`) gibt es untertags keine neue Information (§4.2) |
| LP-Formulierung | **erledigt — Prämisse falsch** | Es gibt keine (§3.1). Die „LP-Lücke" ist im Contract als offen geführt |

---

## Anhang — wie gemessen wurde

- **§1.2** — `packages/engine/src/pv-generation/__fixtures__/pvgis-seriescalc-wien-2014-2023-gekuerzt.json`
  eingelesen, `outputs.hourly` nach `YYYYMMDD:HHMM` zerlegt, je (Monat-Tag) die Tagessumme `P` je
  Wetterjahr gebildet, Tage mit < 5 Jahren verworfen. 768 Stunden, 4 Kalendertage, 3 davon mit
  10 Jahren.
- **§2** — Urbanz-CSV (`;`-getrennt, Dezimalkomma, Spalte 4 = Verbrauch kWh) je Kalendertag auf
  96 Slots gelegt; nur Tage mit allen 96 Werten gewertet (208 von 209). Je Schema Eimermittel über
  die 96 Slots gebildet, einmal mit und einmal ohne den bewerteten Tag. Fehlermasse: Slot-nMAE
  (mittlerer absoluter Slot-Fehler ÷ mittlerer Slot-Verbrauch), Tages-nMAE (analog auf die
  Tagessumme), Median-APE, Formfehler (beide Kurven auf ihre Tagessumme normiert, mittlere absolute
  Differenz ÷ 2). Wochentag aus `Date.UTC(y, m-1, d).getUTCDay()`, Wochenende = Sa/So.
- **§3/§4** — Quellcode auf `a1469a1` gelesen; `package.json`-Abhängigkeiten und
  `modbus`/`live_meter`-Treffer per `grep` über `packages/` und `apps/` ohne `node_modules`.
- **§4.3** — **nicht selbst gerechnet**, sondern aus Root-`CLAUDE.md` („Fünf fehlende Kostenposten
  im Tarifvergleich", 21.09.2026) und `urbanz-referenzfall-liegt-auf-dem-rechner` zitiert.
