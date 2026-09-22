# Pflichtenheft-Delta: Report-Baukasten (B24 Teil 3)

> **Delta zu:** `Pflichtenheft_Kalkulator_Delta_PDF-Report.md` (B23, bleibt unverändert in Kraft —
> dieses Dokument erweitert seinen Inhalt, ersetzt ihn nicht) und
> `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §5 (das Report-Freiheitsmodell — dieses Dokument
> **konkretisiert** §5, ändert seine drei Stufen nicht). **Grundlage:**
> `Report_Baukasten_Bestandsaufnahme.md` (16.09.2026, Stand `4dc3231`) — jede technische Aussage
> unten mit Fundstelle dort ist referenziert, nicht neu behauptet.
>
> **Referenzbild:** `Urbanz_Wirtschaftlichkeitsanalyse_V2.pdf` — zeigt, wozu der Baukasten fähig sein
> soll, ist aber **kein Bauplan**: die Zahlen darin entstanden grösstenteils als Handarbeit einer
> Advisor-Sitzung, nicht aus wiederverwendbarem Code (Bestandsaufnahme Q2, Q3). Wo dieses Dokument
> vom Urbanz-Bild abweicht, steht der Grund dabei.
>
> **Legende:** `[ANNAHME]` = Empfehlung dieses Dokuments, vor Bau zu bestätigen · `[MARTIN]` =
> Domänen-Input nötig · `[OFFEN]` = echte Entscheidungslücke, hier nicht geschlossen.

---

## D1 — Scope

**In diesem Delta:**
1. Der fehlende Engine-Einstiegspunkt vom Wizard-Entwurf aus (Voraussetzung für alles Weitere).
2. Die Konditional-Matrix — was der Report zeigt, je nachdem was die fünf Wizard-Stationen liefern.
3. Zwei neue Engine-Bausteine, die die Matrix braucht: PV-Anomalie-Erkennung, Jahres-Hochrechnung
   als wiederverwendbare Funktion.
4. Eine bindende Contract-Regel gegen den Q6-Befund (zwei unklar zugeordnete Ersparnis-Zahlen).
5. Der Ausbau von „Annahmen und Datengrundlage" zu dem, was der Urbanz-Anhang zeigt.
6. Die Konkretisierung des Baukastens selbst (Delta-KI §5.1) — welche Bausteine, wie geprüft.
7. Die Archivierungs-Anforderung aus Delta-KI §5.2 gegen `platform.analyses`.
8. Der fehlende Weg vom Wizard (`apps/web`) zum Report (`apps/website`).
9. Eine MVP-Scope-Entscheidung zur Rollup-Frage (mehrere Zählpunkte je Betrieb).

**Ausdrücklich NICHT in diesem Delta:**
- Der echte Batteriekatalog — unabhängig, kann parallel oder danach laufen (Engine rechnet mit
  `DEMO_BATTERY_CATALOG` genauso wie mit dem echten Katalog; kein Code-Unterschied).
- Die McKinsey-Optik/Design-Sprache — orthogonal zum Contract, eigener, späterer Baustein (D15).
- Die Finanzierungsmodelle-Lücke (§3.9, Kauf vs. Contracting) — bestehende, nicht blockierende
  Contract-Lücke, von keiner der sieben Bestandsaufnahme-Fragen berührt.
- Der Cutover-Zeitpunkt selbst (`REACT_PDF_REPORT_ENABLED` an) — Empfehlung in D14, keine
  Bauentscheidung hier.

---

## D2 — Was unverändert gilt: das Freiheitsmodell

`Pflichtenheft_Kalkulator_Delta_KI-Interface.md:179-181` legt bereits fest, und dieses Delta rührt
daran nicht:

> **Zahlen/Berechnung — fest**, unverändert aus `AnalysisResult`. **Auswahl & Struktur — frei** aus
> einem typisierten, geprüften Baukasten. **Formulierung — frei.**

Dazu zwei bereits bindende Nebenbedingungen (`…:183`, `:186`, `:189`):
- Freiheit nur als Auswahl/Kombination aus einem **geprüften** Baukasten — **nicht** freie Erfindung
  neuer Grafik-Arten.
- Der ausgelieferte Report wird **vollständig archiviert** (Struktur und Text, nicht nur Zahlen).
- Komposition ausschliesslich aus **vorqualifizierten Aussage-Bausteinen**, die ihre
  Annahme/Messwert-Kennzeichnung bereits eingebaut tragen.

**Was fehlt, ist ausschliesslich der Inhalt des Baukastens** — Bestandsaufnahme §9.4: „Die Stufen
sind entschieden, offen ist ausschliesslich der Inhalt." Dieses Delta liefert diesen Inhalt (D10).

---

## D3 — Baustein 1: Engine-Einstiegspunkt vom Wizard-Entwurf

**Der härteste Befund der Bestandsaufnahme (Q1, §3.8): es gibt keine Stelle im Repo, die aus dem
Wizard-Entwurf einen Engine-Lauf startet.** `computeAnalysis` liegt app-lokal in `apps/website`;
`apps/web` führt weder `engine` noch `@react-pdf/renderer` als direkte Abhängigkeit.

**Zwei Hindernisse, konkret:**

1. **`loadProfile.readings` — die eigentlichen Viertelstundenwerte — stehen in keiner Datenbank­
   spalte.** Nur Metadaten sind abgelegt (`intervalMinutes`, `coveredFrom/To`, `gaps`, `rowCount`,
   `coveredMonths`); die Rohdatei liegt unverarbeitet in `platform.project_documents` (Storage).
   Ein Engine-Lauf muss die Datei zur Laufzeit **erneut lesen und parsen** — nicht nur DB-Felder
   zusammenstellen.
2. **`billingModel` ist das einzige Pflichtfeld, das von keiner Wizard-Station geschrieben wird**
   (nur über den freien `set_draft_field`-Weg erreichbar, §3.5). Ohne verlässlichen Wert dafür
   schlägt jeder Analyse-Lauf fehl oder rät.

**Empfehlung `[ANNAHME]`:** eine neue Funktion in `packages/engine` (Arbeitstitel
`runAnalysisFromMeteringPointDraft`), die (a) den Entwurf eines Zählpunkts, (b) eine Referenz auf
die gespeicherte Lastgang-Datei entgegennimmt, daraus über den **bestehenden** Parser
(`packages/extractors`/`packages/engine/parser`) ein vollständiges `LoadProfile` erzeugt, die
Contract-Lücken aus §3.6 auffüllt (siehe Tabelle unten) und danach das **bestehende, unveränderte**
`computeAnalysis` aufruft — keine zweite Rechenlogik, nur ein neuer Eingang zur selben Engine. Die
Storage-Lesefunktion wird injiziert (Parameter, kein harter Import), damit `packages/engine` frei
von App-spezifischem I/O bleibt — dem bestehenden Muster des Pakets entsprechend.

**Contract-Lücken, die diese Funktion schliessen oder explizit auffangen muss** (Bestandsaufnahme
§3.6, Tabelle):

| Feld | Zustand laut Bestandsaufnahme | Vorschlag |
|---|---|---|
| `title` | fehlt im Entwurf | wird wie heute im Gate-Dialog erhoben, nicht aus dem Entwurf |
| `customer.address` | keine Spalte irgendwo | `[OFFEN]` — neues Feld nötig, falls Adresse gewünscht (D9) |
| `printedAt` | fehlt (Klickzeitpunkt) | zur Laufzeit gesetzt, keine Entwurfs-Abhängigkeit |
| `tariffSource` (7 Felder) | Netzbetreiber jetzt im Entwurf gespeichert (PR #249) | **gelöst** — kein Contract-Feld, aber für D9-Zitate verfügbar. Restliche 6 Felder weiterhin nicht erfasst, ausserhalb des Rechenbedarfs |
| `billingModel` | Pflichtfeld, von keiner Station geschrieben | **gelöst** — Standard `monthly_max_sum` (E-Control-SNE-V-Regelfall, Martin 16.09.2026), Admin-Override statt Pflichtfrage. NICHT `monthly_max_average` (das war nur der Default des alten, abgeschalteten Rechners) |
| `loadProfile.readings` | fehlt komplett in der DB | **gelöst** — wird zur Laufzeit aus Storage nachgeladen und geparst |

**Stand nach PR #248–#258:** `computeAnalysis` liegt in `packages/engine` (PR #248, bit-identisch
verschoben). `runAnalysisFromMeteringPointDraft` (`packages/extractors`) rechnet vollständig für
Tarif+Lastgang, Bestandsbatterie, PV-Upload UND PV-generated (PR #249–#258) — die geschätzte
Erzeugungsreihe wird beim Generieren jetzt als eigenes Dokument abgelegt (nicht mehr zur Laufzeit neu
bei PVGIS geholt, Entscheidung revidiert gegenüber der ursprünglichen Annahme) und beim Analyse-Lauf
mit dem Lastgang gekoppelt (`pvSource: 'estimated'`, löst den `estimated_pv`-Blocker korrekt aus).
Metadaten (`smoothingOptimismPercent`, `weatherYears`) reisen als Geschwister von `AnalysisResult`
mit, nicht darin — vorgesehen für D9. Ältere, vor PR #256 generierte PV-Entwürfe (ohne Dokument-
Kennung, darunter der bestehende Urbanz-Testfall) bleiben bewusst gesperrt. Offen bleiben
ausschliesslich D5 (PV-Ausfall-Erkennung) und D6 (Jahres-Hochrechnung) als eigene Bausteine. Bei
`hasBattery: true` ohne Kerndaten: sichtbare Warnung in `dataQuality.warnings` (PR #251).

**NICHT-TUN:** `computeAnalysis` selbst wird nicht verändert oder verdoppelt. Die zwei Felder mit
direkter Namensgleichheit (`energyPriceCtPerKwh`, `einspeiseverguetungCtPerKwh`) werden 1:1
durchgereicht, nicht neu berechnet.

---

## D4 — Baustein 2: Konditional-Matrix je Wizard-Station

Kern von Teil 3, und die direkte Antwort auf deine Anforderung „wenn User keine PV hat, gibt's auch
keine PV-Analyse". Die Matrix macht explizit, was heute nur mit **zwei** Schaltern (`insight`,
`comparison`, §2.4) angedeutet ist:

| Station | Zustand | Report-Konsequenz | Baustand laut Bestandsaufnahme |
|---|---|---|---|
| PV | keine PV eingetragen | keine PV-Sektion, kein PV-Chart | teilweise vorhanden (`comparisonVariant`, `costKind`) |
| PV | PV vorhanden, Ausfall-Muster im Lastgang | Anomalie-Sektion wie im Urbanz-Fall | **fehlt komplett** (D5) |
| Batterie | keine bestehende Batterie | keine Ladesteuerungs-Sektion; ggf. „Lohnt sich eine neue Batterie" (Empfehlungslogik bereits vorhanden — `perBattery`/`recommendation`) | Empfehlungsteil vorhanden, Bedingung dafür ist der bestehende `comparison`-Schalter |
| Tarif | ein oder zwei Vergleichstarife gefunden | entsprechend viele Wege im Kostenvergleich | `[OFFEN]`, s. D7 — die Wege selbst sind grösstenteils nicht gebaut |
| Lastgang | vollständiges Jahr vs. Teiljahr | Hochrechnungs-Sektion nur bei Lücke | nur der einfache Faktor existiert (D6) |

**Bauform:** jede Zeile der Matrix wird ein **Baustein** im erweiterten `statement.ts`-Katalog
(D10), nicht eine Ad-hoc-Bedingung in `document.tsx`. Das ist die Erweiterung des bestehenden
Zwei-Schalter-Systems (`ReportChapterPresence`, `content.ts:292-301`) auf so viele Bausteine, wie die
Matrix Zeilen hat — der Mechanismus (bedingte `<Page>`, `buildReportAgenda`) bleibt, nur die Zahl der
Bedingungen wächst.

---

## D5 — Baustein 3: PV-Anomalie-Erkennung (neu)

Bestandsaufnahme Q2: **kein** Code erkennt lange Nahe-Null-Strecken im Lastgang. Der einzige Treffer
im Repo ist ein Satz in einem System-Prompt (`system-prompt.ts:223`), der die Prüfung dem
Sprachmodell zuweist — und die Zeitreihe, an der das Modell das prüfen müsste, erreicht es über
keinen seiner Werkzeug-Kanäle.

**Zu bauen:** eine deterministische Engine-Funktion (kein KI-Aufruf — Prinzip 5,
Nachvollziehbarkeit), die auf dem vollen `LoadProfile.readings` nach zusammenhängenden Strecken mit
Werten nahe null sucht, lang genug um kein Rauschen zu sein, und daraus einen
`ReportNotice`-Baustein erzeugt (nach demselben Muster wie `buildBlocker`, `basis.ts:240-263`, das
laut Bestandsaufnahme W.2 bereits existiert und nur der Code-Kommentar es fälschlich als offen
führt).

**`[OFFEN]`:** die genaue Schwelle (wie lang, wie nahe null) — braucht `[MARTIN]`, Fachwissen zu
typischen PV-Ausfallmustern gegen normales Nachtverhalten.

### D5 Teil 2 umgesetzt (22.09.2026) — Kapitel „Ihre PV-Anlage"

Der Befund aus D5 bekommt ein eigenes Kapitel, und es beantwortet die Frage, die der Lastgang
strukturell nicht beantwortet: **was hätte es OHNE die Anlage gekostet?** Ein
Netzbetreiber-Export misst am Anschlusspunkt; der selbst verbrauchte PV-Strom steht dort nur als
gesenkter Bezug. Gerechnet wird deshalb ein zweiter, rekonstruierter Lastgang —
`Netzbezug(t) + geschätzte Erzeugung(t)` — und **beide Seiten gehen durch dieselbe
Tarifkosten-Funktion**, aus der auch „Ihr Tarif heute" entsteht (`buildMonthlyTariffComparison`,
Reihe `currentTariffEur`). Contract: `AnalysisResult.pvValue` (`packages/shared/src/pv-value.ts`),
gerechnet in `packages/extractors/src/analysis/pv-value.ts`, Kapitel in
`apps/website/lib/pdf-report/pv-value.ts`.

**Es erscheint genau in einer Lage** — bestehende Anlage (`pvStage: 'existing'`) in einem reinen
Bezugslastgang (`source: 'import_only'`), mit abgelegter PVGIS-Reihe und Preisseiten. Die
Bedingung wird **nicht neu formuliert**, sondern am bereits gefallenen Urteil abgelesen
(`pvGeneratorEligibility(...).reason === 'pv_already_in_grid_profile'`). Bei einer GEPLANTEN
Anlage gibt es nichts zu rekonstruieren (die Schätzung ist bereits abgezogen, der Ist-Zustand IST
„ohne PV"); bei GEMESSENER Einspeisung wäre ein direkter Wert möglich — **`[OFFEN]`, bewusst
ausgeklammert**: eine Rekonstruktion neben einer Messung wäre ein Rückschritt gegenüber ihr
(Prinzip 1).

**⚠ Vier Dinge, die beim nächsten Umbau mitzudenken sind:**

**(a) Die Vereinfachung ist bewusst und steht im Kundentext:** die gesamte geschätzte Erzeugung
gilt als Eigenverbrauch, eine Netzeinspeisung wird nicht gegengerechnet (ohne Exportdaten wäre ein
`min(Erzeugung, Last)` eine zweite Schätzung über der ersten). Die Richtung des Fehlers ist
benannt — tatsächlicher Export machte die Differenz kleiner.

**(b) Ausfallmonate bekommen 0 Erzeugung, und das geschieht EINMAL** (`zeroPvOutageMonths`), bevor
addiert, summiert oder ins Jahr verlängert wird. In den Monatsbalken tragen sie `null` und keinen
Nullbalken — dieselbe Unterscheidung „keine Angabe vs. gemessene Null" wie im Monatsvergleich.

**(c) Die Jahres-Hochrechnung läuft über EINEN `buildSyntheticYearProfile`-Aufruf, nicht zwei.**
Der Baustein wählt seine Referenzwoche nach dem höchsten Verbrauch, und der rekonstruierte
Lastgang ist im Sommer stärker angehoben als im Winter — zwei Läufe könnten verschiedene Wochen
und damit verschiedene Füllpläne wählen, und die ausgewiesene Differenz enthielte einen Anteil aus
der Auswahl statt aus der Anlage. Der Baustein verlängert eine mitgegebene Erzeugungsreihe nach
DEMSELBEN Plan (`extendPv`); die „ohne PV"-Seite entsteht daraus durch dieselbe Addition wie im
gemessenen Zeitraum. **Das Fenster wird aus dem Kapitel davor übernommen** (`annualScenario`) und
nicht zweitausgerechnet; ohne Jahres-Szenario entfällt die Hochrechnung, es wird nichts genähert.

**(d) Die Zahl steht NICHT in der Ersparnis-Spanne der Zusammenfassung (D8):** sie ist bereits
gehoben und steckt in den Ist-Kosten. In der Spanne stünde sie als etwas, das man noch bekommt.
`summary.ts` liest `pvValue` nirgends.

**Nachtrag (22.09.2026) — der Befund steht genau einmal ausführlich.** Solange beide Stellen die
volle Erklärung trugen, stand derselbe Befund in zwei Ausführlichkeiten und der Leser musste raten,
welche gilt. Mit dem Kapitel zeigt der Satz der Zusammenfassung jetzt dorthin, und der Hinweis in
„Annahmen und Datengrundlage" kürzt sich auf das, wofür jenes Kapitel da ist: WELCHE Monate
betroffen sind, plus einen Zeiger. **Ohne das PV-Kapitel bleibt beides wortgleich wie zuvor** — dort
ist der Hinweis weiterhin die einzige Stelle. Der Methodik-Absatz `method_pv_outage` ist unberührt:
er erklärt, WIE gemessen wird, und das gehört in beiden Fällen ins Methodik-Kapitel.

⚠ Dafür ist `pv_value_finding` als **26.** Baustein in die Registry gewandert. Ein Verweis kann nur
auf einen Katalog-Eintrag auflösen; ohne ihn fiele der Satz stillschweigend auf seine leere Fassung
(`WAYS_SECTION` benennt genau diese Bedingung). Die übrigen Absätze des Kapitels bleiben draussen —
sie werden von nirgends adressiert. ⚠ Und der Halbsatz hängt weiterhin am BEFUND und nicht am
Kapitel: ohne auffälligen Monat gibt es das Kapitel sehr wohl, den Satz aber nicht.

**Gemessen:** gegen synthetische Lastgänge (Engine- und Extractor-Tests, absolute Kostenwerte von
Hand nachgerechnet) und an einem gerenderten PDF (16 statt 15 Seiten, Kapitel gelesen, beide
Verweis-Fassungen nebeneinander); die Chart-Komponente über einen esbuild+jsdom-Harness im
Scratchpad. **Nicht gegen den Urbanz-Fall über den Produktionspfad** — s. Regel 11.

---

## D6 — Baustein 4: Jahres-Hochrechnung als wiederverwendbare Funktion

Bestandsaufnahme Q3: `annualizationFactor` (`packages/engine/src/savings/annualization.ts:71`)
existiert, rechnet aber nur mit einem einzigen Faktor `365 / coveredDays` auf zwei Energie-Töpfe,
ist nicht aus `packages/engine/src/index.ts` exportiert, und hat **keine** der beiden Zutaten, die
der Urbanz-Report zeigt: keine Referenzperiode nach der kältesten verfügbaren Zeit, keine
Marktpreis-Nachladung für den Lückenzeitraum (der Rechner bricht heute bei einer Preislücke ab,
statt nachzuladen — §5.6).

**Zu bauen (Erweiterung, nicht Neubau):**
- Export der bestehenden Funktion aus dem Paket-Index.
- Referenzraten-Logik: aus der kältesten verfügbaren echten Periode ableiten, mit Rückfallregel,
  wenn keine Kälteperiode in den Daten liegt `[ANNAHME — Vorbild Urbanz-Methodik, s. dort „Wie diese
  Zahlen entstanden sind"]`.
- Marktpreis-Nachladung: für den Lückenzeitraum echte historische aWATTar-Preise statt Abbruch.

**Bewusst nicht Teil dieses Bausteins:** die Referenzraten-Logik bleibt eine **Schätzung, sichtbar
gekennzeichnet** — keine zweite, unabhängig validierte Zahl. Das ist bereits Prinzip im bestehenden
Code (§5.3) und wird hier nicht aufgeweicht.

### D6 Teil 3 umgesetzt (22.09.2026, Andreas) — Kapitel „Was wäre, wenn wir ein ganzes Jahr hätten?"

Teil 1 und Teil 2b bleiben unverändert stehen; Teil 3 ist ein **zweiter, anderer Weg daneben** und
kein Ersatz für sie. Der Unterschied ist die Stelle, an der geschätzt wird:

| | D6 Teil 2b (`annualProjection`) | D6 Teil 3 (`annualScenario`) |
|---|---|---|
| Referenzperiode | kälteste Monate, sonst stärkster Monat | **verbrauchsstärkste 7 zusammenhängende Tage** |
| Lückentag | flache Tagesform aus der Rate | **echter Viertelstundenverlauf** desselben Wochentags |
| Gerechnet wird | zwei Kostenzeilen (`buildMonthlyTariffComparison`) | **die ganze Kette** (`computeAnalysis`), Dispatch und Spitzenkappung eingeschlossen |
| Marktpreise der Lücke | nachgeladen und genähert | **aus dem gepflegten Bestand; fehlt etwas, entfällt das Kapitel** |
| Geschätzt ist | das Ergebnis der beiden Zeilen | **die Eingabe (der Lastgang), nicht das Ergebnis** |

**Die Referenzwoche statt der kältesten Periode** (Abweichung von der ursprünglichen D6-Fassung,
zulässig nach dem Grundsatz vom 21.09.2026): eine Auswahl nach Kalendermonat setzt voraus, dass der
Kunde heizlastgetrieben ist. Ein Betrieb mit Kühlhaus hat seine Spitzenwoche im August, und für ihn
wählte die Winterregel die schwächste Zeit als Referenz. Das Maximum über alle Wochen trifft beide
Fälle ohne Wetterannahme und ohne Verbrauchertyp-Kategorie.

**Das Fenster ist begrenzt, nicht fest:** 365 Kalendertage, die alle Messwerte enthalten müssen,
innerhalb von `[Preisanker, gestern]`. Gewählt wird das **spätestmögliche** — solange es geht,
beginnt das Jahr am ersten Messtag und die Lücke liegt dahinter. Die Grenzen kommen als Parameter
in die Engine (`SyntheticYearBounds`); der Rechenkern kennt weder den Preisanker noch die Uhr.

**Im Report:** eigenes Kapitel direkt hinter den Wegen, ohne Chart (eine zyklisch wiederholte Woche
als Heatmap sähe aus wie ein gemessener Jahresgang). Tabelle mit **einer Zeile je Balken des
Wege-Kapitels**, Kasten „Gesamtersparnis im Jahresvergleich". **Weg 5 steht im Kasten und nicht in
der Tabelle** — Kosten und Ersparnis gehören nicht in dieselbe Spalte, dieselbe Trennung wie bei
den Balken in D7. Der Kasten ist zugleich **die einzige Stelle im Report, an der Weg 5 addiert
werden darf**: dort sind alle Zahlen Jahresgrössen.

**Die Ein-Spanne-Regel (D8) bleibt unberührt:** `summary.ts` liest `annualScenario` nirgends, und
ein Test pinnt, dass die Kopfzahlen mit und ohne Szenario bit-gleich bleiben.

**Fundstellen:** `packages/engine/src/savings/reference-week.ts` · `…/synthetic-year.ts` ·
`packages/shared/src/annual-scenario.ts` · `packages/shared/src/tariff-ways.ts` (die Wege-Auswahl,
eine Definition für gemessenen und hochgerechneten Lauf) · `packages/extractors/src/analysis/annual-scenario.ts` ·
`apps/website/lib/pdf-report/annual-scenario.ts`.

---

## D7 — Baustein 5: Der Kostenvergleich — Scope-Entscheidung nötig `[OFFEN]`

Der Urbanz-Report zeigt fünf Balken. Bestandsaufnahme Q5 zeigt: **zwei davon existieren im
Kalkulator-Pfad nicht.**

| Weg | Baustand |
|---|---|
| Ihr Tarif heute | gerechnet |
| Einfacher Tarifwechsel (z. B. ENSTROGA) | **erfasst, aber nicht gerechnet** — die fertige Rechnung liegt im **Monitor-Produkt**, einem anderen Teil des Repos, nicht im Kalkulator |
| aWATTar, ungesteuert | gerechnet |
| aWATTar, einfache Steuerung | gerechnet |
| aWATTar, optimal (LP) | an drei Stellen **ausdrücklich als nicht gerechnet dokumentiert** im Kalkulator-Pfad |

**⚠ Eine zusätzliche Spannung, unabhängig vom Baustand:** die LP-optimale Zahl ist laut den
bestehenden Engine-Prinzipien eine **Hindsight-Bestmarke, „nie unvalidiert in Kundenmaterial"**. Der
Urbanz-PDF zeigt sie mit einem erklärenden Sternchen-Absatz — das ist die Advisor-Sitzung, die das
selbst abfedert, nicht ein im Code durchgesetztes Prinzip. Ein Report-Baukasten, der diesen Balken
automatisch für jeden Kunden zeigt, bräuchte entweder dieselbe Validierung, die das Prinzip verlangt,
oder eine bewusste Ausnahme davon.

**Zwei Wege, ursprünglich hier nicht entschieden:**
1. **MVP-Scope: drei Balken** (heute, aWATTar ungesteuert, aWATTar einfach gesteuert) — keine
   Prinzip-5-Spannung.
2. **Fünf Balken wie Urbanz** — braucht (a) den einfachen Tarifwechsel-Vergleich in den
   Kalkulator-Pfad geholt oder dupliziert (Verhältnis zum Monitor-Produkt zu klären, `[MARTIN]`),
   (b) eine Entscheidung zur LP-Optimum-Validierungsfrage.

**~~Entschieden (Andreas, 16.09.2026, nach dem ersten Live-Test): Variante 1, drei Balken.~~
⚠ ÜBERHOLT durch die Revision vom 21.09.2026 unmittelbar darunter — steht als Beleg der
Entscheidungsgeschichte da, ist aber nicht mehr maßgeblich.**

**Revidiert (Andreas, 21.09.2026):** Scope ist FÜNF Wege. 1) aktueller Tarif, 2) alternativer Tarif (nur wenn vom Kunden angegeben), 3) aWATTar ohne Ladesteuerung, 4) aWATTar mit vorausschauender Ladesteuerung — gilt für ALLE Kunden, nicht nur Weg-c-Fälle, 5) Lastspitzenkappung als eigener Weg, wenn der Speicher den abgerechneten Leistungswert senkt. Vorhandene Batterie wird für alle fünf Wege herangezogen UND zusätzlich unter „Zahlt sich ein weiterer Speicher aus" geprüft; ohne vorhandene Batterie wird eine Erstanschaffung empfohlen.

