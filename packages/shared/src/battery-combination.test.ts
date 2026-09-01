import { describe, expect, it } from 'vitest'

import type { BatteryCandidate } from './battery'
import {
  EXISTING_BATTERY_ID,
  buildExistingBatteryCandidate,
  combineBatteries,
  combinedBatteryId,
} from './battery-combination'
import { DEMO_BATTERY_CATALOG } from './demo-battery-catalog'

function candidate(over: Partial<BatteryCandidate>): BatteryCandidate {
  return {
    id: 'x',
    name: 'X',
    manufacturer: 'M',
    class: 'commercial',
    usableCapacityKwh: 10,
    maxPowerKw: 5,
    roundTripEfficiency: 0.9,
    pricePerKwh: 300,
    inverterIncluded: true,
    requiresFoundation: false,
    controlType: 'dynamic',
    ...over,
  }
}

describe('buildExistingBatteryCandidate', () => {
  it('übernimmt die EXAKTEN Werte des Kunden, ohne sie auf den Katalog zu runden', () => {
    // Der reale Anlass (Urbanz): 19,2 kWh liegen zwischen HomeStore R15 (15) und PeakStore C25 (25).
    const b = buildExistingBatteryCandidate({
      usableCapacityKwh: 19.2,
      maxPowerKw: 10.6,
      roundTripEfficiency: 0.9,
    })
    expect(b.usableCapacityKwh).toBe(19.2)
    expect(b.maxPowerKw).toBe(10.6)
    expect(b.roundTripEfficiency).toBe(0.9)
    // Keine der fünf Katalog-Kapazitäten (10/15/25/40/60) darf hier auftauchen.
    expect(DEMO_BATTERY_CATALOG.map((c) => c.usableCapacityKwh)).not.toContain(b.usableCapacityKwh)
  })

  it('ist immer static — auch das ist eine Entscheidung, keine Ableitung', () => {
    expect(
      buildExistingBatteryCandidate({
        usableCapacityKwh: 60,
        maxPowerKw: 30,
        roundTripEfficiency: 0.95,
      }).controlType,
    ).toBe('static')
  })

  it('trägt keine Investitionsangaben (Platzhalter, nie in calculateRoi)', () => {
    const b = buildExistingBatteryCandidate({
      usableCapacityKwh: 19.2,
      maxPowerKw: 10.6,
      roundTripEfficiency: 0.9,
    })
    expect(b.pricePerKwh).toBe(0)
    expect(b.requiresFoundation).toBe(false)
    expect(b.inverterIncluded).toBe(true)
    expect(b.foundationCost).toBeUndefined()
    expect(b.extraInverterCost).toBeUndefined()
  })

  it('kollidiert mit keiner Katalog-Kennung', () => {
    expect(DEMO_BATTERY_CATALOG.map((c) => c.id)).not.toContain(EXISTING_BATTERY_ID)
  })
})

describe('combineBatteries', () => {
  it('addiert Kapazität und Leistung', () => {
    const combined = combineBatteries(
      candidate({ id: 'e', usableCapacityKwh: 19.2, maxPowerKw: 10.6 }),
      candidate({ id: 'a', usableCapacityKwh: 25, maxPowerKw: 15 }),
    )
    expect(combined.usableCapacityKwh).toBe(44.2)
    expect(combined.maxPowerKw).toBe(25.6)
  })

  it('gewichtet den Wirkungsgrad nach Kapazität, nicht nach Geräteanzahl', () => {
    // Binär exakte Werte, damit die Erwartung ohne Toleranz nachrechenbar bleibt:
    // (10 × 0,5 + 30 × 0,75) / 40 = (5 + 22,5) / 40 = 0,6875.
    // Ein arithmetisches Mittel ergäbe 0,625 — der Unterschied IST der Punkt dieser Regel.
    const combined = combineBatteries(
      candidate({ id: 'e', usableCapacityKwh: 10, roundTripEfficiency: 0.5 }),
      candidate({ id: 'a', usableCapacityKwh: 30, roundTripEfficiency: 0.75 }),
    )
    expect(combined.roundTripEfficiency).toBe(0.6875)
    expect(combined.roundTripEfficiency).not.toBe((0.5 + 0.75) / 2)
  })

  it('bleibt im Schema-Wertebereich (0,1], auch wenn beide Geräte 100 % tragen', () => {
    const combined = combineBatteries(
      candidate({ id: 'e', roundTripEfficiency: 1 }),
      candidate({ id: 'a', roundTripEfficiency: 1 }),
    )
    expect(combined.roundTripEfficiency).toBeGreaterThan(0)
    expect(combined.roundTripEfficiency).toBeLessThanOrEqual(1)
  })

  it('ist IMMER static — auch wenn beide Geräte dynamic sind', () => {
    const combined = combineBatteries(
      candidate({ id: 'e', controlType: 'dynamic' }),
      candidate({ id: 'a', controlType: 'dynamic' }),
    )
    expect(combined.controlType).toBe('static')
  })

  it('trägt keine Investitionsangaben — die Investition ist die des Zusatzgeräts', () => {
    const combined = combineBatteries(
      candidate({ id: 'e', pricePerKwh: 900 }),
      candidate({ id: 'a', pricePerKwh: 270, requiresFoundation: true, foundationCost: 1800 }),
    )
    expect(combined.pricePerKwh).toBe(0)
    expect(combined.requiresFoundation).toBe(false)
    expect(combined.inverterIncluded).toBe(true)
  })

  it('erzeugt gegen den ganzen Katalog eindeutige, kollisionsfreie Kennungen', () => {
    const existing = buildExistingBatteryCandidate({
      usableCapacityKwh: 19.2,
      maxPowerKw: 10.6,
      roundTripEfficiency: 0.9,
    })
    const catalogIds = new Set(DEMO_BATTERY_CATALOG.map((c) => c.id))
    const ids = DEMO_BATTERY_CATALOG.map((addon) => combineBatteries(existing, addon).id)

    expect(new Set(ids).size).toBe(DEMO_BATTERY_CATALOG.length)
    for (const id of ids) {
      expect(catalogIds.has(id)).toBe(false)
      expect(id).not.toBe(EXISTING_BATTERY_ID)
    }
    expect(ids[0]).toBe(combinedBatteryId(EXISTING_BATTERY_ID, DEMO_BATTERY_CATALOG[0]!.id))
  })
})
