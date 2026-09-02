import { describe, expect, it } from 'vitest'
import type {
  BatteryCandidate,
  GridTariffRowInput,
  LoadProfile,
  SpotPriceSeriesInput,
  TariffParams,
  TariffPricingInputs,
} from 'shared'

import { topPeaksKw } from '../peaks/metrics'
import type { BatterySimulationResult } from './simulate'
import { simulateBattery } from './simulate'
import { buildDispatchTrace } from './trace'

/**
 * Stunden-Heatmap + Ø-Ladepreis im `dispatchTrace` (02.09.2026).
 *
 * ── ⚠ ZWEI ARTEN VON TESTS, UND SIE PRÜFEN VERSCHIEDENES ───────────────────────────────────────
 * (1) ARITHMETIK gegen einen VON HAND gebauten `BatterySimulationResult`: `buildDispatchTrace` ist
 *     reine Datenextraktion, also lässt sich jede Zelle und jeder Mittelwert exakt vorrechnen.
 *     Ein Test, der die Zahlen aus einem echten Dispatch nachrechnet, prüfte sonst zwei Dinge auf
 *     einmal und bliebe grün, wenn beide gleich falsch wären.
 * (2) VERHALTEN über die volle Kette (`simulateBattery` mit echter Preiskurve): dort geht es um die
 *     Aussage, die die Grafik trifft — dass die Ladestunden der Preiskurve folgen und dass der
 *     Ladepreis unter dem Monatsdurchschnitt liegt.
 *
 * ── ⚠ DIE 1/η-FALLE ────────────────────────────────────────────────────────────────────────────
 * `chargedKwh` ist NETZSEITIG (`batteryPowerKw × Δt`). Die naheliegende falsche Umsetzung nimmt
 * stattdessen die SoC-Differenz (`socKwh[i] − socKwh[i−1]`) — beim Laden ist das `P·Δ·η`, also um
 * den Wirkungsgrad zu wenig. Auf den PREIS wirkt das nicht (ein gewichtetes Mittel ist gegen einen
 * konstanten Faktor auf allen Gewichten invariant), auf die MENGE sehr wohl. Genau deshalb steht
 * `chargedKwh` im Contract und wird hier hart gepinnt: an ihm allein ist die Verwechslung messbar.
 */

const STEP_MS = 15 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000
const DELTA_H = 0.25
const iso = (ms: number): string => new Date(ms).toISOString()

// ── (1) ARITHMETIK: von Hand gebauter Fahrplan ────────────────────────────────────────────────

/** Wirkungsgrad des Hand-Fahrplans — bewusst 0,8, damit die SoC-Seite um volle 20 % danebenläge. */
const HAND_ETA = 0.8

/**
 * Ein Simulationsergebnis von Hand: Batterieleistung und Preisreihe sind die Eingaben, `socKwh`
 * wird daraus KONSISTENT zur Dispatch-Physik fortgeschrieben (`soc += P·Δ·η` beim Laden,
 * `soc −= P·Δ` beim Entladen). Nur so trifft die Wächter-Probe „SoC-Differenz statt Netzseite"
 * überhaupt eine plausible Zahl, statt an einer offensichtlich unsinnigen zu scheitern.
 */
function handSim(
  load: LoadProfile,
  batteryPowerKw: number[],
  rateCtPerKwh: number[],
  priceCurveComputable = true,
): BatterySimulationResult {
  const socKwh: number[] = []
  let soc = 0
  for (const p of batteryPowerKw) {
    soc += p > 0 ? p * DELTA_H * HAND_ETA : p * DELTA_H
    socKwh.push(soc)
  }
  return {
    capKwByPeriod: [Infinity],
    newBilledKw: 0,
    socFloorKwh: batteryPowerKw.map(() => 0),
    dispatch: {
      socKwh,
      gridAfterKw: load.readings.map((r, i) => r.gridPowerKw + (batteryPowerKw[i] ?? 0)),
      batteryPowerKw,
    },
    startSocKwh: 0,
    rateCtPerKwh,
    priceCurveComputable,
  }
}

