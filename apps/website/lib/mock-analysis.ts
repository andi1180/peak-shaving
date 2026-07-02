import type { AnalysisResult, BatteryCandidate, DispatchTrace } from 'shared'

/*
 * ============================================================================
 *  MOCK — statisches AnalysisResult, das den Contract aus /packages/shared erfüllt.
 *  NUR für die UI-Hülle (U1). KEINE echte Rechnung. Zahlen sind erfunden und dürfen
 *  NICHT als belastbar dargestellt werden (siehe CLAUDE.md „Rechnung ist die Wahrheit").
 *  Prompt 4 ersetzt diesen Mock durch den echten Engine-Aufruf im Worker.
 * ============================================================================
 */

const HORIZON_YEARS = 10
const LEISTUNGSPREIS_EUR_PER_KW_YEAR = 90
const BILLED_KW = 69.0 // gem. monthly_max_average (Mock)

// Deterministischer Tagesverlauf (96 × 15 min) für den Tages-Energiefluss-Chart (U2).
function buildDay(
  dateIso: string,
  opts: { basePeakKw: number; pvPeakKw: number; capKw: number; usableKwh: number },
): DispatchTrace['representativeDays'][number]['intervals'] {
  const out: DispatchTrace['representativeDays'][number]['intervals'] = []
  let soc = opts.usableKwh * 0.5
  for (let i = 0; i < 96; i++) {
    const hour = i / 4
    const hh = String(Math.floor(hour)).padStart(2, '0')
    const mm = String((i % 4) * 15).padStart(2, '0')
    // Grundlast + Morgen-/Abend-Ramp (Bäckerei-ähnlich).
    const ramp = Math.exp(-((hour - 7) ** 2) / 4) + 0.4 * Math.exp(-((hour - 18) ** 2) / 6)
    const rawLoad = 12 + opts.basePeakKw * ramp
    // PV-Glocke um die Mittagszeit.
    const pv = Math.max(0, opts.pvPeakKw * Math.exp(-((hour - 12.5) ** 2) / 6))
    // Batterie: entlädt oberhalb cap (−), lädt aus PV-Überschuss (+).
    let battery = 0
    if (rawLoad - pv > opts.capKw && soc > 0) {
      battery = -Math.min(rawLoad - pv - opts.capKw, soc * 4, opts.usableKwh)
    } else if (pv > rawLoad && soc < opts.usableKwh) {
      battery = Math.min(pv - rawLoad, (opts.usableKwh - soc) * 4)
    }
    soc = Math.max(0, Math.min(opts.usableKwh, soc + (battery * 0.25) / 1))
    const grid = Math.max(0, rawLoad - pv + (battery < 0 ? battery : battery))
    out.push({
      ts: `${dateIso}T${hh}:${mm}:00Z`,
      gridPowerKw: Math.round(grid * 10) / 10,
      pvGenerationKw: Math.round(pv * 10) / 10,
      batteryPowerKw: Math.round(battery * 10) / 10, // + = laden, − = entladen
      socKwh: Math.round(soc * 10) / 10,
    })
  }
  return out
}

const batteryCommercial: BatteryCandidate = {
  id: 'coolin-c40',
  name: 'PeakStore C40', // [MARTIN: Katalog]
  manufacturer: '[MARTIN: Katalog]',
  class: 'commercial',
  usableCapacityKwh: 40,
  maxPowerKw: 20,
  roundTripEfficiency: 0.9,
  pricePerKwh: 250,
  inverterIncluded: true,
  requiresFoundation: true,
  foundationCost: 1500,
  controlType: 'dynamic',
}

const batteryResidential: BatteryCandidate = {
  id: 'coolin-r15',
  name: 'HomeStore R15', // [MARTIN: Katalog]
  manufacturer: '[MARTIN: Katalog]',
  class: 'residential',
  usableCapacityKwh: 15,
  maxPowerKw: 7.5,
  roundTripEfficiency: 0.88,
  pricePerKwh: 500,
  inverterIncluded: false,
  extraInverterCost: 2500,
  requiresFoundation: false,
  controlType: 'static',
}

function investment(b: BatteryCandidate): number {
  return (
    b.usableCapacityKwh * b.pricePerKwh +
    (b.requiresFoundation ? (b.foundationCost ?? 0) : 0) +
    (b.inverterIncluded ? 0 : (b.extraInverterCost ?? 0))
  )
}

