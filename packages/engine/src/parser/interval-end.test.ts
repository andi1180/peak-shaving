import { describe, expect, it } from 'vitest'

import { readLoadProfileMetadata } from './metadata'
import { parseLoadProfile } from './parse'

const QUARTER_MS = 15 * 60 * 1000

/** Wanduhrzeit Europe/Vienna mit Offset, wie ein E-Control-Export sie schreibt: `2025-01-01T00:15+01:00`. */
function viennaIso(ms: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Vienna',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  )
  const offset = parts.timeZoneName!.replace('GMT', '')
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}${offset}`
}

/** Kalenderjahr 2025, je Zeile das ENDE der Viertelstunde: 01.01. 00:15 … 01.01.2026 00:00 Ortszeit. */
function endStampedYear(header: string): { csv: string; totalKwh: number } {
  const firstEndMs = Date.parse('2024-12-31T23:15:00Z')
  const lines = [`${header};Verbrauch [kWh]`]
  let totalKwh = 0
  for (let i = 0; i < 35_040; i++) {
    const kwh = 0.5 + (i % 96) / 100
    totalKwh += kwh
    lines.push(`${viennaIso(firstEndMs + i * QUARTER_MS)};${kwh.toFixed(2).replace('.', ',')}`)
  }
  return { csv: lines.join('\n'), totalKwh }
}

describe('Zeitstempel am Intervallende', () => {
  it('rechnet "Ende Ablesezeitraum" auf den Intervallbeginn um', () => {
    const { csv, totalKwh } = endStampedYear('Ende Ablesezeitraum')
    const out = parseLoadProfile({ content: csv, format: 'csv' })
    if (!out.ok) throw new Error(JSON.stringify(out))

    const readings = out.profile.readings
    expect(readings).toHaveLength(35_040)
    expect(readings[0]!.ts).toBe('2024-12-31T23:00:00.000Z') // 01.01.2025 00:00 Ortszeit
    expect(readings.at(-1)!.ts).toBe('2025-12-31T22:45:00.000Z') // 31.12.2025 23:45 Ortszeit
    expect(readings.reduce((s, r) => s + r.gridPowerKw, 0) * 0.25).toBeCloseTo(totalKwh, 6)

    const scan = readLoadProfileMetadata({ content: csv, format: 'csv' })
    if (!scan.ok || scan.needsMapping) throw new Error(JSON.stringify(scan))
    expect(scan.coveredFrom).toBe('2024-12-31T23:00:00.000Z')
    expect(scan.coveredTo).toBe('2025-12-31T23:00:00.000Z')
  })

  it('lässt "Zeit von/Zeit bis" beim Intervallbeginn', () => {
    const csv = [
      'Datum;Zeit von;Zeit bis;Verbrauch [kWh]',
      '01.01.2025;00:00:00;00:15:00;0,5',
      '01.01.2025;00:15:00;00:30:00;0,6',
      '01.01.2025;00:30:00;00:45:00;0,7',
    ].join('\n')
    const out = parseLoadProfile({ content: csv, format: 'csv' })
    if (!out.ok) throw new Error(JSON.stringify(out))
    expect(out.profile.readings[0]!.ts).toBe('2024-12-31T23:00:00.000Z')
  })

  it('fragt bei einem Kopf, der Beginn UND Ende nennt, nach statt anzunehmen', () => {
    const { csv } = endStampedYear('Zeitraum von bis')
    const out = parseLoadProfile({ content: csv, format: 'csv' })
    expect(out.ok).toBe(false)
    if (out.ok || out.kind !== 'needs_mapping') throw new Error('needs_mapping erwartet')
    expect(out.issues[0]!.field).toBe('timestampColumn')

    const confirmed = parseLoadProfile({ content: csv, format: 'csv' }, { timestampMarks: 'interval_end' })
    if (!confirmed.ok) throw new Error(JSON.stringify(confirmed))
    expect(confirmed.profile.readings[0]!.ts).toBe('2024-12-31T23:00:00.000Z')
  })
})
