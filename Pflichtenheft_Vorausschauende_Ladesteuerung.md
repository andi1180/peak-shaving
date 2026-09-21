# Pflichtenheft — Vorausschauende Ladesteuerung (vereinfacht)

> **Dokumenttyp:** Technisches Pflichtenheft. Es beschreibt, was gebaut werden soll, und legt die
> Contract-Entscheidungen fest, die vor dem ersten Bau-Prompt feststehen müssen. **Es ist selbst kein
> Bau-Schritt** — zum Zeitpunkt seiner Entstehung (21.09.2026, Commit `a1469a1`) ist an keiner Zeile
> Anwendungscode etwas geändert.
>
> **Bezug:** Ergänzt `Pflichtenheft_Kalkulator_MVP.md` (§3.6 Simulation, §3.6.1 Kapp-Suche,
> **§3.6.2 Tages-Rangfolge**, §3.7 Zuschreibung, §6.2 Hindsight-Hinweis, §7 `[v2]`-Liste) und
> `Pflichtenheft_PV_Zeitreihengenerator.md` (B22, die PVGIS-Klimatologie). Wer daraus baut, liest
> **zuerst** das Kalkulator-Pflichtenheft, **dann** dieses Dokument. Alles, was hier nicht erwähnt
> ist, bleibt unverändert gültig. Für Reihenfolge und Umfang bleibt `Fahrplan_2026.md` maßgeblich.
>
> **Kanonische Faktenquelle für alle Zahlen und Befunde in diesem Dokument:**
> `Vorausschauende_Ladesteuerung_Bestandsaufnahme.md` (Repo-Root, Commit `a1469a1`, 21.09.2026).
> Dort steht, wie gemessen wurde; hier steht, was daraus folgt. Bei Widerspruch gilt die
> Bestandsaufnahme für die **Messung**, dieses Dokument für die **Entscheidung**.
>
> **⚠ Dieses Dokument trägt noch KEINE Fahrplan-Nummer.** Die höchste vergebene ist B24; ob dies
> B25 wird oder als Delta an §3.6.2 hängt, entscheidet `Fahrplan_2026.md` `[ANDREAS]`.
>
> **Legende:** `[ANNAHME]` = getroffene Annahme, vor Auslieferung zu bestätigen · `[MARTIN]` /
> `[ANDREAS]` = Input erforderlich, nicht ableitbar · `[v2]` = bewusst nicht in dieser Variante,
> s. **§3**.

---

## 0. Zweck, Zielgruppe und Scope-Grenze

### 0.1 Zweck

