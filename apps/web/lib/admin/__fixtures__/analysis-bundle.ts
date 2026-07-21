import type { AnalysisBundleInputs, AnalysisResult, BatteryCandidate, TariffParams } from 'shared'

/**
 * B14-2 — Geteiltes Fixture für die Upload- und die Download-Tests.
 *
 * Bewusst EIN Datensatz für beide: der Pflicht-Test 6 verlangt einen VOLLSTÄNDIGEN Rundlauf
 * (Export → Upload → Download), und der ist nur dann einer, wenn beide Enden dieselbe Analyse und
 * dieselbe Ursprungsdatei benutzen. Zwei getrennte Fixtures bewiesen zweimal die Hälfte.
 */

const BATTERY: BatteryCandidate = {
  id: 'test-c60',
  name: 'PeakStore C60',
  manufacturer: '[MARTIN: Katalog]',
  class: 'commercial',
  usableCapacityKwh: 60,
  maxPowerKw: 30,
  roundTripEfficiency: 0.9,
  pricePerKwh: 235,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic',
}

const TARIFF: TariffParams = {
  leistungspreisEurPerKwYear: 100,
  billingModel: 'monthly_max_average',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

const RESULT: AnalysisResult = {
  current: {
    annualPeakKw: 50.8,
    monthlyPeaksKw: Array(12).fill(40),
    billedKw: 50.6,
    leistungspreisCostPerYear: 5060,
  },
  peaks: {
    top: [{ ts: '2023-01-20T06:00:00.000Z', kw: 50.8 }],
    distribution: {
      byWeekday: Array(7).fill(0),
      byHour: Array(24).fill(0),
      byMonth: Array(12).fill(0),
    },
  },
  perBattery: [
    {
      battery: BATTERY,
      newBilledKw: 20.6,
      leistungspreisSavingPerYear: 2700,
      selfConsumptionSavingPerYear: 0,
      loadShiftSavingPerYear: 0,
      totalSavingPerYear: 2700,
      totalInvestment: 14100,
      subsidyAmount: 0,
      taxBenefit: 0,
      taxEffectsIncluded: false,
      netInvestment: 14100,
      amortizationYears: 7.1,
      netSavingOverHorizon: 7900,
      warnings: [],
    },
  ],
  recommendation: { batteryId: 'test-c60', rationale: 'Beispiel' },
  assumptions: {
    roundTripEfficiency: 0.9,
    horizonYears: 10,
    energyPriceCtPerKwh: 25,
    einspeiseverguetungCtPerKwh: 8,
    billingModel: 'monthly_max_average',
  },
  dataQuality: { coveredDays: 365, coveredMonths: 12, gapsInterpolated: 0, warnings: [] },
}

const INPUTS: AnalysisBundleInputs = {
  tariff: TARIFF,
  horizonYears: 10,
  batteryCatalog: [BATTERY],
  pvFileName: null,
}

export const ANALYSIS_FIXTURE = { inputs: INPUTS, result: RESULT }

/**
 * Die „Ursprungsdatei". Enthält bewusst Umlaute und CRLF: der Rundlauf muss BYTE-identisch sein,
 * und genau daran scheitern Ketten, die irgendwo dekodieren und neu kodieren.
 */
export const SOURCE_BYTES = new TextEncoder().encode(
  'Zeitpunkt;Wert (kW);Zählpunkt\r\n01.01.2023 00:00;1,25;AT0010000000000000000000000010111\r\n' +
    '01.01.2023 00:15;1,30;AT0010000000000000000000000010111\r\nÜberschuss;0,00;—\r\n',
)

/** Eine ANDERE Datei — für den Prüfsummen-Fehlerfall. */
export const OTHER_SOURCE_BYTES = new TextEncoder().encode(
  'Zeitpunkt;Wert (kW)\r\n01.01.2023 00:00;9,99\r\n',
)
