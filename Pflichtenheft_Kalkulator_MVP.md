# Pflichtenheft — Kalkulator MVP

> **Plattform-Kontext:** Peak-Shaving- & Eigenverbrauchs-Plattform (Arbeitstitel; produkt­neutrale Marke, COOLiN GmbH als erster Mandant/Referenz).
> **Dokumenttyp:** Technisches Pflichtenheft für den ersten Bauabschnitt (Kalkulator).
> **Bezug:** Ergänzt und konkretisiert `CLAUDE_PEAKSHAVING.md`. Bei Widerspruch gilt dieses Dokument für den Kalkulator.
> **Stand:** Juli 2026 · Finale Fassung — vollwertiges Produkt, Engine + UI parallel auf voller Infrastruktur (§9) · Sprache: Deutsch (Projektsprache)
>
> **Legende:** `[ANNAHME]` = getroffene Annahme, vor Auslieferung zu bestätigen · `[MARTIN]` = Domänen-Input erforderlich · `[v2]` = bewusst nicht im MVP, aber architektonisch vorzusehen · `[MN]` = neu/geändert aus Martins Review (2.7.).

---

## 0. Zweck & Scope-Grenze

**Zweck des Kalkulators** (Produktname: *Peak Shaving Kalkulator* `[MN]`)**:** Aus einem Lastgang (+ optionalen Zusatzdaten) automatisch berechnen, welche Batterie einem KMU wie viel spart — durch Lastspitzen-Kappung (Leistungspreis), Eigenverbrauchssteigerung **und** tarifbewusstes Laden (günstig laden, später nutzen) `[MN]` — und daraus eine belastbare, transparente Empfehlung + ROI erzeugen. Der Kalkulator ist zugleich Verkaufswerkzeug und produktisierte Potenzialanalyse.

**Vertriebs-/Nutzungskanäle** `[MN]`**:** (a) Installateure und Elektrofachbetriebe als Reseller/White-Label; (b) direkte Kaltakquise bei Endkunden (Tischler, Bäcker, Hotels, Gastro, Handel, Landwirtschaft, Kühlhäuser, EV-Ladeinfrastruktur); (c) Multiplikatoren wie die WKO. Konsequenz für den Kalkulator: Der öffentliche Rechner muss **für Endkunden selbsterklärend** sein (Kanal b/c), nicht nur für Fachpartner — das bestätigt die bestehende Public/Portal-Trennung. Leads aus Direktakquise gehen an COOLiN, Leads über Fachpartner an den jeweiligen Partner (siehe §5.1).

**Zwei Oberflächen, eine Engine.** Die Rechenlogik ist eine reine, deterministische TypeScript-Bibliothek. Sie wird von zwei UIs aufgerufen:
- **Öffentlicher Rechner** (Marketing-Website): läuft **client-side** im Browser, kein Login; die **Verbrauchsdaten verlassen den Browser nicht**. Persistiert wird erst bei bewusster Lead-Abgabe (Kontaktdaten + Einwilligung, §5.1). Top-of-Funnel + Vertrauensvorteil.
- **Portal-Rechner** (eingeloggt): identische Engine, aber persistiert Daten (konsentiert), reicher, mandantenfähig.

**Nicht-Ziele des MVP** (siehe §7 für die vollständige Liste): keine Live-Zähler-Anbindung, kein Rechnungs-OCR, kein Monitoring, kein ML/Predictive, keine Energiegemeinschaften, kein übergreifender Handel, kein VPP-Dispatch, keine Batterie-Steuerung, keine preisgetriebene Entlade-Arbitrage, keine Mehrsprachigkeit.

**Leitprinzip gegen Scope-Creep:** Der MVP rechnet **einen** ehrlichen Business Case für **eine** Batterie-Investition an **einem** Standort. Alles andere ist v2.

---

## 1. Grundprinzipien (nicht verhandelbar)

Diese fünf Prinzipien sind die Konsequenz der bisherigen Analyse und bestimmen jede Detailentscheidung:

1. **Die Rechnung ist die Wahrheit.** Tarifsätze (Leistungspreis €/kW, Netzebene, Arbeitspreise, Abrechnungsmodell) kommen aus der Netzrechnung des Kunden, nicht aus einer gepflegten Tarif-Datenbank. Das macht die Berechnung robust, länderskalierbar und liefert nebenbei Trainingsdaten. Die *Sätze* kommen vom Kunden; das *Wie der Umrechnung* (Spitze → Kosten) ist eine konfigurierbare Strategie in der Engine (§3.5).

2. **Ein Dispatch, eine ehrliche Zahl.** Peak Shaving, Eigenverbrauch und tarifbewusstes Laden `[MN]` konkurrieren um dieselbe Batteriekapazität. Ihre Ersparnisse werden **niemals unabhängig gerechnet und addiert.** Es gibt genau einen simulierten Batterie-Fahrplan; der Report darf die Gesamtersparnis transparent nach Anteilen aufschlüsseln (§3.7), aber nicht doppelt zählen.

3. **Physikalisch korrekte Simulation.** Eine Batterie hat eine Leistungsgrenze (kW) *und* eine Energiegrenze (kWh). Die Simulation ist ein chronologischer Durchlauf über alle Viertelstundenwerte mit mitgeführtem Ladezustand (State of Charge), inkl. Wirkungsgrad und nachlade-induzierter Spitzen. Kein „Peak-Zählen" (§3.6).

4. **Public/Portal-Grenze von Tag 1.** Öffentlicher Funnel dataless & client-side; Datensammlung erst konsentiert im Portal. Multi-Tenancy und Row-Level-Security sind Architektur, nicht Nachrüstung (§2, §4, §5.1).

5. **Transparenz als Verkaufsargument.** Jede Kernzahl ist zur Rechenweise aufklappbar; Annahmen sind editierbar. Keine Black Box (§6.2).

---

## 2. Systemarchitektur & Domain-Struktur

### 2.1 Deployables

| Deployable | Zweck | Charakter | Domain (Vorschlag) |
|---|---|---|---|
| **Website** | Marketing, SEO-Content, öffentlicher Rechner | statisch/SSG-lastig, öffentlich | `www.<produktmarke>` (+ ggf. `coolin-energy.at`) |
| **Portal** | Eingeloggte App: Installateure & Kunden, gespeicherte Analysen, Leads | dynamisch, authentifiziert, Multi-Tenant | `portal.<produktmarke>` |
| **API** | Server-Logik, Persistenz, Auth-Backing | intern | `api.<produktmarke>` *(MVP: Next.js API-Routes; eigene Subdomain optional)* |

`coolin.at` bleibt COOLiNs Beratungs-/Vitrinen-Seite (kann auf die Plattform verlinken). Die Produktmarke ist installateur-neutral (White-Label-fähig).

### 2.2 Skalierungs-Vorgaben (nach oben offen)

