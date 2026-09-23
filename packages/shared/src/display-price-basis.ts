/**
 * H3 — Preisbasis der ANZEIGE und der EINGABE. Gerechnet wird durchgängig netto (`tariff.ts`,
 * Delta 6); die Umsatzsteuer kommt ausschliesslich hier dazu bzw. weg:
 *
 * — Anzeige: Privatkunden (`heim`) sehen Geldbeträge inkl. USt, Betriebe netto. Der Faktor greift
 *   auf Investition UND Ersparnis gleich, die Amortisation bleibt dadurch unverändert.
 * — Eingabe: ein brutto eingetragener Preis wird sofort auf netto umgerechnet; die gewählte Basis
 *   reist daneben mit, damit die Eingabe wiedererkennbar zurückgelesen werden kann.
 */
import type { AnalysisResult } from './analysis-result'
import type { BatteryCatalogCategory } from './battery-catalog-loader'
import type { PriceBasis } from './tariff'

/**
 * Umsatzsteuer-Normalsatz Österreich — die EINE Stelle. Fachlich bestätigt 23.09.2026; offen
 * bleibt, ob für Speicher bei Privatkunden ein Nullsteuersatz greift (dann ist hier nachzuziehen).
 */
export const VAT_RATE = 0.2

/** Wie Geldbeträge einem Kunden gezeigt werden. */
export type DisplayPriceBasis = PriceBasis

/** `heim` → inkl. USt, `gewerbe` → netto. Dieselbe Zuordnung gibt auch die Eingabe-Vorgabe. */
export function displayPriceBasisFor(category: BatteryCatalogCategory): DisplayPriceBasis {
  return category === 'heim' ? 'gross' : 'net'
}

export function vatFactor(basis: DisplayPriceBasis): number {
  return basis === 'gross' ? 1 + VAT_RATE : 1
}

/** „inkl. 20 % USt" — aus `VAT_RATE` gebildet, damit Satz und Beschriftung nicht auseinanderlaufen. */
export const VAT_INCLUSIVE_LABEL = `inkl. ${Math.round(VAT_RATE * 100)} % USt`

/** Der Zusatz an einem Betrag: `netto` oder `inkl. 20 % USt`. */
export function priceBasisLabel(basis: DisplayPriceBasis | undefined): string {
  return basis === 'gross' ? VAT_INCLUSIVE_LABEL : 'netto'
}

/** Ein eingegebener Preis in der Rechenbasis netto. */
export function netFromEntered(value: number, entered: PriceBasis): number {
  return value / vatFactor(entered)
}

/** Die Gegenrichtung fürs Zurücklesen — auf 6 Stellen, damit 10,9008… nicht als 13,080999… zurückkommt. */
export function enteredFromNet(net: number, entered: PriceBasis): number {
  return Math.round(net * vatFactor(entered) * 1e6) / 1e6
}

type NumericLeaf<T, K extends string> = T extends number
  ? K
  : T extends readonly (infer E)[]
    ? NumericLeaf<E, K>
    : T extends object
      ? NumericKeysOf<T>
      : never
type NumericKeysOf<T> = {
  [P in keyof T & string]-?: NumericLeaf<NonNullable<T[P]>, P>
}[keyof T & string]

/** Jeder Name, unter dem im `AnalysisResult` eine Zahl steht (auch verschachtelt, auch in Reihen). */
export type AnalysisNumericKey = NumericKeysOf<AnalysisResult>

/**
 * Welche Zahl ein Geldbetrag ist. VOLLSTÄNDIG über `AnalysisNumericKey` — ein neues Zahlenfeld im
 * Contract bricht den Typecheck, bis es hier eingeordnet ist (sonst stünde es netto unter einem
 * „inkl. USt"-Etikett).
 *
 * `price` sind Bezugspreise je kWh — sie tragen beim Privatkunden USt wie die Beträge daraus.
 * Die Einspeisevergütung NICHT: ein privater Anlagenbetreiber bekommt sie ohne USt.
 */
