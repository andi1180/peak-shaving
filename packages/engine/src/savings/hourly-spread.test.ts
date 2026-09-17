import { describe, expect, it } from 'vitest'

import { spreadDailyConsumptionHourly } from './hourly-spread'

describe('spreadDailyConsumptionHourly', () => {
  it('erhält die Tagesmenge exakt — ohne Rundungsrest', () => {
    for (const kwhPerDay of [0, 1, 7, 51.96, 365, 1234.56, 99999.99]) {
      const hours = spreadDailyConsumptionHourly(kwhPerDay)
      expect(hours).toHaveLength(24)
      expect(hours.reduce((sum, h) => sum + h, 0)).toBe(kwhPerDay)
    }
  })

  it('verteilt flach — jede Stunde trägt ein Vierundzwanzigstel', () => {
    const hours = spreadDailyConsumptionHourly(48)
    for (const h of hours) expect(h).toBeCloseTo(2, 12)
  })

  it('weist eine unbrauchbare Tagesmenge zurück, statt sie zu verteilen', () => {
    expect(() => spreadDailyConsumptionHourly(Number.NaN)).toThrow()
    expect(() => spreadDailyConsumptionHourly(-1)).toThrow()
  })
})
