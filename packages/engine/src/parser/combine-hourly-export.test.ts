import { describe, expect, it } from 'vitest'

import { combineImportWithHourlyExport, type HourlyEnergyReading } from './combine-hourly-export'
import { utcMsToLocalFields } from './datetime'

const TZ = 'Europe/Vienna'
const SLOT = 15 * 60 * 1000
const HOUR = 60 * 60 * 1000

/** 15-min-Bezug ab `startIso`; `kw(i)` je Slot. */
function import15(
  startIso: string,
  slotCount: number,
  kw: (i: number) => number,
  skip?: (ms: number) => boolean,
) {
  const start = Date.parse(startIso)
  const readings = []
  for (let i = 0; i < slotCount; i++) {
    const ms = start + i * SLOT
    if (skip?.(ms)) continue
    readings.push({ ts: new Date(ms).toISOString(), gridPowerKw: kw(i) })
  }
  return { readings, timezoneMeta: TZ }
}

function hourly(
  startIso: string,
  hours: number,
  kwh: (h: number, ms: number) => number,
): HourlyEnergyReading[] {
  const start = Date.parse(startIso)
  return Array.from({ length: hours }, (_, h) => ({
    ts: new Date(start + h * HOUR).toISOString(),
    kwh: kwh(h, start + h * HOUR),
  }))
}

/** Kombiniert und prüft die Invariante: jeder Slot mit Bezug > 0 bleibt bitgleich. */
function combine(input: Parameters<typeof combineImportWithHourlyExport>[0]) {
  const result = combineImportWithHourlyExport(input)
  const byTs = new Map(result.netSigned15.map((r) => [r.ts, r.gridPowerKw]))
  for (const r of input.import15.readings) {
    if (r.gridPowerKw > 0 && byTs.has(r.ts)) expect(byTs.get(r.ts)).toBe(r.gridPowerKw)
  }
  return result
}

