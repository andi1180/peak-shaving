import type {
  BatteryCandidate,
  BillingModel,
  LoadProfile,
  TariffParams,
  TariffPricingInputs,
} from 'shared'
import { describe, expect, it } from 'vitest'

import { analyzeCurrentPeaks } from '../peaks/analyze'
import { annualizationFactor } from '../savings/annualization'
import { computeBatterySavings } from '../savings/attribute'
import { buildSyntheticYearProfile } from '../savings/synthetic-year'
import { coveredMonthCount } from '../peaks/metrics'
import { eagDemandChargePerYear } from './eag-demand-charge'

const RATE = 100 // €/kW·a

/** Grundlast 5 kW ab 01.01.2025 (Ortszeit Wien), je Monat eine Spitze am 15. um 11:00 Ortszeit. */
function profile(monthlyPeaksKw: number[]): LoadProfile {
  const readings: LoadProfile['readings'] = []
  const start = Date.parse('2024-12-31T23:00:00Z')
  const end = Date.parse(
    ['2025-02-28T23:00:00Z', '2025-07-31T22:00:00Z', '2025-12-31T23:00:00Z'][
      [2, 7, 12].indexOf(monthlyPeaksKw.length)
    ]!,
  )
  for (let t = start; t < end; t += 15 * 60_000) {
    readings.push({ ts: new Date(t).toISOString(), gridPowerKw: 5 })
  }
  monthlyPeaksKw.forEach((kw, m) => {
    const ts = new Date(Date.UTC(2025, m, 15, 10)).toISOString()
    readings.find((r) => r.ts === ts)!.gridPowerKw = kw
  })
  return { readings, intervalMinutes: 15, timezoneMeta: 'Europe/Vienna', source: 'import_only' }
}

const tariff = (billingModel: BillingModel): TariffParams => ({
  leistungspreisEurPerKwYear: RATE,
  billingModel,
  minBillableKw: 0,
  energyPriceCtPerKwh: 20,
  einspeiseverguetungCtPerKwh: 0,
})

const battery: BatteryCandidate = {
  id: 'test-battery',
  name: 'Testspeicher',
  manufacturer: 'Test',
  class: 'commercial',
  usableCapacityKwh: 20,
  maxPowerKw: 10,
  roundTripEfficiency: 0.9,
  pricePerKwh: 500,
  inverterIncluded: true,
  extraInverterCost: 0,
  requiresFoundation: false,
  controlType: 'dynamic',
}

