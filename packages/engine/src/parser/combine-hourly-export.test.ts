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

describe('combineImportWithHourlyExport', () => {
  it('verteilt nur auf Nullslots: 4 Nullslots × −2 kW, 1 Nullslot −4 kW, übrige Slots bitgleich', () => {
    // Stunde 0: alle vier Slots 0; Stunde 1: nur Slot 2 ist 0.
    const values = [0, 0, 0, 0, 3.25, 1.5, 0, 2.125]
    const { netSigned15, diagnostics } = combineImportWithHourlyExport({
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

  it('Nullslot gedeckelt, Überlauf auf die Bezugsslots: 0/5/5/5 + 40 kWh → −100/−15/−15/−15', () => {
    const values = [0, 5, 5, 5]
    const { netSigned15, diagnostics } = combineImportWithHourlyExport({
      import15: import15('2026-06-01T10:00:00Z', 4, (i) => values[i]!),
      exportHourly: hourly('2026-06-01T10:00:00Z', 1, () => 40),
      exportCapKw: 100,
    })
    // Die alte Regel hätte die ganze Stunde in den einen Nullslot gelegt: −40 / 0,25 = −160 kW.
    expect(-40 / (1 * 0.25)).toBe(-160)
    expect(netSigned15.map((r) => r.gridPowerKw)).toEqual([-100, -15, -15, -15])
    expect(diagnostics).toMatchObject({
      assignedExportKwh: 40,
      droppedExportKwh: 0,
      overCapExportKwh: 0,
    })
  })

  it('Stunde ohne Nullslot (früher verworfen): 5/5/5/5 + 40 kWh → −35 × 4', () => {
    const { netSigned15, diagnostics } = combineImportWithHourlyExport({
      import15: import15('2026-06-01T10:00:00Z', 4, () => 5),
      exportHourly: hourly('2026-06-01T10:00:00Z', 1, () => 40),
      exportCapKw: 100,
    })
    expect(netSigned15.map((r) => r.gridPowerKw)).toEqual([-35, -35, -35, -35])
    expect(diagnostics.droppedExportHours).toBe(0)
  })

  it('nur Nullslots unter der Grenze: 0/0/0/0 + 40 kWh → −40 × 4, wie die alte Regel', () => {
    const { netSigned15 } = combineImportWithHourlyExport({
      import15: import15('2026-06-01T10:00:00Z', 4, () => 0),
      exportHourly: hourly('2026-06-01T10:00:00Z', 1, () => 40),
      exportCapKw: 100,
    })
    expect(netSigned15.map((r) => r.gridPowerKw)).toEqual(Array(4).fill(-40 / (4 * 0.25)))
  })

  it('ohne Grenze gilt die größte Stunden-Einspeisung der Reihe als Grenze', () => {
    // Grenze = 8 kW (Stunde 1: 8 kWh). Stunde 0: 1 kWh → Nullslot −4 kW, Bezugsslots unberührt;
    // Stunde 1: Nullslot −8 kW, Rest 6 kWh auf die drei Bezugsslots, je 1 − 8 = −7 kW.
    const values = [0, 1, 1, 1, 0, 1, 1, 1]
    const { netSigned15, diagnostics } = combineImportWithHourlyExport({
      import15: import15('2026-06-01T10:00:00Z', 8, (i) => values[i]!),
      exportHourly: hourly('2026-06-01T10:00:00Z', 2, (h) => (h === 0 ? 1 : 8)),
    })
    expect(netSigned15.map((r) => r.gridPowerKw)).toEqual([-4, 1, 1, 1, -8, -7, -7, -7])
    expect(diagnostics.overCapExportKwh).toBe(0)
  })

  it('Grenze zu klein: Energie bleibt erhalten, Überlauf ohne Grenze verteilt und gezählt', () => {
    const { netSigned15, diagnostics } = combineImportWithHourlyExport({
      import15: import15('2026-06-01T10:00:00Z', 4, (i) => (i === 0 ? 0 : 2)),
      exportHourly: hourly('2026-06-01T10:00:00Z', 1, () => 40),
      exportCapKw: 10,
    })
    const kwh = netSigned15.reduce((s, r, i) => s + ((i === 0 ? 0 : 2) - r.gridPowerKw) * 0.25, 0)
    expect(Math.abs(kwh - 40)).toBeLessThan(1e-9)
    expect(diagnostics.overCapExportHours).toBe(1)
    // Nullslot 10 kW + Bezugsslots bis −10 kW = 2,5 + 3 × 3 kWh = 11,5 kWh unter der Grenze.
    expect(diagnostics.overCapExportKwh).toBeCloseTo(28.5, 9)
  })

  it('Energie je Stunde bleibt erhalten — alle Verteilungsfälle', () => {
    const bezug = (i: number) => [0, 0, 3, 7, 1, 0, 9, 4, 6, 6, 6, 6, 0, 0, 0, 0][i % 16]!
    const input = import15('2026-06-01T00:00:00Z', 24 * 4, bezug)
    const exportHourly = hourly('2026-06-01T00:00:00Z', 24, (h) => [0.3, 7.7, 41, 13.13, 2][h % 5]!)
    for (const exportCapKw of [undefined, 3, 12, 100]) {
      const { netSigned15 } = combineImportWithHourlyExport({
        import15: input,
        exportHourly,
        exportCapKw,
      })
      for (let h = 0; h < 24; h++) {
        let kwh = 0
        for (let q = 0; q < 4; q++) {
          const i = h * 4 + q
          kwh += (input.readings[i]!.gridPowerKw - netSigned15[i]!.gridPowerKw) * 0.25
        }
        expect(Math.abs(kwh - exportHourly[h]!.kwh)).toBeLessThan(1e-9)
      }
    }
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
    const { netSigned15, diagnostics } = combineImportWithHourlyExport({
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
    const { netSigned15, diagnostics } = combineImportWithHourlyExport({
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

    const shifted = combineImportWithHourlyExport({
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
    const { netSigned15, diagnostics } = combineImportWithHourlyExport({
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
    const { netSigned15, diagnostics } = combineImportWithHourlyExport({
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
    const { netSigned15, diagnostics } = combineImportWithHourlyExport({
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
