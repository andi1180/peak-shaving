import { describe, expect, it } from 'vitest'

import { textWidthAt } from './executive-summary-charts'
import { EXEC_HERO, execHeroSideWidth, execHeroValuePt } from './executive-summary-layout'

describe('Hero-Box: gemeinsame Zahlengrösse', () => {
  const side = { label: 'Gesamtmaßnahme', prefix: 'frühestens', value: 'ca. 0,8 Jahre' }

  it('beide Spalten passen mit der gemeinsamen Grösse, die nächste Stufe nicht mehr', () => {
    const inner = EXEC_HERO.innerWidth
    const used = (pt: number) =>
      textWidthAt('ca. 4 Jahre', pt, true) + EXEC_HERO.sideGap + execHeroSideWidth(side, pt)
    const pt = execHeroValuePt('ca. 4 Jahre', side, inner)
    expect(used(pt)).toBeLessThanOrEqual(inner)
    expect(used(pt + 0.1)).toBeGreaterThan(inner)
  })

  it('ohne Gesamtmaßnahme bleibt es bei der Einzelzahl bis 26 pt', () => {
    expect(execHeroValuePt('ca. 4 Jahre', null, EXEC_HERO.innerWidth)).toBe(EXEC_HERO.valueMaxPt)
  })
})
