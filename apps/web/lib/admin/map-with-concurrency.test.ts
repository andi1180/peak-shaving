import { describe, expect, it } from 'vitest'

import { mapWithConcurrency } from './map-with-concurrency'

describe('mapWithConcurrency', () => {
  it('hält die Obergrenze ein und liefert die Ergebnisse in Eingabereihenfolge', async () => {
    let running = 0
    let peak = 0
    const results = await mapWithConcurrency([30, 5, 20, 1, 10, 15, 2], 4, async (ms) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, ms))
      running--
      return ms * 2
    })
    expect(peak).toBe(4)
    expect(results).toEqual([60, 10, 40, 2, 20, 30, 4])
  })
})
