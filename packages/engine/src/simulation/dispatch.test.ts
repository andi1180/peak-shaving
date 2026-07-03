import { describe, expect, it } from 'vitest'
import type { LoadProfile, TariffParams } from 'shared'

import { searchCaps } from './cap-search'
import { runCombinedDispatch } from './dispatch'
import { drawSeries, intervalHours, startSoc, type BatteryPhysics } from './helpers'
import { computeSocFloor } from './reserve'
import { simulateBattery } from './simulate'

const STEP_MS = 15 * 60 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()
const repeat = (kw: number, n: number): number[] => Array.from({ length: n }, () => kw)

function series(startIso: string, kws: number[]): Array<{ ts: string; gridPowerKw: number }> {
  const t0 = Date.parse(startIso)
  return kws.map((kw, i) => ({ ts: iso(t0 + i * STEP_MS), gridPowerKw: kw }))
}

function loadProfile(
  kws: number[],
  overrides: Partial<LoadProfile> = {},
  startIso = '2023-01-01T00:00:00Z',
): LoadProfile {
  return {
    readings: series(startIso, kws),
    intervalMinutes: 15,
    timezoneMeta: 'UTC',
    source: 'net_signed',
    ...overrides,
  }
}

const EPS = 1e-6

describe('§3.6 Spitzen-Reserve — Schritt 4 (Eigenverbrauch) darf soc(t) nie unter socFloor(t) senken', () => {
  // Batterie: 100 kWh / 100 kW, η=1 (klare Reserve-Arithmetik).
  const battery: BatteryPhysics = { usableCapacityKwh: 100, maxPowerKw: 100, roundTripEfficiency: 1 }
  // annual_max, EINE Periode:
  //  Phase 1 (idx 0–3):   −50 kW Einspeisung → PV-Überschuss lädt die Batterie 50→100 (Schritt 3).
  //  Phase 2 (idx 4–63):  +20 kW Bezug → Eigenverbrauchs-VERSUCHUNG (naiv würde die Batterie leergefahren).
  //  Phase 3 (idx 64–71): +90 kW anhaltende Spitze → braucht die Reserve, sonst verpasst.
  //  Phase 4 (idx 72–…):  +5 kW Ausklang.
  const kws = [...repeat(-50, 4), ...repeat(20, 60), ...repeat(90, 8), ...repeat(5, 40)]
  const PHASE3_START = 64
  const PHASE3_END = 72

  const lp = loadProfile(kws)
  const draws = drawSeries(lp)
  const deltaH = intervalHours(lp)
  const s0 = startSoc(battery)

  const { capKwByPeriod } = searchCaps(lp, battery, 'annual_max')
  const cap = capKwByPeriod[0] ?? NaN
  const capForInterval = draws.map(() => cap)
  const socFloor = computeSocFloor(draws, capForInterval, battery, deltaH)

  // Der ECHTE Dispatch (respektiert die Reserve).
  const real = runCombinedDispatch(draws, capForInterval, socFloor, battery, s0, deltaH)
  // Kontrast: NAIVER Dispatch mit socFloor ≡ 0 (Eigenverbrauch ignoriert die Reserve).
  const naive = runCombinedDispatch(draws, capForInterval, draws.map(() => 0), battery, s0, deltaH)

  const socEntering = (soc: number[], i: number): number => (i === 0 ? s0 : (soc[i - 1] ?? 0))
  const maxGridIn = (grid: number[], from: number, to: number): number => {
    let m = 0
    for (let i = from; i < to; i++) m = Math.max(m, grid[i] ?? 0)
    return m
  }

  it('die Reserve steigt VOR der Spitze an (voller Rückblick auf das Jahresprofil)', () => {
    expect(cap).toBeCloseTo(40, 0) // (90−cap)·0,25·8 ≤ 100 → cap ≈ 40
    // Zu Beginn der anhaltenden Spitze muss ~die volle Kapazität reserviert sein.
    expect(socFloor[PHASE3_START] ?? 0).toBeGreaterThan(90)
    // Weit vor der Spitze ist die Reserve ~0 (Batterie darf für Eigenverbrauch frei genutzt werden).
    expect(socFloor[10] ?? 0).toBeLessThan(1)
  })

  it('ECHTER Dispatch: soc(t) bleibt überall ≥ socFloor(t) UND die Spitze wird gehalten (≤ cap)', () => {
    for (let i = 0; i < draws.length; i++) {
      expect(socEntering(real.socKwh, i)).toBeGreaterThanOrEqual((socFloor[i] ?? 0) - EPS)
    }
    const realPeakGrid = maxGridIn(real.gridAfterKw, PHASE3_START, PHASE3_END)
    expect(realPeakGrid).toBeLessThanOrEqual(cap + EPS)
  })

  it('NAIVER Dispatch (ohne Reserve) verletzt die Reserve UND verpasst die Spitze — zeigt, dass die Reserve nötig ist', () => {
    // Naiver Eigenverbrauch fährt die Batterie in Phase 2 leer → zu Spitzenbeginn ~0 kWh.
    const naiveSocAtPeak = socEntering(naive.socKwh, PHASE3_START)
    const realSocAtPeak = socEntering(real.socKwh, PHASE3_START)
    const naivePeakGrid = maxGridIn(naive.gridAfterKw, PHASE3_START, PHASE3_END)
    const realPeakGrid = maxGridIn(real.gridAfterKw, PHASE3_START, PHASE3_END)

    console.log(
      `[§3.6 Reserve] cap=${cap.toFixed(1)} kW · socFloor@Spitze=${(socFloor[PHASE3_START] ?? 0).toFixed(1)} kWh · ` +
        `SoC@Spitze ECHT=${realSocAtPeak.toFixed(1)} kWh / NAIV=${naiveSocAtPeak.toFixed(1)} kWh · ` +
        `Netzspitze ECHT=${realPeakGrid.toFixed(1)} kW / NAIV=${naivePeakGrid.toFixed(1)} kW`,
    )

    // Reserve verletzt: naiver SoC beim Spitzenbeginn liegt klar unter der Reserve.
    expect(naiveSocAtPeak).toBeLessThan((socFloor[PHASE3_START] ?? 0) - 50)
    // Spitze verpasst: der naive Netzbezug schießt weit über cap (kaum/nicht gekappt).
    expect(naivePeakGrid).toBeGreaterThan(cap + 20)
    // Der echte Dispatch hält die Spitze dagegen.
    expect(realPeakGrid).toBeLessThanOrEqual(cap + EPS)
  })
})

