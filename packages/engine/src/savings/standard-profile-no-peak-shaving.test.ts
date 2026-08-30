import { describe, expect, it } from 'vitest'
import type { BatteryCandidate, LoadProfile, TariffParams } from 'shared'

import { generateStandardLoadProfile } from '../standard-profile/h0'
import { simulateBattery } from '../simulation/simulate'
import { peakShavingBlockers } from '../simulation/peak-shaving'
import { getTariffStrategy } from '../tariff/strategy'
import { computeBatterySavings } from './attribute'

/**
 * Delta 3 (zweite Anwendung) / Delta 8 — ein SYNTHETISCHES Standardlastprofil bekommt KEINE
 * Leistungspreis-Ersparnis, und zwar unabhängig vom nominellen Vertragsstatus des Kunden.
 *
 * Der eigentliche Prüfpunkt ist der GEGENBEWEIS: dieselbe Batterie, derselbe Tarif MIT
 * Leistungspreis, einmal auf einem echten (hier: aus demselben Generator stammenden, aber als
 * gemessen etikettierten) Lastgang und einmal auf dem Standardprofil. Ein Test, der nur den
 * erwarteten Fall zeigt, bliebe auch dann grün, wenn die Sperre gar nicht greift — dann nämlich,
 * wenn die Batterie ohnehin nichts kappt.
 */

const TZ = 'Europe/Vienna'

const outcome = generateStandardLoadProfile({
  annualConsumptionKwh: 4200,
  customerClass: 'privat',
  year: 2025,
  timeZone: TZ,
})
if (!outcome.ok) throw new Error('Standardprofil nicht erzeugbar — der Test prüfte sonst nichts.')
const standardProfile = outcome.profile

/**
 * Dasselbe Zahlenmaterial, aber als GEMESSENER Lastgang etikettiert. Nur so ist der Vergleich
 * sauber: unterschiedliche Profile lieferten unterschiedliche Zahlen aus einem zweiten Grund, und
 * dann bewiese der Unterschied nichts über die Herkunfts-Sperre.
 */
const measuredProfile: LoadProfile = { ...standardProfile, source: 'net_signed' }

// Eine dynamische Batterie — sie KANN kappen; die Sperre muss also aus dem Profil kommen.
const battery: BatteryCandidate = {
  id: 'test-dyn-10',
  manufacturer: 'Test',
  model: 'Dyn 10',
  usableCapacityKwh: 10,
  maxPowerKw: 5,
  roundTripEfficiency: 0.9,
  pricePerKwh: 500,
  controlType: 'dynamic',
  inverterIncluded: true,
  requiresFoundation: false,
  class: 'residential',
}

// Tarif MIT Leistungsmessung — genau der Fall, den Delta 8 ausdrücklich mit abdeckt.
const tariff: TariffParams = {
  leistungspreisEurPerKwYear: 82.92,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

describe('Delta 8 — Standardprofil trägt die Leistungspreis-Dimension nicht', () => {
  it('nennt die Herkunft als Grund, auch bei einer dynamischen Batterie', () => {
    expect(peakShavingBlockers(standardProfile, battery)).toEqual(['standard_profile'])
    expect(peakShavingBlockers(measuredProfile, battery)).toEqual([])
  })

  it('simuliert reserve-frei (cap = ∞, socFloor ≡ 0) — es wird gar nicht erst gekappt', () => {
    const sim = simulateBattery(standardProfile, battery, tariff)
    expect(sim.capKwByPeriod.every((c) => c === Infinity)).toBe(true)
    expect(sim.socFloorKwh.every((v) => v === 0)).toBe(true)
  })

  it('kreditiert KEINE Spitzenkappung — der GEGENBEWEIS: derselbe Lastgang als Messung tut es', () => {
    const oldBilledKw = getTariffStrategy(tariff.billingModel).billedKw(standardProfile, tariff)

    const synthetisch = computeBatterySavings(standardProfile, battery, tariff)
    const gemessen = computeBatterySavings(measuredProfile, battery, tariff)

    console.log(
      `[Delta 8] billedKw ohne Batterie=${oldBilledKw.toFixed(4)} kW · ` +
        `synthetisch: leistungspreis=€${synthetisch.leistungspreisSavingPerYear.toFixed(2)}, newBilledKw=${synthetisch.newBilledKw.toFixed(4)} · ` +
        `gemessen: leistungspreis=€${gemessen.leistungspreisSavingPerYear.toFixed(2)}, newBilledKw=${gemessen.newBilledKw.toFixed(4)}`,
    )

    // Synthetisch: exakt 0, und der abgerechnete Wert bleibt der ungekappte.
    expect(synthetisch.leistungspreisSavingPerYear).toBe(0)
    expect(synthetisch.newBilledKw).toBe(oldBilledKw)

    // Gegenbeweis: als Messung etikettiert wird dieselbe Batterie sehr wohl kreditiert.
    expect(gemessen.leistungspreisSavingPerYear).toBeGreaterThan(0)
    expect(gemessen.newBilledKw).toBeLessThan(oldBilledKw)
  })

  it('sagt im Report-Contract, WARUM — und die Summe der Anteile bleibt exakt', () => {
    const s = computeBatterySavings(standardProfile, battery, tariff)
    expect(s.warnings.some((w) => /Synthetisches Standardlastprofil/.test(w))).toBe(true)
    expect(s.warnings.some((w) => /Statische Steuerung/.test(w))).toBe(false)
    expect(s.totalSavingPerYear).toBeCloseTo(
      s.leistungspreisSavingPerYear + s.selfConsumptionSavingPerYear + s.loadShiftSavingPerYear,
      12,
    )
  })

  it('nennt bei einer statischen Batterie auf einem Standardprofil BEIDE Gründe', () => {
    const statisch: BatteryCandidate = { ...battery, id: 'test-stat-10', controlType: 'static' }
    expect(peakShavingBlockers(standardProfile, statisch)).toEqual([
      'static_control',
      'standard_profile',
    ])
    const s = computeBatterySavings(standardProfile, statisch, tariff)
    expect(s.warnings.filter((w) => /Statische Steuerung|Synthetisches Standardlastprofil/.test(w))).toHaveLength(2)
    expect(s.leistungspreisSavingPerYear).toBe(0)
  })
})
