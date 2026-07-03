import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import type { BatteryCandidate, LoadProfile, PvProfile, TariffParams } from 'shared'

import { parseLoadProfile, parsePvProfile } from '../parser'
import { topPeaksKw } from '../peaks/metrics'
import { computeBatterySavings } from '../savings/attribute'
import { recommendBattery } from '../recommendation/rank'
import {
  basisWithPvLoadProfile,
  consistentPvProfile,
  flatTariff,
  GATE_DYNAMIC_BATTERY,
  PV_EXPORT_KW,
} from '../fixtures/profiles'
import { drawSeries } from './helpers'
import { alignPvGrossToLoad } from './pv'
import { simulateBattery } from './simulate'
import { buildDispatchTrace } from './trace'

/**
 * §3.1 — PvProfile durch die volle Kette (simulateBattery → computeBatterySavings → buildDispatchTrace).
 * Deckt die vier Zusagen des Prompts ab:
 *   1. REGRESSION: PvProfile ändert Dispatch UND Ersparnis NICHT (der speicherbare Überschuss = am
 *      Zähler sichtbare Einspeisung steckt schon im signierten Netz-Lastgang). `grossPvKw` ist der
 *      EINZIGE Unterschied → alles andere bit-identisch.
 *   2. selfConsumptionSaving MIT PvProfile ≥ OHNE (hier: exakt gleich — s. Doku-Assertion).
 *   3. Bilanz-Invariante MIT PV je Slot: Verbrauch = grid − Batterie + BruttoPV, geschlossen & ≥ 0.
 *   4. Trace: `pvGenerationKw` = echte Brutto-PV (nicht mehr nur die Einspeisung).
 */

const EPS = 1e-9

describe('§3.1 PvProfile-Kette — Regression (Dispatch/Ersparnis unverändert)', () => {
  const lp = basisWithPvLoadProfile()
  const tariff = flatTariff('annual_max')
  const battery = GATE_DYNAMIC_BATTERY

  const simNoPv = simulateBattery(lp, battery, tariff)
  const simPv = simulateBattery(lp, battery, tariff, consistentPvProfile())

  it('grossPvKw ist der einzige Unterschied: Dispatch/Caps/newBilledKw/socFloor bit-identisch', () => {
    expect(simNoPv.grossPvKw).toBeUndefined()
    expect(simPv.grossPvKw).toBeDefined()

    expect(simPv.capKwByPeriod).toEqual(simNoPv.capKwByPeriod)
    expect(simPv.newBilledKw).toBe(simNoPv.newBilledKw)
    expect(simPv.startSocKwh).toBe(simNoPv.startSocKwh)
    expect(simPv.socFloorKwh).toEqual(simNoPv.socFloorKwh)
    expect(simPv.dispatch.socKwh).toEqual(simNoPv.dispatch.socKwh)
    expect(simPv.dispatch.gridAfterKw).toEqual(simNoPv.dispatch.gridAfterKw)
    expect(simPv.dispatch.batteryPowerKw).toEqual(simNoPv.dispatch.batteryPowerKw)
  })

  it('selfConsumptionSaving MIT PvProfile ≥ OHNE — hier exakt gleich (Überschuss = Einspeisung, schon im Netz)', () => {
    const savNoPv = computeBatterySavings(lp, battery, tariff, simNoPv)
    const savPv = computeBatterySavings(lp, battery, tariff, simPv)

    expect(savPv.selfConsumptionSavingPerYear).toBeGreaterThan(0) // der Fall ist nicht-trivial (echte PV)
    expect(savPv.selfConsumptionSavingPerYear).toBeGreaterThanOrEqual(savNoPv.selfConsumptionSavingPerYear)
    // Präzise: identisch, weil derselbe (pv-unabhängige) Fahrplan zugrunde liegt.
    expect(savPv).toEqual(savNoPv)

    console.log(
      `[§3.1 selfConsumption] ohne PvProfile=€${savNoPv.selfConsumptionSavingPerYear.toFixed(2)} · ` +
        `mit=€${savPv.selfConsumptionSavingPerYear.toFixed(2)} (gleich: Dispatch pv-unabhängig)`,
    )
  })
})

