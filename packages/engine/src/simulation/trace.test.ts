import { describe, expect, it } from 'vitest'
import type { LoadProfile, TariffParams } from 'shared'

import { topPeaksKw } from '../peaks/metrics'
import {
  basisLoadProfile,
  basisWithPvLoadProfile,
  flatTariff,
  GATE_DYNAMIC_BATTERY,
  GATE_STATIC_BATTERY,
  SPIKE_KW,
} from '../fixtures/profiles'
import { simulateBattery } from './simulate'
import { buildDispatchTrace } from './trace'

/**
 * §3.10/§6.2 — `dispatchTrace`-Befüllung. Prüft, dass der Trace reine DATENEXTRAKTION aus dem einen
 * `simulateBattery`-Lauf ist (keine Zweitsimulation) und die vier fachlichen Zusagen hält:
 *  1. Energiebilanz je Slot (Last = grid − battery), NUMERISCH an konkreten Spitzen-Slots gezeigt.
 *  2. `worst_caught_peak` wählt den Tag der teuersten ABGEFANGENEN Spitze (bekannter Peak-Tag).
 *  3. `pv_strong` erscheint bei Einspeisung, fehlt ohne PV.
 *  4. `caughtPeaks` enthält NUR die abgefangenen, nicht alle Top-Peaks.
 *
 * Fixtures aus `fixtures/profiles.ts`: Bäckerei mit dominantem Jahres-Peak `SPIKE_KW=70` an Tag 9
 * (= 2024-02-10, UTC), Batterie 60 kWh / 20 kW / η0,9. Weil `maxPowerKw=20 < SPIKE_KW`, ist die
 * Kappung leistungsbegrenzt → cap ≈ 70 − 20 = 50, Rest-Bezug an der Spitze = 50 kW.
 */

const DELTA_H = 0.25
const ETA = GATE_DYNAMIC_BATTERY.roundTripEfficiency // 0,9
const USABLE = GATE_DYNAMIC_BATTERY.usableCapacityKwh // 60
const SPIKE_DATE = '2024-02-10'

function trace(lp: LoadProfile, battery = GATE_DYNAMIC_BATTERY, tariff: TariffParams = flatTariff('annual_max')) {
  const topPeaks = topPeaksKw(lp)
  const sim = simulateBattery(lp, battery, tariff)
  return { topPeaks, sim, dt: buildDispatchTrace(lp, tariff, sim, topPeaks) }
}

/** ts → ursprünglicher (signierter) Netzbezug, für die Energiebilanz-Rückrechnung. */
function originalDrawByTs(lp: LoadProfile): Map<string, number> {
  return new Map(lp.readings.map((r) => [r.ts, r.gridPowerKw]))
}

describe('§6.2 dispatchTrace — capKwByPeriod (1:1 aus der Kapp-Suche)', () => {
  it('reicht sim.capKwByPeriod unverändert durch (annual_max: 1 Slot, cap ≈ 50, leistungsbegrenzt)', () => {
    const { sim, dt } = trace(basisLoadProfile())
    expect(dt.capKwByPeriod).toEqual(sim.capKwByPeriod)
    expect(dt.capKwByPeriod).toHaveLength(1)
    expect(dt.capKwByPeriod[0]!).toBeGreaterThan(45)
    expect(dt.capKwByPeriod[0]!).toBeLessThan(SPIKE_KW)
  })
})