- **Subdomain-basierte Mandantenauflösung** vorgesehen: `*.<produktmarke>` für White-Label-Installateure `[v2]`, Custom-Domains pro Mandant `[v2]`. Der Auflösungs-Layer (Subdomain → `tenant_id`) wird von Anfang an so gekapselt, dass das Hinzufügen keine Kern-Änderung erfordert.
- **Engine ist isomorph:** dieselbe TS-Bibliothek läuft im Browser (öffentlich) und auf dem Server (Portal, spätere Batch-Jobs). Keine DOM- oder Node-spezifischen Abhängigkeiten im Engine-Paket.
- **Schwere Berechnungen** laufen im **Web Worker** (öffentlich, kein Tab-Freeze) bzw. asynchron server-seitig (Portal). Uploads gehen über Storage, nicht durch die API (Portal).

### 2.3 Tech-Stack (bestätigt aus `CLAUDE_PEAKSHAVING.md`)

```
Frontend:    Next.js (App Router), TypeScript, Tailwind CSS
Engine:      Reines TS-Paket (framework-frei, isomorph, 100% unit-testbar)
Backend:     Next.js API-Routes (Portal)
DB:          Supabase (PostgreSQL, RLS, Realtime für v2)
Auth:        Supabase Auth (Portal)
Storage:     Supabase Storage (Lastgang-Uploads, Portal)
Charts:      Recharts (Report) / leichtgewichtige SVG-Animation (Marketing-Flows)
Parser:      PapaParse (CSV) + SheetJS/xlsx (XLSX/XLS)
PDF:         Report-Export (Bibliothek in Bauphase festzulegen)
Deployment:  Vercel
```

### 2.4 Repo-Struktur (Vorschlag, Monorepo)

```
/packages/engine        ← reine Rechen-Bibliothek (Herzstück, zuerst gebaut)
/packages/shared        ← Typen, Konstanten, Batterie-/Tarif-Schemata (von beiden UIs genutzt)
/apps/website           ← öffentliche Seite + öffentlicher Rechner (client-side Engine)
/apps/portal            ← eingeloggte App (Engine server- oder client-side)
/supabase               ← Schema, Migrations, RLS-Policies
```

---

## 3. Die Rechen-Engine (Herzstück)

> Reihenfolge **innerhalb der Engine**: Logik + Tests zuerst (§3.11), bevor einzelne Bausteine ans UI verdrahtet werden. Das öffentliche UI (M2) läuft als eigener, paralleler Track — siehe §9.

### 3.1 Eingabe-Datenmodell

Alle Eingaben sind explizite, typisierte Objekte (keine impliziten Defaults im Rechenkern; Defaults liegen im UI-Layer).

```ts
// --- Lastgang (PFLICHT) ---
// Netz-Lastgang am Anschlusspunkt. Signiert: + = Netzbezug, − = Einspeisung.
// Enthält bereits den Effekt vorhandener PV (Eigenverbrauch ist schon "drin").
type LoadProfile = {
  readings: Array<{ ts: string /* ISO, UTC */; gridPowerKw: number }>;
  intervalMinutes: 15;            // validiert; andere Intervalle → Fehler oder Resampling [ANNAHME: nur 15-min im MVP]
  timezoneMeta: string;          // z.B. "Europe/Vienna" (nur Metadatum; Speicherung in UTC)
  source: 'net_signed' | 'import_export_split' | 'import_only';
};
// Klärung `source: 'import_only'`: Ohne Einspeisedaten ist „kein PV" nicht von „PV vorhanden,
// aber nicht separat erfasst" unterscheidbar — die Eigenverbrauchs-Ersparnis fällt im zweiten
// Fall unbemerkt auf ~0. PFLICHT: liegt `source === 'import_only'` UND kein `PvProfile` vor,
// MUSS `dataQuality.warnings` (§3.10) einen expliziten Hinweis enthalten, dass die
// Eigenverbrauchs-/Lastverschiebungs-Ersparnis nicht beurteilbar ist bzw. unterschätzt sein kann.

// --- PV-Erzeugungsprofil (OPTIONAL) ---
// Brutto-PV-Erzeugung vom Wechselrichter. Verbessert Genauigkeit der
// Eigenverbrauchs-Aussage, ist aber NICHT zwingend: Der Netz-Lastgang enthält
// die Einspeisung (negative Werte) bereits als kappbaren Überschuss.
type PvProfile = {
  readings: Array<{ ts: string; pvGenerationKw: number }>;
};

// --- Tarifparameter (aus der Netzrechnung — "Rechnung ist Wahrheit") ---
type TariffParams = {
  leistungspreisEurPerKwYear: number;   // Leistungspreis €/kW/Jahr
  billingModel: BillingModel;           // Strategie, siehe §3.5
  minBillableKw: number;                // Mindestleistung (Sockel, nie unterschreitbar)
  arbeitspreisNetzCtPerKwh?: number;    // Kontext / Energiekostenanteil
  energyPriceCtPerKwh: number;          // Bezugs-Arbeitspreis (für Eigenverbrauchswert)
  energyPriceNightCtPerKwh?: number;    // [MN] optional: Nacht-/Niedertarif → tarifbewusstes Laden (MVP, §3.6/§3.7)
  timeOfUseWindows?: Array<{ from: string; to: string; ctPerKwh: number }>; // [MN] optional, einfache HT/NT-Fenster (MVP)
  dynamicPriceProfile?: unknown;        // [v2] Spot-/dynamische Preise für preisgetriebenes Entladen (Arbitrage)
  einspeiseverguetungCtPerKwh: number;  // Vergütung für ins Netz gespeisten Überschuss (Baseline)
  netzebene?: string;                   // Metadatum
  benutzungsdauerModel?: BenutzungsdauerModel; // §3.5, optional im MVP vereinfachbar
};

// --- Batterie-Kandidat (aus Martins Katalog) ---
type BatteryCandidate = {
  id: string;
  name: string;
  manufacturer: string;
  class: 'residential' | 'commercial';
  usableCapacityKwh: number;      // nutzbare Kapazität (DoD bereits berücksichtigt)
  maxPowerKw: number;             // max. Lade-/Entladeleistung (~ C-Rate × Kapazität)
  roundTripEfficiency: number;    // z.B. 0.88
  pricePerKwh: number;            // residential ~500, commercial ~250 €/kWh [MARTIN]
  inverterIncluded: boolean;      // commercial i.d.R. true, residential i.d.R. false
  extraInverterCost?: number;     // falls separater WR nötig (residential)
  requiresFoundation: boolean;    // commercial i.d.R. true (Betonsockel)
  foundationCost?: number;
  controlType: 'static' | 'dynamic'; // residential oft static, commercial dynamic
};

// --- Förder- & Steuerparameter (alle optional; wirken auf die Amortisation) [MN] ---
// Hinweis: vereinfachte Rechnung, KEINE Steuerberatung. Der Steuereffekt hängt vom
// individuellen Grenzsteuersatz/KöSt des Betriebs ab und wird als solcher gekennzeichnet.
type FinancialParams = {
  fixedSubsidyEur?: number;                // pauschale Zuschüsse / Direktförderung
  subsidyPercent?: number;                 // prozentuale Förderung auf die Investition
  investitionsfreibetragPercent?: number;  // steuerlicher Investitionsfreibetrag (IFB)
  depreciationYears?: number;              // Abschreibungsdauer (AfA)
  taxRatePercent?: number;                 // Grenzsteuersatz / KöSt für den Steuereffekt
  note?: string;
};

// --- Simulations-Konfiguration ---
type SimulationConfig = {
  horizonYears: number;           // Default 10
  dispatchPriority: 'peak_first'; // MVP-Default; 'co_optimized' ist [v2]
};
```

