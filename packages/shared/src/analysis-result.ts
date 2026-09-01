import type { BatteryCandidate } from './battery'
import type { BillingModel } from './tariff'
import type { TariffOptimizationStatus } from './tariff-pricing'

/**
 * [ANNAHME, fixiert mit §3.4-Implementierung] Verteilung der Bezugsspitzen für die
 * Report-Aufschlüsselung nach Wochentag/Uhrzeit/Monat. Bucket-Semantik: der
 * MAXIMALE Bezug (kW) innerhalb des Buckets über den gesamten abgedeckten Zeitraum —
 * bewusst nicht Anzahl der Intervalle und nicht aufsummierte Energie. Begründung:
 * für Peak Shaving ist relevant, WANN hoch belastete Zeitfenster liegen (z.B.
 * Morgenspitze einer Bäckerei), nicht wie oft irgendein Bezugswert > 0 vorkommt.
 * Wochentag-Index 0=Montag..6=Sonntag, Monat-Index 0=Jänner — beide nach lokaler
 * Zeit (`LoadProfile.timezoneMeta`), nicht UTC.
 */
export type PeakDistribution = {
  byWeekday: number[] // 7 (Mo..So), Max-kW je Wochentag
  byHour: number[] // 24, Max-kW je Stunde
  byMonth: number[] // 12, Max-kW je Monat
}

/**
 * PROVISORISCH (§3.10 / §6.2) — speist die drei Report-Charts.
 *
 * Bewusster Zuschnitt (Vorschlag, siehe Handover): trägt NUR die Größen, die die UI
 * NICHT selbst aus dem bereits geparsten Lastgang ableiten kann — Kapp-Schwellen,
 * Spitzen-Overlays und die SoC-/Batterie-Zerlegung eines repräsentativen Tages.
 * KEINE Duplikation der bis zu 35.040 15-min-Rohpunkte: die UI besitzt den Lastgang
 * bereits client-side; Downsampling der Jahresübersicht bleibt UI-Sache (DESIGN.md:
 * uPlot/Downsample bei Performance-Bedarf).
 */
export type DispatchTrace = {
  /** Chart 1: Kapp-Schwelle je Abrechnungsperiode (1 bei `annual_max`, 12 bei `monthly_*`). */
  capKwByPeriod: number[]
  /** Chart 1: welche der `peaks.top` wurden abgefangen (anklickbare Spitzen-Details, §6.2). */
  caughtPeaks: Array<{
    ts: string
    originalKw: number
    residualKw: number
    caught: boolean
  }>
  /**
   * Chart 3 (Tages-Energiefluss): repräsentative Tage in voller 15-min-Auflösung.
   * Batterieleistung + SoC sind Simulations-Interna und NUR hier verfügbar; die
   * übrigen Charts kommen ohne Rohreihe aus.
   *
   * Deterministische Auswahl (PROVISORISCH markiert, aber NICHT ermessensoffen —
   * die Auswahl ist eine fachliche Aussage, keine UI-Kosmetik; U2 trifft sie nicht still):
   * - `label: 'worst_caught_peak'` — PFLICHT: der Tag der teuersten ABGEFANGENEN Spitze.
   *   Zeigt den Peak-Shaving-Kernfall (die Batterie fängt die teuerste Spitze ab).
   * - `label: 'pv_strong'` — OPTIONAL: ein PV-starker Tag für den Eigenverbrauchs-Fall.
   * Reihenfolge/Vorhandensein: der Pflicht-Tag ist immer enthalten; der PV-Tag nur,
   * wenn ein PvProfile bzw. Einspeisung vorliegt.
   */
  representativeDays: Array<{
    date: string // ISO-Datum des Tages
    label: 'worst_caught_peak' | 'pv_strong'
    intervals: Array<{
      ts: string
      gridPowerKw: number // nach Batterie
      /**
       * Brutto-PV-Erzeugung (kW, ≥ 0) bei vorhandenem PvProfile; ohne PvProfile die am Zähler
       * sichtbare Einspeisung `max(0,−grid)` (MVP-Fallback). Mit Brutto-PV ist der abgeleitete
       * Verbrauch = `gridPowerKw − batteryPowerKw + pvGenerationKw` (der 4. Strom fürs Chart).
       */
      pvGenerationKw: number
      /** Vorzeichen-Konvention: **+ = laden, − = entladen** (verhindert spiegelverkehrten Fluss in U2). */
      batteryPowerKw: number
      socKwh: number
    }>
  }>
}
// Chart 2 (Kostenvergleich mit/ohne Batterie über Horizont) wird aus den
// perBattery-Aggregaten (Ersparnis-/Investitionsfelder) gespeist — kein Trace nötig.

