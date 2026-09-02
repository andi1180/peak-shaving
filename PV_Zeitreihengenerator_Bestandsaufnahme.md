# PV-Zeitreihengenerator — Bestandsaufnahme

> **Was dieses Dokument ist:** eine reine Bestandsaufnahme, entstanden am 02.09.2026. Sie beantwortet
> vier Fragen, die vor einem Pflichtenheft geklärt sein müssen, und sie beantwortet sie **gemessen**,
> nicht abgeleitet. Alle Zahlen darin stammen aus tatsächlich ausgeführten Läufen (Engine, PVGIS-API,
> PDF-Inspektion); wo etwas nicht gemessen werden konnte, steht das als Fehlanzeige da.
>
> **Was dieses Dokument NICHT ist:** kein Pflichtenheft, keine Bauentscheidung, keine
> Fahrplan-Nummer. Es ist an **keiner** Zeile Anwendungscode etwas geändert worden —
> `packages/engine`, `packages/shared`, `apps/website`, `apps/web` und `supabase/` haben
> **0 Zeilen Diff**. Die Engine-Messungen liefen in temporären vitest-Dateien, die nach dem Lauf
> gelöscht sind (`git status` sauber).
>
> **Vorgelagerte Quellen:** `Fahrplan_2026.md` (Reihenfolge) · `Pflichtenheft_Kalkulator_MVP.md` §3.1,
> §3.7 · `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md` Delta 8/9b/11/15 · `DEPLOYMENT.md`
> §1-Website-c.

---

## Kurzfassung — die vier Befunde in je einem Satz

1. **Ein `PvProfile` ändert heute KEINE einzige Ersparnis-Zahl** — gemessen über drei Lastgang-Typen;
   wirksam ist ausschliesslich die **Einspeisung im Lastgang selbst**, und ein PV-Generator muss
   deshalb den **Netz-Lastgang** erzeugen, nicht ein zweites Profil daneben.
2. **PVGIS liefert KEINE CORS-Header** — ein Browser kann die Antwort nicht lesen, ein Proxy ist
   zwingend; dafür genügt eine **Gemeinde-/PLZ-genaue** Ortsangabe (innerhalb Wiens < 1 % Unterschied,
   gemessen), was die Datenschutzfrage deutlich entschärft.
3. **Das vorliegende PV\*SOL-Dokument ist ein sauber extrahierbares Text-PDF** — aber die
   Azimut-Konvention weicht von PVGIS ab, und der ungeprüft übernommene Wert kostet in diesem Fall
   **56 % der ausgewiesenen Ersparnis** (gemessen, in Euro); mit **n = 1** ist Formatrobustheit nicht
   verifizierbar.
4. **Zerlegung:** (a) PVGIS-Anbindung isoliert und ohne UI, (b) Formular-Weg, (c) Scan-Weg — genau die
   Reihenfolge von Delta 9b-1 vor 9b-2, mit `source: 'estimated'` von Schritt (a) an.

---

## 1. PvProfile-Contract und tatsächliche Wirkung

### 1.1 IST-Stand (gegen den Code, nicht gegen Pseudocode)

| Baustein | Fundort | Signatur / Inhalt |
|---|---|---|
| Typ | `packages/shared/src/load-profile.ts:47-59` | `PvProfile = { readings: Array<{ ts: string; pvGenerationKw: number }> }` — sonst nichts. Kein `intervalMinutes`, keine `timezoneMeta`, **keine `source`** und **kein `.nonnegative()`** auf dem Wert. |
| Parser | `packages/engine/src/parser/parse.ts:317-416` | `parsePvProfile(input, options) → PvParseOutcome`. Verlangt eine Zeitstempel- und eine Wertspalte, prüft die Einheit (`needs_mapping` bei `unknown`), fährt `prepareSeries` und **bricht bei ≠ 15 min mit `wrong_interval` ab**. Setzt `detection.source = 'import_only'` mit dem Kommentar *„PV kennt keine source; Feld für Detection-Form belegt, ungenutzt."* |
| Ausrichtung | `packages/engine/src/simulation/pv.ts:48-81` | `alignPvGrossToLoad(loadProfile, pvProfile) → { grossPvKw, inconsistentSlots, matchedSlots }`. Klemmt Brutto-PV auf die Einspeisung hoch, wo sie darunter liegt (Prinzip 1). |
| Warnungen | `packages/engine/src/simulation/pv.ts:92-130` | `pvConsistencyWarning(inconsistentSlots)` und `pvCoverageWarning(matchedSlots, totalSlots)` — reine Textbausteine für `dataQuality.warnings`. |
| UI-Einstieg | `apps/website/components/flow/step-tariff.tsx:480-497, 945-954` | Optionaler Datei-Upload in Schritt 2, client-seitig geparst (Prinzip 4). Ein Fehler ist **nicht blockierend**. |

**⚠ Die Zuordnung läuft über einen exakten ISO-String-Vergleich.** `alignPvGrossToLoad` baut eine
`Map<string, number>` über `pvProfile.readings[i].ts` und schlägt mit `loadProfile.readings[i].ts`
nach. Ein erzeugtes Profil muss also **byte-identische** Zeitstempel liefern (`toIsoUtc` =
`new Date(ms).toISOString()`), sonst läuft es still ins Leere — genau der Fall, für den
`matchedSlots`/`pvCoverageWarning` existieren.

### 1.2 Der Befund: ein `PvProfile` ändert KEINE Ersparnis-Zahl

**Der Codepfad, an dem das entschieden wird:** `simulateBattery`
(`packages/engine/src/simulation/simulate.ts:105-207`) berechnet `grossPvKw` **als letzten Schritt,
nach** Kapp-Suche, `computeSocFloor`, `runCombinedDispatch` und `newBilledKw`:

```ts
// simulate.ts:195 — NACH dem gesamten Dispatch
const grossPvKw = pvProfile ? alignPvGrossToLoad(loadProfile, pvProfile).grossPvKw : undefined
```

`pvProfile` wird an **keine** der Physik-Primitiven weitergereicht. Und `computeBatterySavings`
(`packages/engine/src/savings/attribute.ts`) liest `sim.grossPvKw` **nirgends** — die
Herkunftsmarkierung der FIFO-Schichten hängt am Vorzeichen der Netzlast, nicht am PV-Profil:

```ts
// attribute.ts:184-185 — 'pv' entsteht aus draw < 0, also aus der EINSPEISUNG im Lastgang
if (draw < 0) {
  layers.push({ kwh: storedKwh, origin: 'pv', costCtPerStoredKwh: einspeise * chargeLossFactor })
}
```

Verstärkend: ruft ein Aufrufer `computeBatterySavings` ohne vorgerechnete Simulation auf, baut die
Funktion sie sich **ausdrücklich ohne PV-Profil** (`attribute.ts:106` —
`simulateBattery(loadProfile, battery, tariffParams, undefined, pricing)`).

**GEMESSEN** (temporäre vitest-Datei, danach gelöscht; Batterie 19,2 kWh / 10,6 kW / η 0,9,
Arbeitspreis 25 ct, Einspeisevergütung 8 ct, Leistungspreis 0):

| Lastgang | `source` | Einspeise-Slots | ohne `PvProfile` | mit synthetischem `PvProfile` |
|---|---|---|---|---|
| H0-Standardprofil, 4.500 kWh | `standard_profile` | **0** von 35.040 | sc 0,00 · total 0,00 · billedKw 1,442210 | **identisch** |
| Nur Bezug (Urbanz-Form) | `import_only` | **0** von 2.880 | sc 0,00 · total 0,00 · billedKw 1,800000 | **identisch** |
| Signiert mit Einspeisung | `net_signed` | 1.320 von 2.880 | sc **541,0068** · total 541,0068 | **identisch** |

In allen drei Fällen ist das gesamte `BatterySavings`-Objekt bit-gleich
(`JSON.stringify(savA) === JSON.stringify(savB)` → `true`), während `sim.grossPvKw` korrekt gesetzt
wird. Das deckt sich mit dem bestehenden Regressionstest
`packages/engine/src/simulation/pv-chain.test.ts:63` (`expect(savPv).toEqual(savNoPv)`) — dieser Punkt
ist also nicht neu entdeckt, sondern **im Code zugesagt und hier über drei Lastgang-Typen bestätigt**.

**Wirkung eines `PvProfile` heute, vollständig:** (a) `dispatchTrace.pvGenerationKw` zeigt die echte
Brutto-PV statt der Einspeise-Näherung (`trace.ts:237`) — sichtbar im Energiefluss-Chart und in der
`pv_strong`-Tagesauswahl; (b) die zwei `dataQuality`-Warnungen. **Sonst nichts.**

### 1.3 Was stattdessen wirkt — gemessen

Wirksam ist ausschliesslich die **Einspeisung im Lastgang** (`gridPowerKw < 0`). Dieselbe PV-Reihe,
nicht als zweites Profil beigelegt, sondern **vom Verbrauch abgezogen**:

**Aufbau:** H0-Standardprofil 4.500 kWh/Jahr (2025, Europe/Vienna, 35.040 Slots) minus einer **echten
PVGIS-Reihe** (Wien, 10,2 kWp, Neigung 90°, PVGIS-Azimut −47, Wetterjahr 2020, Stundenwert als
Treppe auf das 15-min-Gitter gelegt).

| | Eigenverbrauchs-Ersparnis | `totalSavingPerYear` | `newBilledKw` |
|---|---|---|---|
| H0 **ohne** PV | € 0,00 | € 0,00 | 1,442 kW |
| H0 **mit** PV im Lastgang | **€ 384,69** | **€ 384,69** | 1,442 kW |

PV-Energie 7.874 kWh/a · 9.895 von 35.040 Slots mit Einspeisung · 6.483 kWh/a Einspeisung.

**Das ist die Architekturentscheidung des ganzen Vorhabens:** Ein „PV-Zeitreihengenerator", der ein
`PvProfile` erzeugt, ändert **nichts** an der Wirtschaftlichkeitsrechnung. Er muss den **Lastgang**
erzeugen — also einen `net_signed`-`LoadProfile` aus Verbrauch minus Erzeugung.

### 1.4 Für welchen Lastgang-Typ hat das überhaupt einen Effekt — geprüft, nicht angenommen

- **`standard_profile` (H0, Delta 9b-1):** `dailyShape` ist an jeder Stelle ≥ 0,3, `seasonFactor` und
  `scale` sind positiv (`packages/engine/src/standard-profile/h0.ts:102-181`) ⇒ `gridPowerKw` ist
  **strikt positiv**, es gibt **strukturell keine Einspeisung**. Gemessen: 0 negative Slots von
  35.040. Die Eigenverbrauchs-Ersparnis ist damit **immer exakt 0** — und der Kunde ohne Lastgang
  ist genau der, für den dieser Einstieg gebaut wurde. **Hier ist der Hebel am grössten.**