### 3.2 CSV/XLSX-Parsing & Format-Erkennung

Netzbetreiber und Wechselrichter liefern uneinheitliche Formate. Der Parser muss robust und erweiterbar sein.

- **Formate:** CSV, XLSX, XLS. Trennzeichen (`;` vs `,`), Dezimaltrenner (`,` vs `.`), Datums-/Zeitformate automatisch erkennen.
- **Spaltenerkennung:** Zeitstempel + Wert(e). Drei Fälle abbilden: (a) *signed net* (eine Spalte Bezug/Einspeisung), (b) *import/export split* (zwei Spalten), (c) *import only*. Aus (b)/(c) intern nach `gridPowerKw` (signiert) normalisieren.
- **Einheiten:** kW vs kWh unterscheiden. Bei kWh-Viertelstundenwerten Umrechnung `kW = kWh × 4`. Einheit erkennen oder erfragen.
- **Robustheit:** Header-Zeilen, Leerzeilen, BOM, Tausendertrennzeichen tolerieren. Bei Uneindeutigkeit: dem Nutzer die erkannte Struktur **zeigen** und bestätigen/korrigieren lassen (Mapping-Schritt).
- **Mindest-Abdeckung MVP:** Wiener Netze, Netz NÖ, Salzburg Netz `[MARTIN: Musterexporte besorgen]` + gängige Wechselrichter-Exporte (Fronius, SMA, Sungrow) `[MARTIN: was liefern diese als CSV?]`.
- **Sicherheit:** Datei-Größenlimit, Zeilen-Limit, Typ-Validierung. Öffentlich läuft alles client-side (kein Upload); im Portal Upload über Storage + Validierung.

### 3.3 Lastgang-Aufbereitung

- Zeitstempel → UTC normalisieren, lokale Zeitzone als Metadatum halten.
- Viertelstunden-Granularität beibehalten (nicht aggregieren).
- Fehlende Werte erkennen; kleine Lücken interpolieren, große Lücken markieren und im Report als Datenqualitäts-Hinweis ausweisen.
- Plausibilitätsprüfung: Ausreißer, negative Bezugswerte dort wo unerwartet, Zeitstempel-Duplikate/Sprünge.
- Ergebnis: sauberer, lückenloser 15-min-Vektor über den abgedeckten Zeitraum (idealerweise 12 Monate = 35.040 Werte).

### 3.4 Spitzenerkennung & Ist-Kosten

- **Bezugsspitzen** aus dem positiven Anteil von `gridPowerKw`.
- Kennzahlen: Jahreshöchstwert, Monatshöchstwerte (12), Top-N Spitzen mit Zeitstempel, Verteilung (Wochentag/Uhrzeit/Monat).
- **Ist-Kosten Leistungspreis** = `leistungspreisEurPerKwYear × abgerechneter kW-Wert`, wobei „abgerechneter Wert" **vom `billingModel` abhängt** (§3.5), nicht pauschal der Jahreshöchstwert ist.

### 3.5 Tarif-Strategy-Interface (der Kern von Prinzip 1)

Das Abrechnungsmodell ist austauschbar. **Kein hartkodierter „Jahreshöchstwert".**

```ts
type BillingModel =
  | 'annual_max'            // ein Jahreshöchstwert bestimmt alles
  | 'monthly_max_average'   // Mittelwert der 12 Monatshöchstwerte  ← [ANNAHME] AT-Default (Wiener-Netze-Definition)
  | 'monthly_max_sum';      // Summe der 12 Monatshöchstwerte

interface TariffStrategy {
  // liefert den ABGERECHNETEN kW-Wert aus einem (ggf. batterie-modifizierten) Lastgang
  billedKw(loadProfile: LoadProfile, params: TariffParams): number;
}
```

- **`annual_max`:** billedKw = max(Bezug über das Jahr).
- **`monthly_max_average`:** je Monat den Höchstwert bilden, dann die 12 mitteln.
- **`monthly_max_sum`:** je Monat den Höchstwert bilden, dann summieren.
- **Mindestleistung immer zuletzt:** `billedKw = max(computed, minBillableKw)`. Eine perfekte Batterie kann den Sockel nicht unterschreiten.

**Benutzungsdauer-Effekt** `[ANNAHME, im MVP optional aktivierbar]`: Sinkt die Spitze, steigt die Benutzungsdauer (`Jahresarbeit ÷ Jahreshöchstleistung`); überschreitet sie eine Schwelle (z.B. 2.500 h), gilt ggf. eine andere Preisspalte (höherer €/kW, niedrigerer Arbeitspreis). Wenn `benutzungsdauerModel` gesetzt ist, muss die ROI-Rechnung den korrekten €/kW-Satz **nach** der Kappung verwenden. Ist es nicht gesetzt, wird konstanter Satz angenommen und im Report als Vereinfachung gekennzeichnet.

> **Warum das zentral ist:** Bei `monthly_max_average` senkt das Kappen einer einzigen Spitze den abgerechneten Wert nur um ~1/12. Wer hier `annual_max` annimmt, verspricht ein Vielfaches der realen Ersparnis. Der Default und die exakte Umrechnung sind **vor Auslieferung an echten Rechnungen zu validieren** `[MARTIN]`.

### 3.6 Batterie-Simulation (State of Charge)

Chronologischer Durchlauf über alle 15-min-Intervalle mit mitgeführtem Ladezustand `soc ∈ [0, usableCapacityKwh]`.

**Pro Intervall (Dauer Δ = 0,25 h):**
1. Ausgangslast `gridPowerKw` lesen (signiert).
2. **Entladen (Spitzenkappung, Priorität):** Liegt der Bezug über der Kapp-Schwelle `cap` (siehe §3.6.1), entlade so viel wie nötig, begrenzt durch `maxPowerKw` und durch verfügbare Energie `soc`. Reduziert den Netzbezug in diesem Intervall.
3. **Laden aus PV-Überschuss (Eigenverbrauch):** Ist `gridPowerKw < 0` (Einspeisung), lade den Überschuss in die Batterie, begrenzt durch `maxPowerKw` und freien Speicherplatz; Wirkungsgrad `roundTripEfficiency` auf die Ladung anwenden. Verringert die (schlecht vergütete) Einspeisung und erhöht später nutzbare Eigenenergie.
4. **Entladen (Eigenverbrauch, Restkapazität):** In sonnenlosen Bezugsphasen ohne akute Spitze mit **verbleibender** Kapazität Bezug substituieren → spart `energyPrice − einspeisevergütung` je verschobene kWh. „Verbleibend" ist exakt durch die **Spitzen-Reserve** definiert (siehe Kasten unten) — diese Entladung darf `soc` nie unter die Reserve senken.
5. **Laden aus Netz (tarifbewusst):** `[MN]` In Niedriglastfenstern und **nur** wenn die Ladeleistung keinen neuen Bezugspeak über `cap` erzeugt. Sind Niedertarif-/HT-NT-Fenster gesetzt (`energyPriceNightCtPerKwh` / `timeOfUseWindows`), wird **bevorzugt in günstigen Fenstern** geladen. Das dient gleichzeitig der Spitzenbereitschaft (kein Zielkonflikt mit Prio 2) und senkt die Energiekosten (günstig laden → später nutzen). **Preisgetriebenes Entladen** (Spot-Arbitrage) ist bewusst **[v2]**, weil es mit dem Spitzenschutz um Kapazität konkurriert.
6. Ladezustand fortschreiben.

