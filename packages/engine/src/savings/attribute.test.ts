import { describe, expect, it } from 'vitest'
import type { BatteryCandidate, LoadProfile, TariffParams } from 'shared'

import { simulateBattery } from '../simulation/simulate'
import { computeBatterySavings } from './attribute'

const STEP_MS = 15 * 60 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()

function profile(days: number[][], startIso = '2023-06-01T00:00:00Z'): LoadProfile {
  const t0 = Date.parse(startIso)
  const readings = days
    .flat()
    .map((gridPowerKw, i) => ({ ts: iso(t0 + i * STEP_MS), gridPowerKw }))
  return { readings, intervalMinutes: 15, timezoneMeta: 'UTC', source: 'net_signed' }
}

/**
 * Ein Tag (96 × 15 min). `peak` ersetzt die Morgenspitze (idx 24–31) — sonst 15 kW.
 *  - idx 0–23   (00–06 h): 5 kW  · NT-Fenster (günstig)
 *  - idx 24–39  (06–10 h): 15 kW · Morgen (teuer) — bzw. `peak` in 24–31
 *  - idx 40–55  (10–14 h): −20 kW · PV-Einspeisung
 *  - idx 56–79  (14–20 h): 25 kW · Nachmittag (teuer, Eigenverbrauch)
 *  - idx 80–87  (20–22 h): 15 kW
 *  - idx 88–95  (22–24 h): 5 kW  · NT-Fenster (günstig)
 */
function day(peak?: number): number[] {
  const d = new Array<number>(96)
  for (let i = 0; i < 96; i++) {
    if (i < 24) d[i] = 5
    else if (i < 32) d[i] = peak ?? 15
    else if (i < 40) d[i] = 15
    else if (i < 56) d[i] = -20
    else if (i < 80) d[i] = 25
    else if (i < 88) d[i] = 15
    else d[i] = 5
  }
  return d
}

const battery = (controlType: 'static' | 'dynamic'): BatteryCandidate => ({
  id: 'b1',
  name: 'Test',
  manufacturer: 'Demo',
  class: 'commercial',
  usableCapacityKwh: 100,
  maxPowerKw: 50,
  roundTripEfficiency: 0.9,
  pricePerKwh: 400,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType,
})