describe('monthly_max_sum rechnet den Jahressatz mit 1/12 je Monat', () => {
  it('Mini-Rechnung der Bestandsaufnahme: 10 kW Jan, 20 kW Feb, 100 €/kW·a', () => {
    const p = profile([10, 20])
    const levies = {
      gridTariffRows: null,
      spotPrices: null,
      levies: {
        periods: [
          {
            validFrom: '2025-01-01',
            validUntil: '2025-12-31',
            elektrizitaetsabgabeCtPerKwh: 0,
            eagFoerderbeitragCtPerKwh: 0,
            eagFoerderbeitragGrundpreisAmount: 5,
            eagFoerderbeitragGrundpreisUnit: 'eur_per_kw_year',
            eagPauschaleEurPerYear: 0,
            gebrauchsabgabeRate: 0,
          },
        ],
      },
    } as TariffPricingInputs
    const sum = analyzeCurrentPeaks(p, tariff('monthly_max_sum')).current

    expect(sum.billedKw).toBe(30) // der kW-Wert bleibt die Summe
    // Die zwei beobachteten Monate kosten (10 + 20) × 100/12 = 250 €; auf das Jahr gebracht × 12/2.
    expect((sum.leistungspreisCostPerYear * 2) / 12).toBe(250)
    expect(sum.leistungspreisCostPerYear).toBe(1500)
    expect(
      analyzeCurrentPeaks(p, tariff('monthly_max_average')).current.leistungspreisCostPerYear,
    ).toBe(1500)
    expect(analyzeCurrentPeaks(p, tariff('annual_max')).current.leistungspreisCostPerYear).toBe(
      2000,
    )
    expect(eagDemandChargePerYear(p, levies, sum.billedKw, 'monthly_max_sum')).toBe(75)
  })

  it('volles Jahr: Summe und Mittel ergeben dieselben Leistungskosten und dieselbe Ersparnis', () => {
    const p = profile([12, 30, 18, 25, 9, 14, 22, 40, 11, 17, 28, 35])
    const sum = analyzeCurrentPeaks(p, tariff('monthly_max_sum')).current
    const avg = analyzeCurrentPeaks(p, tariff('monthly_max_average')).current
    // Toleranz statt Bitgleichheit: Summe teilt in zwei Schritten ((Σ/12)·(12/n)), Mittel in einem
    // (Σ/n) — beides ist dieselbe Zahl, darf sich aber in der letzten Binärstelle unterscheiden.
    expect(sum.leistungspreisCostPerYear).toBeCloseTo(avg.leistungspreisCostPerYear, 9)
    expect(sum.billedKw).toBeCloseTo(avg.billedKw * 12, 9)

    const sumSaving = computeBatterySavings(p, battery, tariff('monthly_max_sum'))
    const avgSaving = computeBatterySavings(p, battery, tariff('monthly_max_average'))
    expect(sumSaving.leistungspreisSavingPerYear).toBeGreaterThan(0)
    expect(sumSaving.leistungspreisSavingPerYear).toBeCloseTo(
      avgSaving.leistungspreisSavingPerYear,
      9,
    )
  })

  it('7 Monate: genau eine Hochrechnung — 12/7 im Lauf selbst, keine weitere im D6-Jahreslauf', () => {
    const peaks = [12, 30, 18, 25, 9, 14, 22]
    const p = profile(peaks)
    const sigma = peaks.reduce((a, b) => a + b, 0)
    expect(coveredMonthCount(p)).toBe(7)

    // Lauf auf dem Teiljahr: Σ7 × Satz/12, einmal × 12/7 — dieselbe Zahl wie das Mittel-Modell.
    const sum = analyzeCurrentPeaks(p, tariff('monthly_max_sum')).current
    expect(sum.billedKw).toBe(sigma)
    expect(sum.leistungspreisCostPerYear).toBeCloseTo((sigma / 12) * (12 / 7) * RATE, 9)
    expect(sum.leistungspreisCostPerYear).toBeCloseTo(
      analyzeCurrentPeaks(p, tariff('monthly_max_average')).current.leistungspreisCostPerYear,
      9,
    )

    // Die Ersparnis bekommt dieselbe Monats-Hochrechnung, NICHT zusätzlich `annualizationFactor`
    // (der gilt nur den Energie-Töpfen, §3.7).
    const saving = computeBatterySavings(p, battery, tariff('monthly_max_sum'))
    expect(saving.annualizationFactor).toBeGreaterThan(1)
    expect(saving.annualizationFactor).toBe(annualizationFactor(p))
    expect(saving.leistungspreisSavingPerYear).toBeCloseTo(
      ((sigma - saving.newBilledKw) / 12) * (12 / 7) * RATE,
      9,
    )

    // D6: der Jahreslauf rechnet auf einem 365-Tage-Profil, das alle 12 Monate abdeckt — der
    // Faktor ist dort 12/12, die Hochrechnung aus dem Teiljahr kommt also nicht ein zweites Mal.
    const year = buildSyntheticYearProfile(p, {
      earliestDate: '2025-01-01',
      latestDate: '2026-09-22',
    })
    if (!year.ok) throw new Error(`kein Jahresprofil: ${year.blocker}`)
    expect(coveredMonthCount(year.value.profile)).toBe(12)
    const yearly = analyzeCurrentPeaks(year.value.profile, tariff('monthly_max_sum')).current
    expect(yearly.leistungspreisCostPerYear).toBeCloseTo((yearly.billedKw / 12) * RATE, 9)
  })
})
