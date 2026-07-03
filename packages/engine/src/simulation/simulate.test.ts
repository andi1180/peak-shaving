import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import type { BatteryCandidate, TariffParams } from 'shared'

import { parseLoadProfile } from '../parser'
import { positiveAnnualPeakKw } from '../peaks/metrics'
import { drawSeries } from './helpers'
import { simulateBattery } from './simulate'

// Plausibilität am ECHTEN synthetischen Demo-Bäckerei-Lastgang (dev-fixtures/). Kein I/O im
// Rechenkern — hier im TEST wird die Datei gelesen und über den echten Parser aufbereitet.
const demoCsv = readFileSync(
  new URL('../../../../dev-fixtures/demo-baeckerei-lastgang-2023.csv', import.meta.url),
  'utf8',
)

/**
 * Plausible Commercial-Batterie (Dummy — Martins Katalog steht noch aus, §8 OP#2). 60 kWh / 30 kW
 * ist eine übliche gewerbliche Größe (C-Rate ~0,5); für den Demo-Lastgang ist die Kappung
 * leistungsbegrenzt (der einzelne 50,8-kW-Jahres-Peak lässt sich um höchstens `maxPowerKw` = 30 kW
 * senken → cap ≈ 20,8 kW). Der Energie-limitierte Fall (größere Batterie → tieferer cap) ist damit
 * konsistent, aber weniger typisch fürs Vertriebsbeispiel.
 */
const commercial: BatteryCandidate = {
  id: 'demo-commercial-60-30',
  name: 'Demo Commercial 60/30',
  manufacturer: 'Demo',
  class: 'commercial',
  usableCapacityKwh: 60,
  maxPowerKw: 30,
  roundTripEfficiency: 0.9,
  pricePerKwh: 350,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic',
}

function tariff(overrides: Partial<TariffParams> = {}): TariffParams {
  return {
    leistungspreisEurPerKwYear: 90,
    billingModel: 'annual_max',
    minBillableKw: 0,
    energyPriceCtPerKwh: 25,
    einspeiseverguetungCtPerKwh: 7,
    ...overrides,
  }
}

describe('§3.6/§3.6.1 — Plausibilität am Demo-Bäckerei-Lastgang', () => {
  const parsed = parseLoadProfile({ content: demoCsv, format: 'csv' })
  if (!parsed.ok) throw new Error(`Demo-Fixture parst nicht: ${JSON.stringify(parsed)}`)
  const lp = parsed.profile
  const rawAnnualPeak = positiveAnnualPeakKw(lp)

  it('cap + newBilledKw liegen spürbar unter dem rohen Jahres-Peak (annual_max)', () => {
    const res = simulateBattery(lp, commercial, tariff())
    const cap = res.capKwByPeriod[0] ?? Infinity

    console.log(
      `[§3.6 Demo-Bäckerei] roher Jahres-Peak=${rawAnnualPeak.toFixed(1)} kW · ` +
        `cap=${cap.toFixed(1)} kW · newBilledKw=${res.newBilledKw.toFixed(1)} kW · ` +
        `Batterie=${commercial.usableCapacityKwh} kWh / ${commercial.maxPowerKw} kW / η=${commercial.roundTripEfficiency}`,
    )

    // Spürbare Kappung: die Batterie senkt den abgerechneten Wert klar unter den rohen Peak.
    expect(rawAnnualPeak).toBeGreaterThan(45) // Sanity: der Demo-Lastgang hat ~50 kW Jahres-Peak
    expect(cap).toBeLessThan(rawAnnualPeak - 5)
    expect(res.newBilledKw).toBeLessThan(rawAnnualPeak - 5)
    expect(res.newBilledKw).toBeGreaterThan(0)

    // Der gekappte Fahrplan hält den cap tatsächlich (max. Netzbezug nach Batterie ≤ cap).
    const grid = res.dispatch.gridAfterKw
    let maxGrid = 0
    for (const g of grid) if (g > maxGrid) maxGrid = g
    expect(maxGrid).toBeLessThanOrEqual(cap + 1e-6)
  })

  it('monthly_max_average liegt nicht über annual_max (Verdünnungs-Richtung, §3.5)', () => {
    const annual = simulateBattery(lp, commercial, tariff({ billingModel: 'annual_max' }))
    const monthlyAvg = simulateBattery(lp, commercial, tariff({ billingModel: 'monthly_max_average' }))
    console.log(
      `[§3.6 Demo-Bäckerei] newBilledKw annual_max=${annual.newBilledKw.toFixed(1)} kW · ` +
        `monthly_max_average=${monthlyAvg.newBilledKw.toFixed(1)} kW`,
    )
    // monatlicher Mittelwert der Caps ≤ Jahres-Cap (ein einzelner Peak verdünnt sich auf ~1/12).
    expect(monthlyAvg.newBilledKw).toBeLessThanOrEqual(annual.newBilledKw + 1e-6)
  })

  it('Datenlänge stimmt (35.040 Viertelstunden) — die Simulation läuft über das ganze Jahr', () => {
    expect(drawSeries(lp).length).toBe(35040)
  })
})