/**
 * Das Ergebnis EINER Batterie-Simulation, ohne jede Investitionsrechnung (§3.6/§3.7).
 *
 * ── WARUM DIESER TYP SEIT DEM 01.09.2026 EIGENS BENANNT IST ────────────────────────────────────
 * Er war bis dahin der anonyme Elementtyp von `perBattery` und trug die ROI-Felder mit. Seit dem
 * Bestandsspeicher-Ausbau gibt es einen zweiten, gleichrangigen Ort für dieselben Zahlen, an dem
 * eine Investition ausdrücklich NICHT existiert: die bereits installierte Anlage des Kunden
 * (`existingBatteryAnalysis.entry`). Sie ist bezahlt — eine Amortisationszeit beantwortet dort
 * eine Kaufentscheidung, die längst gefallen ist.
 *
 * Die Trennung ist deshalb kein Refactoring-Selbstzweck: sie macht es dem Typsystem UNMÖGLICH,
 * für die bestehende Anlage eine Investition auszuweisen — statt sich darauf zu verlassen, dass
 * die Oberfläche sie weglässt. Struktur und Feldbedeutung von `perBattery` sind unverändert.
 */
export type BatteryResultEntry = {
  battery: BatteryCandidate
  newBilledKw: number
  leistungspreisSavingPerYear: number
  /**
   * Eigenverbrauchs-Ersparnis PRO JAHR. Bei einem echten Lastgang, der weniger als ein Jahr
   * abdeckt, ist das die HOCHGERECHNETE Grösse (`…OverCoveredPeriod × annualizationFactor`).
   */
  selfConsumptionSavingPerYear: number
  /** [MN] tarifbewusstes Laden; 0 ohne Tarif-Fenster. Ebenfalls hochgerechnet, s. oben. */
  loadShiftSavingPerYear: number
  /**
   * ── Die beiden GEMESSENEN Energie-Werte über den tatsächlich abgedeckten Zeitraum ───────────
   * Anders als die Leistungspreis-Ersparnis (ratenbasiert, €/kW·Jahr → konstruktionsbedingt eine
   * Jahresgrösse) entstehen Eigenverbrauch und Lastverschiebung als SUMME über die vorhandenen
   * Intervalle. Bei einem Teilzeitraum-Lastgang muss diese Summe hochgerechnet werden, damit sie
   * mit dem Leistungspreis-Anteil in dieselbe `totalSavingPerYear` und in die ROI-Kette darf
   * (§3.7). Die Hochrechnung ist aber eine ANNAHME (homogenes Jahr) — der gemessene Wert darf sie
   * deshalb nicht verdrängen und steht als eigenes Feld daneben, damit der Report beide zeigen
   * kann (Prinzip 5). Bei voller Jahresabdeckung sind Paar und Faktor trivial (Faktor = 1).
   */
  selfConsumptionSavingOverCoveredPeriod: number
  loadShiftSavingOverCoveredPeriod: number
  /** `365 / coveredDays` bei einem echten Teilzeitraum-Lastgang, sonst exakt `1`. */
  annualizationFactor: number
  /** Abgedeckte Tage — die Bezugsgrösse des Faktors, damit Report/CSV sie benennen können. */
  coveredDays: number
  totalSavingPerYear: number // Summe aus DEMSELBEN Fahrplan (keine Doppelrechnung)
  warnings: string[]
  dispatchTrace?: DispatchTrace
}

/** Die ROI-Felder (§3.9) — nur für ein Gerät, das noch zu kaufen ist. */
export type BatteryRoiSummary = {
  totalInvestment: number
  subsidyAmount: number
  taxBenefit: number // [MN] Effekt aus IFB + AfA (vereinfacht)
  // false = FinancialParams nicht gesetzt → taxBenefit=0 heißt „keine Angabe", nicht „geprüft".
  taxEffectsIncluded: boolean
  netInvestment: number
  amortizationYears: number
  netSavingOverHorizon: number
}