Der Report weist den Energie-Anteil der Ersparnis heute als **„Bestmarke mit vollem Rückblick"** aus
(`HINDSIGHT_NOTE`, §3.6 „methodische Konsequenz", §6.2). Das ist ehrlich, aber es ist auch eine
offene Flanke im Verkaufsgespräch: der Kunde erfährt, was **maximal** möglich gewesen wäre, und
nicht, was eine Steuerung ohne Hellsichtigkeit **erreicht** hätte.

Dieses Vorhaben schließt genau diese Lücke — **und nur sie**: es rechnet denselben Fahrplan ein
zweites Mal, aber mit Eingaben, die eine reale Steuerung am Vorabend tatsächlich gehabt hätte:

- **Preise:** die bereits veröffentlichten aWATTar-Day-Ahead-Preise. **Keine Prognose nötig** — sie
  sind für den Folgetag ab ~14 Uhr bekannt (§3.6.2 begründet daraus bereits den Tageshorizont).
- **PV-Erzeugung:** die bestehende PVGIS-Klimatologie aus B22 (Zehn-Jahres-Mittel). **Kein
  Live-Wetter.**
- **Verbrauch:** ein Muster aus der **eigenen Historie des Kunden**. Kein Fremdprofil, kein Modell.

### 0.2 Zielgruppe

Jeder Kunde mit einer **echten Preiskurve** (Delta-4-Hebel angefordert und berechenbar) und einem
**echten Lastgang**. Ohne Preiskurve gibt es innerhalb eines Tages gar keine Rangfolge (§3.6.2
„Geltungsbereich"); ohne echten Lastgang gibt es keine Historie, aus der ein Muster entstehen könnte.

**⚠ `standard_profile` ist ausdrücklich ausgeschlossen, und zwar strukturell.**
`generateStandardLoadProfile` ist deterministisch und rauschfrei (`h0.ts`: „Es gibt keinen Zufall in
diesem Generator, und das ist eine fachliche Entscheidung"). Ein aus ihm gebildetes Wochentyp-Muster
träfe den Tag **exakt**, weil Muster und Wahrheit dieselbe Formel sind. Die ausgewiesene
Prognosegüte wäre dann 100 % — eine Selbstauskunft, keine Messung, und im Report eine Zahl, die
genau das Gegenteil dessen behauptet, was sie belegt. Dieselbe Haltung wie der harte
`standard_profile`-Blocker bei der Spitzenkappung (Delta 8/9b-1).

### 0.3 Scope-Grenze

**Nicht Gegenstand:** kein zweiter Dispatch-Pfad im Code, kein Optimierer, keine Live-Daten, keine
Steuerung von irgendetwas. **Diese Logik plant, sie steuert nichts** — die Ausführung ist ein
eigener, seit dem MVP geführter `[v2]`-Punkt (§7 „Live-Anbindung Zähler/Wechselrichter").

**Was in eine vollwertige, nicht-vereinfachte Ladeoptimierung gehört, steht als eigener Abschnitt in
§3 und ist ausdrücklich NICHT Teil dieser Variante.**

---

## 1. Der tragende Befund: es wird kein Planer gebaut, es werden Eingaben getauscht

Dies ist die Architekturentscheidung des Vorhabens, und sie ist gemessen, nicht abgeleitet
(Bestandsaufnahme §3).

**Es gibt keine LP-Formulierung im Repo, die man wiederverwenden könnte.** `packages/engine` hat drei
Abhängigkeiten (`papaparse`, `shared`, `xlsx`) und keinen Solver; das Hindsight-Optimum entsteht aus
einer chronologischen Greedy-Heuristik, und der Code sagt das selbst (`tou.ts:471`; §3.6.2 „Die
LP-Lücke bleibt offen"). `monthly-tariff-comparison.ts` ist eine Kostenaufsummierung,
`real-saving.ts` eine Differenz-Aufschlüsselung — keine der beiden trägt Entscheidungsvariablen,
Nebenbedingungen oder eine Zielfunktion.

**Wiederverwendbar ist etwas Besseres:** `packages/engine/src/simulation/daily-price-order.ts` **ist
bereits strukturell ein Ein-Kalendertag-Planer.** §3.6.2 hat den Horizont am 02.09.2026 auf genau
einen lokalen Kalendertag festgelegt — mit exakt der Begründung, die diesem Vorhaben zugrunde liegt
(aWATTar veröffentlicht den Folgetag gegen 14 Uhr vorab). Die Datei gruppiert über die lokale
Wanduhr, beendet beide Schranken an der Tagesgrenze und trägt den SoC physikalisch darüber hinweg.

**Was ihr fehlt, ist eine Eingabe, keine Struktur.** `DailyPriceOrderInputs` nimmt heute den
**gemessenen** Netzbezug des Tages (`draws`). Genau dort — und nur dort — sitzt die Änderung.

**⇒ Es entsteht kein zweiter Fahrplan-Algorithmus. Es entsteht eine zweite Eingabereihe.**

---

## 2. Contract — die sechs Entscheidungen, die die Messung erzwingt

Diese sechs stehen fest und sind in einem Bau-Prompt **nicht neu herzuleiten**. Sie sind nicht
gewählt, sondern **aus den Messungen der Bestandsaufnahme gefolgert**. Was sie offen lassen, steht
in **§4** — und es ist mehr als hier steht.

### 2.1 Die PVGIS-Klimatologie wird unverändert wiederverwendet — mit einer neuen Pflichtangabe

**Entscheidung:** Die Erzeugungsprognose für einen Tag ist ein Aufruf von
`expandReferenceToTimestamps(profile, timestamps)` aus
`packages/engine/src/pv-generation/reference-profile.ts` mit den 96 Zeitstempeln dieses Tages.
**Null Zeilen Änderung an B22.**

**Warum das trägt — gemessen:** `PvReferenceProfile.hourlyKw` sind **8.760 Zellen**, indiziert über
`referenceHourIndex(month, day, hour)` — eine **(Monat, Tag, Stunde)-Kalenderposition**, keine
Jahres- und keine Monatssumme. `referenceHourIndexForUtcMs` beantwortet unmittelbar „was erzeugt
diese Anlage am 12.10. um 14 Uhr". Das Ergebnis ist bereits in kW und bereits auf dem 15-min-Gitter
(Treppenfunktion, B22 §2.5). Die Zellen sind zudem **UTC-Kalenderpositionen und kennen die Zeitzone
des Kunden gar nicht** — ein Tagesplan über die lokale Wanduhr fällt von selbst richtig, auch an
DST-Tagen mit 92 bzw. 100 Intervallen.

**⚠ Die neue Pflichtangabe, und sie ist der wichtigere Teil dieser Entscheidung: die
Jahresgenauigkeit ist NICHT die Tagesgenauigkeit, und der Unterschied ist eine Größenordnung.**

B22 §2.1 weist die Klimatologie mit **± 5,8 %** aus. Das ist die Streuung der **Jahres**erträge, und
für eine über ein Jahr summierte Eigenverbrauchs-Rechnung ist sie die richtige Angabe. Für **einen
Tag** gilt sie nicht. Gegen dieselbe echte PVGIS-Antwort gemessen (Tagessumme je Kalendertag über
die zehn Wetterjahre):

| Kalendertag | kleinstes Jahr | grösstes Jahr | Verhältnis | Variationskoeffizient |
|---|---|---|---|---|
| 28.02. | 12.518 Wh | 52.677 Wh | **4,2×** | 40 % |
| 01.03. | 8.607 Wh | 55.058 Wh | **6,4×** | 49 % |
| 21.06. | 9.439 Wh | 63.257 Wh | **6,7×** | 34 % |

**Mittlerer Variationskoeffizient der Tagessumme: 41 %.** Die Klimatologie beantwortet „was liefert
ein **typischer** 21. Juni", nicht „was liefert **morgen**".

**Folge für die Umsetzung:** Wo immer das Ergebnis dieses Vorhabens erscheint, wird diese Zahl
genannt — **nicht die ± 5,8 %**, und nicht in einer Fußnote. Dieselbe Regel und dieselbe Begründung
wie bei B22 §2.2 Punkt 1: ein Vorbehalt, den niemand sieht, schützt niemanden. Dazu kommt die
bereits dokumentierte **Glättung** (B22 §4.2: gemittelte Spitze 6,18 kW gegen 7,55–8,30 kW in den
Einzeljahren) — eine Prognose, die nie eine Wolkenkante zeigt, plant nie eine Nachladung ein, die
eine Wolkenkante nötig gemacht hätte.

**⚠ Fehlanzeige, ausdrücklich:** die 41 % sind an **drei** Kalendertagen gemessen (die Repo-Fixture
ist auf 768 Stunden gekürzt). Eine Messung über alle 365 Tage ist **ein** PVGIS-Aufruf und vor der
Auslieferung nachzuholen — die Zahl steht bis dahin als `[ANNAHME]`.

### 2.2 Das Verbrauchsmuster wird per Leave-one-out gebildet — Pflicht, nicht Güteprüfung

**Entscheidung:** Der Eimermittelwert, mit dem ein Tag bewertet wird, enthält **diesen Tag nicht**.
Und zwar nicht als Prüfverfahren beim Bau, sondern als **Rechenregel im Produktivcode**.

**Warum, gemessen** (Urbanz, 208 vollständige Tage, Tages-nMAE):

| Einteilung | selbst-einschliessend | Leave-one-out | **Überschätzung** |
|---|---|---|---|
| Wochentag (7) × Monat | 25,5 % | **33,9 %** | **−25 %** |
| WT/WE × Monat | 26,5 % | 28,8 % | −8 % |
| nur Monat | 26,9 % | 28,2 % | −5 % |

**Das Leakage skaliert mit `1/n` des Eimers** — und daraus folgt die eigentliche Falle: **je feiner
die Einteilung, desto größer die Selbstbestätigung.** Ohne die Regel sähe ausgerechnet die feinste
Einteilung am besten aus, obwohl sie (§2.3) die schlechteste ist. Der Fehler wäre damit nicht bloß
eine zu gute Zahl, sondern **eine falsche Bauentscheidung, die eine zu gute Zahl als Beleg mitbringt.**

**⚠ Zweitfolge, die nicht übersehen werden darf:** bei `Wochentag(7) × Monat` sind **zwei von
51 Eimern unter Leave-one-out leer** — für diese Tage existiert überhaupt kein Vergleichswert. Jede
Einteilung, die leere Eimer erzeugen kann, braucht eine benannte Antwort für diesen Fall
(s. §4). **Ein stiller Rückfall auf den Gesamtmittelwert ist ausgeschlossen** — dieselbe Regel wie
bei B22 §4.1 („kein stiller Rückfall auf eine ersatzweise Kurve").

### 2.3 `Wochentag(7) × Monat` ist ausgeschlossen

**Entscheidung:** Die Einteilung nach **sieben** Wochentagen kommt nicht in Betracht. Welche der
verbleibenden es wird, ist **offen** (§4).

**Warum, gemessen** (Leave-one-out; Güte gegen den trivialen Vorhersager „alle Tage, ein Eimer"):

| Einteilung (LOO) | Tages-nMAE | Median-APE | Formfehler | Güte |
|---|---|---|---|---|
| **nur Monat** | **28,2 %** | 31 % | 41,4 % | **+67 %** |
| **WT/WE × Monat** | 28,8 % | 34 % | 42,1 % | +66 % |
| Wochentag (7) × Monat | **33,9 %** | 43 % | 46,4 % | +60 % |
| WT/WE × Jahreszeit | 45,3 % | 39 % | 41,6 % | +47 % |
| nur WT/WE | 85,2 % | 90 % | 46,8 % | **−0 %** |

Die sieben Wochentage **verdünnen die Eimer, ohne Information hinzuzufügen**: sie sind gleichzeitig
die schlechteste sinnvolle Vorhersage **und** die mit dem größten Leakage. Das ist der Fall, den §2.2
verhindert.

**Der bestehende Präzedenzfall im Code stützt das.** `h0.ts` bildet seine Kurve aus genau zwei
Achsen: `dailyShape(h, weekday)` mit einer **binären** Unterscheidung `weekday >= 5` — **keine sieben
Wochentage** — und `seasonFactor(month)` als **stetigem Kosinus** über das Jahr, nicht als zwölf
diskreten Eimern.

**⚠ Ausdrücklich NICHT entschieden ist damit, dass die Wochentagsachse entfallen soll.** An diesem
Kunden trägt sie nichts (`nur WT/WE` hat −0 % Güte; das Verhältnis Wochenende/Werktag schwankt je
Monat zwischen 0,82 und 1,92 ohne Richtung, über alle Tage 0,97) — **aber Urbanz ist ein Haushalt
mit Heizungslast, und die Zielgruppe des Kalkulators sind Gewerbebetriebe.** Bei einer Bäckerei ist
genau diese Achse der Unterschied zwischen Betrieb und Stillstand. Die Entscheidung gehört deshalb
in §4 und braucht einen zweiten, gewerblichen Lastgang `[MARTIN]`.

### 2.4 Nur der Energie-Anteil. Der Leistungspreis-Anteil bleibt unberührt.

**Entscheidung:** Das Vorhaben verändert ausschließlich `selfConsumptionSaving` und
`loadShiftSaving`. `leistungspreisSavingPerYear`, die Kapp-Suche (§3.6.1) und `socFloor(t)` werden
**nicht angefasst**.

**Warum — und das ist eine strukturelle Feststellung, keine Abgrenzung aus Bequemlichkeit:**

| Dimension | auf einen Tageshorizont reduzierbar? |
|---|---|
| Energie (Lastverschiebung, Eigenverbrauch) | **ja** — `daily-price-order.ts` tut es bereits |
| Leistungspreis (Spitzenkappung) | **nein** — `cap` und `socFloor` sind **Periodengrößen** |

`computeSocFloor` (`simulation/reserve.ts`) ist ein **Rückwärts-Pass über das ganze Jahr**; sein Wert
an einem Dienstag im März hängt an einer Spitze, die im Mai kommt — der Modulkopf nennt das als
Absicht („ein Monat läuft nicht blind leer, wenn Anfang des Folgemonats eine Spitze steht"). `cap`
entsteht aus einer binären Suche über die ganze Abrechnungsperiode. **Eine Steuerung mit
Tageshorizont kann beide Werte nicht kennen.**

Das deckt sich exakt mit dem, was §3.6 ohnehin festhält: *„Der Leistungspreis-/Spitzenschutz-Anteil
ist davon NICHT betroffen — er ist durch eine einfache Schwellenwert-Regel (Schritt 2) auch reaktiv
erreichbar."* **Der Rückblick stört den Energie-Anteil; der Spitzenanteil braucht gar keine
Prognose.** Priorität `peak_first` (§3.7) gilt unverändert.

**⚠ Die Frage, mit welchem `cap`/`socFloor` der prognosebasierte Lauf dann rechnet, ist damit NICHT
beantwortet, sondern verschärft** — s. §4. Sie ist die schwierigste offene Frage des Vorhabens.

### 2.5 Ein Plan je Tag. Kein untertägiges Nachschärfen.

**Entscheidung:** Genau ein Plan je lokalem Kalendertag, gebildet aus den am Vorabend bekannten
Größen. Kein Re-Solve.

**Warum — und das ist eine Entscheidung durch Abwesenheit, keine Präferenz:** Es gibt **0 Treffer**
auf `modbus`/`live_meter` im Code; die Live-Anbindung ist seit dem MVP als `[v2]` geführt (§7).
**Ohne Beobachtung gibt es untertags keine neue Information:** die Day-Ahead-Preise sind seit
Mitternacht fix, die PVGIS-Klimatologie ist eine Konstante des Kalendertags (§2.1), und das
Verbrauchsmuster ist statisch. Ein Re-Solve um 13 Uhr liefe über **dieselben Eingaben** und ergäbe
**denselben Plan**.

**⇒ Die Kadenz ist die Folge einer fehlenden Eingabe, nicht einer Modellierungsentscheidung. Sie ist
durch besseres Rechnen nicht zu verbessern.** Rollierende Neuplanung gehört in die vollwertige
Variante — s. **§3**.

### 2.6 Es entsteht eine ZWEITE, getrennt ausgewiesene Zahl — und sie ersetzt die Bestmarke nicht

**Entscheidung:** Das Ergebnis tritt **neben** den bestehenden Energie-Anteil, nicht an seine Stelle.
Die Bestmarke bleibt, was sie ist, und behält ihren `HINDSIGHT_NOTE`.

**Warum die Bestmarke bleibt:** Sie ist die ehrliche Obergrenze und die einzige Zahl, die heute
gegen den echten Lastgang validiert ist. Sie zu ersetzen hieße, eine belegte Zahl gegen eine
unbelegte zu tauschen.

**Warum die neue Zahl trotzdem gebraucht wird:** Sie beantwortet die Frage, die der
`HINDSIGHT_NOTE` heute aufwirft und offen lässt.

**⚠ Diese Entscheidung berührt Prinzip 2 („Ein Dispatch, eine ehrliche Zahl") und ist deshalb hier
nur zur HÄLFTE getroffen.** Fest steht: es gibt **weiterhin genau einen Fahrplan pro Rechenlauf**,
und die beiden Zahlen werden **niemals addiert** — sie sind zwei Messungen desselben Gegenstands
unter verschiedenen Informationsständen, nicht zwei Ersparnisquellen. **Offen ist, welche der beiden
die Kernzahl des Reports ist** und ob die zweite überhaupt in den Kundenreport gehört oder nur in
den internen Nachweis. Das ist eine Produktentscheidung `[ANDREAS]` und steht in §4.

### 2.7 Typdefinitionen

```ts
// ─────────────────────────────────────────────────────────────────────────────
// (1) PV — NICHTS NEUES. Die B22-Funktion wird unverändert benutzt (§2.1).
// ─────────────────────────────────────────────────────────────────────────────
// packages/engine/src/pv-generation/reference-profile.ts, bereits vorhanden:
//   expandReferenceToTimestamps(profile: Pick<PvReferenceProfile,'hourlyKw'>,
//                               timestamps: readonly string[]): number[]
// Neu ist nur die AUSSAGE über ihre Tagesgenauigkeit — eine Konstante neben
// PVGIS_WEATHER_SPREAD_PERCENT, ausdrücklich NICHT an deren Stelle.
const PVGIS_DAILY_SPREAD_PERCENT = 41; // [ANNAHME] an n = 3 Kalendertagen gemessen (§2.1)

// ─────────────────────────────────────────────────────────────────────────────
// (2) Die Eimer-Einteilung — die Achsen stehen, die WAHL steht NICHT (§2.3, §4)
// ─────────────────────────────────────────────────────────────────────────────
// 'weekday_month' ist AUSGESCHLOSSEN (§2.3) und steht deshalb NICHT im Typ.
type ConsumptionPatternScheme =
  | 'month'              // nur Kalendermonat            — bestes LOO-Ergebnis an n = 1 Kunde
  | 'daytype_month'      // WT/WE × Kalendermonat        — 0,6 pp dahinter, Achse für Gewerbe erwartet
  | 'daytype_season';    // WT/WE × Jahreszeit           — deutlich schwächer, für kurze Lastgänge

// Der Mittelwert ENTHÄLT DEN BEWERTETEN TAG NICHT (§2.2). Das ist Produktivverhalten,
// keine Testhilfe — der Parameter ist deshalb der Tag selbst, nicht ein Schalter.
declare function consumptionPatternForDay(
  history: LoadProfile,
  targetDayKey: string,       // lokaler Kalendertag, Format wie localDayKey() in daily-price-order.ts
  scheme: ConsumptionPatternScheme,
): ConsumptionPatternOutcome;

type ConsumptionPatternOutcome =
  // 96 Werte in kW, auf den Zeitstempeln des Zieltags. Trägt mit, wie viele Tage
  // eingegangen sind — die Zahl gehört in den Nachweis, nicht in eine Fussnote.
  | { ok: true; forecastKw: number[]; peerDays: number }
  // KEIN stiller Rückfall auf den Gesamtmittelwert (§2.2). Der Grund wird benannt.
  | { ok: false; reason: 'empty_bucket' | 'insufficient_history' | 'standard_profile' };

// ─────────────────────────────────────────────────────────────────────────────
// (3) Der Eingabetausch — das ganze Vorhaben in einem Feld (§1)
// ─────────────────────────────────────────────────────────────────────────────
// DailyPriceOrderInputs bleibt UNVERÄNDERT. `draws` trägt heute den gemessenen
// Netzbezug; im vorausschauenden Lauf trägt es die Prognose. Es entsteht kein
// zweiter Planer und kein zweiter Dispatch-Pfad.
//
// ⚠ `capForInterval` ist der ungelöste Teil: cap und socFloor sind Periodengrössen
//   und auf einen Tageshorizont NICHT reduzierbar (§2.4). Welcher Wert im
//   vorausschauenden Lauf einzusetzen ist, ist OFFEN — s. §4.

// ─────────────────────────────────────────────────────────────────────────────
// (4) Das Ergebnis — zweite Zahl, NIE addiert (§2.6)
// ─────────────────────────────────────────────────────────────────────────────
type ForesightComparison = {
  /** Der bestehende Energie-Anteil, mit vollem Rückblick. Unverändert. */
  hindsightEnergySavingEur: number;
  /** Derselbe Anteil, mit den am Vorabend bekannten Eingaben. */
  foresightEnergySavingEur: number;
  /** foresight ÷ hindsight. Die Zahl, die das Vorhaben eigentlich liefert. */
  realizationRatio: number;
  /** Welches Schema gerechnet wurde — gehört in den Nachweis und ins Analyse-Bündel. */
  scheme: ConsumptionPatternScheme;
};
// Es gibt bewusst KEIN Feld `totalSavingPerYear` daneben: die beiden Beträge sind
// zwei Messungen DESSELBEN Gegenstands, keine zwei Ersparnisquellen (Prinzip 2).
```

---

## 3. Was in eine vollwertige, nicht-vereinfachte Variante gehört — NICHT Teil dieses Vorhabens

> Dieser Abschnitt ist **kein Ausblick und keine Wunschliste**. Er steht hier, damit die
> vereinfachte Variante nicht später für die vollwertige gehalten wird — von einem Leser, von einem
> Bau-Prompt oder von einem Verkaufsgespräch. Der Wortlaut ist von Andreas vorgegeben und wird
> **unverändert** geführt.

**Was in eine vollwertige, nicht-vereinfachte Ladeoptimierung gehört (nicht Teil der
Kalkulator-Variante): Live-Kurzfrist-Wetterprognose statt PVGIS-Zehnjahres-Klimamittel; ein
tagesaktuell nachjustiertes Verbrauchsmodell statt eines statischen Historienmusters; rollierende
Neuplanung (MPC: Execute-und-Re-Solve), nicht ein einmaliger Tagesplan; Live-Anbindung an
Zähler/Wechselrichter zur tatsächlichen Ausführung (bereits als eigener v2-Punkt geführt,
MVP-Pflichtenheft §7 — diese Logik plant, sie steuert nichts); Validierung an echten, live
gemessenen Ergebnissen über einen saisonal repräsentativen Zeitraum, bevor ein Ergebniswert
unvalidiert im Verkaufsmaterial erscheint; Umgang mit Prognosefehlern im Optimierungsmodell selbst
(Sicherheitsmarge), nicht nur als Punktschätzung.**

**Wo jeder dieser sechs Punkte in diesem Dokument auf seine vereinfachte Entsprechung trifft:**

| Punkt aus dem Vermerk | vereinfachte Entsprechung | gemessene Kosten der Vereinfachung |
|---|---|---|
| Live-Kurzfrist-Wetterprognose | PVGIS-Zehnjahres-Klimamittel (§2.1) | Tagesstreuung Faktor **4,2–6,7**, CV **41 %** — gegen ± 5,8 % im Jahr |
| tagesaktuell nachjustiertes Verbrauchsmodell | statisches Wochentyp/Monat-Muster (§2.2/§2.3) | Tages-nMAE **28 %** unter LOO, **Formfehler 41 %** gegen 47 % bei gar keinem Muster |
| rollierende Neuplanung (MPC) | ein Plan je Kalendertag (§2.5) | nicht bezifferbar — ohne Live-Zähler gibt es untertags nichts nachzuschärfen |
| Live-Anbindung zur Ausführung | **gar nichts** — diese Logik plant, sie steuert nichts (§0.3) | — |
| Validierung an live gemessenen Ergebnissen | Gegenrechnung gegen den historischen Lastgang (§5) | **die Lücke, die dieses Dokument NICHT schliesst** |
| Prognosefehler im Modell (Sicherheitsmarge) | **nicht vorgesehen** — Punktschätzung | offen, s. §4 |

**⚠ Die fünfte Zeile ist die, an der ein Missverständnis am teuersten wäre.** Eine Gegenrechnung
gegen den eigenen historischen Lastgang sagt, wie gut das Verfahren **auf vergangenen Daten**
abgeschnitten hätte. Sie sagt **nicht**, was eine reale Anlage im nächsten Jahr erreicht. Solange
das nicht live gemessen ist, gilt für jeden Ergebniswert dieses Vorhabens dieselbe Regel wie für
jede andere unvalidierte Zahl im Kalkulator (Root-`CLAUDE.md`, „Offene Abhängigkeiten"): **keine
ROI-Zahl als „echt" ausgeben.**

---

## 4. Was offen bleibt

Die Tabelle übernimmt die offenen Punkte der Bestandsaufnahme (§5) und ergänzt je Zeile den Stand
nach diesem Pflichtenheft. **Keiner dieser Punkte ist hier entschieden worden.**

> **Nachtrag 21.09.2026 — ein TEIL ist inzwischen gebaut, als reine INTERNE Berechnung.**
> `packages/engine/src/foresight/` liefert „Zahl 2" (`computePredictiveControlValue`) für die
> Kunden **ohne Leistungspreis** — Weg c (`cap = ∞`, `socFloor ≡ 0`), Eimer-Einteilung vorläufig
> `month`. Kein Rendering, keine Oberfläche, kein Analyse-Bündel; der Marker
> `basis: 'foresight_unvalidated'` reist mit der Zahl. Drei Zeilen der Tabelle sind dadurch
> weitergerückt und sagen das je selbst; die übrigen stehen unverändert.
>
> **Nachtrag 21.09.2026, zweiter Teil — WEG a ist gebaut, die Beschränkung auf Kunden ohne
> Leistungspreis ist AUFGEHOBEN.** `cap`/`socFloor` kommen jetzt aus einem Rückblick-Lauf desselben
> Kunden und Zeitraums (`simulation/peak-constraints.ts`, dieselbe Funktion wie `simulateBattery`);
> der Blocker `demand_charge` ist entfallen. Getauscht bleibt allein die Verbrauchserwartung —
> **der Lauf ist damit nur zur HÄLFTE vorausschauend, und die Spitzenschutz-Seite ist perfektes
> Wissen.** Der Marker `basis: 'foresight_unvalidated'` bleibt unverändert; was sich ändert, ist der
> Geltungsbereich der Zahl, nicht ihre Belastbarkeit.

| Punkt | Art | Stand nach diesem Pflichtenheft | Blockiert |
|---|---|---|---|
| Tagesauflösung der PVGIS-Klimatologie | **ERLEDIGT** | Liefert Stundenauflösung je Kalendertag, ohne eine Zeile Änderung (§2.1) | — |
| LP-Wiederverwendung | **ERLEDIGT — Prämisse traf nicht zu** | Es gibt keine LP-Formulierung. Wiederverwendet wird `daily-price-order.ts` als bereits vorhandener Tagesplaner (§1) | — |
| Leave-one-out | **ENTSCHIEDEN** | Pflicht im Produktivcode, nicht nur im Test (§2.2) | — |
| Untertägiges Nachschärfen | **ENTSCHIEDEN durch Abwesenheit** | Ohne Live-Zähler nicht definierbar (§2.5) | — |
| **Welche Eimer-Einteilung** | **OFFEN** | `weekday_month` ist raus (§2.3). `month` und `daytype_month` liegen an n = 1 Kunde **0,6 pp** auseinander — das ist kein Abstand, sondern Rauschen. **Die Wochentagsachse ist an einem HAUSHALT gemessen; die Zielgruppe ist GEWERBE**, wo sie der Hauptunterschied sein dürfte. Nötig: mindestens ein gewerblicher Lastgang über ≥ 6 Monate `[MARTIN]`. **21.09.2026: `month` ist als `[ANNAHME, vorläufig]`-Vorgabe gesetzt** (`DEFAULT_CONSUMPTION_PATTERN_SCHEME`), alle drei Schemata sind als Parameter rechenbar — die Wahl bleibt revisionspflichtig | nichts mehr — die Vorgabe ist gesetzt, die WAHL steht aus |
| **`cap` und `socFloor` im vorausschauenden Lauf** | **OFFEN für Kunden MIT Leistungspreis** | §2.4 stellt fest, dass beide Periodengrößen sind und auf einen Tag nicht reduzierbar. Drei denkbare Wege: (a) dieselben Werte wie im Hindsight-Lauf übernehmen — dann ist der vorausschauende Lauf **nur zur Hälfte** vorausschauend und das muss dastehen; (b) `cap` aus der bis dahin **abgelaufenen** Historie fortschreiben; (c) die Spitzenkappung **ganz abschalten** und nur den Energie-Anteil vergleichen. **⚠ 21.09.2026, zweiter Stand: (a) IST GEBAUT und gilt für alle Kunden** — `cap`/`socFloor` aus dem Rückblick-Lauf (`peak-constraints.ts`, geteilt mit `simulateBattery`), `demand_charge` entfallen; der Lauf ist damit **nur zur Hälfte vorausschauend**, und genau das steht im Modulkopf. **Gemessen an einer synthetischen Leistungspreis-Last:** bindet die Spitzen-Reserve fast die ganze Batterie (Plateau-Last, `socFloor` max 25,8 von 30 kWh), wird die Zahl gegenüber der Prognose unempfindlich — `realizationRatio` exakt 1,000, obwohl sich die Preis-Untergrenze in 420 von 480 Intervallen unterscheidet; bei kurzer Spitze (`socFloor` max 8,0 kWh) 0,955. **Ein Verhältnis von 1,000 ist hier zuerst ein Hinweis auf eine gebundene Batterie, nicht auf eine perfekte Prognose.** (b) bleibt offen `[ANDREAS]`. Vorstand: **(c) war gebaut, AUSSCHLIESSLICH für `leistungspreisCostPerYear === 0`** — dort ist es keine Abweichung vom Produktivpfad, sondern genau er: der Blocker `no_demand_charge` (Delta 3/9b-1) setzt den heutigen Lauf für diese Kunden bereits auf `cap = ∞`/`socFloor ≡ 0`, die beiden Zahlen sind deshalb direkt vergleichbar. Bei Leistungspreis > 0 wurde mit benanntem Grund VERWEIGERT (`demand_charge`) statt geraten | nichts mehr |
| **Welche Zahl die Kernzahl des Reports ist** | **OFFEN** | §2.6 legt fest, dass es zwei Zahlen gibt und dass sie nie addiert werden. Ob die vorausschauende in den **Kundenreport** gehört oder nur in den internen Nachweis, ist eine Produktentscheidung `[ANDREAS]`. **⚠ Berührt Prinzip 5 (Transparenz) in beide Richtungen:** sie zu zeigen erklärt den `HINDSIGHT_NOTE`, sie zu verschweigen lässt ihn unbeantwortet | der Report, **nicht** die Engine |
| **Leerer Eimer / zu kurze Historie** | **OFFEN** | `ConsumptionPatternOutcome` sieht `empty_bucket` und `insufficient_history` vor, aber **die Schwelle steht nicht**. Gemessen ist nur, dass 208 Tage in der feinsten Einteilung bereits leere LOO-Eimer erzeugen. Ein stiller Rückfall auf den Gesamtmittelwert ist ausgeschlossen (§2.2) | der Bau |
| **Sicherheitsmarge für Prognosefehler** | **OFFEN — und laut Vermerk (§3) NICHT Teil dieser Variante** | Die vereinfachte Variante rechnet eine **Punktschätzung**. Ob das ohne jede Marge zulässig ist oder ob wenigstens die Kappschwelle einen Aufschlag braucht, hängt an der Zeile darüber `[ANDREAS]` | — |
| Was der Prognosefehler in Euro kostet | **GEMESSEN — aber an einem Fall, der die Frage kaum stellt** | 21.09.2026, echter Urbanz-Lastgang über den Cloud-Entwurf (13,081 ct, 3,50 €/Monat, 4,56 ct; echte `grid_tariffs`/`spot_prices`, 209 Tage, Bestandsspeicher 19,2 kWh/10,6 kW): Zahl 1 = **201,99 €**, Zahl 2 (`month`) = **200,86 €**, `realizationRatio` **0,994**. **⚠ Die Zahl ist an diesem Kunden fast unempfindlich und belegt die Prognosegüte NICHT:** derselbe Lauf mit dem TRIVIALEN Vorhersager (ein einziger Eimer) ergibt 200,62 €, mit einer NULL-Prognose 200,15 € — die ganze Spanne zwischen vollem Rückblick und gar keiner Prognose ist **1,84 € (0,9 %)**. Ohne Tages-Rangfolge fällt derselbe Posten dagegen auf **77,60 €**. Der Fahrplan hängt hier also fast nur am PREIS und kaum am erwarteten Verbrauch — der Speicher ist mit 19,2 kWh gegenüber 20,5 kWh Tagesmittel (im Sommer 2–7 kWh) so gross, dass die beiden Schranken selten binden. **Ein aussagekräftiger Wert braucht einen Kunden, bei dem der Speicher knapp ist** `[MARTIN]` | nichts |
| Tagesgenauigkeit der Klimatologie über das volle Jahr | **teilgemessen** | n = 3 Kalendertage. Ein einzelner PVGIS-Aufruf über 365 Tage; die **41 %** stehen bis dahin als `[ANNAHME]` | nichts |
| `standard_profile` | **ENTSCHIEDEN** | Ausgeschlossen, strukturell (§0.2) | — |
| Fahrplan-Nummer | **OFFEN** | Höchste vergebene ist B24 `[ANDREAS]` | nichts |
| Analyse-Bündel | **OFFEN** | Eine archivierte Baseline muss später sagen können, **welches Schema** gerechnet wurde und ob die Zahl mit oder ohne Rückblick entstand. Das wäre ein **Sprung der Bündel-Fassung** (Muster B22 §2.2 Punkt 2: Fassung 5 → 6) | nichts |

---

## 5. Prüfkriterien für den Abschluss

Ein Bau-Schritt gilt als abgeschlossen, wenn zusätzlich zu Bau, Tests, Typecheck und Lint Folgendes
**gemessen** vorliegt — nicht behauptet:

1. **Das Leave-one-out ist im Produktivcode wirksam, nicht nur im Test.** Gegenbeweis: derselbe
   Lastgang einmal mit und einmal ohne die Regel gerechnet, und der Unterschied liegt in der
   Größenordnung, die die Bestandsaufnahme misst (bei der feinsten zulässigen Einteilung
   ~8 % Tages-nMAE). Bleibt der Unterschied bei **0**, ist die Regel nicht angekommen.
2. **Ein leerer Eimer erzeugt einen benannten Zustand, keinen Rückfall.** Am echten Lastgang
   herbeigeführt (die feinste Einteilung hat zwei solche Tage), nicht konstruiert.
3. **Die beiden Zahlen stehen nebeneinander und werden nirgends addiert.** Ein Wächter, der jede
   Summenbildung aus `hindsightEnergySavingEur` und `foresightEnergySavingEur` rot werden lässt —
   dieselbe Art Wächter wie der für `LEVIES_NONE` in `packages/shared/src/levies.test.ts`.
4. **`realizationRatio` ist am echten Urbanz-Lastgang gemessen und liegt vor.** Bezugsgröße
   `controlValueEur` ≈ 202 € über 209 Tage. **Liegt das Verhältnis über 1, ist etwas falsch** — eine
   Steuerung ohne Rückblick kann die Bestmarke nicht übertreffen. Dieser Test ist die wichtigste
   Einzelprüfung des ganzen Vorhabens.
5. **Der Report-Hinweis nennt die TAGESstreuung (41 %), nicht die Jahresstreuung (± 5,8 %)** — und
   er ist im **Druckmedium** sichtbar (`boundingBox() != null` unter
   `emulateMedia({ media: 'print' })`), wie der B22-Hinweis.
6. **`standard_profile` liefert `{ ok: false, reason: 'standard_profile' }`**, mit Gegenbeweis: ein
   echter Lastgang liefert an derselben Stelle eine Zahl. Muster: Delta 9b-1.
7. **Jede in einem Bericht genannte Zahl nennt ihre Datenquelle** (Root-`CLAUDE.md` Regel 11) —
   insbesondere, ob der Lauf gegen die **Kalibrier-Fixture** (9,5 ct, keine Grundgebühr, Einspeisung
   0) oder den **Cloud-Entwurf** (13,081 ct, 3,50 €/Monat, 4,56 ct) gefahren wurde. Die beiden
   fallen am Urbanz-Fall auf **4 Cent** zusammen und sind ohne Angabe nicht unterscheidbar.
