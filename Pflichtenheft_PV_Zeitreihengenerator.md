# Pflichtenheft — PV-Zeitreihengenerator (Bauabschnitt B22)

> **Dokumenttyp:** Technisches Pflichtenheft für den Bauabschnitt **B22**. Es beschreibt, was gebaut
> werden soll, und legt die Contract-Entscheidungen fest, die vor dem ersten Bau-Prompt feststehen
> müssen. **Es ist selbst kein Bau-Schritt** — zum Zeitpunkt seiner Entstehung (02.09.2026) ist an
> keiner Zeile Anwendungscode etwas geändert.
>
> **Bezug:** Ergänzt `Pflichtenheft_Kalkulator_MVP.md` (§3.1 Eingabe-Datenmodell, §3.6/§3.7
> Simulation und Zuschreibung, §3.10 Ausgabe-Contract) und
> `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md` (Delta 8/9b Standardprofil, Delta 15 Regel A/C).
> Wer daraus baut, liest **zuerst** das Kalkulator-Pflichtenheft, **dann** dieses Dokument. Alles,
> was hier nicht erwähnt ist, bleibt unverändert gültig. Für Reihenfolge und Umfang bleibt
> `Fahrplan_2026.md` maßgeblich.
>
> **Kanonische Faktenquelle für alle Zahlen und Befunde in diesem Dokument:**
> `PV_Zeitreihengenerator_Bestandsaufnahme.md` (Repo-Root, Commit `3aac59f`, 02.09.2026). Dort steht,
> wie gemessen wurde; hier steht, was daraus folgt. Bei Widerspruch gilt die Bestandsaufnahme für die
> **Messung**, dieses Dokument für die **Entscheidung**.
>
> **Legende:** `[ANNAHME]` = getroffene Annahme, vor Auslieferung zu bestätigen · `[MARTIN]` /
> `[ANDREAS]` = Input erforderlich, nicht ableitbar · `[v2]` = bewusst nicht in B22.

---

## 0. Zweck, Zielgruppe und Scope-Grenze

### 0.1 Zweck

Ein Kunde ohne sichtbare PV-Erzeugung in seinem Lastgang soll eine **ehrliche, als geschätzt
gekennzeichnete** Eigenverbrauchs-Rechnung bekommen. Der Generator erzeugt dafür aus einer
PV-Auslegung (Standort, kWp, Neigung, Ausrichtung) eine Erzeugungs-Zeitreihe und **zieht sie vom
Verbrauch ab** — das Ergebnis ist ein signierter Netz-Lastgang, den die bestehende Engine ohne jede
Änderung an Dispatch, Zuschreibung oder ROI verarbeitet.

### 0.2 Zielgruppe — für wen der Generator gebaut wird

Er richtet sich an **zwei** Ausgangslagen, und beide sind messbar dieselbe:

- **Standardprofil-Kunde** (Delta 9b-1, `source: 'standard_profile'`): Der H0-Generator liefert eine
  strikt positive Kurve — **0 negative Slots von 35.040** (Bestandsaufnahme 1.4). Die
  Eigenverbrauchs-Ersparnis ist damit heute **immer exakt € 0,00**. Genau dieser Kunde ist der,
  für den der zweite Einstieg überhaupt gebaut wurde. **Hier ist der Hebel am größten.**
