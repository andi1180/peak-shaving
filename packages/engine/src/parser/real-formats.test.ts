import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { parseLoadProfile } from './parse'
import type { ColumnMapping } from './types'

// Erste ECHTEN Netzbetreiber-/Wechselrichter-Formate (OP#4) gegen ANONYMISIERTE dev-fixtures.
// Struktur/Format wie reale Exporte (siehe dev-fixtures/README.md + generate-*.mjs).
const fixture = (name: string) =>
  new URL(`../../../../dev-fixtures/${name}`, import.meta.url)
const edaJuni = readFileSync(fixture('netzbetreiber-eda-juni-2026.csv'), 'utf8')
const edaMaerz = readFileSync(fixture('netzbetreiber-eda-maerz-2026.csv'), 'utf8')

const ESS_FILES = [
  'wechselrichter-ess-sys1-maerz-2026.xlsx',
  'wechselrichter-ess-sys1-juni-2026.xlsx',
  'wechselrichter-ess-sys2-maerz-2026.xlsx',
  'wechselrichter-ess-sys2-juni-2026.xlsx',
]

// Gesamtbezug (kWh) = Σ positive Viertelstunden-Leistung × 0,25 h.
function totalKwh(readings: { gridPowerKw: number }[]): number {
  return readings.reduce((s, r) => s + Math.max(0, r.gridPowerKw), 0) * 0.25
}
function peakKw(readings: { gridPowerKw: number }[]): number {
  return Math.max(...readings.map((r) => r.gridPowerKw))
}