- **Echter Lastgang ohne Einspeisespalte** (`import_only`, der reale Urbanz-Fall — die Datei hat
  gar keine Einspeisespalte): ebenfalls 0 Einspeise-Slots, ebenfalls sc = 0. Für diesen Fall gibt es
  bereits die §3.1-Pflichtwarnung („nicht beurteilbar bzw. unterschätzt").
- **Echter Lastgang MIT Einspeisung** (`net_signed` / `import_export_split`): die Ersparnis steht
  bereits; ein Generator hätte hier **nichts hinzuzufügen** und wäre ein Rückschritt gegenüber der
  Messung (Prinzip 1).

**⚠ Daraus folgt eine Abgrenzung, die ins Pflichtenheft gehört:** Der Generator ist ein Werkzeug für
**Lastgänge ohne Einspeisung** — vor allem für das Standardprofil und für den Kunden, der eine PV
plant oder besitzt, deren Erzeugung im Lastgang nicht sichtbar ist. Auf einem `net_signed`-Lastgang
darf er **nicht** angeboten werden, oder wenn, dann ausdrücklich nicht als Ersatz der Messung.

### 1.5 Bewertung von `dev-fixtures/generate-demo-pv-profile.mjs`

**Der Ansatz ist als Bauvorlage brauchbar, das Modell darin ist es nicht.**

Was **trägt** und übernommen gehört:
- Der Generator erzeugt **beide** Dateien konsistent aus derselben Quelle: `netz = verbrauchKw − pv`.
  Genau die Konstruktion aus 1.3 — er ist damit schon heute der einzige Ort im Repo, an dem PV
  wirklich in eine Ersparnis-Zahl gerät.
- Die dortige Zusage „`BruttoPV ≥ Einspeisung` gilt per Konstruktion, die Konsistenzwarnung feuert
  nie" folgt aus der Konstruktion, nicht aus den Zahlen — sie gilt in jedem Jahrgang.
- Determinismus (fixer Seed, `--year`-Parameter, byte-identische Reproduktion).

Was **nicht trägt**:
- `pvGrossKw()` (`generate-demo-pv-profile.mjs:110-120`) ist ein **Gauss-Tagesbogen um 12:30 Uhr
  mit kosinusförmig saisonal skalierter Amplitude** — **kein Sonnenstandsmodell**: keine Koordinate,
  keine Neigung, keine Ausrichtung, keine kWp-Angabe (die „~30 kWp" stehen als Kommentar, die
  Amplitude 18,5 ± 9,5 kW ist hartkodiert), keine Bewölkung, keine Temperaturabhängigkeit.
- **Keine Zeitzone.** Die Datei rechnet bewusst in UTC-Gettern als „naive Wanduhr" — für ein Fixture
  richtig, für eine Kundenanlage falsch (der PV-Mittag verschöbe sich sommers um zwei Stunden gegen
  die Last).
- Er erfindet **auch den Verbrauch** (`verbrauchKw`, Bäckerei-Form mit PRNG-Rauschen). Ein
  Produktions-Generator bekommt den Verbrauch von aussen (H0 oder echter Lastgang) und darf ihn
  nicht ersetzen.

**Fazit:** die **Kopplungslogik** (Netz-Lastgang = Verbrauch − Erzeugung, Konsistenz per
Konstruktion, Determinismus) ist der Ausgangspunkt; die **Erzeugungskurve** ist reines Test-Fixture
ohne fachlichen Bezug und wird durch eine externe Quelle ersetzt.

---

## 2. PVGIS — Machbarkeit und Datenschutz

### 2.1 CORS: gemessen, und die Antwort ist eindeutig

Reale Anfrage am 02.09.2026 gegen `https://re.jrc.ec.europa.eu/api/v5_3/seriescalc` mit
`Origin: https://rechner.coolin.at`, generische Wien-Koordinate (48,2082 / 16,3738 — **nicht** die
Adresse eines Kunden):

```
HTTP/1.1 200 OK · Content-Type: application/json · Content-Length: 829218 · 2,08 s
Strict-Transport-Security, Content-Security-Policy, X-Content-Type-Options,
X-XSS-Protection, X-Robots-Tag, X-Download-Options,
X-Permitted-Cross-Domain-Policies, Referrer-Policy, 2× Set-Cookie
```

**Access-Control-Allow-Origin: nicht vorhanden.** Über alle Antwortköpfe gemessen: **0 Treffer** auf
`Access-Control-*`. Der CORS-Preflight (`OPTIONS` mit `Access-Control-Request-Method: GET`)
antwortet mit einem nackten `HTTP/1.0 200 OK`, Content-Length 26, **ebenfalls ohne einen einzigen
CORS-Header**.

**⇒ Ein direkter Aufruf aus dem Browser ist ausgeschlossen.** `curl` bekommt die Antwort, weil es
CORS ignoriert; ein Browser würde die Antwort verwerfen. **Ein Proxy ist zwingend, keine
Geschmacksfrage.** (Nebenbefund: der Dienst setzt zwei Cookies — ein Browser-Aufruf brächte damit
zusätzlich eine Drittanbieter-Cookie-Frage mit sich, die über einen Proxy gar nicht erst entsteht.)

### 2.2 Was der Dienst liefert

`seriescalc` mit `pvcalculation=1` gibt je Stunde:

| Feld | Einheit | Inhalt |
|---|---|---|
| `time` | — | `20200101:0010` — UTC, mit 10-min-Versatz (Beobachtungszeitpunkt). Am Sonnenhöhen-Maximum geprüft: 21.06.2020, `11:10` UTC, `H_sun` 65,06° — passt zum wahren Sonnenhöchststand in Wien. |
| `P` | **W** | PV-Systemleistung (AC) — die gesuchte Grösse |
| `G(i)` | W/m² | Globalstrahlung in Modulebene |
| `H_sun` | ° | Sonnenhöhe |
| `T2m`, `WS10m`, `Int` | °C, m/s, — | Lufttemperatur, Wind, Interpolations-Flag |

`inputs` spiegelt die Anfrage zurück (`location` inkl. **`elevation`**, `mounting_system`,
`pv_module`, `meteo_data`) — brauchbar als Nachweis, mit welchen Annahmen gerechnet wurde.

**Drei harte Eigenschaften:**

1. **Stündlich, nicht viertelstündlich.** 8.784 Werte für 2020. Die Engine arbeitet auf einem
   15-min-Gitter; es braucht eine ausdrückliche Umsetzungsregel (Treppe / lineare Interpolation) und
   sie ist eine **Entscheidung**, keine Formalie: eine Treppe verschiebt Ladeentscheidungen an
   Stundenkanten, eine Interpolation glättet Wolkenkanten weg. *(Für die Messung in 1.3 wurde eine
   Treppe verwendet — bewusst die konservativere, weil sie nichts erfindet, was nicht in den Daten
   steht.)*
2. **⚠ Nur die Wetterjahre 2005–2023.** Gemessen: `startyear=1990` antwortet
   `{"message":"startyear: Incorrect value. Please, enter an integer between 2005 and 2023.","status":400}`.
   **Das kollidiert mit Delta 15 Regel A** („der Vergleich benutzt exakt den Zeitraum des
   hochgeladenen Lastgangs"): der reale Urbanz-Lastgang deckt **27.08.2025 – 26.08.2026** ab —
   PVGIS kann diesen Zeitraum **nicht liefern**. Jede Anbindung muss ein Wetterjahr auf den
   Analysezeitraum **abbilden**, und das ist eine `[ANNAHME]`, keine Messung.
3. **`tmy` ist kein Ersatz.** Der TMY-Endpunkt antwortet (HTTP 200, 8.760 Zeilen), liefert aber
   **ausschliesslich Wetter** (`G(h)`, `Gb(n)`, `Gd(h)`, `T2m`, …) und **kein `P`** — wer TMY nutzen
   will, müsste Transposition und Temperaturmodell selbst bauen. `seriescalc` ist der einzige
   Endpunkt, der die PV-Rechnung macht.

### 2.3 Ortsgenauigkeit: reicht PLZ / Gemeinde? — gemessen

Gleiche Anlage (10 kWp, 35°, Süd), Wetterjahr 2020, nur die Koordinate variiert:

| Ort | Ertrag | vs. Wien-Zentrum | Höhe |
|---|---|---|---|
| Wien Zentrum | 11.833,8 kWh/a | 100,0 % | 186 m |
| Wien SW, ~5 km | 11.913,6 kWh/a | **100,7 %** | 213 m |
| Wien NO, ~6 km | 11.859,1 kWh/a | **100,2 %** | 158 m |
| Wien Stadtrand SW, ~13 km | 11.906,6 kWh/a | **100,6 %** | 286 m |
| Graz, ~145 km | 12.538,8 kWh/a | 106,0 % | 365 m |
| Innsbruck, Alpental | 13.453,4 kWh/a | 113,7 % | 583 m |

**Innerhalb einer Stadt (≤ 13 km) liegt der Unterschied unter 1 %.** Eine strassengenaue Adresse
bringt gegenüber einem PLZ-/Gemeinde-Mittelpunkt **nichts Messbares**. Über 145 km sind es 6 %.

**⚠ Ein Vorbehalt, der nicht weggemessen ist:** PVGIS rechnet den Geländehorizont aus einem
Höhenmodell **an der übergebenen Koordinate** (`use_horizon: true`, `horizon_data: "DEM-calculated"`).
In flachem Gelände ist das folgenlos; in einem engen Alpental kann der Gemeinde-Mittelpunkt einen
anderen Horizont haben als der Hof am Hang. Die Innsbruck-Messung oben zeigt diesen Effekt **nicht**
(der Wert liegt höher, nicht niedriger) — sie widerlegt ihn aber auch nicht, weil sie nur einen Punkt
misst.

### 2.4 Was das für Prinzip 4 bedeutet

Prinzip 4 lautet: *„Öffentlicher Rechner: client-side, Verbrauchsdaten verlassen den Browser nicht."*

- **Der Lastgang bleibt unangetastet.** Er geht auch bei einer PVGIS-Anbindung nicht hinaus — die
  Anfrage trägt Koordinate, Neigung, Ausrichtung, kWp und ein Wetterjahr, sonst nichts. Keine
  Verbrauchsdaten.
- **Es wäre die ZWEITE benannte Ausnahme.** Die erste ist der Rechnungs-Scan (Delta 9b-2,
  `DEPLOYMENT.md` §1-Website-c): dort verlässt ein Kundendokument das Gerät. Die dritte, kleinere
  ist B21-3a — dort tragen die Abfrageparameter bereits die **Zeitgrenzen des Lastgangs** hinaus.
  Eine Ortsangabe ist eine **andere Art** von Datum als eine Rechnung: sie ist kein Dokument, aber
  sie ist personenbezogen, sobald sie hausgenau wird.
- **Die Entschärfung ist gemessen, nicht argumentiert:** weil eine PLZ genügt (2.3), muss die
  Anwendung **nie** eine hausgenaue Koordinate erheben, und der Datenschutz-Satz kann das im
  Klartext sagen. Das ist der wesentliche Unterschied zum Rechnungs-Scan, wo die Datei
  zwangsläufig alles enthält, was auf ihr steht.
- **Eigener Datenschutz-Satz Pflicht.** Die vier bestehenden Einstiegs-Sätze („wird nicht
  hochgeladen" / „nicht übertragen") wären hier unwahr — dieselbe Lage und dieselbe Konsequenz wie
  bei 9b-2b.

### 2.5 Wo der Proxy läge

`apps/website` (der Kalkulator) hat seit Delta 16b/17/18 fünf Server Actions
(`lib/{report-gate,report-request,battery-text,upload-classification,invoice-scan}/actions.ts`) und
**keine** `route.ts`. Ein PVGIS-Proxy ist strukturell die sechste Server Action nach demselben
Muster: eine Datei, die den externen Aufruf macht, eine Datei, die ihn auslöst.

**Zwei Unterschiede zu den KI-Anbindungen, die den Aufbau vereinfachen:** PVGIS braucht **keinen
Schlüssel** (offen, kostenlos), und die Antwort ist deterministisch — es gibt nichts abzurechnen und
keine „offene Kasse" im Sinne von §1-Website-c. Der ESLint-Allowlist-Mechanismus schützt dort einen
**abrechenbaren Schlüssel**; hier gäbe es keinen zu schützen. Was bleibt, ist eine
**Missbrauchs-/Fairness-Frage** (eine offene Server Action ist über ihre ID aufrufbar) — die
Antwort darauf ist eine Grössen-/Frequenzgrenze in der Prüfkette **vor** dem externen Aufruf, wie
sie `MAX_INVOICE_FILE_BYTES` für den Rechnungs-Scan schon ist.

---

## 3. Formular vs. Scan-Extraktion

### 3.1 Das vorliegende Dokument, technisch inspiziert

Zwei Dateien im Kundenordner (**nicht im Repo**, dieselbe Regel wie bei den Rechnungs- und
Preisblatt-Prüfdateien):

| Datei | Seiten | Erzeuger | Bild-XObjects | Font-Objekte | Textextraktion |
|---|---|---|---|---|---|
| Haupt-Exposé | 19 | `Aspose.Words for .NET 21.9.0` aus `Microsoft Office Word` | 18 | 9 | **funktioniert** |
| „PV Anlage Schätzung" | 1 | `Quartz PDFContext` (macOS Preview) | 3 | 9 | funktioniert |

**Ergebnis: TEXT-PDF, nicht gescannt.** Alle 19 Seiten liefern über PDFKit sauberen, gegliederten
Text (414 Zeilen, 11,4 kB). Die einseitige Datei ist **kein eigenes Dokument**, sondern
**Seite 10 des Haupt-Exposés**, in Preview herausgeschnitten.

**⚠ Ohne Werkzeug geht es nicht.** Auf diesem Rechner fehlen `pdftotext`, `mutool`, `qpdf`, `gs`,
PyPDF und PyObjC/Quartz. Die Extraktion lief über einen selbst kompilierten Swift-PDFKit-Aufruf
(`swiftc`, ~50 kB Binary im Scratchpad). Ein naiver Ansatz („FlateDecode-Streams entpacken, `(...)`
einsammeln") **scheitert** an diesem Dokument: die Texte stehen als **Hex-Strings** (`<...>`) unter
Type0/CID-Fonts, und mehrere Bild-Streams enthalten zufällig `BT`/`Tj` — beide naiven Filter liefern
Müll bzw. gar nichts. Das ist die Sorte Detail, die einen Bau-Schritt sonst einen halben Tag kostet.

### 3.2 Was das Dokument tatsächlich trägt

Alle für einen Generator nötigen Felder stehen **im Text**, Bezeichner und Wert auf derselben Zeile:

| Feld | Wert im Dokument | Seite |
|---|---|---|
| Erzeuger | `PV*SOL premium 2024 (R6)`, Valentin Software GmbH | Fusszeile jeder Seite |
| **Standort (Klimadaten)** | `Wien 11, AUT (1996 - 2015)` — Quelle `Meteonorm 8.1(i)`, Auflösung `1 h` | 4 |
| Simulationsmodelle | Diffusstrahlung `Hofmann`, Einstrahlung geneigte Fläche `Hay & Davies` | 4 |
| Verbrauch (Annahme des Planers) | `4500 kWh`, „Haushalt, jahreszeitlicher Verlauf vergleichbar mit Standardlastprofil", Spitzenlast `24,3 kW` | 4 |
| Modulfläche 1 | `10 × StoPhotovoltaics Inlay 425Wp` · **Neigung `90 °`** · **Ausrichtung `Südosten 133 °`** · Einbau `Dachparallel - gut hinterlüftet` · `19,5 m²` | 5 |
| Modulfläche 2 | `14 ×` dieselben Module · **Neigung `90 °`** · **Ausrichtung `Südosten 133 °`** · `27,3 m²` | 6 |
| Wechselrichter | `SH10RT (v12)`, Sungrow, 1 Stück, Dimensionierungsfaktor `102 %` | 6 |
| Batterie | `19,2 kWh`, `Lithium-Eisen-Phosphat` | 7 |
| **kWp gesamt** | `10,20 kWp` | 8 |
| **Spez. Jahresertrag** | `754,31 kWh/kWp` · PR `87,67 %` · Abschattungsverlust `3,4 %` | 8 |
| Jahresertrag AC (mit Batterie) | `7.469 kWh/Jahr` · Eigenverbrauch `3.621` · Einspeisung `3.848` · Autarkiegrad `80,0 %` | 8 |
| Je Modulfläche | `4,25 kWp` → `3100,91 kWh/a` (`729,62 kWh/kWp`) · `5,95 kWp` → `4368,08 kWh/a` (`734,13 kWh/kWp`) | 10 |

**Was NICHT drinsteht:**
- **Keine Koordinate.** Der Standort ist der **Name eines Meteonorm-Klimadatensatzes**
  („Wien 11, AUT (1996 - 2015)") — kein Lat/Lon-Paar. Für PVGIS wäre daraus eine Koordinate
  abzuleiten; auf Gemeindeebene reicht das (2.3), aber die Ableitung ist ein eigener Schritt.
- **Keine Monatstabelle, keine Zeitreihe.** Die Ertragskurve steht ausschliesslich als **Bild**
  („Abbildung: Ertragsprognose mit Verbrauch", Seite 10). Aus dem Text ist kein Monatswert zu holen.
  Der Weg „Monatswerte aus dem Dokument statt PVGIS" ist damit **verschlossen**.
- Die Batterie ist dokumentiert (19,2 kWh), aber **nicht ihre Leistung**.

**⚠ Ein innerer Widerspruch im Dokument, der als Warnung dient, nicht als Aussage über die Anlage:**
`Neigung 90 °` bei gleichzeitig `Einbausituation: Dachparallel` und dem Dokumenttitel „PV am
Hausdach" passt nicht zusammen. Ob das ein Planungswerkzeug-Vorgabewert ist oder die tatsächlich
simulierte Geometrie, lässt sich **aus dem Dokument nicht entscheiden** — und dieses Dokument ist
laut Aufgabenstellung die einzige zulässige Quelle. Für die Bestandsaufnahme ist nur eines wichtig:
**ein Extraktor darf einen solchen Wert nicht stillschweigend übernehmen.** (Die PVGIS-Gegenrechnung
in 3.3 spricht dafür, dass die 90° wirklich simuliert wurden — sie beweist es nicht.)

### 3.3 ⚠ Die Azimut-Konvention — gemessen, und in Euro

**PV\*SOL zählt den Azimut vom Norden (Kompass: 0° = N, 180° = S), PVGIS von Süden
(0° = S, −90° = O, +90° = W).** Ein extrahiertes „Südosten 133 °" ist als PVGIS-`aspect` **−47**,
nicht 133. Übernimmt ein Extraktor die Zahl ungeprüft, zeigt die Anlage nach **Nordwesten**
(180° + 133° = Kompass 313°) — die Gegenrichtung.

**Beide Konventionen sind belegt, nicht zitiert.** PV\*SOL: das Dokument schreibt die
Himmelsrichtung neben die Gradzahl („Ausrichtung **Südosten 133 °**") — Südost liegt auf dem
Kompass bei 135°, die Zählung geht also vom Norden aus. PVGIS: über die Tageslage des
Erzeugungsmaximums gemessen (Wien, Juni 2020, Neigung 90°) —

| `aspect` | Juni-Maximum | ergibt |
|---|---|---|
| **−90** | 08:00 UTC ≈ **10:00 Ortszeit** | Morgen ⇒ **Osten** |
| **0** | 10:00 UTC ≈ **12:00 Ortszeit** | Sonnenhöchststand ⇒ **Süden** |
| **+90** | 14:00 UTC ≈ **16:00 Ortszeit** | Nachmittag ⇒ **Westen** |

Gemessen (Wien 48,2082/16,3738, 10,2 kWp, Verlust 14 %, Wetterjahr 2020):

| Konfiguration | Jahresertrag | spez. | Anteil |
|---|---|---|---|
| Süd, 35° (naive Standardannahme) | 12.070,5 kWh/a | 1.183,4 kWh/kWp | — |
| **90° / aspect −47 (Kompass 133° SO, KORREKT umgerechnet)** | **7.885,7 kWh/a** | **773,1 kWh/kWp** | 100 % |
| 90° / aspect **133 ungeprüft übernommen** | 3.358,9 kWh/a | 329,3 kWh/kWp | **43 %** |
| 35° / aspect 133 ungeprüft übernommen | 7.110,7 kWh/a | 697,1 kWh/kWp | 90 % |

**Und dieselben drei Reihen bis in die Ersparnis durchgerechnet** (H0 4.500 kWh, Batterie
19,2 kWh / 10,6 kW / η 0,9, Arbeitspreis 25 ct, Einspeisevergütung 8 ct):

| PV-Konfiguration | PV-Energie | Eigenverbrauchs-Ersparnis |
|---|---|---|
| 90° / −47 (korrekt) | 7.874 kWh/a | **€ 384,69/Jahr** |
| 90° / 133 (ungeprüft) | 3.353 kWh/a | **€ 171,10/Jahr** — **−56 %** |
| 35° / Süd (naiv) | 12.051 kWh/a | € 360,26/Jahr — −6 % |

**Zwei Befunde daraus, beide unbequem:**

1. **Die Konventions-Verwechslung kostet 56 % der ausgewiesenen Ersparnis** — und die falsche Zahl
   sieht **völlig plausibel** aus (eine schlecht ausgerichtete Fassadenanlage). Sie fiele niemandem
   als Fehler auf. Genau das Muster, das den Faktor-10-Leistungspreis in B21-2a und die
   Eur/MWh-Prüfung begründet hat.
2. **Der Jahresertrag ist KEIN ausreichendes Prüfmass.** Die naive Süd-35°-Annahme liefert **53 %
   mehr PV-Energie** und trotzdem **6 % WENIGER** Ersparnis — weil bei 4.500 kWh Verbrauch und
   19,2 kWh Speicher der Zusatzertrag überwiegend eingespeist wird (Sättigung). Wer einen Extraktor
   gegen „stimmt der Jahresertrag ungefähr?" prüft, prüft die falsche Grösse; entscheidend ist die
   **Tagesform** relativ zur Last.

**Unabhängige Gegenrechnung, die für die Anbindung spricht:** PVGIS über die zehn Wetterjahre
2014–2023 bei 90°/−47 ergibt im Mittel **759,0 kWh/kWp** (Spanne 711,4–800,0, ±5,8 %) — gegen die
im Dokument stehenden **754,31 kWh/kWp** von PV\*SOL/Meteonorm. **0,6 % Abweichung im
Zehnjahresmittel.** PVGIS reproduziert also für genau diese Konfiguration, was ein
Fachplanungswerkzeug ausweist — und die **±5,8 % Streuung zwischen Wetterjahren ist zugleich die
ehrliche Genauigkeitsgrenze** des ganzen Vorhabens (2.2 Punkt 2: das Wetterjahr ist ohnehin eine
Annahme).

### 3.4 ⚠ Mit n = 1 ist Formatrobustheit NICHT verifizierbar — ausdrücklich benannt

Es liegt **genau ein** PV\*SOL-Dokument vor, aus **einer** Programmversion (premium 2024 R6), von
**einem** Planer, in **einer** Sprache. Daraus lässt sich **nicht** ableiten:

- ob die Feldbezeichner in anderen PV\*SOL-Versionen gleich heissen,
- ob andere Werkzeuge (PVsyst, Polysun, Solar-Log, Hersteller-Konfiguratoren) überhaupt vergleichbare
  Felder ausweisen,
- ob andere Exporte Text-PDF oder Scan sind,
- ob mehrere Modulflächen immer so sauber getrennt aufgeführt sind,
- ob die Azimut-Konvention bei allen Werkzeugen dieselbe ist — **zwischen den zwei hier
  gemessenen ist sie es nicht** (3.3), und für weitere Werkzeuge ist sie hier weder gemessen noch
  belegt; sie ist je Werkzeug einzeln festzustellen.

**Was fehlt, bevor ein Scan-Weg vertrauenswürdig wäre:** mindestens fünf bis zehn echte Auslegungen
verschiedener Herkunft, darunter **mindestens ein Scan** und **mindestens ein Nicht-PV\*SOL-Werkzeug**
— und je Dokument ein Feld-für-Feld-Abgleich gegen das Papier, wie er für den Rechnungs-Scan am
31.08.2026 gefahren wurde (dort: 20 Felder, 0 falsche Werte, an zwei echten Rechnungen).

**Semantisch statt positionsbasiert extrahieren — wie beim Rechnungs-Scan.** Konkret bedeutet das
hier:

- **Ausrichtung als Himmelsrichtung UND Gradzahl getrennt erfassen**, plus die im Dokument
  verwendete Konvention als eigenes Feld. Das Dokument schreibt „Südosten 133 °" — die
  Himmelsrichtung ist der **Kreuzcheck** gegen die Zahl, und ohne ihn ist die Konventions-Falle aus
  3.3 nicht zu fangen. Ein Extraktor, der nur „133" liefert, ist strukturell unsicher.
- **Neigung, kWp, Modulzahl je Modulfläche als Liste**, nicht als Einzelwerte: zwei Flächen mit
  unterschiedlicher Ausrichtung sind der Normalfall (hier zufällig identisch), und ein
  zusammengefasster Wert wäre eine gerechnete Zahl, die nirgends dasteht.
- **Standort als Freitext**, nicht als Koordinate — das Dokument trägt keine (3.2).
- **Jahresertrag und spez. Jahresertrag als Prüfgrössen mitnehmen**, nicht als Rechengrundlage: sie
  sind das Einzige, womit sich eine PVGIS-Rechnung gegen die Auslegung gegenprüfen lässt (3.3
  letzter Absatz) — **aber nur als grober Plausibilitätsrahmen**, s. Befund 2 in 3.3.
- **Jedes Feld einzeln `null`-fähig, fail closed** — dieselbe Regel wie in `parseInvoiceExtraction`:
  `null` heisst „im Dokument nicht erkennbar", nie „vermutlich der Vorgabewert".
- **Kein Freitextfeld in der Rückgabe.** Keine Begründung, keine Zusammenfassung des Modells —
  dieselbe Regel wie in allen fünf bestehenden Anbindungen.

### 3.5 Architekturvorschlag — ausschliesslich nach dem Muster §1-Website-c

Kein neues Muster. Falls ein Scan-Weg gebaut wird, ist er die **sechste** Anbindung und sieht aus wie
die fünf davor:

```
packages/shared/src/pv-design-scan.ts        ← Wire-Schema + parsePvDesignExtraction (rein, getestet)
apps/website/lib/pv-design-scan/
  ├── ai-client.ts   ← import 'server-only'; createPvDesignScanClient(); PV_DESIGN_SCAN_MODEL;
  │                    MAX_PV_DESIGN_FILE_BYTES; require-on-use auf process.env
  ├── limits.ts      ← Grössen-/Formatgrenzen OHNE Schlüsselzugriff (Delta 17: damit die Action
  │                    keinen Grund hat, den Client zu importieren)
  ├── extract.ts     ← die EINZIGE Datei, die ai-client.ts ziehen darf
  └── actions.ts     ← 'use server'; Prüfkette (Datei da · PDF · Grösse) VOR jedem externen Kontakt
```

Dazu, wortgleich zum Bestand:
- **ESLint** (`eslint.config.mjs`): ein **sechster** Eintrag im `apps/website`-Block auf
  `@/lib/pv-design-scan/ai-client`, erlaubt in **genau einer Datei** (`…/extract.ts`) — nicht im
  Verzeichnis. Und alle bestehenden Ausnahmeblöcke um den neuen Client erweitern, damit die Regel
  **getauscht statt abgeschaltet** wird (die Korrektur aus Delta 9b-2a).
- **`import 'server-only'`** als zweite Sperre, require-on-use als dritte.
- **Datei-Grössengrenze** in `limits.ts`, `bodySizeLimit` in `next.config.mjs` bewusst etwas
  darüber (Muster B14-2).
- **Zielschema eigen, nicht `invoice-scan` erweitert** — dieselbe Begründung wie dort: gemeinsame
  Felder gibt es praktisch keine, und ein zusammengelegter Typ hätte je Dokumentart zwei Drittel
  strukturelle `null`.
- **`anyOf: [{type, enum}, {type: 'null'}]`** für jedes nullbare Aufzählungsfeld — die 400-Falle
  aus §1-Website-c gilt unverändert, und der rekursive Schema-Wächter aus
  `packages/shared/src/invoice-scan.test.ts` ist mitzuziehen.
- **Vorschlag, keine stille Übernahme.** Zwischen Gelesenem und Gerechnetem eine Vorschau und ein
  ausdrückliches „Übernehmen" — dieselbe Haltung wie Delta 17/18 und der Tarifblatt-Scan, hier
  zusätzlich deshalb, weil 3.3 zeigt, dass ein einzelner falsch gelesener Winkel die Hälfte der
  Ersparnis bewegt.

**⚠ Ein Unterschied zu allen fünf bestehenden Anbindungen, der ins Pflichtenheft gehört:** der
Rechnungs-Scan liest eine **Rechnung** — ein Dokument über Vergangenes, dessen Werte auf dem Papier
stehen. Eine PV-Auslegung ist eine **Prognose eines Dritten**, deren Eingangsgrössen (Neigung,
Ausrichtung) selbst schon Planungsannahmen sind, und die — wie 3.2 zeigt — in sich widersprüchlich
sein kann. Was daraus gelesen wird, ist deshalb **niemals** eine Messung im Sinne von Prinzip 1,
sondern in jedem Fall `[ANNAHME]`/`source: 'estimated'`, auch wenn die Extraktion fehlerfrei war.

---

## 4. Zerlegungsvorschlag für den Bau (NICHT gebaut)

Reihenfolge und Abhängigkeiten. Die Teilung folgt exakt der von Delta 9b (9b-1 Formular vor 9b-2
Scan) und aus demselben Grund: die beiden Wege teilen fast nichts, und der Formular-Weg steht ohne
den Scan-Weg vollständig für sich.

### (a) PVGIS-Anbindung, isoliert von jeder Oberfläche

**Umfang:** Proxy-Server-Action + reiner Umrechnungskern (PVGIS-Stundenwerte → 15-min-Reihe auf den
Zeitstempeln eines gegebenen `LoadProfile`) + die Kopplungsfunktion „Verbrauch − Erzeugung →
`net_signed`-Lastgang". Kein UI, kein Formular.

**Warum zuerst und warum isoliert:** Es ist der einzige Teil mit einer **externen Abhängigkeit** und
den drei harten Eigenschaften aus 2.2 (stündlich · Jahre 2005–2023 · kein CORS). Diese drei muss man
gelöst haben, bevor eine Oberfläche darauf Zusagen macht. Isoliert heisst zusätzlich: der
Umrechnungskern gehört in `packages/shared` oder `packages/engine` und ist dort **ohne Netz testbar**
(die PVGIS-Antwort als Fixture), während der Proxy in `apps/website` nur holt und weiterreicht —
dieselbe Trennung wie zwischen `invoice-scan.ts` (shared, getestet) und `extract.ts` (App).

**Muss in diesem Schritt entschieden werden:**
- **Die Wetterjahr-Regel.** Delta 15 Regel A verlangt den Zeitraum des Lastgangs, PVGIS kann ihn
  nicht liefern (2.2). Vorschlag: das jüngste verfügbare Jahr **oder** ein aus mehreren Jahren
  gemitteltes Profil, in beiden Fällen als benannte `[ANNAHME]` mit Nennung der ±5,8 %
  Jahresstreuung (3.3). **Ein Rückfall auf „irgendein Jahr", ohne es zu sagen, ist der schlechteste
  Ausgang** — dieselbe Haltung wie Delta 15 Regel C.
- **Stundenwert → Viertelstunde:** Treppe oder Interpolation (2.2 Punkt 1).
- **Zeitzone und Schaltjahr:** PVGIS liefert UTC mit 10-min-Versatz; das Zielgitter läuft über die
  **lokale Wanduhr** (wie `generateStandardLoadProfile`). Ein Schaltjahr-Wetterjahr auf ein
  Nicht-Schaltjahr abzubilden ist eine eigene Entscheidung.
- **`source: 'estimated'` von Anfang an** — s. unten.

### (b) Formular-Weg (entspricht 9b-1)

**Umfang:** Eingabefelder für Standort (PLZ/Gemeinde), kWp, Neigung, Ausrichtung — je Modulfläche —,
Ableitung PLZ → Koordinate, Infobuttons nach dem 9a-Muster, Verdrahtung in den Lastgang-Schritt,
Report-Hinweis.

**Warum vor dem Scan-Weg:** Er ist **vollständig ohne externe Extraktion** benutzbar, deckt den
Kunden ab, der gar kein Dokument hat, und ist zugleich die **Bestätigungs- und Korrekturstufe**, in
die ein späterer Scan-Weg nur vorbelegt. Genau die Rolle, die das 9b-1-Panel für 9b-2b spielt.

**Muss in diesem Schritt entschieden werden:**
- **Die Konventionsfrage aus 3.3 gehört in die OBERFLÄCHE, nicht erst in den Extraktor.** Ein
  Auswahlfeld „Himmelsrichtung" mit optionaler Gradzahl fängt sie strukturell ab; ein reines
  Gradfeld verlagert die Falle auf den Nutzer.
- **Auf welchem Lastgang der Weg angeboten wird** (1.4): Standardprofil ja, `import_only` ja,
  `net_signed` — hier gibt es die Messung bereits, und ein Generator wäre ein Rückschritt.
- **Kleingewerbe-Analogie:** was nicht seriös geht, wird sichtbar und deaktiviert angeboten statt
  versteckt (Delta 9, Transparenz gilt auch für Unfertiges).

### (c) Scan-Weg (entspricht 9b-2)

**Umfang:** die sechste KI-Anbindung nach 3.5, die ausschliesslich die Felder von (b) **vorbelegt**.

**Warum zuletzt:** Er braucht (b) als Ziel — ohne Formular gäbe es nichts zu befüllen und keine
Korrekturstufe. Und er ist der einzige Teil, der mit **n = 1** startet (3.4); er sollte erst gebaut
werden, wenn genug Testmaterial da ist, um die Ablesequalität zu messen statt zu behaupten.

### Querschnitt: `source: 'estimated'` von Schritt (a) an mitdenken

**⚠ Der `LoadProfile.source`-Enum trägt heute vier Werte** (`net_signed`, `import_export_split`,
`import_only`, `standard_profile`) und **keinen** für „gemessener Verbrauch minus **geschätzter**
Erzeugung". Das ist genau die Kennzeichnungspflicht aus §3.1/Prinzip 7, und Delta 8/9b-1 hat für den
Standardprofil-Fall vorgemacht, wie sie durchschlägt: `peakShavingBlockers` liest `source ===
'standard_profile'` und schaltet die Leistungspreis-Dimension hart ab.

**Vier Punkte, die deshalb ab Schritt (a) feststehen müssen:**

1. **Ein fünfter `source`-Wert oder ein eigenes Kennzeichen** — offen, welche Form. Ein fünfter Wert
   wäre nach dem Muster von `standard_profile` konsequent; ein zweites, orthogonales Feld
   (`pvSource: 'measured' | 'estimated'`) trüge dem Umstand Rechnung, dass die Schätzung nur die
   **PV-Hälfte** betrifft, der Verbrauch dagegen gemessen sein kann. **Das ist eine
   Contract-Entscheidung und gehört ins Pflichtenheft, nicht in einen Bau-Prompt.**
2. **Der Report muss es sagen** — an der Zahl, nicht in einer Aufklappliste. Muster: der
   Standardprofil-Hinweis direkt unter der Kern-Kennzahl (9b-1), sichtbar auch im Druck.
3. **Der Wert muss ins Analyse-Bündel** (B14-1/B14-2, Bündel-Fassung). Eine 2026 archivierte Baseline
   muss 2028 sagen können, ob ihr Eigenverbrauchs-Anteil gemessen oder geschätzt war — sonst misst
   der Wirkungsnachweis gegen eine Zahl, deren Herkunft niemand mehr kennt.
4. **Die Kombination `standard_profile` + geschätzte PV ist die schwächste Grundlage im ganzen
   Rechner** — synthetischer Verbrauch minus geschätzter Erzeugung. Sie ist trotzdem der wichtigste
   Anwendungsfall (1.4). Was sie ausweisen darf und was nicht, ist eine eigene Frage; **eine
   Spitzenkappungs-Ersparnis darf sie definitiv nicht ausweisen**, und das folgt heute schon
   automatisch aus `peakShavingBlockers`.

---

## 5. Was offen bleibt

| Punkt | Art | Anmerkung |
|---|---|---|
| Wetterjahr-Regel gegen Delta 15 Regel A | **Entscheidung** | PVGIS deckt 2025/2026 nicht ab (2.2). Blockiert Schritt (a). |
| Fünfter `source`-Wert oder eigenes Kennzeichen | **Contract-Entscheidung** | s. 4, Querschnitt Punkt 1. |
| PLZ/Gemeinde → Koordinate | offen | Woher? Eine eigene Tabelle im Repo, ein weiterer externer Dienst, oder ein Kartenausschnitt zur Auswahl. Jede Variante hat eigene Datenschutz-/Abhängigkeitsfolgen. |
| Testmaterial für den Scan-Weg | **Fehlanzeige** | n = 1 (3.4). Blockiert Schritt (c), nicht (a)/(b). |
| Verhalten auf `net_signed`-Lastgängen | offen | 1.4 — anbieten oder nicht. |
| Alpiner Geländehorizont bei PLZ-Genauigkeit | ungemessen | 2.3, letzter Absatz. Eine Messung an einem echten Alpental-Standort wäre billig nachzuholen. |
| Stundenwert → Viertelstunde | **Entscheidung** | 2.2 Punkt 1. |
| PV\*SOL-Neigung 90° gegen „dachparallel" | **nicht entscheidbar** | Aus dem Dokument nicht auflösbar (3.2) — und die Aufgabenstellung lässt keine Annahme darüber hinaus zu. Falls es je gebraucht wird: beim Planer nachfragen, nicht ableiten. |

---

## Anhang — wie gemessen wurde

- **Engine:** drei temporäre vitest-Dateien in `packages/engine/src/`, nach dem Lauf gelöscht;
  `git status` danach sauber. Sie riefen ausschliesslich die öffentlichen Bausteine
  `generateStandardLoadProfile`, `simulateBattery` und `computeBatterySavings` auf — kein Eingriff
  in Bestandscode.
- **PVGIS:** `curl` bzw. `urllib` gegen `https://re.jrc.ec.europa.eu/api/v5_3/seriescalc` und `…/tmy`,
  **ausschliesslich mit der generischen Wien-Koordinate 48,2082 / 16,3738** und den Vergleichspunkten
  aus 2.3. **Zu keinem Zeitpunkt mit einer Kundenadresse.**
- **PDF:** ein selbst kompilierter Swift-PDFKit-Aufruf (Scratchpad), plus Stream-Statistik über
  `zlib` zur Unterscheidung Text-PDF/Scan. Die beiden Dokumente sind **nicht** ins Repo kopiert
  worden.
- **Datum aller Messungen:** 02.09.2026.