- **Echter Lastgang ohne Einspeisespalte** (`source: 'import_only'`, der reale Urbanz-Fall): ebenfalls
  0 Einspeise-Slots, ebenfalls € 0,00. Für ihn existiert bereits die §3.1-Pflichtwarnung
  („nicht beurteilbar bzw. unterschätzt") — der Generator macht daraus eine Zahl mit benannter
  Herkunft statt einer Leerstelle.

**Größenordnung, gemessen** (Bestandsaufnahme 1.3; H0 4.500 kWh/Jahr, Batterie 19,2 kWh / 10,6 kW /
η 0,9, Arbeitspreis 25 ct, Einspeisevergütung 8 ct, echte PVGIS-Reihe Wien 10,2 kWp):

| | Eigenverbrauchs-Ersparnis | `totalSavingPerYear` | `newBilledKw` |
|---|---|---|---|
| H0 **ohne** PV | € 0,00 | € 0,00 | 1,442 kW |
| H0 **mit** PV im Lastgang | **€ 384,69** | **€ 384,69** | 1,442 kW |

### 0.3 Scope-Grenze

**Nicht Gegenstand von B22:** kein Sonnenstandsmodell im eigenen Code (die Erzeugungsrechnung macht
PVGIS), keine Verbrauchs-Erzeugung (den Verbrauch liefert H0 oder der echte Lastgang), keine
Wirtschaftlichkeitsrechnung für die PV-Anlage selbst (der Rechner rechnet den **Speicher**),
kein Batterie-Vorschlag aus der Auslegung, keine Anbindung an Wechselrichter-Portale `[v2]`.

**Ausdrücklich nicht Gegenstand:** die Ablösung einer vorhandenen Messung. Wo Einspeisung im
Lastgang steht, gilt Prinzip 1 — s. §2.4.

---

## 1. Der tragende Befund: der Generator erzeugt den LASTGANG, nicht ein PvProfile

Dies ist die Architekturentscheidung des ganzen Vorhabens, und sie ist gemessen, nicht abgeleitet
(Bestandsaufnahme 1.2).

**Ein `PvProfile` ändert heute KEINE einzige Ersparnis-Zahl.** `simulateBattery` berechnet
`grossPvKw` als **letzten** Schritt, **nach** Kapp-Suche, `computeSocFloor`, `runCombinedDispatch`
und `newBilledKw`; `pvProfile` wird an keine Physik-Primitive weitergereicht. `computeBatterySavings`
liest `sim.grossPvKw` **nirgends** — die Herkunftsmarkierung der FIFO-Schichten hängt am **Vorzeichen
der Netzlast**, nicht am PV-Profil. Über drei Lastgang-Typen gemessen ist das gesamte
`BatterySavings`-Objekt mit und ohne `PvProfile` **bit-gleich**; der bestehende Regressionstest
`packages/engine/src/simulation/pv-chain.test.ts` sagt dasselbe zu.

**Wirkung eines `PvProfile` heute, vollständig:** `dispatchTrace.pvGenerationKw` zeigt die echte
Brutto-PV statt der Einspeise-Näherung, und es entstehen zwei `dataQuality`-Warnungen. **Sonst
nichts.**

**⇒ Ein Generator, der ein `PvProfile` erzeugt, wäre wirkungslos.** Er muss den **Netz-Lastgang**
erzeugen: `gridPowerKw(t) = verbrauchKw(t) − erzeugungKw(t)`, signiert, mit Einspeisung als negativem
Wert. Das ist zugleich die Konstruktion, die `dev-fixtures/generate-demo-pv-profile.mjs` heute schon
benutzt — von dort ist die **Kopplungslogik** (Netz = Verbrauch − Erzeugung, Konsistenz per
Konstruktion, Determinismus) zu übernehmen und die **Erzeugungskurve** zu ersetzen: sie ist dort ein
Gauß-Tagesbogen ohne Koordinate, Neigung, Ausrichtung und Zeitzone, also reines Test-Fixture ohne
fachlichen Bezug (Bestandsaufnahme 1.5).

**⚠ Ein `PvProfile` darf dabei trotzdem zusätzlich entstehen** — für `dispatchTrace` und das
Energiefluss-Chart. Es ist dann aber **Beiwerk der Anzeige**, nicht die Rechengrundlage, und die
Zuordnung läuft über einen **exakten ISO-String-Vergleich**: die erzeugten Zeitstempel müssen
byte-identisch zu denen des Lastgangs sein (`new Date(ms).toISOString()`), sonst läuft die
Ausrichtung still ins Leere (Bestandsaufnahme 1.1).

---

## 2. Contract — die fünf festgelegten Entscheidungen

Diese fünf stehen fest und sind in einem Bau-Prompt **nicht neu herzuleiten**. Was sie offen lassen,
steht in §4.

### 2.1 Wetterjahr: Zehn-Jahres-Mittel 2014–2023

**Entscheidung:** Die Erzeugungsreihe entsteht aus dem **Mittel der zehn PVGIS-Wetterjahre
2014–2023** (`seriescalc`, `pvcalculation=1`). Sie wird im Report als benannte **`[ANNAHME]`**
ausgewiesen, mit Nennung der Jahresstreuung.

**Warum es überhaupt eine Regel braucht:** PVGIS liefert ausschließlich die Wetterjahre **2005–2023**
(gemessen: `startyear=1990` → HTTP 400 mit genau dieser Auskunft). Das **kollidiert mit Delta 15
Regel A** („der Vergleich benutzt exakt den Zeitraum des hochgeladenen Lastgangs") — der reale
Urbanz-Lastgang deckt 27.08.2025 – 26.08.2026 ab, und diesen Zeitraum kann PVGIS **nicht liefern**.
Eine Abbildung ist damit unvermeidlich; die einzige Frage ist, ob sie benannt wird.

**Warum das Zehn-Jahres-Mittel und nicht das jüngste Jahr:** Es entspricht der **Klimanormale, mit
der ein Fachplanungswerkzeug selbst rechnet.** Das vorliegende PV\*SOL-Dokument nennt als Klimadaten
„Wien 11, AUT (**1996 - 2015**)" aus Meteonorm 8.1 — also ebenfalls ein Mehrjahres-Mittel, nicht ein
einzelnes Jahr. Die Gegenrechnung schließt das: PVGIS über 2014–2023 bei derselben Konfiguration
ergibt im Mittel **759,0 kWh/kWp**, gegen die im Dokument stehenden **754,31 kWh/kWp** von
PV\*SOL/Meteonorm — **0,6 % Abweichung** (Bestandsaufnahme 3.3, letzter Absatz).

**⚠ Die Streuung ist die ehrliche Genauigkeitsgrenze des ganzen Vorhabens und gehört in den Report,
nicht in eine Fußnote:** die zehn Einzeljahre liegen zwischen **711,4 und 800,0 kWh/kWp**, also
**± 5,8 %**. Ein einzelnes Jahr auszuweisen behauptete eine Genauigkeit, die die Datenlage nicht
hergibt; ein Rückfall auf „irgendein Jahr", ohne es zu sagen, wäre der schlechteste Ausgang —
dieselbe Haltung wie Delta 15 Regel C.

**Folge für die Umsetzung:** Das Wetterjahr ist **kein Parameter der Oberfläche**. Es ist eine
Konstante im Code, die genau einmal steht und im Report zitiert wird.

### 2.2 Kennzeichnung: `LoadProfile.pvSource?: 'estimated'`

**Entscheidung:** Ein **optionales, zu `source` orthogonales** Feld `pvSource?: 'estimated'`. Es wird
**ausschließlich** gesetzt, wenn die PV-Komponente des Netz-Lastgangs synthetisch erzeugt wurde.
**Kein fünfter `source`-Wert.**

**Warum orthogonal und nicht ein fünfter `source`-Wert:** `source` beschreibt, **wie der Lastgang
zustande kam** (`net_signed`, `import_export_split`, `import_only`, `standard_profile`). Die
Schätzung betrifft aber nur die **PV-Hälfte**; der Verbrauch daneben kann sehr wohl gemessen sein
(`import_only` + geschätzte PV). Ein fünfter `source`-Wert könnte diese beiden Aussagen nicht mehr
auseinanderhalten — er machte aus zwei Angaben eine und verlöre genau die, auf die es bei der
Beurteilung ankommt.

**⚠ Die Kennzeichnung ist nicht Kosmetik, sie schaltet Rechnung ab.** Delta 8/9b-1 hat für das
Standardprofil vorgemacht, wie eine Herkunftsangabe durchschlägt: `peakShavingBlockers`
(`packages/engine/src/simulation/peak-shaving.ts`) liest `source === 'standard_profile'` und schaltet
die Leistungspreis-Dimension **hart** ab — von `simulateBattery` (§3.6) und `computeBatterySavings`
(§3.7) **gemeinsam** gelesen, in beiden Hälften. `pvSource === 'estimated'` bekommt eine **neue
Prüfung nach genau diesem Muster**. Der Grund ist derselbe: eine Spitzenkappung, die auf einem
Netz-Lastgang gerechnet wird, dessen Spitzen zur Hälfte aus einer Schätzung stammen, wäre eine
Ersparnis auf eine Spitze, die so nie gemessen wurde.

**Der Blocker-Grund heißt `'estimated_pv'`** — zweiwortig wie `static_control`, `standard_profile`
und `no_demand_charge`, und er benennt wie diese die Achse: das Produkt (Steuerung), die Datenlage
(Lastgang), die Abrechnung (Tarif), und nun die **Erzeugungsseite**. Je Grund ein eigener Warnsatz;
ein gemeinsamer, allgemeiner Satz verlöre genau die Information, die den Unterschied ausmacht.

**⚠ Die Kombination `standard_profile` + geschätzte PV ist die schwächste Grundlage im ganzen
Rechner** — synthetischer Verbrauch minus geschätzter Erzeugung — und zugleich der **wichtigste**
Anwendungsfall (§0.2). Sie darf **definitiv keine Spitzenkappungs-Ersparnis ausweisen**. Das folgt
zwar bereits aus dem bestehenden `standard_profile`-Blocker; **es ist trotzdem als eigener,
ausdrücklicher Testfall zu benennen** — sonst hinge die Zusage an einer Bedingung, die jemand später
für redundant halten und entfernen könnte, ohne dass ein Test rot würde.

**Zwei weitere Orte, an denen die Kennzeichnung ankommen muss:**

1. **Im Report, an der Zahl — nicht in einer Aufklappliste, und sichtbar auch im Druck.** Muster ist
   der Standardprofil-Hinweis direkt unter der Kern-Kennzahl (Delta 9b-1) und die Teiljahres-Warnung:
   ein Vorbehalt, den niemand sieht, schützt niemanden. Der Satz nennt die Herkunft (PVGIS,
   Zehn-Jahres-Mittel), die Streuung (± 5,8 %) und dass die Eigenverbrauchs-Zahl darüber eine
   Schätzung ist.
2. **Im Analyse-Bündel** (B14-1/B14-2). Eine 2026 archivierte Baseline muss 2028 sagen können, ob ihr
   Eigenverbrauchs-Anteil **gemessen oder geschätzt** war — sonst misst der Wirkungsnachweis gegen
   eine Zahl, deren Herkunft niemand mehr kennt. Das ist ein **Sprung der Bündel-Fassung** (Muster:
   Fassung 4 bei der Hochrechnung, Fassung 5 bei den Ladeverlusten), weil sich damit die Bedeutung
   eines bestehenden Feldes ändert.

### 2.3 PLZ → Koordinate: statisches Codemodul, kein Geocoding-Dienst

**Entscheidung:** Eine getypte, versionierte Tabelle **im Code**, nach dem Muster von
`packages/shared/src/tariff-catalog.ts` (B11). Quelle: **PLZ-Zentroiden der Statistik Austria**.
**Kein externer Geocoding-Dienst**, keine Laufzeitabfrage, keine Kartenauswahl.

**Warum das trägt — gemessen:** Innerhalb einer Stadt (≤ 13 km Abstand) liegt der Ertragsunterschied
**unter 1 %** (Wien Zentrum 11.833,8 kWh/a = 100,0 % · Wien SW ~5 km 100,7 % · Wien NO ~6 km 100,2 %
· Wien Stadtrand ~13 km 100,6 %). Eine **straßengenaue Adresse bringt gegenüber einem
PLZ-Mittelpunkt nichts Messbares** (Bestandsaufnahme 2.3). Über 145 km (Graz) sind es 6 % — die
PLZ-Auflösung ist also genau die Grenze, an der es anfängt zu zählen.

**Warum Code und nicht Datenbank oder Fremddienst:** Dieselbe Begründung wie bei B11. Ein externer
Dienst machte den Rechner von einem zweiten Netzaufruf abhängig und trüge die Ortsangabe des Kunden
**an einen dritten Empfänger** — eine Ausnahme von Prinzip 4, die es nicht zu geben braucht, weil die
Daten statisch sind und sich nicht ändern. Eine Datenbanktabelle brächte einen Pflegeweg für einen
Datensatz, der einmal eingetragen wird. Als Codemodul ist eine Korrektur ein PR mit einer Datei,
und die Herkunft steht im Kopf des Moduls.

**Was das für Prinzip 4 bedeutet:** Es wäre die **zweite** benannte Ausnahme im Kalkulator (die erste
ist der Rechnungs-Scan, Delta 9b-2 / `DEPLOYMENT.md` §1-Website-c; die dritte, kleinere ist B21-3a,
wo die Abfrageparameter die Zeitgrenzen des Lastgangs hinaustragen). **Der Lastgang bleibt
unangetastet** — hinaus geht Koordinate, Neigung, Ausrichtung, kWp und ein Wetterjahr, sonst nichts.
**Die Entschärfung ist gemessen, nicht argumentiert:** weil eine PLZ genügt, muss die Anwendung **nie**
eine hausgenaue Koordinate erheben, und der Datenschutz-Satz kann das im Klartext sagen. Das ist der
wesentliche Unterschied zum Rechnungs-Scan, wo die Datei zwangsläufig alles enthält, was auf ihr
steht.

**Ein eigener Datenschutz-Satz ist Pflicht.** Die bestehenden Einstiegs-Sätze („wird nicht
hochgeladen" / „nicht übertragen") wären hier unwahr — dieselbe Lage und dieselbe Konsequenz wie bei
Delta 9b-2b.

**⚠ Offen bleibt die Beschaffung, nicht die Entscheidung:** Datensatz, Fassung und Lizenzlage der
PLZ-Zentroiden sind noch zu klären `[ANDREAS]`. Bis dahin gibt es keinen Ersatz aus dem Bauch — eine
selbst geschätzte Koordinate wäre derselbe Fehler wie ein erfundener Tarifsatz in B11.

### 2.4 `net_signed`-Lastgänge: der Generator wird dort nicht angeboten

**Entscheidung:** Trägt der Lastgang bereits Einspeisung (`source: 'net_signed'` oder
`'import_export_split'`), wird der Generator **gar nicht erst angeboten**.

**Warum:** Dort **steht die Ersparnis bereits** — sie ist gemessen. Ein Generator hätte nichts
hinzuzufügen und wäre ein **Rückschritt gegenüber der Messung**, also ein Verstoß gegen Prinzip 1
(„Die Rechnung ist die Wahrheit"). Eine geschätzte Erzeugungskurve neben einer gemessenen Einspeisung
zu führen erzeugte zwei Antworten auf dieselbe Frage, und die Anwendung müsste entscheiden, welche
gilt — eine Entscheidung, die sie nicht treffen kann und nicht treffen soll.

**Nicht verborgen, sondern begründet.** Delta 9s Transparenz-Anspruch gilt auch hier: der Einstieg
erscheint mit dem Satz, dass die Einspeisung im hochgeladenen Lastgang bereits enthalten und die
Eigenverbrauchs-Ersparnis daraus **gemessen** ist — dasselbe Muster wie das sichtbar deaktivierte
Kleingewerbe-Profil in Delta 9b-1. Wer nichts anbietet und nichts sagt, sieht aus wie ein Rechner,
der für diesen Kunden nichts kann.

**⚠ Die Erkennung läuft über `source`, nicht über eine Zählung negativer Slots.** Ein
`net_signed`-Lastgang, dessen erste Einspeisung spät im Jahr liegt, wird vom Parser heute als
`import_only` etikettiert (bekannter, in `packages/engine/src/parser/detect.ts` als `[ANNAHME]`
vermerkter Defekt: die Vorzeichen-Erkennung liest die ersten 60 Zeilen). Für die **Zahlen** ist das
folgenlos; für **diese Regel** heißt es, dass ein solcher Lastgang den Generator angeboten bekäme,
obwohl er Einspeisung trägt. Der Generator muss deshalb vor der Übernahme zusätzlich prüfen, ob im
Lastgang **überhaupt** negative Werte stehen, und in diesem Fall dieselbe Absage geben.

### 2.5 Stunde → Viertelstunde: Treppenfunktion, nicht Interpolation

**Entscheidung:** Der PVGIS-Stundenwert gilt für alle vier Viertelstunden der Stunde
(**Treppenfunktion**). **Keine lineare Interpolation.**

**Warum es eine Entscheidung und keine Formalie ist:** PVGIS liefert **stündlich** (8.784 Werte für
2020), die Engine arbeitet auf einem **15-min-Gitter**. Eine Treppe verschiebt Ladeentscheidungen an
Stundenkanten; eine Interpolation glättet Wolkenkanten weg. Beide Wege verändern den Fahrplan.

**Warum die Treppe:** Sie **erfindet nichts, was nicht in den Daten steht.** Eine Interpolation
behauptete einen Verlauf zwischen zwei Stundenwerten, den PVGIS gar nicht ausweist — und der
Kalkulator entscheidet an Preis- und Leistungsschwellen, an denen ein erfundener Zwischenwert eine
Ladeentscheidung kippen kann. Die Treppe ist die konservativere Wahl, und sie ist zugleich die, mit
der die Wirkungsmessung in Bestandsaufnahme 1.3 gefahren wurde — die € 384,69 oben gehören zu dieser
Regel und zu keiner anderen.

**⚠ Der PVGIS-Zeitstempel trägt einen 10-min-Versatz** (`20200101:0010` — er bezeichnet den
Beobachtungszeitpunkt, nicht den Stundenanfang; am Sonnenhöhen-Maximum geprüft: 21.06.2020, `11:10`
UTC, `H_sun` 65,06°, passend zum wahren Sonnenhöchststand in Wien). Er ist beim Zuschnitt auf das
Gitter zu **normalisieren**, nicht zu übernehmen — sonst liegt die ganze Erzeugungskurve um zehn
Minuten daneben.

### 2.6 Typdefinitionen

```ts
// ─────────────────────────────────────────────────────────────────────────────
// (1) Wetterjahr — eine Konstante, KEIN Parameter der Oberfläche (§2.1)
// ─────────────────────────────────────────────────────────────────────────────
// PVGIS liefert ausschliesslich 2005–2023 (gemessen). Gerechnet wird das Mittel
// dieser zehn Jahre; die Streuung dazwischen ist die ehrliche Genauigkeitsgrenze
// und wird im Report genannt.
const PVGIS_WEATHER_YEARS = { from: 2014, to: 2023 } as const;
const PVGIS_WEATHER_SPREAD_PERCENT = 5.8; // [ANNAHME] gemessen an EINER Konfiguration

// ─────────────────────────────────────────────────────────────────────────────
// (2) Kennzeichnung — orthogonal zu `source`, KEIN fünfter source-Wert (§2.2)
// ─────────────────────────────────────────────────────────────────────────────
type LoadProfile = {
  readings: Array<{ ts: string /* ISO, UTC */; gridPowerKw: number }>;
  intervalMinutes: 15;
  timezoneMeta: string;
  source: 'net_signed' | 'import_export_split' | 'import_only' | 'standard_profile';
  // NEU in B22. Gesetzt AUSSCHLIESSLICH, wenn die PV-Komponente dieses Lastgangs
  // synthetisch erzeugt wurde. `undefined` heisst "keine geschätzte PV", nie
  // "unbekannt" — der Verbrauch daneben kann gemessen sein.
  pvSource?: 'estimated';
};

// Vierter Blocker-Grund, Namensmuster wie die drei bestehenden.
// Gelesen von simulateBattery (§3.6) UND computeBatterySavings (§3.7) — beide
// Hälften, sonst entsteht aus dem reserve-freien Fahrplan eine zufällige
// Differenz, die als Ersparnis auf eine erfundene Spitze kreditiert wird.
type PeakShavingBlocker =
  | 'static_control'
  | 'standard_profile'
  | 'no_demand_charge'
  | 'estimated_pv';      // NEU in B22

// ─────────────────────────────────────────────────────────────────────────────
// (3) PLZ → Koordinate — statisches Codemodul, Muster tariff-catalog.ts (§2.3)
// ─────────────────────────────────────────────────────────────────────────────
type PostalCodeCentroid = {
  postalCode: string;   // "1100"
  name: string;         // Anzeigename, für die Bestätigung in der Oberfläche
  lat: number;
  lon: number;
};
// Quelle: PLZ-Zentroiden der Statistik Austria [ANDREAS: Datensatz, Fassung, Lizenz].
declare const AT_POSTAL_CODE_CENTROIDS: readonly PostalCodeCentroid[];
// Kein Treffer ⇒ null. NIE eine geratene Koordinate — dieselbe Regel wie bei
// einem nicht hinterlegten Tarifsatz (B11): der Weg wird verweigert, nicht geschätzt.
declare function lookupPostalCodeCentroid(postalCode: string): PostalCodeCentroid | null;

// ─────────────────────────────────────────────────────────────────────────────
// (4) Eignung des Lastgangs — der Generator wird nicht überall angeboten (§2.4)
// ─────────────────────────────────────────────────────────────────────────────
type PvGeneratorEligibility =
  | { offered: true }
  // Einspeisung liegt gemessen vor. Wird ANGEZEIGT und begründet, nicht verborgen.
  | { offered: false; reason: 'measured_feed_in' };

// Prüft `source` UND zusätzlich, ob tatsächlich negative Werte vorkommen — die
// Vorzeichen-Erkennung des Parsers liest nur die ersten 60 Zeilen (§2.4).
declare function pvGeneratorEligibility(load: LoadProfile): PvGeneratorEligibility;

// ─────────────────────────────────────────────────────────────────────────────
// (5) Stunde → Viertelstunde — Treppe, keine Interpolation (§2.5)
// ─────────────────────────────────────────────────────────────────────────────
// `hourly` sind die auf volle Stunden normalisierten PVGIS-Werte (der 10-min-
// Versatz ist VORHER entfernt). `targetTimestamps` sind die Zeitstempel des
// Ziel-Lastgangs, byte-identisch übernommen (§1) — die Rückgabe hat dieselbe
// Länge und dieselbe Reihenfolge.
declare function expandHourlyToQuarterHours(
  hourly: ReadonlyArray<{ ts: string; pvGenerationKw: number }>,
  targetTimestamps: readonly string[],
): number[];

// ─────────────────────────────────────────────────────────────────────────────
// Die Kopplung — das eigentliche Ergebnis des Generators (§1)
// ─────────────────────────────────────────────────────────────────────────────
// netz(t) = verbrauch(t) − erzeugung(t). Signiert; negative Werte sind Einspeisung.
// Setzt `pvSource: 'estimated'`. Lässt `source` UNVERÄNDERT — die Herkunft des
// Verbrauchs ändert sich durch die Schätzung nicht.
declare function applyEstimatedPv(
  consumption: LoadProfile,
  pvGenerationKw: readonly number[],
): LoadProfile;
```

---

## 3. Zerlegung des Baus: B22a / B22b / B22c

Die Teilung folgt exakt der von Delta 9b (9b-1 Formular **vor** 9b-2 Scan) und aus demselben Grund:
die beiden Wege teilen fast nichts, und der Formular-Weg steht ohne den Scan-Weg vollständig für
sich. `pvSource: 'estimated'` (§2.2) ist von **B22a an** mitzudenken, nicht nachzurüsten.

### (a) B22a — PVGIS-Anbindung, isoliert von jeder Oberfläche

**Umfang:** Proxy-Server-Action + reiner Umrechnungskern (PVGIS-Stundenwerte → 15-min-Reihe auf den
Zeitstempeln eines gegebenen `LoadProfile`) + die Kopplungsfunktion „Verbrauch − Erzeugung →
signierter Lastgang". **Kein UI, kein Formular.**

**Warum zuerst und warum isoliert:** Es ist der einzige Teil mit einer **externen Abhängigkeit** und
den drei harten Eigenschaften aus der Bestandsaufnahme: stündlich · nur die Jahre 2005–2023 · **kein
CORS**. Diese drei muss man gelöst haben, bevor eine Oberfläche darauf Zusagen macht. *Isoliert*
heißt zusätzlich: der Umrechnungskern gehört in `packages/shared` oder `packages/engine` und ist dort
**ohne Netz testbar** (die PVGIS-Antwort als Fixture), während der Proxy in `apps/website` nur holt
und weiterreicht — dieselbe Trennung wie zwischen `invoice-scan.ts` (shared, getestet) und
`extract.ts` (App).

**⚠ Der Proxy ist zwingend, keine Geschmacksfrage.** Gemessen: PVGIS liefert **0 Treffer** auf
`Access-Control-*` — weder auf die eigentliche Antwort noch auf den Preflight. `curl` bekommt die
Antwort, weil es CORS ignoriert; ein Browser würde sie verwerfen. Nebenbefund: der Dienst setzt zwei
Cookies — ein Browser-Aufruf brächte damit zusätzlich eine Drittanbieter-Cookie-Frage mit sich, die
über einen Proxy gar nicht erst entsteht.

**Der Proxy ist die sechste Server Action in `apps/website`** (`report-gate`, `report-request`,
`battery-text`, `upload-classification`, `invoice-scan`), nach demselben Muster. **Zwei Unterschiede
zu den KI-Anbindungen, die den Aufbau vereinfachen:** PVGIS braucht **keinen Schlüssel** (offen,
kostenlos), und die Antwort ist deterministisch — es gibt nichts abzurechnen und keine „offene Kasse"
im Sinne von `DEPLOYMENT.md` §1-Website-c. Der ESLint-Allowlist-Mechanismus schützt dort einen
**abrechenbaren Schlüssel**; hier gäbe es keinen zu schützen. Was bleibt, ist eine
**Missbrauchs-/Fairness-Frage** — eine Server Action ist über ihre ID aufrufbar; die Antwort darauf
ist eine Größen-/Frequenzgrenze in der Prüfkette **vor** dem externen Aufruf, wie es
`MAX_INVOICE_FILE_BYTES` für den Rechnungs-Scan schon ist.

**In diesem Schritt zu entscheiden (soweit nicht in §2 festgelegt):**
- **Zeitzone und Schaltjahr.** PVGIS liefert UTC mit 10-min-Versatz (§2.5); das Zielgitter läuft über
  die **lokale Wanduhr**, wie `generateStandardLoadProfile`. **Ein Schaltjahr-Wetterjahr auf ein
  Nicht-Schaltjahr abzubilden ist eine eigene Entscheidung** und in diesem Pflichtenheft **nicht**
  getroffen — s. §4.
- Fehlerbild, wenn PVGIS nicht antwortet: ein eigener, benannter Zustand (Muster `not_configured` /
  `api_error` aus 9b-2a), **kein stiller Rückfall** auf eine ersatzweise Kurve.

**Was in diesem Schritt bereits steht:** `pvSource: 'estimated'` wird von der Kopplungsfunktion
gesetzt, und `peakShavingBlockers` liest es — beides ohne Oberfläche prüfbar.

### (b) B22b — Formular-Weg (entspricht Delta 9b-1)

**Umfang:** Eingabefelder für Standort (PLZ), kWp, Neigung, Ausrichtung — **je Modulfläche** —,
Ableitung PLZ → Koordinate (§2.3), Infobuttons nach dem Delta-9a-Muster, Verdrahtung in den
Lastgang-Schritt, Report-Hinweis (§2.2).

**Warum vor dem Scan-Weg:** Er ist **vollständig ohne externe Extraktion** benutzbar, deckt den
Kunden ab, der gar kein Dokument hat, und ist zugleich die **Bestätigungs- und Korrekturstufe**, in
die ein späterer Scan-Weg nur vorbelegt. Genau die Rolle, die das 9b-1-Panel für 9b-2b spielt.

**⚠ Die Azimut-Konvention gehört in die OBERFLÄCHE, nicht erst in den Extraktor.** Gemessen:
PV\*SOL zählt vom **Norden** (Kompass, 0° = N, 180° = S), PVGIS von **Süden** (0° = S, −90° = O,
+90° = W). Ein „Südosten 133 °" ist als PVGIS-`aspect` **−47**, nicht 133; ungeprüft übernommen zeigt
die Anlage nach **Nordwesten** — die Gegenrichtung. In Euro gemessen kostet die Verwechslung
**56 % der ausgewiesenen Ersparnis** (€ 384,69 → € 171,10 pro Jahr), und **die falsche Zahl sieht
völlig plausibel aus** (eine schlecht ausgerichtete Fassadenanlage). Sie fiele niemandem als Fehler
auf — dasselbe Muster wie der Faktor-10-Leistungspreis in B21-2a.

**Die Konsequenz für das Formular:** ein **Auswahlfeld „Himmelsrichtung"** (mit optionaler Gradzahl
daneben) fängt die Falle **strukturell** ab; ein reines Gradfeld verlagert sie auf den Nutzer. Die
Umrechnung Kompass → PVGIS-`aspect` geschieht an **genau einer** Stelle.

**⚠ Der Jahresertrag ist KEIN ausreichendes Prüfmaß.** Gemessen: die naive Süd-35°-Annahme liefert
**53 % mehr PV-Energie** und trotzdem **6 % WENIGER** Ersparnis (€ 360,26 gegen € 384,69) — weil bei
4.500 kWh Verbrauch und 19,2 kWh Speicher der Zusatzertrag überwiegend eingespeist wird (Sättigung).
Wer eine Eingabe gegen „stimmt der Jahresertrag ungefähr?" prüft, prüft die falsche Größe;
entscheidend ist die **Tagesform relativ zur Last**.

**In diesem Schritt zu entscheiden:**
- **Mehrere Modulflächen sind der Normalfall**, nicht der Sonderfall: das vorliegende Dokument führt
  zwei (4,25 kWp und 5,95 kWp, hier zufällig gleich ausgerichtet). Sie werden **einzeln** erfasst und
  **einzeln** gerechnet; ein zusammengefasster Wert wäre eine gerechnete Zahl, die nirgends dasteht.
- **Auf welchem Lastgang der Weg angeboten wird** — festgelegt in §2.4.
- **Kleingewerbe-Analogie:** was nicht seriös geht, wird **sichtbar und deaktiviert** angeboten statt
  versteckt (Delta 9, Transparenz gilt auch für Unfertiges).

### (c) B22c — Scan-Weg (entspricht Delta 9b-2)

**Umfang:** die **sechste** KI-Anbindung des Projekts, die ausschließlich die Felder von B22b
**vorbelegt**.

**Warum zuletzt:** Er braucht B22b als Ziel — ohne Formular gäbe es nichts zu befüllen und keine
Korrekturstufe. Und er ist der einzige Teil, der mit **n = 1** startet; er sollte erst gebaut werden,
wenn genug Testmaterial da ist, um die Ablesequalität zu **messen statt zu behaupten** (s. §4).

**Struktur, wortgleich zum Bestand** (`DEPLOYMENT.md` §1-Website-c):

```
packages/shared/src/pv-design-scan.ts        ← Wire-Schema + parsePvDesignExtraction (rein, getestet)
apps/website/lib/pv-design-scan/
  ├── ai-client.ts   ← import 'server-only'; Modellkennung; MAX_PV_DESIGN_FILE_BYTES;
  │                    require-on-use auf process.env
  ├── limits.ts      ← Grössen-/Formatgrenzen OHNE Schlüsselzugriff (Delta 17: damit die Action
  │                    keinen Grund hat, den Client zu importieren)
  ├── extract.ts     ← die EINZIGE Datei, die ai-client.ts ziehen darf
  └── actions.ts     ← 'use server'; Prüfkette (Datei da · PDF · Grösse) VOR jedem externen Kontakt
```

Dazu: ein **sechster** ESLint-Eintrag auf `@/lib/pv-design-scan/ai-client`, erlaubt in **genau einer
Datei** — und alle bestehenden Ausnahmeblöcke um den neuen Client erweitern, damit die Regel
**getauscht statt abgeschaltet** wird (die Korrektur aus Delta 9b-2a). `anyOf: [{type, enum},
{type: 'null'}]` für jedes nullbare Aufzählungsfeld — die HTTP-400-Falle gilt unverändert, der
rekursive Schema-Wächter aus `invoice-scan.test.ts` ist mitzuziehen. **Eigenes Zielschema**, nicht
`invoice-scan` erweitert: gemeinsame Felder gibt es praktisch keine.

**Extraktionsregeln, die aus der Messung folgen:**
- **Ausrichtung als Himmelsrichtung UND Gradzahl getrennt erfassen**, plus die im Dokument verwendete
  Konvention als eigenes Feld. Das Dokument schreibt „Südosten 133 °" — die Himmelsrichtung ist der
  **Kreuzcheck** gegen die Zahl, und ohne ihn ist die Konventions-Falle nicht zu fangen. Ein
  Extraktor, der nur „133" liefert, ist **strukturell unsicher**.
- **Neigung, kWp, Modulzahl je Modulfläche als Liste**, nicht als Einzelwerte.
- **Standort als Freitext**, nicht als Koordinate — das Dokument trägt keine (es nennt den Namen
  eines Meteonorm-Klimadatensatzes: „Wien 11, AUT (1996 - 2015)").
- **Jahresertrag und spez. Jahresertrag als Prüfgrößen mitnehmen**, nicht als Rechengrundlage — und
  nur als **grober** Plausibilitätsrahmen (s. den Sättigungs-Befund in B22b).
- **Jedes Feld einzeln `null`-fähig, fail closed:** `null` heißt „im Dokument nicht erkennbar", nie
  „vermutlich der Vorgabewert".
- **Kein Freitextfeld in der Rückgabe** — keine Begründung, keine Zusammenfassung des Modells;
  dieselbe Regel wie in allen fünf bestehenden Anbindungen.
- **Vorschlag, keine stille Übernahme.** Zwischen Gelesenem und Gerechnetem eine Vorschau und ein
  ausdrückliches „Übernehmen" — dieselbe Haltung wie Delta 17/18 und der Tarifblatt-Scan, hier
  zusätzlich deshalb, weil ein einzelner falsch gelesener Winkel die Hälfte der Ersparnis bewegt.

**⚠ Ein Unterschied zu allen fünf bestehenden Anbindungen, der beim Bau mitzudenken ist:** der
Rechnungs-Scan liest eine **Rechnung** — ein Dokument über Vergangenes, dessen Werte auf dem Papier
stehen. Eine PV-Auslegung ist die **Prognose eines Dritten**, deren Eingangsgrößen (Neigung,
Ausrichtung) selbst schon Planungsannahmen sind, und die in sich widersprüchlich sein kann. Was
daraus gelesen wird, ist deshalb **niemals** eine Messung im Sinne von Prinzip 1, sondern in jedem
Fall `[ANNAHME]` / `pvSource: 'estimated'` — auch wenn die Extraktion fehlerfrei war.

**Technische Vorbedingung, die einen halben Tag spart:** das vorliegende Dokument ist ein
**Text-PDF**, kein Scan (19 Seiten, `Aspose.Words for .NET 21.9.0`, saubere Extraktion über PDFKit).
Ein naiver Ansatz („FlateDecode-Streams entpacken, `(...)` einsammeln") **scheitert** daran: die
Texte stehen als **Hex-Strings** unter Type0/CID-Fonts, und mehrere Bild-Streams enthalten zufällig
`BT`/`Tj`. Auf dem Entwicklungsrechner fehlen `pdftotext`, `mutool`, `qpdf`, `gs`, PyPDF und
PyObjC/Quartz.

**⚠ Die Ertragskurve steht ausschließlich als BILD im Dokument** („Abbildung: Ertragsprognose mit
Verbrauch", Seite 10). Aus dem Text ist kein Monatswert zu holen — **der Weg „Monatswerte aus dem
Dokument statt PVGIS" ist verschlossen.** Der Scan-Weg belegt Eingabefelder vor, er liefert keine
Zeitreihe.

---

## 4. Was offen bleibt

Die Tabelle übernimmt die offenen Punkte der Bestandsaufnahme (Abschnitt 5) unverändert und ergänzt
je Zeile den Stand nach diesem Pflichtenheft.

| Punkt | Art | Stand nach diesem Pflichtenheft | Blockiert |
|---|---|---|---|
| Wetterjahr-Regel gegen Delta 15 Regel A | Entscheidung | **ENTSCHIEDEN** — §2.1, Zehn-Jahres-Mittel 2014–2023 als benannte `[ANNAHME]` | — |
| Fünfter `source`-Wert oder eigenes Kennzeichen | Contract-Entscheidung | **ENTSCHIEDEN** — §2.2, orthogonales `pvSource?: 'estimated'`, **kein** fünfter `source`-Wert | — |
| PLZ/Gemeinde → Koordinate | offen | **Weg ENTSCHIEDEN** — §2.3, statisches Codemodul. **OFFEN bleibt die Beschaffung:** Datensatz, Fassung und Lizenzlage der Statistik-Austria-Zentroiden `[ANDREAS]` | **B22b** (nicht B22a) |
| Testmaterial für den Scan-Weg | **Fehlanzeige** | **UNVERÄNDERT OFFEN.** n = 1 — ein Dokument, eine Programmversion (PV\*SOL premium 2024 R6), ein Planer, eine Sprache. Nötig sind mindestens fünf bis zehn echte Auslegungen verschiedener Herkunft, darunter **mindestens ein Scan** und **mindestens ein Nicht-PV\*SOL-Werkzeug**, je mit Feld-für-Feld-Abgleich gegen das Papier `[MARTIN]` | **B22c** (nicht B22a/B22b) |
| Verhalten auf `net_signed`-Lastgängen | offen | **ENTSCHIEDEN** — §2.4, wird dort nicht angeboten, aber sichtbar begründet | — |
| Alpiner Geländehorizont bei PLZ-Genauigkeit | ungemessen | **UNVERÄNDERT OFFEN.** PVGIS rechnet den Geländehorizont aus einem Höhenmodell **an der übergebenen Koordinate**; in flachem Gelände folgenlos, in einem engen Alpental kann der Gemeinde-Mittelpunkt einen anderen Horizont haben als der Hof am Hang. Die Innsbruck-Messung zeigt den Effekt **nicht**, widerlegt ihn aber auch nicht — sie misst nur einen Punkt. **Eine Messung an einem echten Alpental-Standort wäre billig nachzuholen.** | **nichts** — der Generator läuft, die Genauigkeit ist dort unbelegt |
| Stundenwert → Viertelstunde | Entscheidung | **ENTSCHIEDEN** — §2.5, Treppenfunktion | — |
| PV\*SOL-Neigung 90° gegen „dachparallel" | **nicht entscheidbar** | **UNVERÄNDERT OFFEN.** Der innere Widerspruch (`Neigung 90 °` bei `Einbausituation: Dachparallel`, Dokumenttitel „PV am Hausdach") ist aus dem Dokument **nicht auflösbar**. Falls es je gebraucht wird: **beim Planer nachfragen, nicht ableiten** `[MARTIN]`. Für B22 folgt daraus nur die Regel, dass ein Extraktor einen solchen Wert **nicht stillschweigend übernehmen** darf | **B22c** (als Randfall, nicht als Sperre) |

### 4.1 Zusätzlich, aus der Zerlegung — hier NICHT entschieden

Die drei Bau-Schritte in §3 nennen je eigene Entscheidungen. Zwei davon sind in diesem Pflichtenheft
bewusst **nicht** getroffen worden, weil die Bestandsaufnahme sie weder misst noch vorentscheidet:

- **Schaltjahr-Abbildung** (B22a): ~~ist im Bau-Prompt für B22a zu treffen~~ **ENTSCHIEDEN am
  02.09.2026 mit dem Bau von B22a.** Das Referenzprofil trägt **8.760** Werte und kennt den
  29. Februar nicht; fällt er im Analysejahr an, bekommt er die Werte des **28. Februar**. Die
  24 Stunden des 29. Februar eines Schaltjahr-Wetterjahres fliessen in **keine** Zelle — sie werden
  verworfen und nicht auf den 28. addiert. Begründung an den echten Daten gemessen (29.02. 11:00 UTC
  = 2.293,65 W über zwei Jahre, 28.02. = 5.205,78 W über zehn) und im Kopf von
  `packages/engine/src/pv-generation/reference-profile.ts` ausgeschrieben.
- **Fehlerbild bei nicht erreichbarem PVGIS** (B22a): ~~die konkreten Zustände sind offen~~
  **ENTSCHIEDEN am 02.09.2026.** Jeder AUSSENfehler (Netzwerk, Zeitüberschreitung, Non-200,
  unlesbarer Rumpf, unerwartetes Schema, unvollständige Reihe) mündet in **`pvgis_error`**; daneben
  stehen **`invalid_input`** und **`rate_limited`** für Anfragen, die **gar nicht erst hinausgehen** —
  sie als `pvgis_error` zu melden hiesse, dem Dienst etwas anzulasten, das bei uns liegt. Kein
  `not_configured` (es ist nichts einzurichten) und ausdrücklich **kein stiller Rückfall** auf eine
  ersatzweise Kurve.

### 4.2 Neu offen seit dem Bau von B22a (02.09.2026)

- **⚠ Das Zehn-Jahres-Mittel GLÄTTET die Kurve, und das macht die Schätzung optimistisch.** §2.1
  begründet das Mittel über die Genauigkeit des **Jahresertrags** (0,6 % gegen Meteonorm); über die
  **Form** sagt es nichts. Gegen die echte PVGIS-Antwort gemessen (Wien, 10,2 kWp, 90°, Azimut −47,
  H0 4.500 kWh, Speicher 19,2 kWh / 10,6 kW): die gemittelte Kurve erreicht als Spitze **6,18 kW**,
  die zehn Einzeljahre **7,55–8,30 kW**; die Eigenverbrauchs-Ersparnis liegt dadurch bei **€ 428,27**
  statt bei € 408,45 — **4,9 % über dem Mittel der einzeln gerechneten Jahre und über jedem einzelnen
  davon.** Der Report-Hinweis (§2.2 Punkt 1) sollte das **neben** der ± 5,8 %-Streuung nennen.
  Blockiert nichts.
- **Die Kennzeichnung im Analyse-Bündel (§2.2 Punkt 2) ist NICHT gebaut.** Das Bündel trägt
  `inputs`/`result`, aber keinen Lastgang — `pvSource` reist heute nicht mit. Der Nachtrag ist ein
  **Sprung der Bündel-Fassung** und gehört zu dem Schritt, der den Report-Hinweis baut (B22b).

---

## 5. Prüfkriterien für den Abschluss von B22

Ein Bau-Schritt gilt als abgeschlossen, wenn zusätzlich zu Bau, Tests, Typecheck und Lint Folgendes
**gemessen** vorliegt — nicht behauptet:

1. **B22a:** Der Umrechnungskern ist ohne Netz getestet (PVGIS-Antwort als Fixture); die
   Treppenfunktion ist mit einer Wächter-Probe abgesichert (Interpolation eingesetzt ⇒ gezielt Rot);
   `pvSource: 'estimated'` schlägt in `peakShavingBlockers` durch, **mit Gegenbeweis** — derselbe
   Tarif mit Leistungsmessung liefert bei geschätzter PV **€ 0** Spitzenkappungs-Ersparnis und beim
   gemessenen Lastgang eine positive Zahl (Muster: Delta 9b-1, dort € 0,00 gegen € 2.487,60).
2. **B22b:** Ein voller Durchlauf über die **echte** Oberfläche gegen den Production-Build, mit dem
   Kompass→`aspect`-Kreuzcheck als eigener Prüfpunkt: „Südosten" ergibt `aspect −47`, und die
   Übernahme der rohen 133 ist strukturell nicht erreichbar. Der Report-Hinweis ist **im
   Druckmedium sichtbar** (`boundingBox() != null` unter `emulateMedia({ media: 'print' })`).
3. **B22c:** Feld-für-Feld-Abgleich gegen das Papier an mindestens fünf echten Auslegungen, wie er
   für den Rechnungs-Scan am 31.08.2026 gefahren wurde (dort: 20 Felder, 0 falsche Werte, an zwei
   echten Rechnungen). **Ein Stub validiert das JSON-Schema nicht** — die Ablesequalität ist gegen die
   echte API zu messen. Die Prüfdokumente gehören **nicht** ins Repo (dieselbe Regel wie bei den
   Rechnungs- und Preisblatt-Prüfdateien).
