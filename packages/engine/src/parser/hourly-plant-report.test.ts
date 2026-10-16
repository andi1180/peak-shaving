import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { combineImportWithHourlyExport } from './combine-hourly-export'
import { parseHourlyPlantReports, type PlantReportFile } from './hourly-plant-report'

const HEADER = [
  'Statistischer Zeitraum',
  'Globale Einstrahlung (kWh/m²)',
  'Durchschnittstemperatur (℃)',
  'Theoretischer Ertrag (kWh)',
  'PV-Ertrag (kWh)',
  'Wechselrichterertrag (kWh)',
  'Netzeinspeisung (kWh)',
  'Netzbezug (kWh)',
  'Verlust durch Abregelung (kWh)',
  'Verlust durch Abregelung (€)',
  'Verbrauch (kWh)',
  'Eigenverbrauch (kWh)',
  'Ladung (kWh)',
  'Entladung (kWh)',
  'Umsatz(€)',
]

type Row = {
  time: string | number
  einspeisung?: string | number | null
  bezug?: string | number | null
}

/** Synthetischer Bericht: Titelzeile, Kopf (optional umsortiert), je Stunde eine Zeile. */
function report(name: string, rows: Row[], header: string[] = HEADER): PlantReportFile {
  const line = (r: Row) =>
    header.map((h) => {
      if (h === 'Statistischer Zeitraum') return r.time
      if (h === 'Netzeinspeisung (kWh)') return r.einspeisung ?? null
      if (h === 'Netzbezug (kWh)') return r.bezug ?? null
      if (h === 'Verbrauch (kWh)' || h === 'Eigenverbrauch (kWh)') return 99
      return '0.000 '
    })
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Anlagenbericht (synthetisch)'],
    header,
    ...rows.map(line),
  ])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Bericht')
  return { name, data: new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })) }
}

/** Stundenzeilen eines Tages (Ortszeit-Text), `hours` = Liste der Stunden. */
function day(
  date: string,
  hours: number[],
  einspeisung: (h: number) => number,
  bezug: (h: number) => number,
): Row[] {
  return hours.map((h) => ({
    time: `${date} ${String(h).padStart(2, '0')}:00:00`,
    einspeisung: einspeisung(h),
    bezug: bezug(h),
  }))
}

const ALL_HOURS = Array.from({ length: 24 }, (_, h) => h)
const sum = (rs: { kwh: number }[]) => rs.reduce((s, r) => s + r.kwh, 0)
const ok = (result: ReturnType<typeof parseHourlyPlantReports>) => {
  if ('error' in result) throw new Error(`unerwartet: ${result.error}`)
  return result
}