**Constraints (hart):** Entlade-/Ladeleistung ≤ `maxPowerKw`; Energie ≤ `soc` bzw. freier Platz; `soc` stets in `[0, usableCapacityKwh]`; Wirkungsgrad-Verluste beim Laden.

> **Definition „Spitzen-Reserve" (Klärung):** Vor dem kombinierten Dispatch-Lauf wird **einmal pro Abrechnungsperiode** ein reiner Peak-Protection-Lauf simuliert — identisch zu Schritt 2 und der Kapp-Suche (§3.6.1), aber **ohne** Eigenverbrauchs- oder Lastverschiebungs-Entladung. Dessen SoC-Trajektorie `socFloor(t)` ist die Reserve: die minimale Energie, die zu jedem Zeitpunkt `t` im Speicher bleiben muss, damit **alle noch ausstehenden Kappungen der restlichen Periode** garantiert erreichbar sind. Schritt 4 darf `soc(t)` nie unter `socFloor(t)` senken.
>
> `socFloor(t)` ist **kein zweiter Dispatch, der Ersparnis erzeugt** — Prinzip 2 bleibt gewahrt: Es ist ein interner Hilfslauf, der ausschließlich die Untergrenze für Schritt 4 liefert und selbst nicht in `totalSavingPerYear` einfließt.
>
> **Methodische Konsequenz:** `socFloor(t)` wird aus dem **vollständigen** Periodenprofil berechnet (bekannte zukünftige Spitzen im historischen Datensatz). Die daraus resultierende Eigenverbrauchs-/Lastverschiebungs-Ersparnis ist folglich eine **Bestmarke mit vollem Rückblick**, kein Versprechen für eine reale, rein reaktive Steuerung ohne Prognose ([v2] Predictive Dispatch). Der Leistungspreis-/Spitzenschutz-Anteil ist davon **nicht** betroffen — er ist durch eine einfache Schwellenwert-Regel (Schritt 2) auch reaktiv erreichbar. **Pflicht:** Report weist diesen Unterschied aus (§6.2).

#### 3.6.1 Kapp-Schwellen-Suche (das eigentlich schwierige Teilproblem)

Für eine gegebene Batterie ist die interessante Frage: **Wie tief kann die Kapp-Schwelle `cap` gesenkt werden, ohne dass die Batterie an irgendeiner Spitze leerläuft?**

