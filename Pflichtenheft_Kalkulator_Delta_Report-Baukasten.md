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

**Stand nach PR #248–#251:** `computeAnalysis` liegt in `packages/engine` (PR #248, bit-identisch
verschoben). `runAnalysisFromMeteringPointDraft` (`packages/extractors`) rechnet vollständig für
Tarif+Lastgang, Bestandsbatterie und PV-Upload (PR #249–#251); PV-Ausfall-Erkennung (D5) und
PVGIS-geschätzte PV (zur Laufzeit) bleiben offen — Letzteres bewusst vertagt, eigener, späterer
Schritt (Netzaufruf, Timeout, Rate-Limit sind eigene Entscheidungen). Bei `hasBattery: true` ohne
Kerndaten: sichtbare Warnung in `dataQuality.warnings` statt stiller Auslassung (PR #251).

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

**Zwei Wege, hier nicht entschieden:**
1. **MVP-Scope: drei Balken** (heute, aWATTar ungesteuert, aWATTar einfach gesteuert) — sofort
   baubar, keine neue Engine-Arbeit, keine Prinzip-5-Spannung.
2. **Fünf Balken wie Urbanz** — braucht (a) den einfachen Tarifwechsel-Vergleich in den
   Kalkulator-Pfad geholt oder dupliziert (Verhältnis zum Monitor-Produkt zu klären, `[MARTIN]`),
   (b) eine Entscheidung zur LP-Optimum-Validierungsfrage.

`[MARTIN]` `[OFFEN]` — bitte vor dem CC-Prompt zu diesem Baustein entscheiden.

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