describe('parseHourlyPlantReports', () => {
  it('zwei Monatsdateien (eine mit umsortierten Spalten) → zusammengeführt, sortiert, Summen stimmen', () => {
    const shuffled = [...HEADER].reverse()
    const feb = report(
      'feb.xlsx',
      day(
        '2026-02-01',
        ALL_HOURS,
        (h) => h / 10,
        () => 2,
      ),
      shuffled,
    )
    const jan = report(
      'jan.xlsx',
      day(
        '2026-01-31',
        ALL_HOURS,
        (h) => h / 4,
        () => 1,
      ),
    )
    const { exportHourly, importHourly, diagnostics } = ok(parseHourlyPlantReports([feb, jan]))

    expect(exportHourly).toHaveLength(48)
    expect(exportHourly[0]!.ts).toBe('2026-01-30T23:00:00.000Z')
    expect(exportHourly.map((r) => r.ts)).toEqual([...exportHourly.map((r) => r.ts)].sort())
    expect(sum(exportHourly)).toBeCloseTo(
      ALL_HOURS.reduce((s, h) => s + h / 10 + h / 4, 0),
      9,
    )
    expect(sum(importHourly)).toBe(24 * 2 + 24 * 1)
    expect(diagnostics).toMatchObject({ files: 2, hours: 48, duplicateHours: 0, skippedRows: 0 })
    expect(diagnostics.perFile.map((f) => [f.name, f.hours])).toEqual([
      ['feb.xlsx', 24],
      ['jan.xlsx', 24],
    ])
  })

  it('Text mit Leerzeichen, Zahl und Excel-Datum werden gleich gelesen; leere Einspeisezelle fehlt, ist nicht 0', () => {
    const serial = Date.UTC(2026, 5, 1, 13) / 86_400_000 + 25569
    const { exportHourly, importHourly } = ok(
      parseHourlyPlantReports([
        report('jun.xlsx', [
          { time: '2026-06-01 12:00:00', einspeisung: '1.250 ', bezug: '0.000 ' },
          { time: serial, einspeisung: 1.25, bezug: 0 },
          { time: '2026-06-01 14:00:00 ', einspeisung: null, bezug: '0.500' },
        ]),
      ]),
    )
    expect(exportHourly).toEqual([
      { ts: '2026-06-01T10:00:00.000Z', kwh: 1.25 },
      { ts: '2026-06-01T11:00:00.000Z', kwh: 1.25 },
    ])
    expect(importHourly.map((r) => [r.ts, r.kwh])).toContainEqual(['2026-06-01T12:00:00.000Z', 0.5])
  })

  it('negativer oder unlesbarer Wert → Zeile übersprungen und gezählt', () => {
    const result = ok(
      parseHourlyPlantReports([
        report('x.xlsx', [
          { time: '2026-06-01 10:00:00', einspeisung: '-1.0', bezug: 0 },
          { time: '2026-06-01 11:00:00', einspeisung: 'n/a', bezug: 0 },
          { time: '2026-06-01 12:00:00', einspeisung: 2, bezug: 0 },
        ]),
      ]),
    )
    expect(result.diagnostics.skippedRows).toBe(2)
    expect(result.exportHourly).toEqual([{ ts: '2026-06-01T10:00:00.000Z', kwh: 2 }])
  })

  it('Sommerzeit-Tag: 23 Stunden nach UTC, eine 02:00-Zeile wird nicht erfunden, sondern übersprungen', () => {
    const hours = ALL_HOURS.filter((h) => h !== 2)
    const rows = [
      ...day(
        '2026-03-29',
        hours,
        () => 1,
        () => 1,
      ),
      { time: '2026-03-29 02:00:00', einspeisung: 1, bezug: 1 },
    ]
    const { exportHourly, diagnostics } = ok(parseHourlyPlantReports([report('mar.xlsx', rows)]))
    expect(exportHourly).toHaveLength(23)
    expect(exportHourly[0]!.ts).toBe('2026-03-28T23:00:00.000Z')
    expect(exportHourly[2]!.ts).toBe('2026-03-29T01:00:00.000Z') // 03:00 CEST
    expect(diagnostics.skippedRows).toBe(1)
    expect(diagnostics.range).toEqual({
      from: '2026-03-28T23:00:00.000Z',
      to: '2026-03-29T22:00:00.000Z',
    })
  })

  it('Winterzeit-Tag: 02:00 doppelt → Sommer- und Winterzeit; einfach → Sommerzeit und ambiguousHours', () => {
    const twice = [...ALL_HOURS.slice(0, 3), 2, ...ALL_HOURS.slice(3)]
    const both = ok(
      parseHourlyPlantReports([
        report(
          'okt.xlsx',
          day(
            '2025-10-26',
            twice,
            (h) => h,
            () => 0,
          ),
        ),
      ]),
    )
    expect(both.exportHourly).toHaveLength(25)
    expect(both.exportHourly.filter((r) => r.kwh === 2).map((r) => r.ts)).toEqual([
      '2025-10-26T00:00:00.000Z',
      '2025-10-26T01:00:00.000Z',
    ])
    expect(both.diagnostics.ambiguousHours).toBe(0)

    const once = ok(
      parseHourlyPlantReports([
        report(
          'okt.xlsx',
          day(
            '2025-10-26',
            ALL_HOURS,
            (h) => h,
            () => 0,
          ),
        ),
      ]),
    )
    expect(once.exportHourly).toHaveLength(24)
    expect(once.exportHourly.find((r) => r.kwh === 2)!.ts).toBe('2025-10-26T00:00:00.000Z')
    expect(once.diagnostics.ambiguousHours).toBe(1)
  })

  it('doppelte Stunde über zwei Dateien → erste bleibt, duplicateHours 1', () => {
    const a = report('a.xlsx', [{ time: '2026-06-30 23:00:00', einspeisung: 1, bezug: 0 }])
    const b = report('b.xlsx', [
      { time: '2026-06-30 23:00:00', einspeisung: 7, bezug: 0 },
      { time: '2026-07-01 00:00:00', einspeisung: 2, bezug: 0 },
    ])
    const { exportHourly, diagnostics } = ok(parseHourlyPlantReports([a, b]))
    expect(exportHourly.map((r) => r.kwh)).toEqual([1, 2])
    expect(diagnostics.duplicateHours).toBe(1)
  })

  it('Kopf ohne Netzeinspeisung → unknown_format; nur Kopf → no_rows', () => {
    const noExport = report(
      'ohne.xlsx',
      [{ time: '2026-06-01 10:00:00', bezug: 1 }],
      HEADER.filter((h) => h !== 'Netzeinspeisung (kWh)'),
    )
    expect(parseHourlyPlantReports([noExport])).toMatchObject({
      error: 'unknown_format',
      file: 'ohne.xlsx',
    })
    expect(parseHourlyPlantReports([report('leer.xlsx', [])])).toEqual({
      error: 'no_rows',
      file: 'leer.xlsx',
    })
  })

  it('Rundlauf mit combineImportWithHourlyExport: Energiebilanz hält', () => {
    const { exportHourly, importHourly } = ok(
      parseHourlyPlantReports([
        report(
          'jun.xlsx',
          day(
            '2026-06-01',
            ALL_HOURS,
            (h) => (h >= 8 && h < 18 ? 2 : 0),
            (h) => (h >= 8 && h < 18 ? 0 : 1),
          ),
        ),
      ]),
    )
    // 15-min-Bezug passend zum Bericht: tagsüber 0, sonst 1 kW.
    const start = Date.parse('2026-05-31T22:00:00Z')
    const readings = Array.from({ length: 96 }, (_, i) => {
      const localHour = Math.floor(i / 4)
      return {
        ts: new Date(start + i * 15 * 60 * 1000).toISOString(),
        gridPowerKw: localHour >= 8 && localHour < 18 ? 0 : 1,
      }
    })
    const { netSigned15, diagnostics } = combineImportWithHourlyExport({
      import15: { readings, timezoneMeta: 'Europe/Vienna' },
      exportHourly,
      importHourly,
    })
    const exported = netSigned15.reduce(
      (s, r) => s + (r.gridPowerKw < 0 ? r.gridPowerKw * 0.25 : 0),
      0,
    )
    expect(exported).toBeCloseTo(-(sum(exportHourly) - diagnostics.droppedExportKwh), 9)
    expect(diagnostics.droppedExportKwh).toBe(0)
    expect(diagnostics.importCheck?.bestOffsetHours).toBe(0)
  })

  it('zu klein deklarierter Blattbereich (Titel verbunden, Kopf in Zeile 2) → Kopf und erste Stunde gelesen', () => {
    const rows = day(
      '2026-02-01',
      [0, 1, 2],
      () => 1,
      () => 0.5,
    )
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Anlagenbericht (synthetisch)'],
      HEADER,
      ...rows.map((r) =>
        HEADER.map((h) =>
          h === 'Statistischer Zeitraum'
            ? r.time
            : h === 'Netzeinspeisung (kWh)'
              ? r.einspeisung
              : h === 'Netzbezug (kWh)'
                ? r.bezug
                : '',
        ),
      ),
    ])
    sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: HEADER.length - 1 } }]
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Bericht')
    // Portal-Export nachgebaut: <dimension> beginnt erst in Zeile 4, die Zellen ab Zeile 1.
    const zip = XLSX.CFB.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), {
      type: 'buffer',
    })
    const entry = XLSX.CFB.find(zip, 'Root Entry/xl/worksheets/sheet1.xml')!
    const xml = new TextDecoder()
      .decode(entry.content as Uint8Array)
      .replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A4:O5"/>')
    entry.content = Buffer.from(xml)
    const file = {
      name: 'feb.xlsx',
      data: new Uint8Array(XLSX.CFB.write(zip, { fileType: 'zip', type: 'buffer' }) as Buffer),
    }
    expect(XLSX.read(file.data, { type: 'array' }).Sheets.Bericht!['!ref']).toBe('A4:O5')

    const { exportHourly, diagnostics } = ok(parseHourlyPlantReports([file]))
    expect(diagnostics.hours).toBe(3)
    expect(exportHourly[0]!.ts).toBe('2026-01-31T23:00:00.000Z')
  })

  it('Kopf mit geschütztem Leerzeichen, Zeilenumbruch und Grossschreibung → erkannt; fremder Kopf nennt die Zellen', () => {
    const odd = HEADER.map((h) =>
      h === 'Netzeinspeisung (kWh)'
        ? 'NETZEINSPEISUNG\u00A0(kWh)'
        : h === 'Netzbezug (kWh)'
          ? 'Netzbezug\n(kWh) '
          : h,
    )
    const { diagnostics } = ok(
      parseHourlyPlantReports([
        report('odd.xlsx', [{ time: '2026-06-01 10:00:00', einspeisung: 1, bezug: 0 }], odd),
      ]),
    )
    expect(diagnostics.hours).toBe(1)

    expect(
      parseHourlyPlantReports([report('fremd.xlsx', [{ time: 'x' }], ['Zeit', 'Wert\u202F(kWh)'])]),
    ).toEqual({
      error: 'unknown_format',
      file: 'fremd.xlsx',
      headers: ['zeit', 'wert (kwh)'],
    })
  })

  it('Jahr Sep–Aug mit „ DST"-Zusatz wie im Portal-Export → 8.759 Stunden, Doppelstunde eindeutig, Leerzeile fehlt', () => {
    const pad = (n: number) => String(n).padStart(2, '0')
    // Sommerzeit Europe/Vienna: bis 26.10.2025 02:00 DST, ab 29.03.2026 03:00 (02:00 entfällt).
    const isDst = (y: number, mo: number, d: number, h: number) =>
      y === 2025
        ? mo < 10 || (mo === 10 && (d < 26 || (d === 26 && h <= 2)))
        : mo > 3 || (mo === 3 && (d > 29 || (d === 29 && h >= 3)))
    const files: PlantReportFile[] = []
    for (let i = 0; i < 12; i++) {
      const y = i < 4 ? 2025 : 2026
      const mo = ((8 + i) % 12) + 1
      const rows: Row[] = []
      for (let d = 1; d <= new Date(Date.UTC(y, mo, 0)).getUTCDate(); d++) {
        for (let h = 0; h < 24; h++) {
          if (y === 2026 && mo === 3 && d === 29 && h === 2) continue
          const time = `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:00:00`
          const empty = y === 2025 && mo === 10 && d === 26 && h === 23
          rows.push({
            time: isDst(y, mo, d, h) ? `${time} DST` : time,
            ...(empty ? {} : { einspeisung: 1, bezug: 0 }),
          })
          if (y === 2025 && mo === 10 && d === 26 && h === 2)
            rows.push({ time, einspeisung: 1, bezug: 0 })
        }
      }
      files.push(report(`${y}-${pad(mo)}.xlsx`, rows))
    }

    const { exportHourly, diagnostics } = ok(parseHourlyPlantReports(files))
    expect(diagnostics).toMatchObject({
      hours: 8759,
      range: { from: '2025-08-31T22:00:00.000Z', to: '2026-08-31T22:00:00.000Z' },
      skippedRows: 0,
      ambiguousHours: 0,
      duplicateHours: 0,
    })
    const ts = new Set(exportHourly.map((r) => r.ts))
    expect(ts.has('2026-07-15T10:00:00.000Z')).toBe(true) // 15.07. 12:00 DST
    expect(ts.has('2026-01-15T11:00:00.000Z')).toBe(true) // 15.01. 12:00
    expect(ts.has('2025-10-26T00:00:00.000Z') && ts.has('2025-10-26T01:00:00.000Z')).toBe(true) // 02:00 DST + 02:00
    expect(ts.has('2025-10-26T22:00:00.000Z')).toBe(false) // Leerzeile 23:00
  })

  it('„ DST" ohne Sommerzeit oder Sommerzeit ohne Zusatz → übersprungen; Zusatz in Kleinschreibung gilt', () => {
    const { exportHourly, diagnostics } = ok(
      parseHourlyPlantReports([
        report('mix.xlsx', [
          { time: '2026-07-15 12:00:00 dst', einspeisung: 1 },
          { time: '2026-01-15 12:00:00 DST', einspeisung: 1 },
          { time: '2026-07-15 13:00:00', einspeisung: 1 },
        ]),
      ]),
    )
    expect(exportHourly.map((r) => r.ts)).toEqual(['2026-07-15T10:00:00.000Z'])
    expect(diagnostics.skippedRows).toBe(2)
  })
})