describe('§3.1 PvProfile-Kette — Bilanz-Invariante MIT PV (4. Strom geschlossen)', () => {
  // Kleines, hand-nachrechenbares Ein-Tages-Profil: Grundlast 5 kW, ein kurzer Peak 50 kW an zwei
  // Mittags-Slots MIT PV-Eigenverbrauch (BruttoPV 10 kW dort → wahre Last 60 kW). η=1 für runde Zahlen.
  const PEAK_SLOTS = [48, 49] // 12:00 / 12:15 (UTC)
  const t0 = Date.parse('2024-03-15T00:00:00Z')
  const STEP_MS = 15 * 60 * 1000

  const draws = Array.from({ length: 96 }, (_, i) => (PEAK_SLOTS.includes(i) ? 50 : 5))
  const grossAtPeak = 10
  const lp: LoadProfile = {
    readings: draws.map((gridPowerKw, i) => ({ ts: new Date(t0 + i * STEP_MS).toISOString(), gridPowerKw })),
    intervalMinutes: 15,
    timezoneMeta: 'UTC',
    source: 'net_signed',
  }
  const pv: PvProfile = {
    readings: lp.readings.map((r, i) => ({ ts: r.ts, pvGenerationKw: PEAK_SLOTS.includes(i) ? grossAtPeak : 0 })),
  }
  const battery: BatteryCandidate = {
    id: 'balance-100-20',
    name: 'Balance 100/20',
    manufacturer: 'Fixture',
    class: 'commercial',
    usableCapacityKwh: 100,
    maxPowerKw: 20,
    roundTripEfficiency: 1,
    pricePerKwh: 300,
    inverterIncluded: true,
    requiresFoundation: false,
    controlType: 'dynamic',
  }
  const tariff: TariffParams = flatTariff('annual_max')

  it('Peak 50 kW → cap 30 (leistungsbegrenzt), Bilanz 60 = grid(30) + Entladung(20) + PV-Eigenverbrauch(10)', () => {
    const topPeaks = topPeaksKw(lp)
    const sim = simulateBattery(lp, battery, tariff, pv)
    const dt = buildDispatchTrace(lp, tariff, sim, topPeaks)

    expect(sim.capKwByPeriod[0]!).toBeCloseTo(30, 2) // 50 − maxPowerKw(20), leistungsbegrenzt

    const day = dt.representativeDays.find((d) => d.label === 'worst_caught_peak')!
    expect(day).toBeDefined()
    // Die zwei Peak-Slots über ihren Zeitstempel finden.
    const peakTs = new Set(PEAK_SLOTS.map((i) => lp.readings[i]!.ts))
    const peaks = day.intervals.filter((iv) => peakTs.has(iv.ts))
    expect(peaks).toHaveLength(2)

    for (const iv of peaks) {
      const gridImport = Math.max(0, iv.gridPowerKw)
      const entladung = Math.max(0, -iv.batteryPowerKw)
      const einspeisung = Math.max(0, -iv.gridPowerKw)
      const pvEigen = iv.pvGenerationKw - einspeisung // PV-Eigenverbrauch = BruttoPV − Einspeisung

      // Trace trägt die ECHTE Brutto-PV (10), nicht die (hier 0) Einspeisung.
      expect(iv.pvGenerationKw).toBeCloseTo(10, 6)
      expect(iv.gridPowerKw).toBeCloseTo(30, 2)
      expect(iv.batteryPowerKw).toBeCloseTo(-20, 2)

      // (a) Prompt-Form: Verbrauch = Netzbezug + Entladung + PV-Eigenverbrauch.
      const verbrauchDecomp = gridImport + entladung + pvEigen
      // (b) Allgemeine signierte Identität: Verbrauch = grid − Batterie + BruttoPV.
      const verbrauchSigned = iv.gridPowerKw - iv.batteryPowerKw + iv.pvGenerationKw

      expect(verbrauchDecomp).toBeCloseTo(60, 2)
      expect(verbrauchSigned).toBeCloseTo(60, 2)
      expect(verbrauchDecomp).toBeCloseTo(verbrauchSigned, 6) // beide Formen geschlossen
      expect(verbrauchSigned).toBeGreaterThanOrEqual(-EPS) // nie negativ

      console.log(
        `[§3.1 Bilanz MIT PV] ${iv.ts}: Verbrauch=${verbrauchSigned.toFixed(1)} = ` +
          `grid(${gridImport.toFixed(1)}) + Entladung(${entladung.toFixed(1)}) + PV-Eigen(${pvEigen.toFixed(1)})`,
      )
    }
  })

  it('nie negativer Verbrauch über den GANZEN Tag (Bilanz an allen 96 Slots geschlossen)', () => {
    const topPeaks = topPeaksKw(lp)
    const sim = simulateBattery(lp, battery, tariff, pv)
    const dt = buildDispatchTrace(lp, tariff, sim, topPeaks)
    const day = dt.representativeDays.find((d) => d.label === 'worst_caught_peak')!
    for (const iv of day.intervals) {
      const verbrauch = iv.gridPowerKw - iv.batteryPowerKw + iv.pvGenerationKw
      expect(verbrauch).toBeGreaterThanOrEqual(-EPS)
    }
  })
})