// Baut einen perBattery-Eintrag mit intern konsistenter ROI (amort = net / total).
function makePerBattery(
  battery: BatteryCandidate,
  args: {
    newBilledKw: number
    selfConsumptionSavingPerYear: number
    loadShiftSavingPerYear: number
    warnings: string[]
    dispatchTrace?: DispatchTrace
  },
): AnalysisResult['perBattery'][number] {
  const leistungspreisSavingPerYear =
    (BILLED_KW - args.newBilledKw) * LEISTUNGSPREIS_EUR_PER_KW_YEAR
  const totalSavingPerYear =
    leistungspreisSavingPerYear + args.selfConsumptionSavingPerYear + args.loadShiftSavingPerYear
  const totalInvestment = investment(battery)
  // FinancialParams im Mock nicht gesetzt → taxEffectsIncluded=false, taxBenefit=0 „keine Angabe".
  const subsidyAmount = 0
  const taxBenefit = 0
  const netInvestment = totalInvestment - subsidyAmount - taxBenefit
  return {
    battery,
    newBilledKw: args.newBilledKw,
    leistungspreisSavingPerYear,
    selfConsumptionSavingPerYear: args.selfConsumptionSavingPerYear,
    loadShiftSavingPerYear: args.loadShiftSavingPerYear,
    totalSavingPerYear,
    totalInvestment,
    subsidyAmount,
    taxBenefit,
    taxEffectsIncluded: false,
    netInvestment,
    amortizationYears: netInvestment / totalSavingPerYear,
    netSavingOverHorizon: totalSavingPerYear * HORIZON_YEARS - netInvestment,
    warnings: args.warnings,
    dispatchTrace: args.dispatchTrace,
  }
}

const commercialTrace: DispatchTrace = {
  capKwByPeriod: [55, 54, 53, 55, 52, 51, 52, 53, 54, 55, 56, 57],
  caughtPeaks: [
    { ts: '2024-07-16T07:30:00Z', originalKw: 82.4, residualKw: 52.0, caught: true },
    { ts: '2024-06-12T08:00:00Z', originalKw: 80.3, residualKw: 51.4, caught: true },
    { ts: '2024-08-05T07:45:00Z', originalKw: 79.8, residualKw: 52.2, caught: true },
  ],
  representativeDays: [
    {
      date: '2024-07-16',
      label: 'worst_caught_peak',
      intervals: buildDay('2024-07-16', { basePeakKw: 70, pvPeakKw: 8, capKw: 52, usableKwh: 40 }),
    },
    {
      date: '2024-06-21',
      label: 'pv_strong',
      intervals: buildDay('2024-06-21', { basePeakKw: 55, pvPeakKw: 45, capKw: 52, usableKwh: 40 }),
    },
  ],
}

/** Der Mock-Datensatz. Import überall über diese eine Konstante. */
export const mockAnalysisResult: AnalysisResult = {
  current: {
    annualPeakKw: 82.4,
    monthlyPeaksKw: [58.2, 61.0, 64.5, 70.1, 74.6, 80.3, 82.4, 79.8, 72.2, 66.7, 60.4, 57.9],
    billedKw: BILLED_KW,
    leistungspreisCostPerYear: BILLED_KW * LEISTUNGSPREIS_EUR_PER_KW_YEAR,
  },
  peaks: {
    top: [
      { ts: '2024-07-16T07:30:00Z', kw: 82.4 },
      { ts: '2024-06-12T08:00:00Z', kw: 80.3 },
      { ts: '2024-08-05T07:45:00Z', kw: 79.8 },
      { ts: '2024-05-21T08:15:00Z', kw: 74.6 },
      { ts: '2024-09-03T07:30:00Z', kw: 72.2 },
    ],
    distribution: {
      // PROVISORISCH (§3.4): hier Anzahl der Spitzen je Bucket (Mock).
      byWeekday: [24, 31, 28, 26, 22, 5, 3],
      byHour: [0, 0, 0, 0, 0, 2, 9, 27, 22, 8, 3, 1, 1, 0, 0, 0, 2, 6, 4, 1, 0, 0, 0, 0],
      byMonth: [3, 4, 6, 9, 12, 18, 21, 17, 10, 6, 4, 2],
    },
  },
  perBattery: [
    makePerBattery(batteryCommercial, {
      newBilledKw: 52.0,
      selfConsumptionSavingPerYear: 520,
      loadShiftSavingPerYear: 0,
      warnings: [],
      dispatchTrace: commercialTrace,
    }),
    makePerBattery(batteryResidential, {
      newBilledKw: 60.0,
      selfConsumptionSavingPerYear: 430,
      loadShiftSavingPerYear: 0,
      warnings: [
        // §3.8: statische Steuerung — Kernannahme noch mit Martin zu bestätigen.
        'Statische Steuerung: kappt Spitzen nur eingeschränkt (keine Vorausschau). [MARTIN: bestätigen]',
        'Separater Wechselrichter nötig (+2.500 €).',
      ],
    }),
  ],
  recommendation: {
    batteryId: 'coolin-c40',
    rationale:
      'Beste Amortisation im 10-Jahres-Horizont bei ausreichender Leistung für alle abgefangenen Spitzen. [MARTIN: Copy prüfen]',
  },
  assumptions: {
    roundTripEfficiency: 0.9,
    horizonYears: HORIZON_YEARS,
    energyPriceCtPerKwh: 25,
    einspeiseverguetungCtPerKwh: 8,
    billingModel: 'monthly_max_average',
  },
  dataQuality: {
    coveredDays: 365,
    gapsInterpolated: 12,
    warnings: ['3 kurze Datenlücken interpoliert (< 1 h). [MARTIN: Beispiel-Datensatz]'],
  },
}