describe('§6.2 dispatchTrace — caughtPeaks (NUR abgefangene, nicht alle Top-Peaks)', () => {
  it('Basis/dynamic: die 8 Spitzen-Slots (70→50) sind abgefangen, die 12-kW-Ramp-Peaks NICHT', () => {
    const { topPeaks, dt } = trace(basisLoadProfile())

    // Top-10 = 8× Spitze (70 kW) + 2× Ofen-Anlauf (12 kW); nur die Spitzen liegen über cap≈50.
    expect(topPeaks).toHaveLength(10)
    expect(dt.caughtPeaks).toHaveLength(8)
    expect(dt.caughtPeaks.length).toBeLessThan(topPeaks.length)

    for (const c of dt.caughtPeaks) {
      expect(c.caught).toBe(true)
      expect(c.originalKw).toBeCloseTo(SPIKE_KW, 5) // 70 (roher Lastwert, exakt)
      expect(c.residualKw).toBeCloseTo(50, 3) // 70 − maxPowerKw(20); ±Binärsuch-Residual (TOLERANCE_KW=1e-4)
      expect(c.residualKw).toBeLessThan(c.originalKw) // tatsächlich gesenkt
    }
    // Kein 12-kW-Ramp-Peak hat sich eingeschlichen (die stehen in top, aber < cap → nicht abgefangen).
    expect(dt.caughtPeaks.every((c) => c.originalKw > 60)).toBe(true)

    console.log(
      `[§6.2 caughtPeaks] top=${topPeaks.length} · caught=${dt.caughtPeaks.length} · ` +
        `original=${dt.caughtPeaks[0]!.originalKw} kW → residual=${dt.caughtPeaks[0]!.residualKw} kW`,
    )
  })

  it('static (cap=∞): keine Spitze wird abgefangen → caughtPeaks leer', () => {
    const { dt } = trace(basisLoadProfile(), GATE_STATIC_BATTERY)
    expect(dt.caughtPeaks).toHaveLength(0)
    expect(dt.capKwByPeriod[0]!).toBe(Infinity)
  })
})

describe('§6.2 dispatchTrace — representativeDays.worst_caught_peak (Tag der teuersten Spitze)', () => {
  it('wählt nachweislich 2024-02-10 (den bekannten Spitzen-Tag), 96 Slots', () => {
    const { dt } = trace(basisLoadProfile())
    const worst = dt.representativeDays.find((d) => d.label === 'worst_caught_peak')
    expect(worst).toBeDefined()
    expect(worst!.date).toBe(SPIKE_DATE)
    expect(worst!.intervals).toHaveLength(96)

    // Der Tag enthält die 8 Spitzen-Slots; die teuerste abgefangene Spitze (70 kW) liegt hier.
    const drawByTs = originalDrawByTs(basisLoadProfile())
    const spikeSlots = worst!.intervals.filter((iv) => drawByTs.get(iv.ts) === SPIKE_KW)
    expect(spikeSlots).toHaveLength(8)
  })

  it('Energiebilanz je Slot: Last = grid − battery (numerisch an 3 Spitzen-Slots gezeigt)', () => {
    const lp = basisLoadProfile()
    const { dt } = trace(lp)
    const drawByTs = originalDrawByTs(lp)
    const worst = dt.representativeDays.find((d) => d.label === 'worst_caught_peak')!

    // Invariante über ALLE 96 Slots: ursprüngliche Last = gridPowerKw − batteryPowerKw.
    for (const iv of worst.intervals) {
      const originalLoad = drawByTs.get(iv.ts)!
      expect(originalLoad).toBeCloseTo(iv.gridPowerKw - iv.batteryPowerKw, 6)
    }

    // Konkrete Zerlegung an den ersten 3 Spitzen-Slots: 70 = grid(50) + Entladung(20).
    const spikeSlots = worst.intervals.filter((iv) => drawByTs.get(iv.ts) === SPIKE_KW)
    for (const iv of spikeSlots.slice(0, 3)) {
      const entladung = Math.max(0, -iv.batteryPowerKw)
      expect(iv.gridPowerKw).toBeCloseTo(50, 3) // ±Binärsuch-Residual
      expect(iv.batteryPowerKw).toBeCloseTo(-20, 3)
      expect(iv.pvGenerationKw).toBe(0) // kein PV im Basis-Profil
      expect(iv.gridPowerKw + entladung).toBeCloseTo(70, 5) // exakte Identität, unabhängig vom cap
      console.log(
        `[§6.2 Bilanz] ${iv.ts}: Last=${(iv.gridPowerKw + entladung).toFixed(1)} = ` +
          `grid(${iv.gridPowerKw.toFixed(1)}) + Entladung(${entladung.toFixed(1)}) · SoC=${iv.socKwh.toFixed(1)} kWh`,
      )
    }
  })

  it('SoC-Fortschreibung je Slot konsistent zu batteryPowerKw × Δ × η (clamp-bewusst)', () => {
    const lp = basisLoadProfile()
    const { dt } = trace(lp)
    const drawByTs = originalDrawByTs(lp)
    const worst = dt.representativeDays.find((d) => d.label === 'worst_caught_peak')!
    const iv = worst.intervals

    for (let k = 1; k < iv.length; k++) {
      const bp = iv[k]!.batteryPowerKw
      const step = bp > 0 ? bp * DELTA_H * ETA : bp * DELTA_H // Laden mit η, Entladen 1:1
      const expected = Math.min(Math.max(iv[k - 1]!.socKwh + step, 0), USABLE)
      expect(iv[k]!.socKwh).toBeCloseTo(expected, 6)
    }

    // 3 Spitzen-Slots konkret: Entladung 20 kW → ΔSoC = −20 × 0,25 = −5 kWh je Slot.
    const spikeSlots = iv.filter((s) => drawByTs.get(s.ts) === SPIKE_KW)
    for (let j = 1; j < Math.min(4, spikeSlots.length); j++) {
      const d = spikeSlots[j]!.socKwh - spikeSlots[j - 1]!.socKwh
      console.log(`[§6.2 SoC] ${spikeSlots[j]!.ts}: ΔSoC=${d.toFixed(2)} kWh (erwartet −5,00)`)
      expect(d).toBeCloseTo(-5, 5)
    }
  })
})

