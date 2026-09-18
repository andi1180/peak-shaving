import { describe, expect, it } from 'vitest'

import { CHART_COLORS, chartCellColor } from './theme'

/**
 * D15 Block 2 — `chartCellColor` ist die EINZIGE Stelle des Chart-Farbsatzes, die noch rechnet
 * (eine Heatmap ist eine stufenlose Skala, ein Token je Zelle gäbe es nicht). Geprüft wird
 * deshalb genau sie: die beiden Enden und der Nullpunkt.
 */
describe('chartCellColor', () => {
  it('trifft an den Enden die Endfarben der Skala', () => {
    expect(chartCellColor(1, 1)).toBe(CHART_COLORS.chargeEnd)
    expect(chartCellColor(-1, 1)).toBe(CHART_COLORS.dischargeEnd)
  })

  it('lässt eine echte 0 sichtbar bleiben statt sie weiss zu zeichnen', () => {
    /* Die 4-%-Untergrenze: ohne sie verschwimmt eine gemessene 0 mit einer Zelle ohne Messwert,
       und das ist bei einem Teiljahres-Lastgang die halbe Grafik. */
    expect(chartCellColor(0, 1)).not.toBe(CHART_COLORS.neutralEnd)
  })

  it('färbt nach Vorzeichen, nicht nach Betrag', () => {
    expect(chartCellColor(0.5, 1)).not.toBe(chartCellColor(-0.5, 1))
  })
})