**Korrektur nach dem Live-Test:** „sofort baubar, keine neue Engine-Arbeit" war zu optimistisch.
`runAnalysisFromMeteringPointDraft` (D3) setzt `payload.tariffPricing` nirgends — ohne dieses Feld
bleibt `tariffOptimization` in jedem Wizard-Lauf `undefined` („nicht angefordert"), unabhängig vom
Tarif des Kunden. Der erste End-zu-Ende-Report (Zählpunkt Urbanz, 16.09.2026) zeigt entsprechend
keinen Tarifvergleich. Zu bauen, bevor die drei Balken erscheinen können: `TariffPricingInputs`
(Netzbetreiber-Tarifzeilen + aWATTar-Marktpreisreihe für den Lastgang-Zeitraum) im neuen
Engine-Einstiegspunkt zusammenstellen — eigener Baustein, eigene Bestandsaufnahme vor dem Bau
(`grid-tariff-lookup.ts`, `TariffPricingInputs`, B21-3b-Kommentare zur Herkunft).

~~`[MARTIN]` `[OFFEN]` — bitte vor dem CC-Prompt zu diesem Baustein entscheiden.~~

### D7 umgesetzt (21.09.2026) — fünf Wege, jeder nur wenn er zutrifft

Gebaut ist die Revision oben. Das Kapitel heisst nicht mehr „Zwei Wege zu weniger Stromkosten",
sondern zählt (`waysSectionTitle`, `content.ts`) — Agenda und Überschrift aus **derselben** Zahl
(`context.waysCount`).

| Weg | Bedingung | Herkunft der Zahl |
|---|---|---|
| 1 Ihr Tarif heute | immer (wenn es das Kapitel gibt) | `currentTariffEur` — jetzt eigener Absatz, nicht nur Kopfzahl |
| 2 Vergleichstarif | **nur** wenn in der Tarif-Station eingetragen UND netto | neue Reihe `comparisonTariffEur` |
| 3 aWATTar ohne Steuerung | immer | `spotWithoutControlEur`, unverändert |
| 4 aWATTar mit Steuerung | immer — **vorausschauend**, sonst einfach | `spotWithPredictiveControlEur`, sonst `spotWithBatteryEur` |
| 5 Lastspitzenkappung | **nur** `leistungspreisSavingPerYear > 0` | die bestehende §3.7-Zuschreibung |

**⚠ Drei Entscheidungen, die der Auftrag offen liess und die hier fielen:**

1. **Weg 5 ist kein Balken.** Die Balken sind Zeitraum-KOSTEN, Weg 5 ist eine Jahres-ERSPARNIS aus
   dem Leistungspreis, den der Monatsvergleich ausdrücklich nicht führt. Als fünfter Balken stünden
   zwei Einheiten über zwei Zeiträumen auf einer Achse. Er ist ein Absatz mit eigener Bezugsangabe
   und bleibt aus demselben Grund **ausserhalb der D8-Spanne** — wie bisher; der Absatz sagt das
   selbst.
2. **Ein brutto eingetragener Vergleichstarif lässt Weg 2 ENTFALLEN**, statt durch einen geratenen
   Steuersatz zu teilen — dieselbe Haltung wie bei Netzentgelt-Zeilen und Börsenpreisen
   (`tou.ts`, `kind: 'price_basis'`).
3. **Weg 4 verschiebt die D8-Spanne.** Mit der vorausschauenden Reihe ist die Ersparnis kleiner als
   mit der Bestmarke (`realizationRatio ≤ 1`) — die Kopfzahl der Zusammenfassung wird dadurch
   konservativer. `realizationRatio` selbst steht **nicht** im Kundenreport.

**Der Hinweistext zu Weg 4 ist ein `[ENTWURF]`** (`PREDICTIVE_NOTE`, `ways.ts`) und von Andreas beim
Testgate zu prüfen. Der interne Marker `basis: 'foresight_unvalidated'` bleibt unverändert.

**Am erzeugten PDF gemessen** (Prüffall `optional-sections.test.ts` + von Hand gesetzte Weg-2-/
Weg-4-Reihen — **synthetische Fixture, keine Kundendaten**): Titel „Fünf Wege zu weniger
Stromkosten" in Agenda **und** Überschrift, alle fünf Absätze, Spanne **€ 36 – € 231**, und
`pdftotext | grep -c "Mögliche Ersparnis"` = **1**.

---

## D8 — Baustein 6: Ein-Spanne-Regel (bindend)

Direkte Antwort auf „zwei verwirrende Zahlen darf nicht passieren". Bestandsaufnahme Q6 bestätigt
das Risiko als **heute real, an fünf Orten**, nicht als Theorie.

**Bindende Contract-Regel, ab sofort für jeden neuen und geänderten Report-Baustein:**

> Der Report führt **genau eine** Kern-Ersparnis-Aussage je Analyse, als **Spanne**, mit expliziter
> Zuordnung zu benannten Wegen (Vorbild: „€53–207, je nach gewähltem Weg"). Jede weitere Euro-Grösse
> im Contract (elf insgesamt, §8.1) erscheint nur innerhalb der Erklärung eines einzelnen, benannten
> Weges — nie zwei davon ohne Zuordnung nebeneinander.

**NICHT-TUN:** die bestehenden vier rechnerisch abgesicherten Zuordnungsstellen (§8.7) werden nicht
angetastet — die Regel gilt für alle **neuen** Bausteine aus diesem Delta, nicht rückwirkend als
eigener Umbauauftrag am Bestand (das wäre ein eigenes Ticket, hier nicht beauftragt).

### D8 umgesetzt (19.09.2026) — „Kernergebnisse" ist „Zusammenfassung"

Das erste inhaltliche Kapitel trägt jetzt die Form von Seite 2 des Zielbildes und erfüllt damit die
Regel oben. **Nur Struktur und Optik sind übernommen, keine Zahl** — alles kommt aus dem
Live-Engine-Output des jeweiligen Falls.

| Was | Woher |
|---|---|
| Kopfzahl „Ihre Stromkosten heute" (`ink`) | `sumCovered(tariffOptimization.monthlyComparison.currentTariffEur)`, Bezugszeile aus `dataQuality.coveredDays` |
| Kopfzahl „Mögliche Ersparnis" (`accent`) | `buildRealSavingBreakdown` — min/max über die Wege mit POSITIVER Ersparnis; eine Zahl statt einer Spanne, wo nur einer trägt |
| Fliesstext | Bestandsbatterie (`existingBatteryAnalysis.entry.battery`), PV-Angabe + kWp aus dem Entwurf, Zahl der tragenden Wege |
| PV-Satz | nur bei `hasPv === true`; der Befund-Halbsatz nur, wenn `pv_outage` im Dokument steht |
| „Ausserdem schon geklärt" | unverändert `buildAddon` (B3-2b) |

**Vier Entscheidungen, die den Abschnitt tragen:**

1. **`savings`, `peak_shaving` und `load_shift` sind ersatzlos entfallen** (Katalog 28 → 25
   Kennungen). Sie waren vier Euro-Grössen nebeneinander, von denen drei nicht addiert werden
   durften — genau der Zustand, gegen den D8 geschrieben ist. **⚠ Benannte Folge: der
   Spitzenkappungs-BETRAG steht damit in keinem Kapitel mehr.** Der Ladesteuerungs-Betrag dagegen
   ist erhalten geblieben — `load_control` trägt wieder eine Kopfzahl, weil der Abschnitt sonst die
   Herkunft einer Zahl erklärte, die im Dokument nicht vorkommt.
2. **Die Spanne führt nur die TARIF-Wege.** Die Spitzenkappung ist eine Jahresgrösse aus dem
   Leistungspreis, die zwei Wege sind Summen über den gemessenen Zeitraum — in einer Spanne
   vereint stünden zwei Bezugszeiträume unter einer Zahl. Dass es sie gibt, sagt stattdessen der
   Fliesstext, und die Bezugszeile der Ist-Kosten nennt ihre eigene Grenze („ohne Leistungspreis").
3. **Die vier Hinweiskästen bleiben, ihre Ortsangaben nicht.** Drei verwiesen auf „den
   abgerechneten Leistungswert oben" — die Kopfzahl, auf die sie zeigten, gibt es nicht mehr.
4. **Die zwei Textblöcke stehen NICHT im Katalog** (`ReportBaukastenId`), wie die Kopfzahlen auch:
   sie tragen weder Titel noch Betrag noch Zeilen und sind damit keine der vier Formen, die
   `document.tsx` rendert. Ihre Querverweise lösen über einen unbekannten Ursprung auf und nennen
   deshalb das Zielkapitel beim Namen statt einer Richtung — gemessen in `registry.test.ts`.

**Am echten Urbanz-Lastgang gemessen** (209 Tage, 8 Monate, Bestandsspeicher 19,2 kWh, NE 7 ohne
Leistungsmessung, echte Cloud-Preisdaten): `€ 770` Ist-Kosten, `€ 84` mögliche Ersparnis — **eine
Zahl, keine Spanne**, weil der reine Tarifwechsel bei diesem Kunden negativ ist. Die Spannen-Form
des Zielbildes entsteht am selben Lastgang mit einem üblichen Fixpreis-Vertrag (`€ 574 – € 778`).
Die Zahlen des Zielbildes (`€1.061`, `€53 – €207`) stammen aus einer Handrechnung und sind
ausdrücklich nicht reproduziert worden.

**Positiv-Kontrolle:** derselbe Fall mit `hasPv: false` — der PV-Satz fehlt vollständig, der Absatz
sagt „aber noch keine PV-Anlage", und die Seite schliesst ohne Lücke.

**Nachgezogen am 19.09.2026:** die Netto-Angabe steht jetzt wie im Zielbild („€1.061 (netto)",
S. 3) an der Kopfzahl selbst — als zweiter Teil der Bezugszeile von „Ihre Stromkosten heute"
(„über 209 gemessene Tage, netto" bzw. „…, netto, ohne Leistungspreis"). Die Fussnote am Seitenende
bleibt bestehen, trägt aber nur noch den Methodik-Zeiger. Dass durchgängig netto gerechnet wird,
sagt weiterhin `limitations` im Schlusskapitel für den ganzen Report.

**Offen geblieben:** der Zeilenabstand im teal Kasten weicht vom Zielbild ab (er ist der geteilte
`statement`-Abstand).

---

## D9 — Baustein 7: „Annahmen und Datengrundlage" ausbauen

Bestandsaufnahme Q4: das bestehende Kapitel hat 168 Code-Zeilen, eine zweispaltige Tabelle mit 4–8
gesetzten Feldern — **keine** der drei Strukturen, die der Urbanz-Anhang zeigt.

**Zu ergänzen, alle drei aus dem Urbanz-Anhang „Methodik im Detail" übernommen:**
1. **Datenquellen-Tabelle** — Quelle, was daraus verwendet wurde, Zeitraum/Stand. Braucht
   `LoadProfile.source` tatsächlich zu lesen (heute laut Bestandsaufnahme nicht einmal angefasst).
2. **Tarifkomponenten-Tabelle** — heute 3 von 13 Tarifgrössen mit Wert; auf alle erfassten
   auszuweiten.
3. **Berechnungsmethodik je Kennzahl** — ein Satz pro Kennzahl, welche Formel/Annahme dahintersteht.

**`customer.address`** — falls das Deckblatt eine Anschrift tragen soll (wie im Urbanz-PDF), fehlt
dafür heute jedes Feld (§3.6). `[OFFEN]`, ob das für den Kalkulator-Report gewünscht ist oder eine
B23-D4-artige reine Druckfeld-Lösung analog übernommen wird.

### D9 Nachtrag umgesetzt (22.09.2026) — das Inhaltsverzeichnis führt Unterpunkte für JEDES Kapitel, das welche hat

Drei Dinge, unabhängig voneinander:

**1 — „Unser Vorschlag" steht jetzt VOR „Methodik & Vorbehalte".** Ein Vorschlag ist eine Aussage an
den Kunden; Methodik und Schlusskapitel sind der Apparat dahinter. Agenda und Seitenzahlen ergeben
sich aus der Reihenfolge selbst — es ist keine Zahl von Hand gesetzt.

**2 — „Ihr Lastgang" trägt unter dem Diagramm drei Kennzahlen** (`load.ts`): Gesamtverbrauch über
den Zeitraum, Ø Tagesverbrauch, Lastfaktor. Alle drei aus Zahlen, die das Dokument ohnehin führt —
**keine neue Datenquelle**. ⚠ Die Spitzenleistung wird aus `current.annualPeakKw` WIEDERVERWENDET,
derselben Zahl, die das Kapitel „Voraussetzungen" als „Höchste gemessene Verbrauchsspitze" ausweist;
zwei getrennt gebildete Maxima derselben Kurve könnten im selben Dokument auseinanderlaufen, und
eine davon trägt den Leistungspreis. ⚠ Gezählt wird NUR der Bezug (`gridPowerKw > 0`) — netto
gerechnet stünde eine Netto-Menge neben einer Bezugs-Spitze. ⚠ Der Erklärsatz gibt die DEFINITION
des Lastfaktors (spitzig vs. gleichmässig) und ordnet den konkreten Kunden ausdrücklich nicht ein.

**3 — die Unterpunkte des Inhaltsverzeichnisses kommen aus einer gemeinsamen Struktur**
(`ChapterSubsections`, `content.ts`). `buildReportAgenda` kennt keinen Kapitelnamen mehr: ein
Kapitel MELDET seine Unterabschnitte, und die Liste ist dieselbe, aus der das Kapitel sie rendert —
`METHODOLOGY_ITEMS` für die Methodik, `basisSubsections(chapter)` fürs Schlusskapitel. Damit ist die
Fehlerklasse geschlossen, an der die Berechnungsmethodik schon einmal auseinandergelaufen ist: zwei
Orte, die synchron bleiben mussten.

⚠ Was daraus für jeden Umbau folgt:

**(a) Ein bedingter Abschnitt taucht im Verzeichnis genau dann auf, wenn er gerendert wird** — die
Bedingung wird nicht zweitformuliert, sondern am gebauten Kapitel abgelesen (`chapter.pvOutage`,
`chapter.methodPerMetric.length`). Betroffen sind vier: Datenqualität, Blocker-Befund, PV-Befund und
die Berechnungsmethodik.

**(b) Das Schlusskapitel wird seit diesem Schritt EINMAL je Durchlauf gebaut** (`ReportDocument`)
und an Agenda UND Kapitel gereicht. `selectedNotice` ist damit entfallen: die Auswahl (Baukasten C)
greift bereits im Kontext, ein zweiter Weg über die Registry wäre eine zweite Antwort auf dieselbe
Frage gewesen — und nur einer der beiden hätte das Verzeichnis gespeist.

**(c) Ein Agenda-Unterpunkt verlangt eine Überschrift im Kapitel.** Für die Herkunft der Tarifsätze
gab es keine; sie hat deshalb eine bekommen (`BASIS_HEADING.tariffSource`), und die Sätze darunter
beginnen dafür nicht mehr mit „Tarifsätze:". Der Bildschirmweg (`tariff-source-note.tsx`) behält
sein Präfix — er hat keine Überschrift.

**(d) Unterpunkte tragen weiterhin KEINE Seitenzahl** (`level: 2`, `page-numbers.ts` Aufbau C). Die
Agenda passt mit acht weiteren Einträgen weiter auf eine Seite; am erzeugten PDF gemessen (18
Seiten, beide Durchläufe messen dasselbe).

---

## D10 — Baustein 8: Der Baukasten selbst

Das bestehende Substrat dafür ist bereits da und richtig gewählt: `apps/website/lib/pdf-report/
statement.ts` trennt bereits sauber **was** eine Aussage sagt (fachlicher Inhalt) von **wie** sie
aussieht (`document.tsx`-Renderer) — genau die Trennung, die „vorqualifizierte Aussage-Bausteine"
(Delta-KI §5.3) braucht. Heute: acht Typen, sieben Kapitel-Module, zwei Schalter.

**Der Ausbau, den dieses Delta beauftragt:** jede Zeile der Konditional-Matrix (D4) plus die drei
neuen Kapitel-Ergänzungen (D9) werden als eigene, typisierte Bausteine in diesem bestehenden System
angelegt — kein neues Typsystem daneben. Die Auswahl/Reihenfolge-Freiheit aus Delta-KI §5.1 (durch
eine KI-Schicht) baut auf diesem erweiterten Katalog auf; **dieses Delta liefert den Katalog, nicht
die Auswahl-Schicht selbst** — das ist ein eigener, nachgelagerter Baustein, sobald der Katalog
ausreichend gross ist, um eine Auswahl überhaupt sinnvoll zu machen.

**NICHT-TUN:** keine freie Erfindung neuer Grafik-Arten durch die KI (Delta-KI §5.1, ausdrücklich
ausgeschlossen) — jeder Baustein ist vorab von einem Menschen definiert und geprüft.

---

## D11 — Baustein 9: Archivierung

Delta-KI §5.2 verlangt bereits: der ausgelieferte Report wird **vollständig** archiviert (Struktur
und Text, nicht nur Zahlen). Bestandsaufnahme §10.7: `platform.analyses` hat dafür **keine Spalte**.

**Zu bauen:** eine neue Spalte (z. B. `rendered_report jsonb` oder vergleichbar) an
`platform.analyses`, die den tatsächlich zusammengesetzten Baukasten-Output hält — **kopiert, nicht
verlinkt**, denselben bestehenden Regeln folgend, die für diese Tabelle bereits gelten (nie
nachrechnen, keine Fremdschlüssel auf veränderliche Konfiguration, enge Append-only-Ausnahme,
`CLAUDE.md`).

**Neue Abhängigkeit aus D12, `[OFFEN]`:** Das Rendering läuft laut D12 im Browser des Admins über
`apps/website` — einer App ganz ohne Anmeldung. Die eigentliche Archiv-Schreibung nach
`platform.analyses` (verlangt `is_admin()`, §10.7) kann dort also nicht direkt passieren. Zwei Wege,
hier nicht entschieden: (a) `apps/website` reicht den fertigen Output an eine `apps/web`-Aktion
zurück, die schreibt, oder (b) die Archivierung bleibt vorerst aus, bis dieser Rückweg feststeht.
Bei D11 selbst zu klären, nicht vorab.

---

## D12 — Baustein 10: Der Weg vom Wizard zum Report

**Korrigiert gegenüber der ersten Fassung dieses Abschnitts** (die (a) serverseitig in `apps/web`
empfahl — das war zu kurz gedacht, s. u.).

Bestandsaufnahme §10.4: **keiner** der gebauten Report-Bausteine ist von der Wizard-Seite aus
erreichbar. Zusätzlich geprüft (16.09.2026): `chart-capture.ts`/`chart-raster.ts` brauchen
strukturell einen echten Browser — echtes Layout (`getBoundingClientRect`), `ResizeObserver`, Canvas,
echte CSS-Auflösung, ein Frame-Takt. jsdom scheidet aus (5 unabhängige Fehlerstellen, teils still —
unbemaltes Bild statt Fehler). Ein Headless-Browser (Playwright/Puppeteer) ist **nirgends im Repo**
vorhanden. **Beide** serverseitigen Optionen — (a) direkt in `apps/web`, (b) HTTP-Aufruf an eine neue
`apps/website`-Route — bräuchten denselben Headless-Browser als neue Abhängigkeit; (b) zusätzlich den
**ersten** Programm-Aufrufweg zwischen den Apps überhaupt (heute: 0 — bewusst so, `next.config.mjs`:
„die zwei Apps einander nie importieren") und eine neue Vertrauensgrenze ohne bestehendes
Auth-Muster.

**Entscheidung `[ANNAHME]`, ersetzt die vorige Empfehlung:** die PDF-Erzeugung bleibt, wo sie heute
schon funktioniert — im Browser. Nicht im Kunden-, sondern im **Admin**-Browser: `apps/web` bindet
`apps/website` bereits produktiv per `<iframe>` ein (drei Stellen). Neue Infrastruktur, minimal:

1. **Neue, kurzlebige Tabelle** (Arbeitstitel `platform.report_render_requests`) — nicht
   `platform.analyses` (das ist bewusst ein Archiv betreuter, dauerhafter Analysen, B14-1; ein
   Zwischenspeicher für jeden Rechnerlauf unterliefe genau den Zweck, für den es gebaut wurde, s. auch
   D11). Zufalls-`id`, `created_by`, `expires_at` (Stunden, nicht dauerhaft), Referenz auf das bereits
   berechnete `AnalysisResult` + die Ursprungsdatei-Referenz (für `loadProfile`).
2. **Geschrieben von `apps/web`** (authentifiziert, admin-seitige Aktion), sobald
   `runAnalysisFromMeteringPointDraft` (D3) gelaufen ist.
3. **Gelesen von `apps/website`** über eine neue, bewusst schmale SECURITY-DEFINER-Funktion — nur
   nicht abgelaufene, exakt passende IDs, kein allgemeiner `anon`-Zugriff auf `platform`.
4. **Neue Route in `apps/website`** (`apps/website` hat heute 0 Route-Dateien, nur vier Seiten) —
   nimmt die Request-ID, baut `PdfReportInput` über die bereits produktiven, vom Prüfstand
   verwendeten Ableitungsfunktionen (`derive.ts`), ruft die **bestehende, unveränderte**
   `downloadReportPdf`-Kette auf.

**Bewusste Einschränkung dieses Bausteins:** trägt nur, was D3 heute rechnen kann — Tarif+Lastgang,
Bestandsbatterie, PV-Upload. Bei PVGIS-geschätzter PV ist der Lastgang aus der Ursprungsdatei allein
nicht rekonstruierbar (dieselbe Grenze wie in D3, hier nur an einer zweiten Stelle sichtbar) — dieser
Fall bleibt gesperrt, bis PVGIS-zur-Rechenzeit (D3, vertagt) steht.

---

## D13 — Rollup: MVP-Scope-Entscheidung `[ANNAHME]`

Die Rollup-Frage (mehrere Zählpunkte → ein Report, Fahrplan §2.4) ist strukturell offen und wird von
keiner der sieben Bestandsaufnahme-Fragen berührt — sie würde diesen Baukasten aber erheblich
verkomplizieren, wenn sie mitgelöst werden müsste.

**Empfehlung:** dieses Delta baut den Report-Baukasten für den **Ein-Zählpunkt-Fall**. Ein Projekt
mit mehreren Zählpunkten bekommt vorerst **keinen** zusammengeführten Report (expliziter Blocker/
Hinweis im Admin-Bereich), bis die Rollup-Schicht ein eigenes, separates Thema wird. Das entspricht
dem Urbanz-Fall (ein Zählpunkt) und verhindert, dass der Report-Baukasten an einer Frage hängt, die
nichts mit ihm selbst zu tun hat.

---

## D14 — Cutover: Zeitpunkt `[ANNAHME]`

`REACT_PDF_REPORT_ENABLED` bleibt AUS, bis mindestens D4–D8 gebaut sind. Der heute abschaltbare Weg
ist inhaltlich dünner als das Urbanz-Referenzbild (§2.3: das produktive Artefakt hat nicht einmal
Inhaltsverzeichnis oder „Seite X von Y") — ihn jetzt einzuschalten hiesse, Kunden ein Dokument zu
zeigen, das die in diesem Gespräch festgelegten Anforderungen (Konditionalität, Ein-Spanne-Regel)
noch nicht erfüllt.

**Zusätzliches Risiko, zu berücksichtigen, nicht in diesem Delta zu lösen:** `apps/website` hat
**0 Testdateien und kein `test`-Skript** (§10.5). Neue Engine-Bausteine (D5, D6) entstehen in
`packages/engine` und bekommen dort reguläre Tests; für die **Rendering**-Seite in `apps/website`
bleibt das Testfundament schwach — bei den CC-Prompts zu D4/D8 mindestens die neu entstehenden
Bausteine mit dem esbuild+react-dom/server-Harness (bereits als zulässiger Weg etabliert) abdecken.

---

## D15 — Design/McKinsey-Optik

Eigener, späterer Baustein — orthogonal zu diesem Delta. Sobald der Contract/Baukasten (D3–D10)
steht, ist eine reine Layout-/Farb-/Typografie-Iteration auf dem bestehenden react-pdf-Dokument
möglich, ohne dass dieses Delta dafür etwas vorwegnehmen müsste. Referenz für den späteren
CC-Prompt: `Urbanz_Wirtschaftlichkeitsanalyse_V2.pdf` als Zielbild für Blockstruktur, Farbgebung,
Kopf-/Fusszeilen.

---

## Baureihenfolge, empfohlen

1. **D3 — Engine-Einstiegspunkt.** Alles andere braucht ihn.
2. **D12 — Weg Wizard → Report** (neue kurzlebige Tabelle + schmaler Lesezugriff + neue
   `apps/website`-Route; Rendering bleibt im Admin-Browser — s. korrigierte Fassung).
3. **D8 — Ein-Spanne-Regel** als Contract-Konvention, bevor neue Bausteine entstehen, die sie sonst
   erneut verletzen könnten.
4. **D4 + D10 — Konditional-Matrix und Baukasten-Ausbau**, die eigentliche Arbeit von Teil 3.
5. **D5, D6 — die zwei neuen Engine-Bausteine** (PV-Anomalie, Jahres-Hochrechnung), parallel zu 4
   möglich, da sie eigenständige Engine-Funktionen sind.
6. **D9 — Annahmen-Kapitel ausbauen.**
7. **D11 — Archivierung.**
8. **D7 — Kostenvergleich-Scope**, erst nachdem die Entscheidung `[MARTIN]`/`[OFFEN]` gefallen ist.
9. **D14 — Cutover**, D15 — Design: danach, nicht Teil des Kern-Baus.

---

## Gesammelt: `[MARTIN]` / `[OFFEN]` / `[ANNAHME]`

| # | Punkt | Baustein | Typ |
|---|---|---|---|
| 1 | ~~Erfasst die Rechnung-Station künftig `netzbetreiber`?~~ | D3 | **gelöst** (PR #249) |
| 2 | ~~Wer setzt `billingModel`?~~ | D3 | **gelöst** — Standard `monthly_max_sum` + Override |
| 3 | Schwelle für „lange Nahe-Null-Strecke" (PV-Ausfall) | D5 | `[MARTIN]` |
| 4 | Drei-Balken- vs. Fünf-Balken-Kostenvergleich; Verhältnis zum Monitor-Produkt; LP-Optimum-Validierung | D7 | `[MARTIN]` `[OFFEN]` |
| 5 | Rückweg für die Archivierung (`apps/website` → `platform.analyses` ohne eigene Anmeldung) | D11/D12 | `[OFFEN]` |
| 6 | Anschrift auf dem Deckblatt — gewünscht? | D9 | `[OFFEN]` |
| 7 | Rollup-Scope: MVP nur Ein-Zählpunkt-Report | D13 | `[ANNAHME]`, zu bestätigen |
| 8 | Cutover-Zeitpunkt: nach D4–D8 | D14 | `[ANNAHME]`, zu bestätigen |
