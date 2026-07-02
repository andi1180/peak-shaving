import type { BatteryCandidate } from './battery'
import type { BillingModel } from './tariff'

/**
 * PROVISORISCH (§3.4) — Verteilung der Bezugsspitzen für die Report-Aufschlüsselung
 * nach Wochentag/Uhrzeit/Monat. Die Bucket-Semantik (Anzahl der Spitzen je Bucket
 * vs. aggregierte oder maximale kW) ist im Pflichtenheft nicht festgelegt und wird
 * mit der §3.4-Implementierung fixiert.
 */
export type PeakDistribution = {
  byWeekday: number[] // 7 (Mo..So)
  byHour: number[] // 24
  byMonth: number[] // 12
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
  perBattery: Array<{
    battery: BatteryCandidate
    newBilledKw: number
    leistungspreisSavingPerYear: number
    selfConsumptionSavingPerYear: number
    loadShiftSavingPerYear: number // [MN] tarifbewusstes Laden; 0 ohne Tarif-Fenster
    totalSavingPerYear: number // Summe aus DEMSELBEN Fahrplan (keine Doppelrechnung)
    totalInvestment: number
    subsidyAmount: number
    taxBenefit: number // [MN] Effekt aus IFB + AfA (vereinfacht)
    // false = FinancialParams nicht gesetzt → taxBenefit=0 heißt „keine Angabe", nicht „geprüft".
    taxEffectsIncluded: boolean
    netInvestment: number
    amortizationYears: number
    netSavingOverHorizon: number
    warnings: string[]
    dispatchTrace?: DispatchTrace
  }>
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
  dataQuality: {
    coveredDays: number
    gapsInterpolated: number
    warnings: string[]
  }
}