describe('combineImportWithHourlyExport', () => {
  it('verteilt nur auf Nullslots: 4 Nullslots × −2 kW, 1 Nullslot −4 kW, übrige Slots bitgleich', () => {
    // Stunde 0: alle vier Slots 0; Stunde 1: nur Slot 2 ist 0.
    const values = [0, 0, 0, 0, 3.25, 1.5, 0, 2.125]
    const { netSigned15, diagnostics } = combine({
      import15: import15('2026-06-01T10:00:00Z', 8, (i) => values[i]!),
      exportHourly: hourly('2026-06-01T10:00:00Z', 2, (h) => (h === 0 ? 2 : 1)),
      exportCapKw: 10,
    })
    expect(netSigned15.map((r) => r.gridPowerKw)).toEqual([-2, -2, -2, -2, 3.25, 1.5, -4, 2.125])
    expect(diagnostics).toMatchObject({
      slots: 8,
      droppedExportKwh: 0,
      droppedExportHours: 0,
      missingExportHours: 0,
    })
  })

  it('Nullslot gedeckelt, Überlauf verworfen: 0/5/5/5 + 40 kWh → −100/5/5/5', () => {
    const { netSigned15, diagnostics } = combine({
      import15: import15('2026-06-01T10:00:00Z', 4, (i) => (i === 0 ? 0 : 5)),
      exportHourly: hourly('2026-06-01T10:00:00Z', 1, () => 40),
      exportCapKw: 100,
    })
    expect(netSigned15.map((r) => r.gridPowerKw)).toEqual([-100, 5, 5, 5])
    expect(diagnostics).toMatchObject({
      capKwUsed: 100,
      assignedExportKwh: 25,
      cappedExportKwh: 15,
      cappedExportHours: 1,
      droppedExportKwh: 0,
    })
  })

  it('Stunde ohne Nullslot: Einspeisung verworfen und gemeldet, Slots bitgleich', () => {
    const { netSigned15, diagnostics } = combine({
      import15: import15('2026-06-01T10:00:00Z', 4, () => 5),
      exportHourly: hourly('2026-06-01T10:00:00Z', 1, () => 40),
      exportCapKw: 100,
    })
    expect(netSigned15.map((r) => r.gridPowerKw)).toEqual([5, 5, 5, 5])
    expect(diagnostics).toMatchObject({ droppedExportKwh: 40, droppedExportHours: 1 })
  })

  it('nur Nullslots unter der Grenze: 0/0/0/0 + 40 kWh → −40 × 4, wie die alte Regel', () => {
    const { netSigned15, diagnostics } = combine({
      import15: import15('2026-06-01T10:00:00Z', 4, () => 0),
      exportHourly: hourly('2026-06-01T10:00:00Z', 1, () => 40),
      exportCapKw: 100,
    })
    expect(netSigned15.map((r) => r.gridPowerKw)).toEqual(Array(4).fill(-40 / (4 * 0.25)))
    expect(diagnostics.cappedExportKwh).toBe(0)
  })

  it('ohne Grenze gilt die größte Stunden-Einspeisung der Reihe als Grenze', () => {
    // Grenze 8 kW (Stunde 1: 8 kWh). Stunde 0: 1 kWh → Nullslot −4 kW; Stunde 1: Nullslot −8 kW,
    // 6 kWh darüber verworfen.
    const values = [0, 1, 1, 1, 0, 1, 1, 1]
    const { netSigned15, diagnostics } = combine({
      import15: import15('2026-06-01T10:00:00Z', 8, (i) => values[i]!),
      exportHourly: hourly('2026-06-01T10:00:00Z', 2, (h) => (h === 0 ? 1 : 8)),
    })
    expect(netSigned15.map((r) => r.gridPowerKw)).toEqual([-4, 1, 1, 1, -8, 1, 1, 1])
    expect(diagnostics).toMatchObject({ capKwUsed: 8, cappedExportKwh: 6, cappedExportHours: 1 })
  })

  it('Bilanz zugeordnet + verworfen + gedeckelt = Einspeisung, über mehrere Grenzen', () => {
    const bezug = (i: number) => [0, 0, 3, 7, 1, 0, 9, 4, 6, 6, 6, 6, 0, 0, 0, 0][i % 16]!
    const input = import15('2026-06-01T00:00:00Z', 24 * 4, bezug)
    const exportHourly = hourly('2026-06-01T00:00:00Z', 24, (h) => [0.3, 7.7, 41, 13.13, 2][h % 5]!)
    const totalKwh = exportHourly.reduce((s, r) => s + r.kwh, 0)
    for (const exportCapKw of [undefined, 3, 12, 100]) {
      const { netSigned15, diagnostics: d } = combine({
        import15: input,
        exportHourly,
        exportCapKw,
      })
      expect(
        Math.abs(d.assignedExportKwh + d.droppedExportKwh + d.cappedExportKwh - totalKwh),
      ).toBeLessThan(1e-9)
      const negativeKwh = -netSigned15.reduce((s, r) => s + Math.min(r.gridPowerKw, 0), 0) * 0.25
      expect(Math.abs(negativeKwh - d.assignedExportKwh)).toBeLessThan(1e-9)
    }
  })

  it('Positivkontrolle: mit sehr großer Grenze identisch zur alten Formel', () => {
    const bezug = (i: number) => [0, 0, 3, 7, 1, 0, 9, 4, 6, 6, 6, 6, 0, 0, 0, 0][i % 16]!
    const input = import15('2026-06-01T00:00:00Z', 24 * 4, bezug)
    const exportHourly = hourly('2026-06-01T00:00:00Z', 24, (h) => [0.3, 7.7, 41, 13.13, 2][h % 5]!)
    const { netSigned15 } = combine({ import15: input, exportHourly, exportCapKw: 1e9 })
    // Alte Regel: Stunden-Einspeisung gleichmäßig auf die Nullslots, ohne Nullslot verworfen.
    const expected = input.readings.map((r, i) => {
      if (r.gridPowerKw !== 0) return r.gridPowerKw
      const h = Math.floor(i / 4)
      const zeros = [0, 1, 2, 3].filter((q) => input.readings[h * 4 + q]!.gridPowerKw === 0).length
      return -exportHourly[h]!.kwh / (zeros * 0.25)
    })
    expect(netSigned15.map((r) => r.gridPowerKw)).toEqual(expected)
  })

  it('positive Bezugswerte bitgleich, Energiebilanz exakt, fehlende Einspeisestunde = 0 und gezählt', () => {
    // 48 h, tagsüber (Stunden 8–15) Nullslots im Wechsel mit Bezug; Einspeisung fehlt in Stunde 10.
    const kw = (i: number) => {
      const hour = Math.floor(i / 4) % 24
      return hour >= 8 && hour < 16 && i % 2 === 0 ? 0 : 0.5 + ((i * 7) % 13) / 4
    }
    const input = import15('2026-06-01T00:00:00Z', 48 * 4, kw)
    const exportHourly = hourly('2026-06-01T00:00:00Z', 48, (h) =>
      h % 24 >= 8 && h % 24 < 16 ? 1.5 + (h % 5) : 0,
    ).filter((_, h) => h !== 10)
    const { netSigned15, diagnostics } = combine({
      import15: input,
      exportHourly,
      exportCapKw: 100,
    })

    input.readings.forEach((r, i) => {
      if (r.gridPowerKw > 0) expect(netSigned15[i]!.gridPowerKw).toBe(r.gridPowerKw)
    })
    const exported = netSigned15.reduce(
      (s, r) => s + (r.gridPowerKw < 0 ? r.gridPowerKw * 0.25 : 0),
      0,
    )
    const totalExport = exportHourly.reduce((s, r) => s + r.kwh, 0)
    expect(exported).toBeCloseTo(-(totalExport - diagnostics.droppedExportKwh), 9)
    expect(diagnostics.missingExportHours).toBe(1)
    expect(netSigned15.slice(40, 44).every((r) => r.gridPowerKw >= 0)).toBe(true)
  })

  it('schneidet auf die gemeinsamen vollen Stunden beider Reihen', () => {
    const { netSigned15, diagnostics } = combine({
      // Bezug 05:15–12:00 Z, Einspeisung 07:00–15:00 Z.
      import15: import15('2026-06-01T05:15:00Z', 27, () => 1),
      exportHourly: hourly('2026-06-01T07:00:00Z', 8, () => 0),
    })
    expect(diagnostics.range).toEqual({
      from: '2026-06-01T07:00:00.000Z',
      to: '2026-06-01T12:00:00.000Z',
    })
    expect(diagnostics.slots).toBe(20)
    expect(netSigned15[0]!.ts).toBe('2026-06-01T07:00:00.000Z')

    const shifted = combine({
      import15: import15('2026-06-01T05:15:00Z', 27, () => 1),
      exportHourly: hourly('2026-06-01T03:00:00Z', 8, () => 0),
    })
    expect(shifted.diagnostics.range).toEqual({
      from: '2026-06-01T06:00:00.000Z',
      to: '2026-06-01T11:00:00.000Z',
    })
  })

  it('Sommerzeit-Tag (23 h): jede Viertelstunde bekommt die Einspeisung ihrer Ortszeit-Stunde', () => {
    // 29.03.2026, 00:00 CET = 28.03. 23:00 Z bis 24:00 CEST = 29.03. 22:00 Z.
    const { netSigned15, diagnostics } = combine({
      import15: import15('2026-03-28T23:00:00Z', 23 * 4, () => 0),
      exportHourly: hourly(
        '2026-03-28T23:00:00Z',
        23,
        (_, ms) => utcMsToLocalFields(ms, TZ).hour + 1,
      ),
    })
    expect(diagnostics.slots).toBe(92)
    for (const r of netSigned15) {
      const localHour = utcMsToLocalFields(Date.parse(r.ts), TZ).hour
      expect(r.gridPowerKw).toBe(-(localHour + 1))
    }
    expect(netSigned15.some((r) => utcMsToLocalFields(Date.parse(r.ts), TZ).hour === 2)).toBe(false)
  })

  it('Winterzeit-Tag: fehlende Doppelstunde im Bezug → deren Einspeisung verworfen und gemeldet', () => {
    // 26.10.2025, 25 h; die zweite 02:00-Stunde (01:00 Z) fehlt im Bezug.
    const missing = (ms: number) =>
      ms >= Date.parse('2025-10-26T01:00:00Z') && ms < Date.parse('2025-10-26T02:00:00Z')
    const { netSigned15, diagnostics } = combine({
      import15: import15('2025-10-25T22:00:00Z', 25 * 4, () => 0, missing),
      exportHourly: hourly('2025-10-25T22:00:00Z', 25, (h) => h + 1),
    })
    expect(diagnostics.slots).toBe(96)
    expect(diagnostics.droppedExportHours).toBe(1)
    expect(diagnostics.exportHoursWithoutImport).toBe(1)
    expect(diagnostics.droppedExportKwh).toBe(4) // Stunde Nr. 3 (Index 3) = 01:00 Z
    // Die erste 02:00-Stunde (00:00 Z) trägt ihre eigene Einspeisung, nicht die der zweiten.
    expect(netSigned15.find((r) => r.ts === '2025-10-26T00:00:00.000Z')!.gridPowerKw).toBe(-3)
    expect(netSigned15.find((r) => r.ts === '2025-10-26T02:00:00.000Z')!.gridPowerKw).toBe(-5)
  })

  it('Gegenprobe: um +1 h versetzter Stundenbezug → bestOffsetHours 1, ohne zu verschieben', () => {
    const kw = (i: number) => 1 + (Math.floor(i / 4) % 7)
    const input = import15('2026-06-01T00:00:00Z', 24 * 4, kw)
    const measuredKwh = (h: number) => kw(h * 4)
    const { netSigned15, diagnostics } = combine({
      import15: input,
      exportHourly: hourly('2026-06-01T00:00:00Z', 24, () => 0),
      importHourly: hourly('2026-06-01T01:00:00Z', 24, (h) => measuredKwh(h)),
    })
    expect(diagnostics.importCheck?.bestOffsetHours).toBe(1)
    expect(diagnostics.importCheck?.deviationAtOffsetKwh[1]).toBe(0)
    expect(diagnostics.importCheck?.hours).toBeGreaterThan(0)
    expect(netSigned15.map((r) => r.gridPowerKw)).toEqual(input.readings.map((r) => r.gridPowerKw))
  })
})