/** Ein Katalog-Kandidat, wie ihn `recommendBattery` (§3.8) liefert: Ergebnis PLUS Investition. */
export type BatteryRoiEntry = BatteryResultEntry & BatteryRoiSummary

/**
 * Ein durchgerechnetes Szenario „bestehende Anlage + EIN Zusatzgerät" (01.09.2026).
 *
 * ── ⚠ ALLE ERSPARNIS-FELDER SIND DIFFERENZEN, KEINE BRUTTOWERTE ────────────────────────────────
 * Simuliert wird der KOMBINIERTE virtuelle Speicher (`combineBatteries`, Kapazität und Leistung
 * addiert, Wirkungsgrad kapazitätsgewichtet). Ausgewiesen wird davon aber ausschliesslich, was
 * ÜBER die bestehende Anlage hinausgeht: `kombiniert − Bestand allein`, je Kategorie und in Summe.
 * Die Bruttozahl der Kombination wäre die Antwort auf eine Frage, die niemand stellt — der Kunde
 * hat seinen Speicher bereits, und dessen Ersparnis bekommt er auch ohne Neukauf.
 *
 * ── UND `battery` IST DAS ZUSATZGERÄT, NICHT DIE KOMBINATION ───────────────────────────────────
 * Bezahlt wird allein das Zusatzgerät. `totalInvestment` und `amortizationYears` entstehen deshalb
 * aus `calculateRoi(zusatzKandidat, inkrementelleErsparnis, …)` — nie aus dem kombinierten
 * Kandidaten, der die addierte Kapazität zum Zusatzpreis trüge und damit eine Investition
 * behauptete, die es nirgends gibt. Der kombinierte Kandidat steht als `combined` daneben, damit
 * der Report die resultierende Gesamtgrösse benennen kann.
 */
export type AddonBatteryScenario = BatteryResultEntry &
  BatteryRoiSummary & {
    /** Der virtuelle Speicher, mit dem tatsächlich simuliert wurde (Bestand + `battery`). */
    combined: BatteryCandidate
  }

/**
 * Die bestehende Anlage des Kunden — der primäre Block des Reports, wenn er einen Speicher hat.
 *
 * ⚠ Ein GESCHWISTERFELD für die Szenarien wäre falsch: sie sind Differenzen GEGEN `entry` und ohne
 * ihn sinnlos. Zwei getrennte optionale Felder liessen den Zustand „Szenarien ohne Bezugsgrösse"
 * überhaupt erst entstehen, und die Oberfläche müsste einen Fall behandeln, den es fachlich nicht
 * gibt. Ein Feld, zwei Mitglieder — sie entstehen gemeinsam oder gar nicht.
 */
export type ExistingBatteryAnalysis = {
  /** Ergebnis der bestehenden Anlage allein, mit ihren EXAKTEN Werten (kein Katalog-Ersatz). */
  entry: BatteryResultEntry
  /** Je Katalog-Kandidat ein Szenario „zusätzlich zum Bestand" — dieselbe Reihenfolge wie `perBattery`. */
  addonScenarios: AddonBatteryScenario[]
}

/**
 * Engine-Ausgabe-Contract (§3.10) — autoritativ, die einzige Wahrheit für beide UIs.
 * Bewusst als TS-Typ (nicht zod): ein zweites, parallel gepflegtes Schema würde genau
 * die Drift erzeugen, die B1 für die Eingaben vermeidet. Ein zod-Mirror kann ergänzt
 * werden, falls der Worker-Harness die gemockte Ausgabe zur Laufzeit validieren soll.
 */