const baseTariff: TariffParams = {
  leistungspreisEurPerKwYear: 100,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

// NT-Fenster 22:00–06:00 zu 12 ct (günstiger als der Tagespreis 25 ct) → Lastverschiebung möglich.
const withNightWindow: TariffParams = {
  ...baseTariff,
  timeOfUseWindows: [{ from: '22:00', to: '06:00', ctPerKwh: 12 }],
}

// 10 Tage: Tag 5 trägt die 90-kW-Jahresspitze (Leistungspreis), alle Tage PV + NT-Fenster.
const days = Array.from({ length: 10 }, (_, i) => day(i === 5 ? 90 : undefined))
const lp = profile(days)

describe('§3.7 Attribution ohne Doppelzählung', () => {
  it('Profil mit PV UND Tarif-Fenstern UND Spitze: alle drei Anteile > 0 und Summe = total (exakt)', () => {
    const s = computeBatterySavings(lp, battery('dynamic'), withNightWindow)

    console.log(
      `[§3.7 Attribution] leistungspreis=€${s.leistungspreisSavingPerYear.toFixed(0)} · ` +
        `eigenverbrauch=€${s.selfConsumptionSavingPerYear.toFixed(0)} · ` +
        `lastverschiebung=€${s.loadShiftSavingPerYear.toFixed(0)} · ` +
        `total=€${s.totalSavingPerYear.toFixed(0)} · newBilledKw=${s.newBilledKw.toFixed(1)}`,
    )

    // Alle drei Zwecke sind gleichzeitig aktiv.
    expect(s.leistungspreisSavingPerYear).toBeGreaterThan(0)
    expect(s.selfConsumptionSavingPerYear).toBeGreaterThan(0)
    expect(s.loadShiftSavingPerYear).toBeGreaterThan(0)

    // Kern-Invariante (Prinzip 2): keine kWh doppelt gezählt → Summe == total, exakt.
    const sum =
      s.leistungspreisSavingPerYear +
      s.selfConsumptionSavingPerYear +
      s.loadShiftSavingPerYear
    expect(s.totalSavingPerYear).toBeCloseTo(sum, 10)
  })
})

describe('§3.7 controlType (Martins Semantik, OP#5)', () => {
  it('static vs dynamic am identischen Profil: static kappt Leistungspreis auf 0 + reserve-freie Warnung', () => {
    const dyn = computeBatterySavings(lp, battery('dynamic'), withNightWindow)
    const stat = computeBatterySavings(lp, battery('static'), withNightWindow)

    // dynamic kreditiert die Spitzenkappung, static nicht.
    expect(dyn.leistungspreisSavingPerYear).toBeGreaterThan(0)
    expect(stat.leistungspreisSavingPerYear).toBe(0)
    expect(dyn.newBilledKw).toBeLessThan(stat.newBilledKw) // static: newBilledKw = alter (unkreditiert)

    // Neuer Warntext (OP#5): keine Spitzenkappung; KEIN socFloor/Reserve-Hinweis mehr.
    expect(stat.warnings.some((w) => /statisch/i.test(w) && /keine Spitzenkappung/i.test(w))).toBe(true)
    expect(stat.warnings.some((w) => /socFloor|Reserve/i.test(w))).toBe(false)
    expect(dyn.warnings).toHaveLength(0)

    // Eigenverbrauch/Lastverschiebung: static ist reserve-frei simuliert (volle Kapazität) → NICHT unter
    // die dynamische (durch die Spitzen-Reserve gebundene) Zuschreibung. total(static) = Σ der drei Töpfe.
    expect(stat.selfConsumptionSavingPerYear).toBeGreaterThanOrEqual(dyn.selfConsumptionSavingPerYear - 1e-9)
    expect(stat.totalSavingPerYear).toBeCloseTo(
      stat.selfConsumptionSavingPerYear + stat.loadShiftSavingPerYear,
      10,
    )
  })

  it('static reserve-frei (OP#5): Eigenverbrauch/Lastverschiebung ≥ alte reservierte Zuschreibung + Summe = total exakt', () => {
    // NEU: static läuft reserve-frei (simulateBattery mit cap = ∞ / socFloor ≡ 0).
    const free = computeBatterySavings(lp, battery('static'), withNightWindow)

    // ALT (zum Vergleich reproduziert): dieselbe static-Batterie, aber gegen einen MIT Spitzen-Reserve
    // gerechneten Fahrplan gebucht — das war das frühere Verhalten (static lief durch die volle,
    // reservierte Simulation, danach nur Leistungspreis auf 0). Wir erzeugen den reservierten Fahrplan
    // über die dynamische Physik und buchen ihn für die static-Batterie.
    const reservedSim = simulateBattery(lp, { ...battery('static'), controlType: 'dynamic' }, withNightWindow)
    const reserved = computeBatterySavings(lp, battery('static'), withNightWindow, reservedSim)

    const freeEvLs = free.selfConsumptionSavingPerYear + free.loadShiftSavingPerYear
    const reservedEvLs = reserved.selfConsumptionSavingPerYear + reserved.loadShiftSavingPerYear

    console.log(
      `[§3.7/OP#5 static reserve-frei] Eigenverbrauch+Lastverschiebung ` +
        `NEU(reserve-frei)=€${freeEvLs.toFixed(2)} ` +
        `(EV €${free.selfConsumptionSavingPerYear.toFixed(2)} + LS €${free.loadShiftSavingPerYear.toFixed(2)}) ` +
        `vs. ALT(mit Reserve)=€${reservedEvLs.toFixed(2)} ` +
        `(EV €${reserved.selfConsumptionSavingPerYear.toFixed(2)} + LS €${reserved.loadShiftSavingPerYear.toFixed(2)}) ` +
        `→ Delta €${(freeEvLs - reservedEvLs).toFixed(2)}`,
    )

    // Reserve-frei gibt dem Eigenverbrauch die volle Kapazität → nie schlechter als mit Reserve.
    expect(freeEvLs).toBeGreaterThanOrEqual(reservedEvLs - 1e-9)
    // Für dieses Profil (90-kW-Spitze bindet Reserve vor der Spitze) ist es echt mehr, kein Grenzfall.
    expect(freeEvLs).toBeGreaterThan(reservedEvLs + 1)

    // Nicht-Doppelzählung bleibt für static exakt (leistungspreis = 0).
    expect(free.leistungspreisSavingPerYear).toBe(0)
    expect(free.totalSavingPerYear).toBeCloseTo(
      free.leistungspreisSavingPerYear + free.selfConsumptionSavingPerYear + free.loadShiftSavingPerYear,
      10,
    )
  })

  it('dynamic-Pfad unberührt (OP#5): bit-identische Zahlen wie vor der static-Änderung', () => {
    // Baseline vor der Änderung erfasst (dynamic, withNightWindow, Batterie 100 kWh/50 kW/η0,9).
    // Der static-Fix fasst den dynamic-Zweig NICHT an → diese Zahlen müssen exakt erhalten bleiben.
    const dyn = computeBatterySavings(lp, battery('dynamic'), withNightWindow)
    expect(dyn.newBilledKw).toBeCloseTo(40.00001907348633, 8)
    expect(dyn.leistungspreisSavingPerYear).toBeCloseTo(4999.998092651367, 6)
    expect(dyn.selfConsumptionSavingPerYear).toBeCloseTo(104.04, 8)
    expect(dyn.loadShiftSavingPerYear).toBeCloseTo(110.50000495910645, 8)
    expect(dyn.totalSavingPerYear).toBeCloseTo(5214.538097610473, 6)
  })
})

describe('§3.7 loadShiftSaving nur mit Tarif-Fenstern', () => {
  it('ohne Tarif-Fenster → 0; mit HT/NT-Fenster → > 0 (konkreter Wert)', () => {
    const withoutWindows = computeBatterySavings(lp, battery('dynamic'), baseTariff)
    const withWindows = computeBatterySavings(lp, battery('dynamic'), withNightWindow)

    console.log(
      `[§3.7 Lastverschiebung] ohne Fenster=€${withoutWindows.loadShiftSavingPerYear.toFixed(2)} · ` +
        `mit NT-Fenster (25→12 ct)=€${withWindows.loadShiftSavingPerYear.toFixed(0)}`,
    )

    // Ohne günstiges Fenster kann keine Lastverschiebung entstehen.
    expect(withoutWindows.loadShiftSavingPerYear).toBe(0)
    // Eigenverbrauch (PV) läuft auch ohne Tarif-Fenster.
    expect(withoutWindows.selfConsumptionSavingPerYear).toBeGreaterThan(0)

    // Mit NT-Fenster: nachts billig laden, tagsüber teuer nutzen → echte Ersparnis.
    expect(withWindows.loadShiftSavingPerYear).toBeGreaterThan(50)
  })
})
