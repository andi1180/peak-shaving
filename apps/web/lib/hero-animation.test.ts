import { describe, expect, it } from 'vitest'
import {
  DAY_END,
  FINAL_FRAME_T,
  HOUR_STARTS,
  LOOP_DURATION,
  PEAKS,
  START,
  batteryAt,
  frameAt,
  hourAt,
  savingPercentAt,
  takeoverProgress,
} from './hero-animation'

describe('hero-animation', () => {
  it('Ersparnis ist am Start 0 und am Tagesende 30', () => {
    expect(savingPercentAt(0)).toBe(0)
    expect(savingPercentAt(DAY_END)).toBe(30)
  })

  it('Ladestand bleibt über den ganzen Loop in [0, 1]', () => {
    for (let t = 0; t <= LOOP_DURATION; t += 0.01) {
      const { level } = batteryAt(t)
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(1)
    }
  })

  it('jede Spitze ist am Ende ihrer Stunde vollständig übernommen', () => {
    for (const h of PEAKS) expect(takeoverProgress(h, HOUR_STARTS[h + 1]!)).toBe(1)
  })

  it('Stunde läuft von 0 bis 24', () => {
    expect(hourAt(START)).toBe(0)
    expect(hourAt(HOUR_STARTS[10]!)).toBe(10)
    expect(hourAt(DAY_END)).toBe(24)
  })

  it('das Schlussbild zeigt den vollständigen Tag', () => {
    const f = frameAt(FINAL_FRAME_T)
    expect(f.clock).toBe('24:00')
    expect(f.captionIndex).toBe(6)
    expect(f.playheadVisible).toBe(false)
    expect(f.savingPercent).toBe(30)
    for (const h of PEAKS) expect(f.bars[h]!.storage).toBeCloseTo(f.bars[h]!.top, 10)
  })
})