const FIELD_KIND: Record<AnalysisNumericKey, 'money' | 'price' | 'other'> = {
  amortizationYears: 'other',
  annualPeakKw: 'other',
  annualizationFactor: 'other',
  assumed: 'other',
  averageCtPerKwh: 'price',
  awattarBaseFeeEur: 'money',
  awattarFeeEurPerMonth: 'money',
  batteryFlowByHourMonth: 'other',
  batteryPowerKw: 'other',
  billedKw: 'other',
  byHour: 'other',
  byMonth: 'other',
  byWeekday: 'other',
  capKwByPeriod: 'other',
  chargeCtPerKwh: 'price',
  chargedKwh: 'other',
  comparisonSupplierBaseFeeEur: 'money',
  comparisonTariffEur: 'money',
  consumptionKwh: 'other',
  controlledEur: 'money',
  coveredDays: 'other',
  coveredMonths: 'other',
  ctPerKwh: 'price',
  currentTariffEur: 'money',
  database: 'other',
  days: 'other',
  dischargeCtPerKwh: 'price',
  dischargedKwh: 'other',
  eagFlatFeeEur: 'money',
  eagGrundpreisCostPerYear: 'money',
  einspeiseverguetungCtPerKwh: 'other',
  energyPriceCtPerKwh: 'price',
  estimatedAnnualConsumptionKwh: 'other',
  estimatedGenerationKwh: 'other',
  extraInverterCost: 'money',
  fetched: 'other',
  foundationCost: 'money',
  gapsInterpolated: 'other',
  gridPowerKw: 'other',
  horizonYears: 'other',
  hours: 'other',
  kw: 'other',
  largestGapSlots: 'other',
  leistungspreisCostPerYear: 'money',
  leistungspreisSavingPerYear: 'money',
  loadShiftSavingOverCoveredPeriod: 'money',
  loadShiftSavingPerYear: 'money',
  maxPowerKw: 'other',
  measuredDays: 'other',
  measuredEur: 'money',
  meteringFeeEur: 'money',
  missingDays: 'other',
  month: 'other',
  monthlyPeaksKw: 'other',
  netInvestment: 'money',
  netSavingOverHorizon: 'money',
  networkBaseFeeEur: 'money',
  newBilledKw: 'other',
  originalKw: 'other',
  peakShavingSavingEur: 'money',
  pricePerKwh: 'money',
  projectedDays: 'other',
  projectedEur: 'money',
  pvGenerationKw: 'other',
  rateKwhPerDay: 'other',
  referenceRateKwhPerDay: 'other',
  residualKw: 'other',
  roundTripEfficiency: 'other',
  selfConsumptionKwh: 'other',
  selfConsumptionSavingOverCoveredPeriod: 'money',
  selfConsumptionSavingPerYear: 'money',
  socKwh: 'other',
  spotWithBatteryEur: 'money',
  spotWithPredictiveControlEur: 'money',
  spotWithoutControlEur: 'money',
  subsidyAmount: 'money',
  supplierBaseFeeEur: 'money',
  supplierFeeEurPerMonth: 'money',
  taxBenefit: 'money',
  totalEur: 'money',
  totalInvestment: 'money',
  totalSavingPerYear: 'money',
  usableCapacityKwh: 'other',
  usageChargeOnFixedEur: 'money',
  valueEur: 'money',
  withPvEur: 'money',
  withoutPvEur: 'money',
  year: 'other',
}

function scalesWithVat(key: string | undefined): boolean {
  if (key == null || !Object.hasOwn(FIELD_KIND, key)) return false
  return FIELD_KIND[key as AnalysisNumericKey] !== 'other'
}

/** Jedes Objekt, das `analysisForDisplay` brutto erzeugt hat — samt aller Teilobjekte. */
const GROSS_VIEWS = new WeakSet<object>()

/**
 * Ein Ergebnis (oder ein Ausschnitt davon, etwa `PdfReportAnalysis`) in der Anzeigebasis. Bei
 * `net` unverändert dasselbe Objekt; bei `gross` eine Kopie mit allen Geldbeträgen und Bezugspreisen
 * × (1 + USt). NUR für die Darstellung — nie zurück in eine Rechnung oder ein Archiv.
 */
export function analysisForDisplay<T extends object>(analysis: T, basis: DisplayPriceBasis): T {
  if (basis !== 'gross') return analysis
  const factor = vatFactor(basis)
  const walk = (value: unknown, key: string | undefined): unknown => {
    if (typeof value === 'number') return scalesWithVat(key) ? value * factor : value
    if (Array.isArray(value)) {
      const out = value.map((item) => walk(item, key))
      GROSS_VIEWS.add(out)
      return out
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) out[k] = walk(v, k)
      GROSS_VIEWS.add(out)
      return out
    }
    return value
  }
  return walk(analysis, undefined) as T
}

/**
 * In welcher Basis die Zahlen dieses Objekts stehen — abgelesen an den Zahlen selbst, nicht an
 * einem zweiten Parameter. Ein Etikett kann dadurch nicht „netto" sagen, wo brutto steht.
 */
export function displayedPriceBasis(view: object | null | undefined): DisplayPriceBasis {
  return view != null && GROSS_VIEWS.has(view) ? 'gross' : 'net'
}

/** `netto` oder `inkl. 20 % USt`, passend zu den Zahlen in `view`. */
export function displayedPriceLabel(view: object | null | undefined): string {
  return priceBasisLabel(displayedPriceBasis(view))
}