describe('Format A (Netzbetreiber/EDA-CSV) — Split-Timestamp + Mehrspalten-Mapping (TEIL 1+3, OP#4)', () => {
  it('erkennt Split-Timestamp (Datum + "Zeit von") und liefert needs_mapping mit klassifizierter Spaltenliste', () => {
    const out = parseLoadProfile({ content: edaJuni, format: 'csv' })
    expect(out.ok).toBe(false)
    if (out.ok || out.kind !== 'needs_mapping') throw new Error('needs_mapping erwartet')

    // Split-Timestamp: Datum = Spalte 0, "Zeit von" = Spalte 1 (Intervall-START, nicht "Zeit bis").
    expect(out.detection.columns.timestamp).toBe(0)
    expect(out.detection.columns.timeColumn).toBe(1)
    expect(out.detection.dateFormat).toBe('de_dot_date')

    // 8 Wert-Spalten: 2 Verbrauch, 2 Einspeisung, 4 ignorierbar (2 Überschuss + 2 Restüberschuss).
    const vc = out.valueColumns ?? []
    expect(vc).toHaveLength(8)
    const roles = (r: string) => vc.filter((c) => c.suggestedRole === r).length
    expect(roles('consumption')).toBe(2)
    expect(roles('feed_in')).toBe(2)
    expect(roles('ignore')).toBe(4)
    expect(vc.filter((c) => c.eegAccounting).length).toBe(4)

    // Zählpunkt-ID + Einheit je Spalte erkannt.
    expect(vc.every((c) => c.meteringPointId?.startsWith('AT'))).toBe(true)
    expect(vc.every((c) => c.unit === 'kWh')).toBe(true)

    // Die needs_mapping-Rückmeldung nennt die Wert-Spalten als offenen Punkt.
    expect(out.issues.some((i) => i.field === 'valueColumns')).toBe(true)
  })

  it('Plausibilität Juni: Summierung beider Verbrauchszähler → ~46,1 kWh / 2,36 kW', () => {
    const first = parseLoadProfile({ content: edaJuni, format: 'csv' })
    if (first.ok || first.kind !== 'needs_mapping') throw new Error('needs_mapping erwartet')
    const vc = first.valueColumns ?? []
    const columns: ColumnMapping = {
      timestamp: first.detection.columns.timestamp,
      timeColumn: first.detection.columns.timeColumn,
      consumptionCols: vc.filter((c) => c.suggestedRole === 'consumption').map((c) => c.index),
      feedInCols: vc.filter((c) => c.suggestedRole === 'feed_in').map((c) => c.index),
    }

    const out = parseLoadProfile({ content: edaJuni, format: 'csv' }, { columns, unit: 'kWh' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.profile.readings).toHaveLength(672) // 7 Tage × 96 Viertelstunden
    expect(out.dataQuality.coveredDays).toBe(7)
    expect(out.dataQuality.coveredMonths).toBe(1) // Teiljahres-Datensatz (nur Juni) — §3.5-Warnung

    const total = totalKwh(out.profile.readings)
    const peak = peakKw(out.profile.readings)
    console.log(`[OP#4 Format A Juni] Gesamtbezug=${total.toFixed(3)} kWh · Spitze=${peak} kW`)
    expect(total).toBeCloseTo(46.1, 1)
    expect(peak).toBeCloseTo(2.36, 2)
  })

  it('Summierung ist Pflicht: ein einzelner Verbrauchszähler liefert nachweislich weniger (≈ halber Bezug)', () => {
    const first = parseLoadProfile({ content: edaJuni, format: 'csv' })
    if (first.ok || first.kind !== 'needs_mapping') throw new Error('needs_mapping erwartet')
    const consCols = (first.valueColumns ?? [])
      .filter((c) => c.suggestedRole === 'consumption')
      .map((c) => c.index)

    const both = parseLoadProfile(
      { content: edaJuni, format: 'csv' },
      { columns: { timestamp: 0, timeColumn: 1, consumptionCols: consCols }, unit: 'kWh' },
    )
    const single = parseLoadProfile(
      { content: edaJuni, format: 'csv' },
      { columns: { timestamp: 0, timeColumn: 1, consumptionCols: [consCols[0]!] }, unit: 'kWh' },
    )
    if (!both.ok || !single.ok) throw new Error('ok erwartet')

    const totalBoth = totalKwh(both.profile.readings)
    const totalSingle = totalKwh(single.profile.readings)
    // Ein einzelner Zähler verliert ~44 % des Verbrauchs — genau der Fehler, den ein
    // "wähle genau eine Spalte"-Contract still machen würde.
    expect(totalSingle).toBeLessThan(totalBoth * 0.75)
    expect(totalBoth).toBeCloseTo(46.1, 1)
  })

  it('Plausibilität März: ~69,2 kWh / 3,28 kW (zweiter echter Datenpunkt)', () => {
    const first = parseLoadProfile({ content: edaMaerz, format: 'csv' })
    if (first.ok || first.kind !== 'needs_mapping') throw new Error('needs_mapping erwartet')
    const vc = first.valueColumns ?? []
    const columns: ColumnMapping = {
      timestamp: 0,
      timeColumn: 1,
      consumptionCols: vc.filter((c) => c.suggestedRole === 'consumption').map((c) => c.index),
      feedInCols: vc.filter((c) => c.suggestedRole === 'feed_in').map((c) => c.index),
    }
    const out = parseLoadProfile({ content: edaMaerz, format: 'csv' }, { columns, unit: 'kWh' })
    if (!out.ok) throw new Error('ok erwartet')
    const total = totalKwh(out.profile.readings)
    const peak = peakKw(out.profile.readings)
    console.log(`[OP#4 Format A März] Gesamtbezug=${total.toFixed(3)} kWh · Spitze=${peak} kW`)
    expect(out.profile.readings).toHaveLength(672)
    expect(total).toBeCloseTo(69.2, 1)
    expect(peak).toBeCloseTo(3.28, 2)
  })
})

describe('Mehrspalten-Summierung — Rechenweg (synthetisch, TEIL 3)', () => {
  it('gridPowerKw = (Σ Verbrauch − Σ Einspeisung) × 4', () => {
    const pad = (x: number) => String(x).padStart(2, '0')
    const rows: string[] = []
    for (let i = 0; i < 96; i++) {
      const t = `2026-06-16T${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`
      // V1=10, V2=6, E1=3, E2=1 (kWh) → net = (16 − 4) × 4 = 48 kW
      rows.push(`${t},10,6,3,1`)
    }
    const csv = ['ts,Verbrauch A (kWh),Verbrauch B (kWh),Einspeisung A (kWh),Einspeisung B (kWh)', ...rows].join('\n')

    const out = parseLoadProfile(
      { content: csv, format: 'csv' },
      { columns: { timestamp: 0, consumptionCols: [1, 2], feedInCols: [3, 4] }, unit: 'kWh' },
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.profile.source).toBe('import_export_split')
    expect(out.profile.readings[0]!.gridPowerKw).toBe(48)
  })
})

describe('TEIL 2 — dt. Monatsname + String-Komma-Werte in XLSX (gültiger Lastgang)', () => {
  it('parst "17/März/2026 HH:MM"-Datum und Komma-String-Werte durch die volle XLSX-Kette', () => {
    const pad = (x: number) => String(x).padStart(2, '0')
    const aoa: (string | number)[][] = [['Zeit', 'Netzbezug (kW)']]
    for (let i = 0; i < 96; i++) {
      const zeit = `17/März/2026 ${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`
      aoa.push([zeit, `${5 + (i % 3)},5`]) // String mit Dezimalkomma: "5,5" / "6,5" / "7,5"
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const out = parseLoadProfile({ content: buf, format: 'xlsx' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.detection.dateFormat).toBe('de_month_name')
    expect(out.profile.readings).toHaveLength(96)
    expect(out.profile.readings[0]!.gridPowerKw).toBe(5.5) // "5,5" korrekt als Komma-Dezimal geparst
    expect(out.profile.readings[1]!.gridPowerKw).toBe(6.5)
  })
})

describe('Split-Timestamp generisch (TEIL 1) — nicht nur "Zeit von/bis"', () => {
  it('kombiniert getrennte "Datum"/"Uhrzeit"-Spalten', () => {
    const pad = (x: number) => String(x).padStart(2, '0')
    const rows: string[] = []
    for (let i = 0; i < 96; i++) {
      rows.push(`16.06.2026;${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)};${10 + (i % 5)}`)
    }
    const csv = ['Datum;Uhrzeit;Bezug (kW)', ...rows].join('\n')
    const out = parseLoadProfile({ content: csv, format: 'csv' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.detection.columns.timestamp).toBe(0)
    expect(out.detection.columns.timeColumn).toBe(1)
    expect(out.detection.dateFormat).toBe('de_dot_date')
    expect(out.profile.readings).toHaveLength(96)
    expect(out.profile.readings[0]!.gridPowerKw).toBe(10)
  })
})

describe('Format B (Wechselrichter/ESS-XLSX) — Ablehnung "kein Netz-Lastgang" (TEIL 2/Format B, OP#4)', () => {
  for (const name of ESS_FILES) {
    it(`lehnt ${name} fachlich korrekt ab (kein Falsch-Parse)`, () => {
      const buf = readFileSync(fixture(name))
      const out = parseLoadProfile({ content: buf, format: 'xlsx' })
      expect(out.ok).toBe(false)
      if (out.ok || out.kind !== 'error') throw new Error('error erwartet')
      expect(out.error.code).toBe('not_a_load_profile')
      expect(out.error.message).toMatch(/kein Netz-Lastgang/i)
    })
  }
})
