import { describe, expect, it } from 'vitest'
import { ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY, EXISTING_BATTERY_ID } from 'shared'

import { mapDraftToExistingBatteryInput } from './battery-draft-mapping'

const FULL: Record<string, unknown> = {
  hasBattery: true,
  existingBatteryCapacityKwh: 19.2,
  existingBatteryMaxPowerKw: 10.6,
  existingBatteryRoundTripEfficiencyPercent: 92,
  existingBatteryPricePerKwh: 640,
}

describe('mapDraftToExistingBatteryInput', () => {
  it('übernimmt den genannten Wirkungsgrad als BRUCHTEIL und weist ihn nicht als Annahme aus', () => {
    const input = mapDraftToExistingBatteryInput(FULL)

    expect(input?.efficiencyAssumed).toBe(false)
    expect(input?.battery.roundTripEfficiency).toBeCloseTo(0.92, 10)
    expect(input?.battery.usableCapacityKwh).toBe(19.2)
    expect(input?.battery.maxPowerKw).toBe(10.6)
    expect(input?.battery.id).toBe(EXISTING_BATTERY_ID)
    // Der erfasste Preis geht ausdrücklich NICHT mit — die Anlage ist bezahlt.
    expect(input?.battery.pricePerKwh).toBe(0)
  })

  it('fällt ohne Wirkungsgrad auf die dokumentierte Annahme zurück und kennzeichnet sie', () => {
    const { existingBatteryRoundTripEfficiencyPercent: _drop, ...draft } = FULL
    const input = mapDraftToExistingBatteryInput(draft)

    expect(input?.efficiencyAssumed).toBe(true)
    expect(input?.battery.roundTripEfficiency).toBe(ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY)
  })

  it('ergibt undefined ohne bejahte Batterie und ohne die zwei Kernwerte', () => {
    expect(mapDraftToExistingBatteryInput({ ...FULL, hasBattery: false })).toBeUndefined()
    const { existingBatteryMaxPowerKw: _drop, ...noPower } = FULL
    expect(mapDraftToExistingBatteryInput(noPower)).toBeUndefined()
  })
})
