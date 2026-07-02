import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { parseLoadProfile, parsePvProfile } from './parse'

// --- Fixture-Helfer (synthetisch) ---
const pad = (x: number) => String(x).padStart(2, '0')

function seqIsoNaive(n: number, stepMin = 15, start = Date.UTC(2024, 0, 15, 0, 0)): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(start + i * stepMin * 60_000)
    out.push(
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    )
  }
  return out
}

function seqDeDot(n: number): string[] {
  return seqIsoNaive(n).map((s) => {
    const [date, time] = s.split('T')
    const [y, mo, d] = date!.split('-')
    return `${d}.${mo}.${y} ${time}`
  })
}

const deNum = (n: number) => n.toString().replace('.', ',')

describe('parseLoadProfile — net_signed, Semikolon, Dezimalkomma, DE-Datum, kW', () => {
  const ts = seqDeDot(96)
  const rows = ts.map((t, i) => `${t};${deNum(i === 10 ? -3 : Math.round((10 + i) * 10) / 10)}`)
  const csv = ['Zeitstempel;Bezug (kW)', ...rows].join('\n')

  it('parst korrekt, erkennt net_signed und 15-min', () => {
    const out = parseLoadProfile({ content: csv, format: 'csv' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.profile.source).toBe('net_signed')
    expect(out.profile.intervalMinutes).toBe(15)
    expect(out.profile.readings).toHaveLength(96)
    expect(out.profile.readings[0]!.gridPowerKw).toBe(10) // 10 + 0
    expect(out.detection.delimiter).toBe(';')
    expect(out.detection.decimal).toBe(',')
    expect(out.detection.unit).toBe('kW')
  })
})

describe('parseLoadProfile — import_export_split, Komma-Trenner, ISO, kWh (×4)', () => {
  const ts = seqIsoNaive(96)
  const rows = ts.map((t) => `${t},10,2`)
  const csv = ['ts,Bezug (kWh),Einspeisung (kWh)', ...rows].join('\n')

  it('normalisiert gridPowerKw = (Import − Export) × 4', () => {
    const out = parseLoadProfile({ content: csv, format: 'csv' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.profile.source).toBe('import_export_split')
    expect(out.detection.unit).toBe('kWh')
    expect(out.profile.readings[0]!.gridPowerKw).toBe(32) // (10-2)*4
  })
})

describe('parseLoadProfile — import_only ohne PV: Pflichtwarnung (§3.1, harte Invariante)', () => {
  const ts = seqIsoNaive(96)
  const csv = ['Zeit,Last (kW)', ...ts.map((t, i) => `${t},${10 + (i % 5)}`)].join('\n')

  it('erkennt import_only und enthält die vorgeschriebene Warnung', () => {
    const out = parseLoadProfile({ content: csv, format: 'csv' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.profile.source).toBe('import_only')
    expect(out.dataQuality.warnings.some((w) => /nicht beurteilbar/.test(w))).toBe(true)
  })

  it('mit hasPvProfile: Pflichtwarnung entfällt', () => {
    const out = parseLoadProfile({ content: csv, format: 'csv' }, { hasPvProfile: true })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.dataQuality.warnings.some((w) => /nicht beurteilbar/.test(w))).toBe(false)
  })
})

describe('parseLoadProfile — uneindeutige Einheit → Mapping-Rückmeldung (§3.2)', () => {
  const ts = seqIsoNaive(96)
  const csv = ['Zeit,Wert', ...ts.map((t, i) => `${t},${10 + i}`)].join('\n')

  it('keine stille Annahme: needs_mapping mit unit-Issue', () => {
    const out = parseLoadProfile({ content: csv, format: 'csv' })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.kind).toBe('needs_mapping')
    if (out.kind !== 'needs_mapping') return
    expect(out.issues.some((i) => i.field === 'unit')).toBe(true)
    expect(out.preview.rows.length).toBeGreaterThan(0)
  })

  it('mit bestätigter Einheit (options.unit) parst es durch', () => {
    const out = parseLoadProfile({ content: csv, format: 'csv' }, { unit: 'kW' })
    expect(out.ok).toBe(true)
  })
})

describe('parseLoadProfile — Robustheit: BOM, Header, Leerzeilen', () => {
  const ts = seqIsoNaive(96)
  const body = ts.map((t, i) => `${t},${i === 3 ? -1 : 5 + i}`).join('\n\n') // Leerzeilen dazwischen
  const csv = `\uFEFFZeit,Bezug (kW)\n${body}`

  it('toleriert BOM + Leerzeilen, liefert lückenlosen Vektor', () => {
    const out = parseLoadProfile({ content: csv, format: 'csv' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.profile.readings).toHaveLength(96)
    expect(out.profile.source).toBe('net_signed')
  })
})

describe('parseLoadProfile — Lücken (§3.3)', () => {
  const ts = seqIsoNaive(96)
  const linear = (i: number) => 10 + i // linear → Interpolation exakt

  it('kleine Lücke wird still interpoliert (gapsInterpolated)', () => {
    const rows = ts.map((t, i) => `${t},${linear(i)}`)
    rows.splice(5, 1) // eine fehlende Viertelstunde
    const out = parseLoadProfile({
      content: ['Zeit,Bezug (kW)', ...rows].join('\n'),
      format: 'csv',
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.profile.readings).toHaveLength(96) // wieder lückenlos
    expect(out.dataQuality.gapsInterpolated).toBe(1)
    expect(out.profile.readings[5]!.gridPowerKw).toBe(15) // linear interpoliert
  })

  it('große Lücke wird markiert (Warnung)', () => {
    const rows = ts.map((t, i) => `${t},${linear(i)}`)
    rows.splice(20, 11) // 11 aufeinanderfolgende fehlend (> maxGap 4)
    const out = parseLoadProfile({
      content: ['Zeit,Bezug (kW)', ...rows].join('\n'),
      format: 'csv',
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.dataQuality.warnings.some((w) => /Datenlücke/.test(w))).toBe(true)
  })
})

describe('parseLoadProfile — falsches Intervall & Guards', () => {
  it('60-min → Fehler wrong_interval', () => {
    const ts = seqIsoNaive(48, 60)
    const csv = ['Zeit,Bezug (kW)', ...ts.map((t, i) => `${t},${10 + i}`)].join('\n')
    const out = parseLoadProfile({ content: csv, format: 'csv' })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.kind === 'error' && out.error.code).toBe('wrong_interval')
  })

  it('leerer Inhalt → Fehler empty', () => {
    const out = parseLoadProfile({ content: '', format: 'csv' })
    expect(out.ok).toBe(false)
    if (out.ok || out.kind !== 'error') return
    expect(out.error.code).toBe('empty')
  })

  it('Zeilenlimit greift → too_many_rows', () => {
    const ts = seqIsoNaive(96)
    const csv = ['Zeit,Bezug (kW)', ...ts.map((t, i) => `${t},${10 + i}`)].join('\n')
    const out = parseLoadProfile({ content: csv, format: 'csv' }, { limits: { maxRows: 10 } })
    expect(out.ok).toBe(false)
    if (out.ok || out.kind !== 'error') return
    expect(out.error.code).toBe('too_many_rows')
  })
})

describe('parseLoadProfile — XLSX via SheetJS', () => {
  it('parst eine XLSX-Arbeitsmappe (net_signed)', () => {
    const ts = seqIsoNaive(96)
    const aoa: (string | number)[][] = [
      ['Zeitstempel', 'Bezug (kW)'],
      ...ts.map((t, i) => [t, i === 8 ? -2 : 10 + i] as (string | number)[]),
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const out = parseLoadProfile({ content: buf, format: 'xlsx' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.detection.format).toBe('xlsx')
    expect(out.profile.source).toBe('net_signed')
    expect(out.profile.readings).toHaveLength(96)
  })
})

describe('parsePvProfile', () => {
  it('parst ein PV-Erzeugungsprofil (pvGenerationKw)', () => {
    const ts = seqIsoNaive(96)
    const csv = ['Zeit,PV (kW)', ...ts.map((t, i) => `${t},${i}`)].join('\n')
    const out = parsePvProfile({ content: csv, format: 'csv' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.profile.readings).toHaveLength(96)
    expect(out.profile.readings[2]!.pvGenerationKw).toBe(2)
  })
})