describe('§3.1 PvProfile-Kette — Trace pvGenerationKw = echte Brutto-PV (Fallback = Einspeisung)', () => {
  const lp = basisWithPvLoadProfile()
  const tariff = flatTariff('annual_max')
  const topPeaks = topPeaksKw(lp)

  it('MIT PvProfile: PV-Slots tragen die Brutto-PV (20), nicht die Einspeisung (16)', () => {
    const sim = simulateBattery(lp, GATE_DYNAMIC_BATTERY, tariff, consistentPvProfile())
    const dt = buildDispatchTrace(lp, tariff, sim, topPeaks)
    const pvDay = dt.representativeDays.find((d) => d.label === 'pv_strong')!
    expect(pvDay).toBeDefined()
    const withGross = pvDay.intervals.filter((iv) => iv.pvGenerationKw > EPS)
    expect(withGross.length).toBeGreaterThan(0)
    expect(withGross.every((iv) => Math.abs(iv.pvGenerationKw - 20) < EPS)).toBe(true) // Brutto 20, nicht feed-in 16
  })

  it('OHNE PvProfile: Fallback auf die Einspeisung (16) — Regression zum bisherigen Verhalten', () => {
    const sim = simulateBattery(lp, GATE_DYNAMIC_BATTERY, tariff) // kein PvProfile
    const dt = buildDispatchTrace(lp, tariff, sim, topPeaks)
    const pvDay = dt.representativeDays.find((d) => d.label === 'pv_strong')!
    const withPv = pvDay.intervals.filter((iv) => iv.pvGenerationKw > EPS)
    expect(withPv.length).toBeGreaterThan(0)
    expect(withPv.every((iv) => Math.abs(iv.pvGenerationKw - PV_EXPORT_KW) < EPS)).toBe(true) // feed-in 16
  })
})

describe('§3.1 PvProfile-Kette — konsistentes Demo-Paar (dev-fixtures)', () => {
  const loadCsv = readFileSync(
    new URL('../../../../dev-fixtures/demo-baeckerei-mit-pv-netzlastgang-2023.csv', import.meta.url),
    'utf8',
  )
  const pvCsv = readFileSync(
    new URL('../../../../dev-fixtures/demo-baeckerei-pv-erzeugung-2023.csv', import.meta.url),
    'utf8',
  )

  // Einmal parsen (35.040 Zeilen je Datei), in beiden Tests wiederverwendet.
  const load = parseLoadProfile({ content: loadCsv, format: 'csv' })
  const pvOut = parsePvProfile({ content: pvCsv, format: 'csv' })
  if (!load.ok) throw new Error(`Demo-PV-Netzlastgang parst nicht: ${JSON.stringify(load).slice(0, 200)}`)
  if (!pvOut.ok) throw new Error(`Demo-PV-Erzeugung parst nicht: ${JSON.stringify(pvOut).slice(0, 200)}`)
  const loadProfile = load.profile
  const pvProfile = pvOut.profile

  it('parst (net_signed + Brutto-PV), löst die Konsistenz-Warnung NIE aus (inconsistentSlots = 0)', () => {
    expect(loadProfile.source).toBe('net_signed')
    // Einspeisung liegt tatsächlich vor (negative Netzwerte).
    expect(drawSeries(loadProfile).some((d) => d < 0)).toBe(true)

    const { inconsistentSlots } = alignPvGrossToLoad(loadProfile, pvProfile)
    expect(inconsistentSlots).toBe(0)

    console.log(
      `[§3.1 Demo-Paar] Lastgang-Slots=${loadProfile.readings.length} · ` +
        `PV-Slots=${pvProfile.readings.length} · inconsistentSlots=${inconsistentSlots}`,
    )
  })

  it('pv_strong-Tag erscheint jetzt mit ECHTER Brutto-PV (Brutto > sichtbare Einspeisung an Mittags-Slots)', () => {
    const { perBattery } = recommendBattery(
      loadProfile,
      flatTariff('annual_max'),
      [GATE_DYNAMIC_BATTERY],
      10,
      undefined,
      pvProfile,
    )
    const dt = perBattery[0]!.dispatchTrace!
    const pvDay = dt.representativeDays.find((d) => d.label === 'pv_strong')
    expect(pvDay).toBeDefined()

    // An mindestens einem Slot ist die Brutto-PV strikt größer als die sichtbare Einspeisung nach
    // Batterie — beweist, dass der Trace die ECHTE Brutto-PV führt (nicht nur den Export).
    const someGrossAboveExport = pvDay!.intervals.some(
      (iv) => iv.pvGenerationKw > Math.max(0, -iv.gridPowerKw) + 0.5,
    )
    expect(someGrossAboveExport).toBe(true)

    const maxGross = Math.max(...pvDay!.intervals.map((iv) => iv.pvGenerationKw))
    console.log(`[§3.1 Demo-Paar] pv_strong=${pvDay!.date} · max Brutto-PV=${maxGross.toFixed(1)} kW`)
  })
})