const FLAT_TARIFF: TariffParams = {
  leistungspreisEurPerKwYear: 0,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

/** Ein Kalendertag im 15-min-Gitter, UTC — „Stunde h" ist damit ohne Umrechnung Intervall 4h..4h+3. */
function oneDayUtc(startIso: string, drawKw = 10): LoadProfile {
  const t0 = Date.parse(startIso)
  return {
    readings: Array.from({ length: 96 }, (_, i) => ({ ts: iso(t0 + i * STEP_MS), gridPowerKw: drawKw })),
    intervalMinutes: 15,
    timezoneMeta: 'UTC',
    source: 'import_only',
  }
}

/**
 * Der Hand-Fahrplan: 1. März 2025 (Monatsindex 2), ein Tag.
 *   • Stunde 0  → +8 kW laden  ⇒ 4 × 2 kWh   =  8 kWh zu 10 ct
 *   • Stunde 1  → +4 kW laden  ⇒ 4 × 1 kWh   =  4 kWh zu 20 ct
 *   • Stunde 18 → −6 kW entladen ⇒ 4 × 1,5 kWh = 6 kWh zu 40 ct
 *   • alle übrigen Stunden: 0 kW, Preis 30 ct
 */
function handCase() {
  const load = oneDayUtc('2025-03-01T00:00:00Z')
  const power = new Array<number>(96).fill(0)
  const rates = new Array<number>(96).fill(30)
  for (let i = 0; i < 4; i++) {
    power[i] = 8
    rates[i] = 10
  }
  for (let i = 4; i < 8; i++) {
    power[i] = 4
    rates[i] = 20
  }
  for (let i = 72; i < 76; i++) {
    power[i] = -6
    rates[i] = 40
  }
  const sim = handSim(load, power, rates)
  return { load, sim, trace: buildDispatchTrace(load, FLAT_TARIFF, sim, topPeaksKw(load)) }
}

describe('Stunden-Heatmap — Netto-Batteriefluss je (Stunde × Monat)', () => {
  it('hat 24 × 12 Zellen und trägt die von Hand gerechneten kWh an genau den richtigen Stellen', () => {
    const { trace } = handCase()
    const grid = trace.batteryFlowByHourMonth!
    expect(grid).toHaveLength(24)
    for (const row of grid) expect(row).toHaveLength(12)

    // März = Index 2. 8 kWh in Stunde 0, 4 kWh in Stunde 1, −6 kWh in Stunde 18.
    expect(grid[0]![2]).toBeCloseTo(8, 12)
    expect(grid[1]![2]).toBeCloseTo(4, 12)
    expect(grid[18]![2]).toBeCloseTo(-6, 12)
  })

  it('⚠ `0` heisst „Speicher ruht", `null` heisst „kein Messwert" — beides kommt vor', () => {
    const { trace } = handCase()
    const grid = trace.batteryFlowByHourMonth!

    // Stunde 12 im März IST gemessen, es fliesst nur nichts → echte 0, kein null.
    expect(grid[12]![2]).toBe(0)
    // Jeder andere Monat ist gar nicht abgedeckt → null in ALLEN 24 Stunden.
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 12; m++) {
        if (m === 2) continue
        expect(grid[h]![m]).toBeNull()
      }
    }
  })

  it('die Summe aller Zellen ist die netzseitige Netto-Energie des Fahrplans (8 + 4 − 6 = 6 kWh)', () => {
    const { sim, trace } = handCase()
    const cellSum = trace
      .batteryFlowByHourMonth!.flat()
      .reduce<number>((acc, v) => (v == null ? acc : acc + v), 0)
    const fromDispatch = sim.dispatch.batteryPowerKw.reduce((acc, p) => acc + p * DELTA_H, 0)

    expect(cellSum).toBeCloseTo(6, 12)
    expect(cellSum).toBeCloseTo(fromDispatch, 12)
  })

  it('⚠ gruppiert nach LOKALER Wanduhr, nicht nach UTC (Wien: 23:00Z am 31.12. ist 00:00 am 1.1.)', () => {
    // Ein einziges Intervall, das die beiden Lesarten maximal auseinanderzieht: in UTC der
    // 31. Dezember 23 Uhr (Monat 11, Stunde 23), in Wien der 1. Jänner 0 Uhr (Monat 0, Stunde 0).
    const load: LoadProfile = {
      readings: [{ ts: '2024-12-31T23:00:00.000Z', gridPowerKw: 10 }],
      intervalMinutes: 15,
      timezoneMeta: 'Europe/Vienna',
      source: 'import_only',
    }
    const sim = handSim(load, [8], [10])
    const grid = buildDispatchTrace(load, FLAT_TARIFF, sim, topPeaksKw(load)).batteryFlowByHourMonth!

    expect(grid[0]![0]).toBeCloseTo(2, 12) // 8 kW × 0,25 h — Jänner, Stunde 0 (Wien)
    expect(grid[23]![11]).toBeNull() // Dezember, Stunde 23 — die UTC-Lesart, hier leer
  })
})