export type AnalysisResult = {
  current: {
    annualPeakKw: number
    monthlyPeaksKw: number[] // 12
    billedKw: number // gem. billingModel (§3.5)
    leistungspreisCostPerYear: number
  }
  peaks: {
    top: Array<{ ts: string; kw: number }>
    distribution: PeakDistribution
  }
  perBattery: BatteryRoiEntry[]
  recommendation: {
    batteryId: string
    rationale: string
  }
  assumptions: {
    // Transparenz-Panel & Editierbarkeit (§6.2). Erweiterbar (§3.10 „…").
    roundTripEfficiency: number
    horizonYears: number
    energyPriceCtPerKwh: number
    einspeiseverguetungCtPerKwh: number
    billingModel: BillingModel
  }
  /**
   * Delta 9 (B21-3b/9a): Konnte der Tarifoptimierungs-Hebel für diese Analyse gerechnet werden?
   *
   * `undefined` heisst: gar nicht angefordert (der Hebel war aus) — kein Fehlerfall, sondern der
   * unveränderte Stand vor B21. Sonst trägt das Feld entweder `{ computable: true }` oder den
   * strukturierten Befund (`side`/`kind`/`ranges`/`message`).
   *
   * ── WARUM EIN EIGENES FELD UND NICHT `dataQuality.warnings` ────────────────────────────────────
   * Bis B21-3b reiste der Befund als reiner TEXT in den Warnungen, weil es keine Anzeige gab, die
   * ihn hätte auswerten können. Seit Delta 9a gibt es sie — und eine Oberfläche, die an einem Satz
   * erkennen müsste, ob eine Zahl gezeigt werden darf, wäre genau die Kopplung, die
   * `TariffOptimizationBlocker` mit seinen drei Feldern vermeidet. Der Text steht deshalb nicht
   * mehr zusätzlich in `warnings`: derselbe Befund an zwei Orten liefe beim nächsten Umbau
   * auseinander, und der Leser sähe denselben Satz zweimal auf einer Seite.
   */
  tariffOptimization?: TariffOptimizationStatus
  /**
   * Der bereits installierte Speicher des Kunden samt der Frage „lohnt sich ein zusätzlicher?"
   * (01.09.2026). `undefined` heisst: keine Bestandsanlage angegeben — dann ist dieser Report
   * Zeile für Zeile der bisherige (Katalog-Empfehlung, Investition, Amortisation).
   *
   * ── WARUM EIN OPTIONALES TOP-LEVEL-FELD UND NICHT `perBattery` ────────────────────────────────
   * Präzedenz `tariffOptimization` direkt darüber, und aus demselben Grund: `perBattery` ist der
   * KATALOG-Lauf, sortiert nach `netSavingOverHorizon`, aus dem `recommendation` entsteht. Der
   * Speicher des Kunden hat dort nichts zu suchen — er ist keine Kaufoption, und mit einem
   * Platzhalter-Preis von 0 sortierte er sich zwangsläufig auf Platz 1 und würde als Empfehlung
   * ausgesprochen. Der Katalog-Lauf bleibt deshalb unangetastet; er ist zugleich die Grundlage der
   * Zusatzspeicher-Szenarien.
   *
   * Ein älteres archiviertes Ergebnis trägt das Feld nicht (`undefined`) — das ist kein Fehler,
   * sondern die zutreffende Aussage „damals gab es diese Unterscheidung nicht". Wie bei
   * `tariffOptimization` erzwingt das keinen `bundleVersion`-Sprung (B14-2).
   */
  existingBatteryAnalysis?: ExistingBatteryAnalysis
  dataQuality: {
    coveredDays: number
    /** Anzahl der 12 Kalendermonate (lokal) mit ≥ 1 Messwert. < 12 = Teiljahres-Datensatz (§3.5) —
     * verzerrt `monthly_*`-Abrechnung; der Report zieht daraus die prominente Teiljahres-Warnung. */
    coveredMonths: number
    gapsInterpolated: number
    /**
     * Längste ZUSAMMENHÄNGENDE interpolierte Lücke, in 15-min-Slots (0 = keine).
     *
     * Neben `gapsInterpolated` (der SUMME), weil die Summe die gefährlichere Lage nicht zeigt:
     * 2.000 über das Jahr verstreute Einzelslots sind eine Kleinigkeit, 2.000 am Stück sind drei
     * Wochen ohne jede Messung — linear zwischen den Rändern aufgefüllt, also ohne jede Lastspitze,
     * die dort tatsächlich stattgefunden hat. Der Report zieht daraus einen eigenen Hinweis; er ist
     * ausdrücklich NICHT der Teiljahres-Hinweis (`coveredMonths`): dort FEHLT ein Zeitraum, hier
     * sieht der Zeitraum vollständig aus und hat trotzdem keine Substanz.
     */
    largestGapSlots: number
    warnings: string[]
  }
}
