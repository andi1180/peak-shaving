import { describe, expect, it } from 'vitest'
import type { BatteryCandidate, FinancialParams } from 'shared'

import { calculateRoi } from './roi'

function battery(overrides: Partial<BatteryCandidate> = {}): BatteryCandidate {
  return {
    id: 'test-battery',
    name: 'Test Battery',
    manufacturer: 'Testcorp',
    class: 'commercial',
    usableCapacityKwh: 100,
    maxPowerKw: 50,
    roundTripEfficiency: 0.9,
    pricePerKwh: 300,
    inverterIncluded: true,
    requiresFoundation: false,
    controlType: 'dynamic',
    ...overrides,
  }
}

describe('calculateRoi — totalInvestment', () => {
  it('Basis: Kapazität × Preis, kein Fundament, WR inklusive', () => {
    const roi = calculateRoi(battery(), 1000, 10)
    expect(roi.totalInvestment).toBe(100 * 300) // 30.000
  })

  it('+ foundationCost, wenn requiresFoundation', () => {
    const b = battery({ requiresFoundation: true, foundationCost: 5000 })
    expect(calculateRoi(b, 1000, 10).totalInvestment).toBe(30_000 + 5000)
  })

  it('requiresFoundation ohne foundationCost zählt als 0 (kein Crash)', () => {
    const b = battery({ requiresFoundation: true })
    expect(calculateRoi(b, 1000, 10).totalInvestment).toBe(30_000)
  })

  it('+ extraInverterCost, wenn !inverterIncluded UND gesetzt', () => {
    const b = battery({ inverterIncluded: false, extraInverterCost: 2000 })
    expect(calculateRoi(b, 1000, 10).totalInvestment).toBe(30_000 + 2000)
  })

  it('inverterIncluded=true ignoriert extraInverterCost, selbst wenn gesetzt', () => {
    const b = battery({ inverterIncluded: true, extraInverterCost: 2000 })
    expect(calculateRoi(b, 1000, 10).totalInvestment).toBe(30_000)
  })

  it('Fundament + separater WR kombiniert', () => {
    const b = battery({
      requiresFoundation: true,
      foundationCost: 5000,
      inverterIncluded: false,
      extraInverterCost: 2000,
    })
    expect(calculateRoi(b, 1000, 10).totalInvestment).toBe(30_000 + 5000 + 2000)
  })
})

describe('calculateRoi — subsidyAmount', () => {
  const b = battery() // totalInvestment = 30.000

  it('nur fixedSubsidyEur', () => {
    expect(calculateRoi(b, 1000, 10, { fixedSubsidyEur: 2000 }).subsidyAmount).toBe(2000)
  })

  it('nur subsidyPercent × totalInvestment', () => {
    expect(calculateRoi(b, 1000, 10, { subsidyPercent: 10 }).subsidyAmount).toBe(3000) // 10% von 30.000
  })

  it('[ANNAHME] beide gesetzt: additiv, keine Alternative', () => {
    expect(calculateRoi(b, 1000, 10, { fixedSubsidyEur: 2000, subsidyPercent: 10 }).subsidyAmount).toBe(
      5000,
    )
  })

  it('keines gesetzt → 0', () => {
    expect(calculateRoi(b, 1000, 10).subsidyAmount).toBe(0)
    expect(calculateRoi(b, 1000, 10, {}).subsidyAmount).toBe(0)
  })
})

describe('calculateRoi — taxBenefit & taxEffectsIncluded (§3.9 „Ohne Angabe"-Klärung, Pflichttest)', () => {
  const b = battery() // totalInvestment = 30.000

  it('vollständige FinancialParams → taxEffectsIncluded=true, taxBenefit > 0', () => {
    const financialParams: FinancialParams = {
      investitionsfreibetragPercent: 15,
      depreciationYears: 10,
      taxRatePercent: 25,
    }
    const roi = calculateRoi(b, 1000, 10, financialParams)

    // IFB = 15% × 30.000 = 4.500 (Einmaleffekt)
    // AfA = 30.000 / 10 = 3.000/Jahr × min(10, 10) Jahre = 30.000
    // taxBenefit = (4.500 + 30.000) × 25% = 8.625
    expect(roi.taxEffectsIncluded).toBe(true)
    expect(roi.taxBenefit).toBeCloseTo(8625, 6)
    expect(roi.taxBenefit).toBeGreaterThan(0)
  })

  it('fehlende FinancialParams (kein Argument) → taxEffectsIncluded=false, taxBenefit=0', () => {
    const roi = calculateRoi(b, 1000, 10)
    expect(roi.taxEffectsIncluded).toBe(false)
    expect(roi.taxBenefit).toBe(0)
  })

  it('leere FinancialParams ({}) → taxEffectsIncluded=false, taxBenefit=0 (nicht „geprüft und Null")', () => {
    const roi = calculateRoi(b, 1000, 10, {})
    expect(roi.taxEffectsIncluded).toBe(false)
    expect(roi.taxBenefit).toBe(0)
  })

  it('taxRatePercent gesetzt, aber ohne IFB/AfA-Basis → taxEffectsIncluded=true, taxBenefit=0 (echtes Null-Ergebnis)', () => {
    const roi = calculateRoi(b, 1000, 10, { taxRatePercent: 25 })
    expect(roi.taxEffectsIncluded).toBe(true)
    expect(roi.taxBenefit).toBe(0)
  })

  it('AfA wird auf min(depreciationYears, horizonYears) gedeckelt', () => {
    // depreciationYears=20 > horizonYears=5 → nur 5 Jahre AfA zählen im Horizont.
    const roi = calculateRoi(b, 1000, 5, { depreciationYears: 20, taxRatePercent: 25 })
    // AfA/Jahr = 30.000/20 = 1.500 × 5 Jahre = 7.500 → taxBenefit = 7.500 × 25% = 1.875
    expect(roi.taxBenefit).toBeCloseTo(1875, 6)
  })
})