describe('Ø-Ladepreis je Monat — gewichtet, netzseitig, mit Vergleichswert', () => {
  it('ist das MIT DER MENGE gewichtete Mittel (13,33 ct), nicht das arithmetische (15 ct)', () => {
    const { trace } = handCase()
    const price = trace.monthlyChargePrice!

    // (8 kWh × 10 ct + 4 kWh × 20 ct) / 12 kWh = 160 / 12 = 13,333… ct.
    // Das arithmetische Mittel der beiden Preise wäre 15 ct — der Unterschied IST die Aussage.
    expect(price.chargeCtPerKwh[2]).toBeCloseTo(160 / 12, 10)
    expect(price.chargeCtPerKwh[2]).not.toBeCloseTo(15, 3)
  })

  it('⚠ `chargedKwh` ist NETZSEITIG (12 kWh) — die SoC-Seite läge bei 9,6 kWh, um η daneben', () => {
    const { sim, trace } = handCase()
    const price = trace.monthlyChargePrice!

    // Netzseitig bezogen: 8 + 4 = 12 kWh. Das ist die bezahlte Menge.
    expect(price.chargedKwh[2]).toBeCloseTo(12, 12)

    // Die SoC-Seite (`soc[i] − soc[i−1]`, also P·Δ·η) — die naheliegende falsche Umsetzung.
    // Sie ist hier ausgerechnet, damit der Test SAGT, wogegen er sich richtet, statt es nur zu
    // vermeiden: 12 × 0,8 = 9,6 kWh. Ein Wächter, der die falsche Zahl nicht nennt, fängt sie nicht.
    const socSideCharged = sim.dispatch.socKwh.reduce((acc, soc, i) => {
      const delta = soc - (i === 0 ? 0 : sim.dispatch.socKwh[i - 1]!)
      return delta > 0 ? acc + delta : acc
    }, 0)
    expect(socSideCharged).toBeCloseTo(9.6, 10)
    expect(price.chargedKwh[2]).not.toBeCloseTo(socSideCharged, 3)

    // Entladen: dort sind beide Seiten identisch (`soc −= P·Δ`, kein η) — die Asymmetrie ist echt.
    expect(price.dischargedKwh[2]).toBeCloseTo(6, 12)
  })

  it('der Entladepreis ist ebenfalls mengengewichtet (40 ct)', () => {
    const { trace } = handCase()
    expect(trace.monthlyChargePrice!.dischargeCtPerKwh[2]).toBeCloseTo(40, 10)
  })

  it('der Vergleichswert ist das UNGEWICHTETE Mittel ALLER Intervalle des Monats (29,17 ct)', () => {
    const { trace } = handCase()
    // 4×10 + 4×20 + 4×40 + 84×30 = 40 + 80 + 160 + 2520 = 2800; 2800 / 96 = 29,1666… ct.
    expect(trace.monthlyChargePrice!.averageCtPerKwh[2]).toBeCloseTo(2800 / 96, 10)
    // Ohne ihn wäre der Ladepreis eine Zahl ohne Massstab — hier liegt er sichtbar darunter.
    expect(trace.monthlyChargePrice!.chargeCtPerKwh[2]!).toBeLessThan(
      trace.monthlyChargePrice!.averageCtPerKwh[2]!,
    )
  })

  it('nicht abgedeckte Monate sind durchgehend `null` — in allen fünf Reihen', () => {
    const { trace } = handCase()
    const price = trace.monthlyChargePrice!
    for (let m = 0; m < 12; m++) {
      if (m === 2) continue
      expect(price.chargeCtPerKwh[m]).toBeNull()
      expect(price.dischargeCtPerKwh[m]).toBeNull()
      expect(price.averageCtPerKwh[m]).toBeNull()
      expect(price.chargedKwh[m]).toBeNull()
      expect(price.dischargedKwh[m]).toBeNull()
    }
  })

  it('gemessener Monat OHNE Ladevorgang: Menge 0, Preis `null` (nie eine 0 als Preis)', () => {
    const load = oneDayUtc('2025-03-01T00:00:00Z')
    const sim = handSim(load, new Array<number>(96).fill(0), new Array<number>(96).fill(30))
    const price = buildDispatchTrace(load, FLAT_TARIFF, sim, topPeaksKw(load)).monthlyChargePrice!

    expect(price.chargedKwh[2]).toBe(0) // gemessen: es wurde nichts geladen
    expect(price.chargeCtPerKwh[2]).toBeNull() // 0 ct wäre ein Preis, den nie jemand bezahlt hat
    expect(price.averageCtPerKwh[2]).toBeCloseTo(30, 12) // der Monat ist trotzdem bewertbar
  })

  it('⚠ OHNE echte Preiskurve entsteht der Ø-Ladepreis GAR NICHT — die Heatmap bleibt', () => {
    const load = oneDayUtc('2025-03-01T00:00:00Z')
    const power = new Array<number>(96).fill(0)
    power[0] = 8
    // `priceCurveComputable: false` = Hebel nicht angefordert oder nicht rechenbar. Die Preisreihe
    // ist dann durchgehend der Standard-Arbeitspreis; eine Auswertung darüber zeigte in jedem Monat
    // dieselbe Zahl und behauptete, die Ladesteuerung bringe nichts.
    const sim = handSim(load, power, new Array<number>(96).fill(25), false)
    const trace = buildDispatchTrace(load, FLAT_TARIFF, sim, topPeaksKw(load))

    expect(trace.monthlyChargePrice).toBeUndefined()
    expect(trace.batteryFlowByHourMonth![0]![2]).toBeCloseTo(2, 12)
  })
})

