import { describe, expect, it } from 'vitest'
import type { LoadProfile } from 'shared'

import { searchCapForPeriod, searchCaps } from './cap-search'
import { drawSeries, intervalHours, startSoc, type BatteryPhysics } from './helpers'

const STEP_MS = 15 * 60 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()
const repeat = (kw: number, n: number): number[] => Array.from({ length: n }, () => kw)

function series(startIso: string, kws: number[]): Array<{ ts: string; gridPowerKw: number }> {
  const t0 = Date.parse(startIso)
  return kws.map((kw, i) => ({ ts: iso(t0 + i * STEP_MS), gridPowerKw: kw }))
}

// Wirkungsgrad 1.0 (Schema erlaubt max(1)) hält die Reserve-/Energie-Arithmetik im Test klar —
// die Wirkungsgrad-Pfade prüft dispatch.test.ts mit η < 1.
const battery: BatteryPhysics = { usableCapacityKwh: 100, maxPowerKw: 100, roundTripEfficiency: 1 }

describe('§3.6.1 Kapp-Suche — sequenzielle SoC-Übergabe (EIN Lauf übers Jahr, kein Reset am Monatsersten)', () => {
  // Jänner: 100 Intervalle @ 40 kW (die Batterie muss arbeiten) + 200 Intervalle @ 2 kW (lange
  // Schwachlast → der Peak-Protection-Lauf lädt die Batterie bis voll). Jänner endet daher ~voll.
  const janKws = [...repeat(40, 100), ...repeat(2, 200)]
  // Februar: 8 Intervalle @ 90 kW GLEICH ZU MONATSBEGINN (vor jeder Nachlademöglichkeit) + Schwachlast.
  // Diese frühe Spitze ist genau dann günstiger zu kappen, wenn die Batterie voll aus dem Jänner kommt.
  const febKws = [...repeat(90, 8), ...repeat(5, 200)]

  const readings = [
    ...series('2023-01-01T00:00:00Z', janKws),
    ...series('2023-02-01T00:00:00Z', febKws),
  ]
  const lp: LoadProfile = {
    readings,
    intervalMinutes: 15,
    timezoneMeta: 'UTC',
    source: 'net_signed',
  }
  const deltaH = intervalHours(lp)
  const febDraws = drawSeries(lp).slice(janKws.length)

  it('korrekter Übertrag (echter Jänner-End-SoC) vs. falscher Reset (50 %) → UNTERSCHIEDLICHE Februar-Caps', () => {
    // Korrekt: EIN sequenzieller Lauf — Februar erbt den echten Jänner-End-SoC.
    const seq = searchCaps(lp, battery, 'monthly_max_average')
    const janEndSoc = seq.periodEndSocKwh[0] ?? NaN
    const febCapSequential = seq.capKwByPeriod[1] ?? NaN // Monatsindex 1 = Februar

    // Falsch: Februar mit ZURÜCKGESETZTEM Start-SoC (50 % = 50 kWh) statt des Jänner-End-SoC.
    const febCapReset = searchCapForPeriod(febDraws, startSoc(battery), battery, deltaH).capKw

    console.log(
      `[§3.6.1 Sequenz] Jänner-End-SoC=${janEndSoc.toFixed(1)} kWh · ` +
        `Februar-Cap KORREKT(Übertrag)=${febCapSequential.toFixed(1)} kW · ` +
        `Februar-Cap FALSCH(Reset 50%)=${febCapReset.toFixed(1)} kW`,
    )

    // Jänner lädt die Batterie ~voll (Übertrag ist echt, nicht 50 %).
    expect(janEndSoc).toBeGreaterThan(95)
    // Mit voller Startenergie fängt Februar die frühe Spitze bei SPÜRBAR niedrigerer Schwelle ab:
    // (90 − cap)·0,25·8 ≤ StartSoC → voll(100): cap ≈ 40; Reset(50): cap ≈ 65.
    expect(febCapSequential).toBeCloseTo(40, 0)
    expect(febCapReset).toBeCloseTo(65, 0)
    expect(febCapReset - febCapSequential).toBeGreaterThan(20) // die beiden Zahlen sind klar verschieden
  })
})