describe('calculateRoi — amortizationYears (Grenzfälle, kein NaN/±Infinity als Crash)', () => {
  it('Normalfall: netInvestment ÷ totalSavingPerYear', () => {
    const b = battery({ usableCapacityKwh: 100, pricePerKwh: 200 }) // totalInvestment = 20.000
    const roi = calculateRoi(b, 4000, 10)
    expect(roi.netInvestment).toBe(20_000)
    expect(roi.amortizationYears).toBe(5)
  })

  it('[ANNAHME] totalSavingPerYear = 0 bei verbleibender Investition → Infinity, nicht NaN', () => {
    const roi = calculateRoi(battery(), 0, 10)
    expect(roi.amortizationYears).toBe(Infinity)
    expect(Number.isNaN(roi.amortizationYears)).toBe(false)
  })

  it('[ANNAHME] totalSavingPerYear < 0 (negative Ersparnis) → Infinity, nicht negative Jahre', () => {
    const roi = calculateRoi(battery(), -500, 10)
    expect(roi.amortizationYears).toBe(Infinity)
  })

  it('[ANNAHME] netInvestment ≤ 0 (Förderung deckt Investition) → 0, unabhängig von totalSavingPerYear', () => {
    const b = battery({ usableCapacityKwh: 10, pricePerKwh: 100 }) // totalInvestment = 1.000
    const roi = calculateRoi(b, 0, 10, { fixedSubsidyEur: 5000 }) // subsidyAmount 5.000 > totalInvestment
    expect(roi.netInvestment).toBeLessThan(0)
    expect(roi.amortizationYears).toBe(0)
  })
})

describe('calculateRoi — netSavingOverHorizon', () => {
  it('= totalSavingPerYear × horizonYears − netInvestment', () => {
    const b = battery({ usableCapacityKwh: 100, pricePerKwh: 200 }) // totalInvestment = 20.000
    const roi = calculateRoi(b, 4000, 10)
    expect(roi.netSavingOverHorizon).toBe(4000 * 10 - 20_000)
  })
})

describe('calculateRoi — durchgängiges Beispiel (konkrete Zahlen für den Abschlussbericht)', () => {
  it('vollständiges Szenario: totalInvestment, subsidyAmount, taxBenefit, netInvestment, amortizationYears, netSavingOverHorizon', () => {
    const b = battery({
      usableCapacityKwh: 50,
      pricePerKwh: 500,
      requiresFoundation: false,
      inverterIncluded: false,
      extraInverterCost: 1500,
    })
    const financialParams: FinancialParams = {
      fixedSubsidyEur: 1000,
      subsidyPercent: 5,
      investitionsfreibetragPercent: 15,
      depreciationYears: 10,
      taxRatePercent: 25,
    }
    const totalSavingPerYear = 3000
    const horizonYears = 10

    const roi = calculateRoi(b, totalSavingPerYear, horizonYears, financialParams)

    console.log(
      `[§3.9 Beispiel] totalInvestment=${roi.totalInvestment} € · subsidyAmount=${roi.subsidyAmount} € · ` +
        `taxBenefit=${roi.taxBenefit} € · netInvestment=${roi.netInvestment} € · ` +
        `amortizationYears=${roi.amortizationYears.toFixed(4)} · netSavingOverHorizon=${roi.netSavingOverHorizon} €`,
    )

    // totalInvestment = 50×500 + 1.500 (WR, kein Fundament) = 26.500
    expect(roi.totalInvestment).toBe(26_500)
    // subsidyAmount = 1.000 + 5% × 26.500 (1.325) = 2.325
    expect(roi.subsidyAmount).toBeCloseTo(2325, 6)
    // taxBenefit = (15%×26.500 [3.975] + 26.500/10×10 [26.500]) × 25% = 30.475 × 25% = 7.618,75
    expect(roi.taxBenefit).toBeCloseTo(7618.75, 6)
    expect(roi.taxEffectsIncluded).toBe(true)
    // netInvestment = 26.500 − 2.325 − 7.618,75 = 16.556,25
    expect(roi.netInvestment).toBeCloseTo(16_556.25, 6)
    // amortizationYears = 16.556,25 / 3.000 = 5,51875
    expect(roi.amortizationYears).toBeCloseTo(5.51875, 6)
    // netSavingOverHorizon = 3.000×10 − 16.556,25 = 13.443,75
    expect(roi.netSavingOverHorizon).toBeCloseTo(13_443.75, 6)
  })
})