describe('§3.6 Harte Constraints — soc ∈ [0, Kapazität], |Leistung| ≤ maxPowerKw, Energiebilanz', () => {
  // Mehrere Szenarien inkl. η < 1, PV (negative Werte) und monatlicher Abrechnung (mehrere Perioden).
  const scenarios: Array<{ name: string; lp: LoadProfile; battery: BatteryPhysics; billingModel: TariffParams['billingModel'] }> = [
    {
      name: 'Bäckerei-artig, kein PV, η=0,85, annual_max',
      lp: loadProfile([...Array.from({ length: 96 * 20 }, (_, i) => (i % 96 < 24 ? 3 : i % 96 < 40 ? 55 : 22))]),
      battery: { usableCapacityKwh: 120, maxPowerKw: 60, roundTripEfficiency: 0.85 },
      billingModel: 'annual_max',
    },
    {
      name: 'mit PV-Überschuss (negative Werte), η=0,9, monthly_max_average über 2 Monate',
      lp: loadProfile(
        [
          ...Array.from({ length: 96 * 20 }, (_, i) => (i % 96 < 20 ? 4 : i % 96 < 44 ? -30 : i % 96 < 60 ? 48 : 18)),
          ...Array.from({ length: 96 * 10 }, (_, i) => (i % 96 < 20 ? 4 : i % 96 < 44 ? -25 : i % 96 < 60 ? 52 : 20)),
        ],
        {},
        '2023-03-01T00:00:00Z',
      ),
      battery: { usableCapacityKwh: 80, maxPowerKw: 40, roundTripEfficiency: 0.9 },
      billingModel: 'monthly_max_average',
    },
    {
      name: 'kleine Batterie relativ zur Last, η=0,88, annual_max',
      lp: loadProfile(Array.from({ length: 96 * 15 }, (_, i) => (i % 96 < 32 ? 6 : i % 96 < 52 ? 70 : 30))),
      battery: { usableCapacityKwh: 25, maxPowerKw: 15, roundTripEfficiency: 0.88 },
      billingModel: 'annual_max',
    },
  ]

  for (const sc of scenarios) {
    it(`${sc.name}: alle harten Grenzen eingehalten`, () => {
      const draws = drawSeries(sc.lp)
      const deltaH = intervalHours(sc.lp)
      const { capKwByPeriod } = searchCaps(sc.lp, sc.battery, sc.billingModel)
      // capForInterval aus den Perioden-Caps (annual: 1 Slot; monthly: nach lokalem Monat).
      const monthIdx = sc.lp.readings.map((r) => new Date(r.ts).getUTCMonth())
      const capForInterval =
        sc.billingModel === 'annual_max'
          ? draws.map(() => capKwByPeriod[0] ?? Infinity)
          : monthIdx.map((m) => capKwByPeriod[m] ?? Infinity)
      const socFloor = computeSocFloor(draws, capForInterval, sc.battery, deltaH)
      const s0 = startSoc(sc.battery)
      const { socKwh, gridAfterKw, batteryPowerKw } = runCombinedDispatch(
        draws,
        capForInterval,
        socFloor,
        sc.battery,
        s0,
        deltaH,
      )

      const cap = sc.battery
      for (let i = 0; i < draws.length; i++) {
        const soc = socKwh[i] ?? -1
        const p = batteryPowerKw[i] ?? 0
        // soc stets in [0, usableCapacityKwh].
        expect(soc).toBeGreaterThanOrEqual(-EPS)
        expect(soc).toBeLessThanOrEqual(cap.usableCapacityKwh + EPS)
        // Leistung nie über maxPowerKw (laden wie entladen).
        expect(Math.abs(p)).toBeLessThanOrEqual(cap.maxPowerKw + EPS)
        // Energiebilanz: gridAfter = draw + batteryPower (Vorzeichen konsistent).
        expect(gridAfterKw[i] ?? 0).toBeCloseTo((draws[i] ?? 0) + p, 6)
        // socFloor selbst bleibt in [0, Kapazität].
        expect(socFloor[i] ?? -1).toBeGreaterThanOrEqual(-EPS)
        expect(socFloor[i] ?? Infinity).toBeLessThanOrEqual(cap.usableCapacityKwh + EPS)
      }
    })
  }

  it('simulateBattery-Orchestrator (η=0,9) hält dieselben Grenzen und kappt spürbar', () => {
    const lp = loadProfile(Array.from({ length: 96 * 30 }, (_, i) => (i % 96 < 24 ? 5 : i % 96 < 44 ? 60 : 25)))
    const tariff: TariffParams = {
      leistungspreisEurPerKwYear: 100,
      billingModel: 'annual_max',
      minBillableKw: 0,
      energyPriceCtPerKwh: 25,
      einspeiseverguetungCtPerKwh: 7,
    }
    const res = simulateBattery(
      lp,
      {
        id: 'c1',
        name: 'Test Commercial',
        manufacturer: 'Demo',
        class: 'commercial',
        usableCapacityKwh: 100,
        maxPowerKw: 50,
        roundTripEfficiency: 0.9,
        pricePerKwh: 400,
        inverterIncluded: true,
        requiresFoundation: false,
        controlType: 'dynamic',
      },
      tariff,
    )
    for (const soc of res.dispatch.socKwh) {
      expect(soc).toBeGreaterThanOrEqual(-EPS)
      expect(soc).toBeLessThanOrEqual(100 + EPS)
    }
    for (const p of res.dispatch.batteryPowerKw) expect(Math.abs(p)).toBeLessThanOrEqual(50 + EPS)
    // newBilledKw = TariffStrategy auf dem gekappten Profil → deutlich unter dem rohen Peak (60 kW).
    expect(res.newBilledKw).toBeLessThan(60)
    expect(res.capKwByPeriod[0] ?? Infinity).toBeLessThan(60)
  })
})
