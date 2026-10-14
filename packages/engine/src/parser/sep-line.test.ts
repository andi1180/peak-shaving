import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { parseLoadProfile } from './parse'

// Deutsches Messstellenbetreiber-Format: `sep=,`-Vorzeile, kW-Mittelwerte, Dezimalkomma in Anführungszeichen.
const fixture = (name: string) => readFileSync(new URL(`../../../../dev-fixtures/${name}`, import.meta.url), 'utf8')

function parseOk(content: string) {
  const out = parseLoadProfile({ content, format: 'csv' })
  if (!out.ok) throw new Error(`ok erwartet, war ${out.kind}`)
  return out
}

/** Die Werte der Datei selbst (ohne sep-/Kopfzeile), unabhängig vom Parser gelesen. */
function fileValues(content: string): number[] {
  return content
    .trim()
    .split('\n')
    .slice(2)
    .map((l) => Number(l.slice(l.indexOf(',') + 1).replace(/"/g, '').replace(',', '.')))
}

describe.each([
  { name: 'de-lastgang-sep-herbst.csv', rows: 288, peakTs: '2025-10-26T07:30:00.000Z', gaps: 4 },
  { name: 'de-lastgang-sep-fruehling.csv', rows: 284, peakTs: '2026-03-29T06:30:00.000Z', gaps: 0 },
])('sep=-Zeile — $name', ({ name, rows, peakTs, gaps }) => {
  const content = fixture(name)
  const values = fileValues(content)

  it('liest die Datei als kW-Viertelstunden-Lastgang, ohne Rückfrage', () => {
    const out = parseOk(content)
    expect(out.detection.unit).toBe('kW')
    expect(out.detection.delimiter).toBe(',')
    expect(out.detection.headerRow).toBe(0)
    expect(out.profile.intervalMinutes).toBe(15)
    expect(values).toHaveLength(rows)
  })

  it('Energie = Σ kW / 4; Abweichung ist allein die bestehende Lückenfüllung (Herbst: 4 Slots der fehlenden UTC-Stunde)', () => {
    const { profile, dataQuality } = parseOk(content)
    const kwh = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / 4
    expect(dataQuality.gapsInterpolated).toBe(gaps)
    expect(profile.readings).toHaveLength(rows + gaps)
    const filled = profile.readings
      .filter((r) => r.ts >= '2025-10-26T01:00:00.000Z' && r.ts <= '2025-10-26T01:45:00.000Z')
      .map((r) => r.gridPowerKw)
    const extra = gaps > 0 ? kwh(filled) : 0
    expect(kwh(profile.readings.map((r) => r.gridPowerKw))).toBeCloseTo(kwh(values) + extra, 6)
  })

  it('Spitze 42,5 kW zum richtigen Zeitpunkt; unquotierte 0 wird als 0 gelesen', () => {
    const { profile } = parseOk(content)
    const peak = profile.readings.reduce((a, b) => (b.gridPowerKw > a.gridPowerKw ? b : a))
    expect(peak).toMatchObject({ ts: peakTs, gridPowerKw: 42.5 })
    expect(content).toMatch(/\d,0\n/)
    expect(profile.readings.filter((r) => r.gridPowerKw === 0)).toHaveLength(
      values.filter((v) => v === 0).length,
    )
  })

  it('Gegenprobe: ohne sep=-Zeile identisches Ergebnis', () => {
    const withSep = parseOk(content)
    const without = parseOk(content.replace(/^sep=,\n/, ''))
    expect(without.profile).toEqual(withSep.profile)
    expect(without.dataQuality).toEqual(withSep.dataQuality)
    expect(without.detection).toEqual(withSep.detection)
  })
})

describe('sep=-Zeile — Randfälle', () => {
  it('BOM, führende Leerzeile, CRLF, Gross-/Kleinschreibung und anderes Trennzeichen', () => {
    const rows = ['2025-09-01 00:00;9,7', '2025-09-01 00:15;9,8', '2025-09-01 00:30;10,1', '2025-09-01 00:45;9,9']
    const text = '﻿\r\nSEP=;\r\nDatumUhrzeit;kW\r\n' + rows.join('\r\n') + '\r\n'
    const out = parseOk(text)
    expect(out.detection.delimiter).toBe(';')
    expect(out.detection.unit).toBe('kW')
    expect(out.profile.readings.map((r) => r.gridPowerKw)).toEqual([9.7, 9.8, 10.1, 9.9])
  })

  it('Positivkontrolle: AT-Datei ohne sep= unverändert (gemessen vor der Änderung)', () => {
    const { profile, dataQuality, detection } = parseOk(fixture('demo-baeckerei-lastgang-2025.csv'))
    expect(profile.readings).toHaveLength(35040)
    expect(profile.readings.reduce((s, r) => s + r.gridPowerKw, 0) / 4).toBeCloseTo(88426.3725, 4)
    expect(Math.max(...profile.readings.map((r) => r.gridPowerKw))).toBe(50.78)
    expect(dataQuality.gapsInterpolated).toBe(15)
    expect(detection).toMatchObject({ delimiter: ';', decimal: ',', unit: 'kW', dateFormat: 'de_dot' })
  })
})