// ── (2) VERHALTEN über die volle Kette ────────────────────────────────────────────────────────

const FLAT_GRID: GridTariffRowInput = {
  validFrom: '2024-12-01',
  validUntil: null,
  netzverlustCtPerKwh: 0,
  priceBasis: 'net',
  windows: [
    {
      label: 'normal',
      monthDayFrom: null,
      monthDayTo: null,
      timeFrom: '00:00:00',
      timeTo: '24:00:00',
      ctPerKwh: 0,
    },
  ],
}

const CHAIN_BATTERY: BatteryCandidate = {
  id: 'chain-40',
  name: 'Prüfspeicher 40',
  manufacturer: '[TEST]',
  usableCapacityKwh: 40,
  maxPowerKw: 10,
  roundTripEfficiency: 0.9,
  pricePerKwh: 300,
  klasse: 'commercial',
  controlType: 'dynamic',
  requiresFoundation: false,
  inverterIncluded: true,
}

/** Winter: billig nachts (2–4 Uhr). Sommer: billig mittags (11–13 Uhr). Sonst 30 ct. */
const WINTER_CHEAP = [2, 3, 4]
const SUMMER_CHEAP = [11, 12, 13]
function seasonalPrice(utcMs: number): number {
  const d = new Date(utcMs)
  const cheap = d.getUTCMonth() >= 4 && d.getUTCMonth() <= 8 ? SUMMER_CHEAP : WINTER_CHEAP
  return cheap.includes(d.getUTCHours()) ? 5 : 30
}

/**
 * Ein durchgehender Lastgang 1.1.–31.7.2025 (UTC), konstante 10 kW Last, keine PV, kein
 * Leistungspreis — damit steht die Ladesteuerung allein, und die Heatmap zeigt ausschliesslich,
 * WANN der Preis sie ziehen konnte.
 */