- **Verfahren:** Binäre Suche über `cap` je Abrechnungs-Bezugsperiode (bei `monthly_*` je Monat, bei `annual_max` über das Jahr). Für einen Kandidatenwert `cap` die Simulation (§3.6) durchlaufen und prüfen: Musste die Batterie je über `cap` hinaus Bezug zulassen, weil `soc` erschöpft oder `maxPowerKw` überschritten war? Wenn nein → `cap` machbar, tiefer suchen; wenn ja → höher.
- Ergebnis: niedrigste machbare `cap` je Periode → daraus der **neue abgerechnete kW-Wert** via `TariffStrategy` (§3.5), inkl. Mindestleistung.
- Bei `monthly_max_average`: die 12 machbaren Monats-Caps mitteln.
- **Periodengrenzen (Klärung):** Die Suche läuft in **einem durchgehenden chronologischen Lauf über das ganze Jahr**, nicht als 12 unabhängige Simulationen mit zurückgesetztem Ladezustand — das wäre inkonsistent mit Prinzip 3 (die Batterie „vergisst" ihren Zustand nicht am Monatsersten um 00:00). Die Monats-Caps werden daher **sequenziell** bestimmt: Cap für Monat 1 per Binärsuche fixieren (Start-SoC siehe unten), den daraus resultierenden **echten** End-SoC nach Monat 1 übernehmen, damit Cap für Monat 2 suchen, usw. Gilt analog für `monthly_max_sum`; bei `annual_max` entfällt die Frage, da nur eine Periode existiert.
- **Start-SoC 1.1. `[ANNAHME]`:** 50 % der nutzbaren Kapazität (neutrale Konvention, kein Bias Richtung „voll"/„leer"). Die Auswirkung dämpft sich durch laufendes Zyklieren selbst und bleibt auf die ersten Tage begrenzt — bei einem ungewöhnlich hohen Peak in den ersten Januar-Tagen kann sie bei `monthly_max_average` bis zu 1/12 des Jahres-Caps verzerren; vor Auslieferung gegen Martins echtes Profil gegenprüfen.

> Dies ist der Teil, der über Glaubwürdigkeit entscheidet, und der **zuerst gegen Martins echten Lastgang validiert wird** (OP #1/#3 in §8, Gate in §9, Akzeptanzkriterien §10).

### 3.7 Kombinierter Dispatch → eine Zahl

Aus dem einen Simulationslauf (§3.6) ergeben sich alle Effekte gleichzeitig:
- `leistungspreisSavingPerYear` = (alter abgerechneter kW − neuer abgerechneter kW) × `leistungspreisEurPerKwYear`.
- `selfConsumptionSavingPerYear` = Σ (durch Batterie verschobene kWh von Einspeisung→Eigenverbrauch) × (`energyPrice − einspeisevergütung`).
- `loadShiftSavingPerYear` `[MN]` = Σ (aus günstigem Tarif-Fenster geladene und in teurem Fenster genutzte kWh) × (`teurer − günstiger` Tarif). Nur wenn Tarif-Fenster gesetzt sind; sonst 0.
- `totalSavingPerYear` = Summe **aus demselben Fahrplan** (keine unabhängige Doppelrechnung).

Der Report weist die Anteile getrennt aus (Transparenz), betont aber die **eine** Gesamtzahl. Priorität `peak_first`: Spitzenschutz hat Vorrang, weil eine verpasste Spitze eine ganze Periode kostet; Eigenverbrauch und Lastverschiebung nutzen nur die verbleibende Kapazität und dürfen die Spitzen-Reserve nie gefährden.

### 3.8 Batterie-Empfehlung

- Simulation für **alle** Kandidaten aus dem Katalog (nicht nur kWh-Stufen, sondern konkrete Modelle inkl. Klasse).
- Ranking nach bestem Kosten-Nutzen (z.B. Amortisation / Netto-Ersparnis über Horizont).
- **Empfehlung = ein prominenter Kandidat + 2–3 aufklappbare Alternativen** (gibt dem Installateur Verhandlungsspielraum, ohne die Hauptaussage zu verwässern).
- **Warnhinweise** offen mitführen, z.B.: „statische Steuerung — kappt Spitzen nur eingeschränkt" `[MARTIN: bestätigen, ob rein statische Residential-Batterie überhaupt sinnvoll Spitzen kappt — Kernannahme des Algorithmus]`; „Betonsockel nötig (+€X)"; „separater Wechselrichter nötig (+€X)"; „Leistung des Kandidaten reicht nicht für alle Spitzen".

### 3.9 ROI & Förderung

- `totalInvestment` = `usableCapacityKwh × pricePerKwh` + ggf. `foundationCost` + ggf. `extraInverterCost`.
- **Förder- & Steuereffekte** aus `FinancialParams` `[MN]` (alle optional, transparent ausgewiesen):
  - `subsidyAmount` = `fixedSubsidyEur` bzw. `subsidyPercent × totalInvestment` (direkte Förderung, mindert die Investition).
  - `taxBenefit` = Steuereffekt aus **Investitionsfreibetrag** (IFB) und **Abschreibung** (AfA) — vereinfacht: `(investitionsfreibetragPercent × totalInvestment + jährliche AfA) × taxRatePercent`, über den Betrachtungszeitraum. **Kennzeichnung als vereinfachte Rechnung, keine Steuerberatung**; hängt vom `taxRatePercent` des Betriebs ab (`[MARTIN]`/`[ANNAHME]` sinnvolle Defaults + Quelle).
  - **Ohne Angabe (Klärung):** Sind `FinancialParams`-Felder nicht gesetzt, wird `subsidyAmount`/`taxBenefit` intern als `0` berechnet — **aber** im Ergebnis über das Flag `taxEffectsIncluded` (§3.10) von „geprüft und Null" unterschieden. Report/UI zeigen dann **keine** Zeile „steuerlicher Vorteil: €0" (suggeriert eine Prüfung, die nicht stattfand), sondern lassen den Posten aus bzw. kennzeichnen „keine Angabe". Verhindert, dass eine synthetische oder unvollständige Eingabe einen nicht validierten Steuervorteil vorgaukelt.
- `netInvestment` = `totalInvestment − subsidyAmount − taxBenefit`.
- `amortizationYears` = `netInvestment ÷ totalSavingPerYear`.
- `netSavingOverHorizon` = `totalSavingPerYear × horizonYears − netInvestment`.
- **Finanzierungsmodelle:** Kauf (Einmalinvestment) im MVP; **Subscription/Contracting als Vergleichsansicht** vorsehen (monatliche Rate statt CAPEX) `[ANNAHME: einfache Gegenüberstellung im MVP, detaillierte Contracting-Modelle v2]`.

### 3.10 Engine-Ausgabe-Contract

```ts
type AnalysisResult = {
  current: {
    annualPeakKw: number;
    monthlyPeaksKw: number[];      // 12
    billedKw: number;              // gem. billingModel
    leistungspreisCostPerYear: number;
  };
  peaks: { top: Array<{ ts: string; kw: number }>; distribution: /* … */ };
  perBattery: Array<{
    battery: BatteryCandidate;
    newBilledKw: number;
    leistungspreisSavingPerYear: number;
    selfConsumptionSavingPerYear: number;
    loadShiftSavingPerYear: number;     // [MN] tarifbewusstes Laden; 0 ohne Tarif-Fenster
    totalSavingPerYear: number;
    totalInvestment: number;
    subsidyAmount: number;
    taxBenefit: number;                 // [MN] Effekt aus IFB + AfA (vereinfacht)
    taxEffectsIncluded: boolean;        // false = FinancialParams nicht gesetzt → taxBenefit=0 bedeutet "keine Angabe", nicht "geprüft"
    netInvestment: number;
    amortizationYears: number;
    netSavingOverHorizon: number;
    warnings: string[];
    dispatchTrace?: /* aggregierte Zeitreihe für Charts */;
  }>;
  recommendation: { batteryId: string; rationale: string };
  assumptions: {                    // für Transparenz-Panel & Editierbarkeit
    roundTripEfficiency: number;
    horizonYears: number;
    energyPriceCtPerKwh: number;
    einspeiseverguetungCtPerKwh: number;
    billingModel: BillingModel;
    // …
  };
  dataQuality: { coveredDays: number; gapsInterpolated: number; warnings: string[] };
};
```

Die Engine ist **rein**: gleiche Eingabe → gleiche Ausgabe, keine Seiteneffekte, kein I/O. 100% unit-testbar mit synthetischen und echten Lastgängen.

### 3.11 Test-Strategie (Fixtures) — Voraussetzung für das M1-Gate

Ein einzelnes synthetisches Profil reicht **nicht**: Es testet nur Spitzenkappung (Schritt 2) und lässt zwei der drei Ersparnis-Komponenten aus Prinzip 2 (Eigenverbrauch, tarifbewusstes Laden) bei jedem Testlauf unbemerkt auf 0 stehen — das fiele frühestens bei Martins realen (meist PV-haltigen) Daten auf, also **nach** dem M1-Gate statt davor.

**Mindestens drei synthetische Lastprofile** (z. B. Bäckerei mit Morgen-Ramp):
1. **Basis** — kein PV, flacher Tarif. Testet ausschließlich Spitzenkappung (Schritt 1–2, §3.6.1).
2. **Basis + PV-Profil** — testet den Eigenverbrauchs-Pfad inkl. Spitzen-Reserve (Schritt 3–4).
3. **Basis + HT/NT-Tarif-Fenster** — testet tarifbewusstes Laden (Schritt 5, `loadShiftSavingPerYear`).

**Zusätzlich (Regressionstest Tarif-Strategie, §3.5):** dieselben Profile einmal mit `billingModel: 'annual_max'` und einmal mit `'monthly_max_average'` rechnen. Erwartung: Die Ersparnis unter `monthly_max_average` liegt spürbar unter der unter `annual_max` (Kappung eines einzelnen Peaks senkt den Mittelwert nur um ~1/12) — bestätigt die zentrale Tarif-Korrektheits-These aus §3.5 im Code, nicht nur auf dem Papier.

Erst wenn alle vier Kombinationen grün sind, gilt M1 als „getestet" im Sinne von §9/§10 — unabhängig davon, ob Martins echter Datensatz schon vorliegt.

---

## 4. Datenmodell / Supabase-Schema

**Grundsatz:** Öffentlicher Funnel schreibt nichts (client-side). Erst bei Lead-Abgabe entsteht ein Datensatz. Im Portal gilt RLS, Mandant = Installateur.

### 4.1 Öffentliches Lead-Schema (nicht mandantiert)

```sql
-- Kalkulator-Nutzung persistiert NUR bei bewusster Lead-Abgabe mit Einwilligung.
-- Kein Tenant, restriktiver Insert-Only-Zugriff, Rate-Limit auf API-Ebene.
leads (
  id                uuid pk,
  created_at        timestamptz,
  contact_name      text,               -- Pflichtfeld [MN]
  contact_email     text,               -- Pflichtfeld [MN]
  contact_phone     text,
  contact_function  text,               -- [MN] Funktion/Rolle im Unternehmen (Pflichtfeld)
  company           text,               -- [MN] Unternehmen
  site_type         text,               -- 'bakery' | 'restaurant' | 'carpenter' | 'hotel' | 'retail' | …
  region            text,
  consent_dsgvo     boolean,            -- [MN] explizite Einwilligung (nicht vorausgewählt), Pflicht
  consent_at        timestamptz,        -- [MN] Zeitpunkt der Einwilligung
  consent_version   text,               -- [MN] Version der Datenschutzerklärung/Einwilligungstext
  lead_channel      text,               -- [MN] 'direct' (→ COOLiN) | 'partner' (→ installer)
  analysis_snapshot jsonb,              -- AnalysisResult zum Zeitpunkt der Abgabe (mit Consent)
  raw_load_data_ref text,               -- optionaler Storage-Verweis, NUR bei separater Consent
  status            text,               -- 'new' | 'assigned' | 'contacted' | 'closed'
  assigned_installer_id uuid null       -- Promotion ins Mandanten-Schema
)
```

### 4.2 Mandanten-Schema (RLS, Tenant = `installer_id`)

```sql
installers (
  id uuid pk, name text, company text, region text,
  white_label_config jsonb,            -- Branding, Subdomain/Domain [v2]
  created_at timestamptz
)

sites (
  id uuid pk,
  installer_id uuid fk → installers,   -- Tenant-Schlüssel (RLS)
  name text, type text,                -- Site-Typ von Anfang an taggen (ML-Fundament)
  netzbetreiber text,
  tariff_params jsonb,                 -- aus der Rechnung
  created_at timestamptz
)

load_data (                            -- kritisch: von Tag 1 persistieren (konsentiert)
  id uuid pk,
  site_id uuid fk → sites,
  ts timestamptz,                      -- IMMER UTC
  grid_power_kw numeric,
  source text                          -- 'csv_upload' | 'live_meter'[v2] | 'api'[v2]
)

pv_data (                              -- optional
  id uuid pk, site_id uuid fk, ts timestamptz, pv_generation_kw numeric
)

analyses (                             -- gecachte Ergebnisse
  id uuid pk, site_id uuid fk,
  calculated_at timestamptz,
  result jsonb                         -- AnalysisResult
)
```

### 4.3 Referenzdaten (plattform-eigen, read-mostly)

```sql
battery_catalog (                      -- Martins Katalog; später pro Mandant überschreibbar [v2]
  id uuid pk, name text, manufacturer text, class text,
  usable_capacity_kwh numeric, max_power_kw numeric,
  round_trip_efficiency numeric, price_per_kwh numeric,
  inverter_included bool, extra_inverter_cost numeric,
  requires_foundation bool, foundation_cost numeric,
  control_type text, active bool
)

-- Optional: bekannte Tarif-Profile als Vorbelegung (die WAHRHEIT bleibt die Rechnung).
tariff_profiles (
  id uuid pk, netzbetreiber text, netzebene text,
  billing_model text, min_billable_kw numeric,
  default_leistungspreis_eur_kw_year numeric, valid_from date, source_note text
)
```

**RLS-Policies:** Für alle Mandanten-Tabellen `installer_id`-Isolation (direkt oder via Join auf `sites`). Referenzdaten öffentlich lesbar, schreibend nur Admin. `leads` insert-only für den öffentlichen Client, lesend nur Admin/zugeordneter Installateur.

---

## 5. Kalkulator-Flow (öffentliche Oberfläche)

Vier Schritte, intuitiv, mobil-/tablet-tauglich:

1. **Lastgang hochladen** — CSV/XLSX. Auto-Erkennung von Format & Struktur; bei Uneindeutigkeit Mapping-Bestätigung. Client-side, kein Upload ans Backend.
2. **Tarif & Ziel** — Werte aus der Netzrechnung eintragen (Leistungspreis, Netzebene, Abrechnungsmodell-Auswahl, Arbeitspreis, Einspeisevergütung, optional Niedertarif-/HT-NT-Fenster `[MN]`). PV-Profil optional hochladen. Optional: Förderung, Investitionsfreibetrag, Abschreibung `[MN]`. Sinnvolle Defaults, alle editierbar.
3. **Analyse läuft** — Web Worker, ohne Tab-Freeze, kurzer Fortschritt.
4. **Ergebnis** — Report (§6). CTA: „Kostenloses Angebot anfordern" → Lead-Erfassung (§5.1). Nur hier entsteht ein persistenter Datensatz, mit Einwilligung.

### 5.1 Lead-Erfassung, Einwilligung & Datenschutz `[MN]`

Ausgelöst durch Martins Review. **Pflichtfelder** bei Lead-Abgabe: Name, E-Mail, **Funktion/Rolle im Unternehmen**, Unternehmen; optional Telefon. Ohne explizite **DSGVO-Einwilligung** (Checkbox, *nicht* vorausgewählt, mit Link zur Datenschutzerklärung) kann kein Lead abgesendet werden.

**Präzise Datentrennung** (löst den scheinbaren Widerspruch „Kontaktdaten erfassen" vs. „nur anonym verarbeiten" auf):
- **Verbrauchsdaten (Lastgang/PV):** werden im öffentlichen Rechner **client-side** verarbeitet und **nicht an den Server übertragen**. Das ist die ehrliche, kommunizierbare Aussage — kein pauschales „anonym".
- **Kontaktdaten:** sind personenbezogen; sobald Name/Funktion/Firma erfasst werden, ist die Person **nicht anonym**. Erfassung nur mit expliziter Einwilligung und klarer Zweckbindung (Kontaktaufnahme durch COOLiN bzw. den Fachpartner).
- **Optionaler Analyse-Snapshot / Rohdaten-Upload:** nur mit **separater, zusätzlicher** Einwilligung (z. B. „Analyse für ein Angebot speichern"). Für spätere Modell-/Auswertungszwecke werden diese Daten pseudonymisiert bzw. aggregiert.

**Kommunizierte Formulierung (Vorschlag, rechtlich final zu prüfen):** „Ihre Verbrauchsdaten werden ausschließlich in Ihrem Browser zur Berechnung verwendet und nicht übertragen. Ihre Kontaktdaten speichern wir nur mit Ihrer Einwilligung, um Sie zu einem Angebot zu kontaktieren."

`[MARTIN/rechtlich]` Datenschutzerklärung + finaler Einwilligungstext (Versionierung via `consent_version`) sind vor Livegang zu erstellen — siehe §8.

---

## 6. UI, Design & Report-Spezifikation

### 6.1 Design-Prinzipien (bindend, beide Oberflächen)

**Zwei Oberflächen, gegensätzlicher Charakter — bewusst nicht identisch gestalten:**
- **Öffentlicher Rechner (§5):** darf glänzen und animieren (Energiefluss-Visualisierung); Ziel ist Konversion + Vertrauen. **Mobile-first** — ein Endkunde stößt oft auf dem Handy darauf.
- **Report (§6.2) + Portal:** ruhig, datendicht, seriös; kein verspieltes Dashboard bei einer Investitionsentscheidung über fünfstellige Beträge. **Desktop-first, Tablet Pflicht** (Installateur zeigt den Report am Tablet beim Kunden vor Ort); Mobile nur als reduzierte Read-Only-Ansicht.

**Weitere bindende Regeln:**
- **Akzentfarbe als CSS-Variable** — White-Label: Fachpartner setzen ihre Markenfarbe. Nie hartkodiert.
- **Farbe im Report ist Information, kein Dekor:** semantische Farben (Ersparnis grün, Kosten/Warnung rot/bernstein) sparsam einsetzen, damit die Signalwirkung erhalten bleibt.
- **Tabellarische Ziffern** (`font-variant-numeric: tabular-nums`) für alle Finanz-/Lastwerte — Pflicht, sonst springen Beträge in Spalten und lassen sich nicht vergleichen.
- **Komponenten:** anpassbare Primitives, deren Code im Repo liegt (kein Fremd-Look, barrierefrei) — Voraussetzung für White-Label.
- Animation nur auf der Marketing-Seite, sparsam; der Report bleibt statisch-ruhig.

**Konkrete Tokens (Farben, Fonts, Bibliotheken, Referenz-Tools): siehe `DESIGN.md`.** Bewusst ausgelagert, weil sie sich schneller ändern als die Fachlogik und pro White-Label-Partner variieren.

### 6.2 Report-Spezifikation

**Charakter:** ruhig, datendicht, seriös (Investitionsentscheidung, kein verspieltes Dashboard). Verspielte/animierte Energieflüsse gehören auf die **Marketing-Seite**, nicht in den Ergebnis-Report.

**Kern-Kennzahl (oben, „die weh tut"):**
> „Ihre teuerste Lastspitze: X kW — Mehrkosten: €Y/Jahr."

**Empfehlungs-Karte:** Modell + Klasse, Kosten (inkl. Sockel/Wechselrichter), jährliche Ersparnis (aufgeschlüsselt Spitze/Eigenverbrauch), Amortisation, offene Warnhinweise.

**Charts (nach Wichtigkeit):**
1. **Lastgang mit Kapp-Linie** — Kurve, teuerste Spitzen markiert, Kapp-Schwelle eingezeichnet. **Anklickbar:** Klick auf Spitze → Detail (Zeitpunkt, kW, Kosten, ob abgefangen).
2. **Kostenvergleich mit/ohne Batterie** über Horizont — Leistungspreis- und Eigenverbrauchsanteil getrennt sichtbar.
3. **Tages-Energiefluss** (Netz/PV/Batterie/Verbrauch über 24 h) — hier ist eine leichte Interaktion/Animation sinnvoll.

**Transparenz & Interaktivität (Abhebung von Batterierechner):**
- **Jede Kernzahl aufklappbar zur Rechenweise** (Annahmen + Formel).
- **Editierbares Annahmen-Panel** (Wirkungsgrad, Entladetiefe, Batteriepreis, Abschreibung, Förderung, Abrechnungsmodell) → Ergebnis rechnet live neu.
- **2–3 Alternativen** zur Empfehlung aufklappbar.
- **Hindsight-Hinweis (Pflicht, §3.6):** Beim Eigenverbrauchs-/Lastverschiebungs-Anteil ein unaufdringlicher Hinweis, dass dieser Wert mit vollem Rückblick auf das Jahresprofil berechnet ist (Bestmarke) und eine reale, rein reaktive Steuerung ohne Prognose ([v2] Predictive Dispatch) davon abweichen kann. Der Leistungspreis-/Spitzenschutz-Anteil ist davon **nicht** betroffen.

**Export:** PDF-Report (Installateur nimmt etwas zum Dalassen mit) + CSV-Export der Ergebnistabelle. **Responsive** (Tablet beim Kunden vor Ort).

---

## 7. Was NICHT im MVP ist (bewusst)

`[v2]`-Aufsätze, architektonisch vorzusehen, aber jetzt nicht gebaut und **nicht** entscheidungsleitend:

- Live-Anbindung Zähler/Wechselrichter (Modbus/REST), Echtzeit-Monitoring, regelbasiertes/ML-Dispatch, Batterie-Steuerung.
- Rechnungs-Upload mit OCR (MVP: Werte manuell eintippen).
- Mathematische Ko-Optimierung von Peak/Eigenverbrauch/Lastverschiebung (MVP: priorisierte Heuristik).
- Preisgetriebenes **Entladen** / Spot- bzw. dynamische Preis-Arbitrage `[MN]` (tarifbewusstes **Laden** ist im MVP, §3.6/§3.7).
- Energiegemeinschaften, umspannwerkübergreifender Handel, VPP-Dispatch-Signal (nur **ein** Architektur-Haken: der spätere Controller kann ein externes Dispatch-Signal empfangen).
- White-Label-Subdomains/Custom-Domains, mandanten-eigene Batteriekataloge/Tarife.
- ESG/CSRD-Export der Report-Zahlen.
- Mobile Upload-Alternativen (Foto der Rechnung / OCR, „Analyse auf Desktop fortsetzen"-Link) — der Datei-Upload im MVP ist Desktop-orientiert.
- Mehrsprachigkeit / DE-/CH-Tarifpakete (Engine ist vorbereitet, Daten kommen später).

---

## 7a. Anstehende Bauabschnitte aus `Fahrplan_2026.md`

Seit 20.07.2026 ist `Fahrplan_2026.md` (Repo-Root) kanonisch für Reihenfolge/Umfang aller Bauabschnitte. Drei davon betreffen den Kalkulator direkt:

- **B10 — Kalkulator ans Entitlement-System.** Löst den separaten, DB-losen Zugangscode (`lib/kalkulator-access.ts`) ab und hängt den Kalkulator an dieselbe `platform.entitlements`-Infrastruktur, die der Monitor-Bauabschnitt T4-1 gebaut hat. Vorbedingung für jede Fachbetriebs-Lizenz.
- **B11 — Kalkulator auf Verordnungssätze umstellbar machen.** Tarifsätze als konfigurierbare Datenschicht statt hartkodierter Annahmen, damit eine Sätze-Änderung (z. B. Nov/Dez 2026) eine Konfigurationsänderung ist, kein Umbau unter Zeitdruck.
- **B14 — Analyse-Persistenz (HOCH PRIORISIERT, muss vor der ersten Pilotanalyse stehen).** Auslegung und Prognose-Baseline serverseitig speichern. Der Kalkulator speichert heute nichts serverseitig (localStorage; §4-Supabase-Schema ist spezifiziert, aber noch nicht ans Portal angebunden). Jede Pilot- oder 990-€-Analyse ohne B14 erzeugt eine Baseline, die verloren geht — relevant für den späteren Wirkungsnachweis (2027), dessen Alleinstellungsmerkmal genau diese Baseline ist.

Die fachliche Tiefe zu B10/B11/B14 wird hier ergänzt, sobald der jeweilige Abschnitt ansteht — nicht auf Vorrat.

---

## 8. Offene Punkte & Martin-Abhängigkeiten

| # | Punkt | Owner | Blockiert |
|---|---|---|---|
| 1 | **Ein echter Kunde:** Lastgang + echte Netzrechnung (+ idealerweise Batterie-Angebot) | Martin | Validierung der Engine, glaubwürdige Demo |
| 2 | Starter-Batteriekatalog (Felder gem. §3.1 `BatteryCandidate`), einige Residential + Commercial | Martin | Empfehlungslogik |
| 3 | Exakte Leistungspreis-Umrechnung Spitze→Kosten je Netzbetreiber (Wiener Netze, Netz NÖ, Salzburg): Modell + Mindestleistung + Benutzungsdauer | Martin | ROI-Korrektheit, `billingModel`-Default |
| 4 | CSV-Musterexporte der 3 Netzbetreiber **und** gängiger Wechselrichter (Fronius/SMA/Sungrow) | Martin | Parser-Abdeckung, Eigenverbrauchs-Genauigkeit |
| 5 | Bestätigung: Kappt eine rein **statische** Residential-Batterie sinnvoll Spitzen? | Martin | Kernannahme Empfehlungs-Algorithmus |
| 6 | Produktmarke/Domain final (mit Martin querchecken) | Beide | nur Domain-Konfiguration, nicht die Engine |
| 7 | `[MN]` Bestätigung Arbitrage-Staffelung: tarifbewusstes **Laden** im MVP, preisgetriebenes **Entladen** erst v2 | Beide | Dispatch-Scope §3.6/§3.7 |
| 8 | `[MN]` Datenschutzerklärung + finaler Einwilligungstext (DSGVO), Versionierung; präzise Datentrennung statt „alles anonym" | Beide/rechtlich | Livegang öffentlicher Rechner + Lead-Erfassung |
| 9 | `[MN]` Steuer-/Abschreibungslogik: sinnvolle Default-Werte und Quelle für `taxRatePercent`/AfA (keine Steuerberatung) | Martin | Belastbarkeit der Amortisation |
| 10 | `[MN]` Lead-Routing Direktakquise (→ COOLiN) vs. Fachpartner (→ Installateur): Zuordnungsregel bei mehreren Kanälen | Beide | Lead-Zuweisung §4.1/§5.1 |

---

## 9. Baureihenfolge / Meilensteine

**Wir bauen ein vollwertiges Produkt — Engine und UI vollständig, in Produktionsqualität, auf echter Infrastruktur (eigene Domain, Supabase, Next.js, Vercel) von Anfang an.** `[Entscheidung Andreas, 2.7.]` Kein Debug- oder Zwischenschritt, kein gestuftes Rollout. Umfang bleibt der bereits spezifizierte MVP-Scope (§0–§6); die `[v2]`-Liste in §7 bleibt bewusst draußen.

1. **M1 — Engine-Kern** (`/packages/engine`): Typen, Parser (Grundfälle), Aufbereitung, `TariffStrategy`, SoC-Simulation + Kapp-Suche + Spitzen-Reserve, ROI. Rein & getestet gegen die synthetischen Fixtures aus §3.11 (nicht nur ein Profil).
2. **M2 — Öffentlicher Rechner** (`/apps/website`) inkl. Report (§6.2): **läuft parallel zu M1**, volles UI nach DESIGN.md/§6.1, gegen den spezifizierten Engine-Contract (§3.10). Wächst inhaltlich mit der Engine mit (erst Spitzenerkennung, dann Eigenverbrauch, dann ROI), bleibt dabei UI-seitig vollständig.
3. **M3 — Lead-Pfad**: `leads`-Tabelle, Consent, CTA → Installateur.
4. **M4 — Portal-Grundgerüst** (`/apps/portal`): Supabase Auth, RLS-Schema, gespeicherte Analysen, Batteriekatalog aus DB.

Reihenfolge innerhalb der Engine (M1): Logik zuerst, testbar (§3.11), dann UI-Verdrahtung. M1–M4 sonst parallele Tracks, kein Nacheinander.

**Einzige verbleibende Bedingung, unverändert seit §1 Prinzip 1/5 — Umsetzung liegt bei Andreas, nicht in dieser Spec vorgeschrieben:** Solange die Engine nicht gegen Martins echten Referenzfall validiert ist (§8 OP#1/#3), sind berechnete Ersparniszahlen nicht belastbar. Das blockiert **nicht** den Bau, nur Aussagen gegenüber echten Kunden.

---

## 10. Akzeptanzkriterien (Definition of Done, MVP)

Der Kalkulator-MVP ist fertig **und glaubwürdig**, wenn:

- Die Engine für Martins **echten** Lastgang eine Leistungspreis-Ist-Kostenzahl liefert, die zur **echten Netzrechnung passt** (Abweichung erklärbar).
- Die simulierte Batterie-Ersparnis nach `[MARTIN]`-Einschätzung **realistisch** (nicht zu optimistisch) ist — Peak- und Eigenverbrauchsanteil aus **einem** Dispatch, nicht addiert.
- Der Parser mindestens die drei Ziel-Netzbetreiber-Formate + gängige Wechselrichter-Exporte verarbeitet.
- Der Report die Kern-Zahl, die klassenbasierte Empfehlung inkl. Warnhinweise, die drei Charts (Lastgang-Chart anklickbar), das editierbare Annahmen-Panel und PDF-Export enthält.
- Der öffentliche Rechner ohne Login, ohne Upload, ohne Tab-Freeze läuft und nur bei bewusster Lead-Abgabe Daten speichert.
- Das Schema RLS-mandantenfähig und subdomain-auflösungs-bereit ist, ohne dass v2-Features gebaut sind.
- Alle vier Fixture-Kombinationen aus §3.11 grün sind (nicht nur ein einzelnes Testprofil).
- `dataQuality.warnings` bei `source: 'import_only'` ohne PV-Profil den vorgeschriebenen Hinweis enthält (§3.1), und der Report den Hindsight-Hinweis (§6.2) beim Eigenverbrauchs-/Lastverschiebungs-Anteil zeigt.

---

*Änderungen an diesem Pflichtenheft werden versioniert. Diese Fassung integriert Martins Review vom 2.7. (`[MN]`) sowie die Klärung zweier struktureller Konzeptlücken (SoC-Periodengrenzen §3.6.1, Definition „Spitzen-Reserve" §3.6) plus Test-Strategie (§3.11), ausgelöst durch Rückfragen der Entwicklungs-Session. Getroffene Annahmen (`[ANNAHME]`) sind vor Auslieferung an echten Daten zu bestätigen; offene Punkte (§8) sind die realen Blocker — nicht der Code.*
