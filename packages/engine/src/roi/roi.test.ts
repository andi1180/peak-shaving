import { describe, expect, it } from 'vitest'
import type { BatteryCandidate, FinancialParams } from 'shared'

import { afterTaxCashflow, calculateRoi } from './roi'

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

  it('+ installationCost (K4): Hardware + Fundament + Installationspauschale', () => {
    const b = battery({ requiresFoundation: true, foundationCost: 1990, installationCost: 1900 })
    expect(calculateRoi(b, 1000, 10).totalInvestment).toBe(30_000 + 1990 + 1900)
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

describe('calculateRoi — Förderprogramme „€ pro kWh" je Gerät (§3.9, Revision Förderung pro kWh)', () => {
  // Investition = kWh × Preis; Programm A: 150 €/kWh, max. 10 kWh, max. 30 %; B: 150 €/kWh, max. 50 kWh.
  const A = { eurPerKwh: 150, maxKwh: 10, maxPercent: 30 }
  const B = { eurPerKwh: 150, maxKwh: 50 }
  const device = (kwh: number, investment: number) =>
    battery({ usableCapacityKwh: kwh, pricePerKwh: investment / kwh })
  const roiWith = (kwh: number, investment: number, programs: FinancialParams['subsidyPrograms']) =>
    calculateRoi(device(kwh, investment), 1000, 10, { subsidyPrograms: programs })

  it('Handrechnung Programm A — kWh-Deckel, Satz, 30-%-Deckel', () => {
    expect(roiWith(8, 6000, [A]).subsidyAmount).toBeCloseTo(1200, 9)
    expect(roiWith(15, 10_000, [A]).subsidyAmount).toBeCloseTo(1500, 9)
    expect(roiWith(10, 4000, [A]).subsidyAmount).toBeCloseTo(1200, 9) // 30 % von 4.000
  })

  it('Programm B allein und je Programm ausgewiesen; Netto und Amortisation je Gerät', () => {
    expect(roiWith(8, 6000, [B]).subsidyAmount).toBeCloseTo(1200, 9)
    expect(roiWith(15, 10_000, [B]).subsidyAmount).toBeCloseTo(2250, 9)
    const both = roiWith(15, 10_000, [A, B])
    expect(both.subsidyProgramAmounts?.[0]).toBeCloseTo(1500, 9)
    expect(both.subsidyProgramAmounts?.[1]).toBeCloseTo(2250, 9)
    expect(both.subsidyAmount).toBeCloseTo(3750, 9)
    expect(both.netInvestment).toBeCloseTo(6250, 9)
    expect(both.amortizationYears).toBeCloseTo(6.25, 9)
    expect(roiWith(8, 6000, [A, B]).subsidyAmount).toBeCloseTo(2400, 9)
  })

  it('Summe über der Investition → gedeckelt auf die Investition, Netto 0', () => {
    const roi = roiWith(8, 1000, [B, B])
    expect(roi.subsidyProgramAmounts).toEqual([1200, 1200])
    expect(roi.subsidyAmount).toBe(1000)
    expect(roi.netInvestment).toBe(0)
    expect(roi.amortizationYears).toBe(0)
  })

  it('ohne Programme kein Feld — %/Fixbetrag unverändert', () => {
    expect(calculateRoi(battery(), 1000, 10, { subsidyPercent: 50 })).not.toHaveProperty('subsidyProgramAmounts')
  })
})

describe('calculateRoi — Steuerwirkung (§3.9, Revision 27.09.2026)', () => {
  // B = 10.000 (Investition nach Förderung), S = 1.000/Jahr, t = 23 %, IFB 20 %, H = 10.
  const b = battery({ usableCapacityKwh: 10, pricePerKwh: 1000 })
  const tax = { taxRatePercent: 23, investitionsfreibetragPercent: 20 }

  it('Handrechnung n = 10: IFB-Wirkung 460, Cashflow 1.460 / 1.000, Netto nach Steuern 460', () => {
    const roi = calculateRoi(b, 1000, 10, { ...tax, depreciationYears: 10 })
    const assumptions = { ...tax, depreciationYears: 10 }
    expect(roi.taxEffect?.ifbEffect).toBeCloseTo(460, 9)
    expect(afterTaxCashflow(1, 10_000, 1000, assumptions)).toBeCloseTo(1460, 9)
    for (let year = 2; year <= 10; year++) {
      expect(afterTaxCashflow(year, 10_000, 1000, assumptions)).toBeCloseTo(1000, 9)
    }
    expect(roi.taxEffect?.netSavingOverHorizonAfterTax).toBeCloseTo(460, 9)
    // 9 Jahre: 1.460 + 8 × 1.000 = 9.460; der Rest 540 im 10. Jahr.
    expect(roi.taxEffect?.amortizationYearsAfterTax).toBeCloseTo(9.54, 9)
  })

  it('Handrechnung n = 20: AfA-Term 115/Jahr, gilt über den Horizont hinaus', () => {
    const roi = calculateRoi(b, 1000, 10, { ...tax, depreciationYears: 20 })
    expect(roi.taxEffect?.annualDepreciationEffect).toBeCloseTo(115, 9)
    expect(afterTaxCashflow(20, 10_000, 1000, { ...tax, depreciationYears: 20 })).toBeCloseTo(
      885,
      9,
    )
    expect(afterTaxCashflow(21, 10_000, 1000, { ...tax, depreciationYears: 20 })).toBeCloseTo(
      770,
      9,
    )
    // 1.345 + 9 × 885 − 10.000
    expect(roi.taxEffect?.netSavingOverHorizonAfterTax).toBeCloseTo(-690, 9)
  })

  it('Vor-Steuer-Zahlen unverändert; Basis ist die Investition NACH Förderung', () => {
    const plain = calculateRoi(b, 1000, 10, { subsidyPercent: 50 })
    const taxed = calculateRoi(b, 1000, 10, { subsidyPercent: 50, ...tax, depreciationYears: 10 })
    expect(taxed.netInvestment).toBe(5000)
    expect(taxed.amortizationYears).toBe(plain.amortizationYears)
    expect(taxed.netSavingOverHorizon).toBe(plain.netSavingOverHorizon)
    expect(taxed.taxEffect?.ifbEffect).toBeCloseTo(230, 9) // 20 % × 5.000 × 23 %
  })

  it('nur gerechnet mit Steuersatz UND (IFB oder AfA-Dauer)', () => {
    for (const params of [
      undefined,
      {},
      { taxRatePercent: 23 },
      { investitionsfreibetragPercent: 20, depreciationYears: 10 },
    ]) {
      const roi = calculateRoi(b, 1000, 10, params)
      expect(roi.taxEffectsIncluded).toBe(false)
      expect(roi.taxBenefit).toBe(0)
      expect(roi).not.toHaveProperty('taxEffect')
    }
    expect(
      calculateRoi(b, 1000, 10, { taxRatePercent: 23, depreciationYears: 10 }).taxEffectsIncluded,
    ).toBe(true)
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

  it('Förderung über der Investition: auf die Investition begrenzt, netInvestment 0, sofort amortisiert', () => {
    const b = battery({ usableCapacityKwh: 10, pricePerKwh: 100 }) // totalInvestment = 1.000
    const roi = calculateRoi(b, 0, 10, { fixedSubsidyEur: 5000 }) // eingetragen 5.000 > totalInvestment
    expect(roi.subsidyAmount).toBe(1000)
    expect(roi.netInvestment).toBe(0)
    expect(roi.amortizationYears).toBe(0)
    expect(roi.netSavingOverHorizon).toBe(0)
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
    // netInvestment = 26.500 − 2.325 = 24.175 (die Steuerwirkung senkt die Investition nicht)
    expect(roi.netInvestment).toBeCloseTo(24_175, 6)
    // amortizationYears = 24.175 / 3.000 = 8,058333…
    expect(roi.amortizationYears).toBeCloseTo(24_175 / 3000, 6)
    // netSavingOverHorizon = 3.000×10 − 24.175 = 5.825
    expect(roi.netSavingOverHorizon).toBeCloseTo(5825, 6)
    // taxBenefit = (15 % × 24.175 + 24.175/10 × 10) × 25 % = 27.801,25 × 25 %
    expect(roi.taxBenefit).toBeCloseTo(6950.3125, 6)
    expect(roi.taxEffectsIncluded).toBe(true)
  })
})