function chainCase() {
  const t0 = Date.parse('2025-01-01T00:00:00Z')
  const t1 = Date.parse('2025-08-01T00:00:00Z')
  const intervals = Math.round((t1 - t0) / STEP_MS)
  const load: LoadProfile = {
    readings: Array.from({ length: intervals }, (_, i) => ({
      ts: iso(t0 + i * STEP_MS),
      gridPowerKw: 10,
    })),
    intervalMinutes: 15,
    timezoneMeta: 'UTC',
    source: 'import_only',
  }
  const hours = Math.round((t1 - t0) / ONE_HOUR_MS)
  const spotPrices: SpotPriceSeriesInput = {
    prices: Array.from({ length: hours }, (_, h) => ({
      tsStart: iso(t0 + h * ONE_HOUR_MS),
      tsEnd: iso(t0 + (h + 1) * ONE_HOUR_MS),
      ctPerKwh: seasonalPrice(t0 + h * ONE_HOUR_MS),
      priceBasis: 'net' as const,
    })),
    complete: true,
    missingRanges: [],
  }
  const pricing: TariffPricingInputs = { gridTariffRows: [FLAT_GRID], spotPrices }
  const sim = simulateBattery(load, CHAIN_BATTERY, FLAT_TARIFF, undefined, pricing)
  expect(sim.priceCurveComputable).toBe(true)
  return { load, sim, trace: buildDispatchTrace(load, FLAT_TARIFF, sim, topPeaksKw(load)) }
}

/** Die Stunde mit der grössten NETTO-Ladung in diesem Monat. */
function peakChargeHour(grid: (number | null)[][], month: number): number {
  let best = -1
  let bestValue = -Infinity
  for (let h = 0; h < 24; h++) {
    const v = grid[h]![month]
    if (v != null && v > bestValue) {
      bestValue = v
      best = h
    }
  }
  return best
}

describe('volle Kette — die Ladestunden folgen der Preiskurve (Nacht → Mittag)', () => {
  it('⚠ die Hauptladestunde wandert von der Nacht (Jänner) in den Mittag (Juli)', () => {
    const { trace } = chainCase()
    const grid = trace.batteryFlowByHourMonth!

    // Ein Test, der nur „irgendwann wird geladen" prüft, bliebe auch bei einer preisblinden
    // Steuerung grün. Gemessen wird deshalb, WELCHE Stunde je Monat die meiste Ladung trägt —
    // und das Preismuster verschiebt sie zwischen Winter und Sommer um neun Stunden.
    const januaryPeak = peakChargeHour(grid, 0)
    const julyPeak = peakChargeHour(grid, 6)

    expect(WINTER_CHEAP).toContain(januaryPeak)
    expect(SUMMER_CHEAP).toContain(julyPeak)
    expect(januaryPeak).not.toBe(julyPeak)

    // Und in der jeweils ANDEREN Saisonstunde wird in diesem Monat netto nicht geladen.
    for (const h of SUMMER_CHEAP) expect(grid[h]![0]!).toBeLessThanOrEqual(0)
    for (const h of WINTER_CHEAP) expect(grid[h]![6]!).toBeLessThanOrEqual(0)
  })

  it('der Ø-Ladepreis liegt in jedem gemessenen Monat unter dem Monatsdurchschnitt', () => {
    const { trace } = chainCase()
    const price = trace.monthlyChargePrice!

    let measured = 0
    for (let m = 0; m < 12; m++) {
      const charge = price.chargeCtPerKwh[m]
      const average = price.averageCtPerKwh[m]
      if (charge == null || average == null) continue
      measured += 1
      // Das ist die Aussage der Grafik: die Steuerung hat die günstigen Stunden getroffen.
      expect(charge).toBeLessThan(average)
      // …und sie hat teurer abgegeben, als sie bezogen hat.
      expect(price.dischargeCtPerKwh[m]!).toBeGreaterThan(charge)
    }
    expect(measured).toBe(7) // Jänner bis Juli
    for (let m = 7; m < 12; m++) expect(price.averageCtPerKwh[m]).toBeNull()
  })

  it('die Heatmap-Summe deckt sich mit der netzseitigen Netto-Energie des Dispatchs', () => {
    const { sim, trace } = chainCase()
    const cellSum = trace
      .batteryFlowByHourMonth!.flat()
      .reduce<number>((acc, v) => (v == null ? acc : acc + v), 0)
    const fromDispatch = sim.dispatch.batteryPowerKw.reduce((acc, p) => acc + p * DELTA_H, 0)
    expect(cellSum).toBeCloseTo(fromDispatch, 6)
  })
})