describe('§6.2 dispatchTrace — representativeDays.pv_strong (nur bei Einspeisung)', () => {
  it('erscheint beim PV-Fixture (Einspeisung vorhanden), zusätzlich zum worst_caught_peak', () => {
    const { dt } = trace(basisWithPvLoadProfile())
    const labels = dt.representativeDays.map((d) => d.label)
    expect(labels).toContain('worst_caught_peak')
    expect(labels).toContain('pv_strong')

    const pv = dt.representativeDays.find((d) => d.label === 'pv_strong')!
    // Der PV-Tag trägt tatsächlich Einspeisungs-Slots (pvGenerationKw > 0).
    expect(pv.intervals.some((iv) => iv.pvGenerationKw > 0)).toBe(true)
    // ...und ist ein ANDERER Tag als der Spitzen-Tag (keine Doppel-Auslieferung desselben Datums).
    expect(pv.date).not.toBe(dt.representativeDays.find((d) => d.label === 'worst_caught_peak')!.date)

    console.log(`[§6.2 pv_strong] Tag=${pv.date} · Slots mit Einspeisung=${pv.intervals.filter((iv) => iv.pvGenerationKw > 0).length}`)
  })

  it('fehlt beim no-PV-Fixture (keine Einspeisung)', () => {
    const { dt } = trace(basisLoadProfile())
    expect(dt.representativeDays.some((d) => d.label === 'pv_strong')).toBe(false)
  })

  it('static + PV: keine Kappung (kein worst_caught_peak), aber pv_strong bleibt (Einspeisung)', () => {
    const { dt } = trace(basisWithPvLoadProfile(), GATE_STATIC_BATTERY)
    expect(dt.caughtPeaks).toHaveLength(0)
    expect(dt.representativeDays.some((d) => d.label === 'worst_caught_peak')).toBe(false)
    expect(dt.representativeDays.some((d) => d.label === 'pv_strong')).toBe(true)
  })
})
