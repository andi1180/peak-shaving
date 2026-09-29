import { describe, expect, it } from 'vitest'
import { WIENER_NETZE_FIRST_VALUE_KWH, wienerNetzeLastgangCsv } from 'shared/fixtures'

import { parseLoadProfile } from './parse'

/**
 * Einheit aus der Spalte „Einheit" (29.09.2026): der Wiener-Netze-Export führt sie je Zeile statt im
 * Kopf der Wert-Spalte. Ohne die Regel: `unit: 'unknown'` → `needs_mapping`.
 */

const parse = (csv: string) =>
  parseLoadProfile({ content: csv, format: 'csv' }, { timezone: 'UTC' })

describe('Einheit aus der Spalte „Einheit"', () => {
  it('Wiener-Netze-Layout: kWh erkannt, Werte ×4 als kW, kein needs_mapping', () => {
    const out = parse(wienerNetzeLastgangCsv())
    if (!out.ok) throw new Error(`erwartet ok, erhalten ${out.kind}: ${JSON.stringify(out)}`)

    expect(out.detection.unit).toBe('kWh')
    expect(out.detection.columns.value).toBe(7) // die Einheiten-Spalte (8) ist kein Wert-Kandidat
    expect(WIENER_NETZE_FIRST_VALUE_KWH).toBe(1.049)
    expect(out.profile.readings[0]!.gridPowerKw).toBeCloseTo(4.196, 9)
  })

  it.each([
    ['gemischt kW/kWh', (i: number) => (i % 2 === 0 ? 'kWh' : 'kW')],
    ['fremde Einheit MWh', () => 'MWh'],
    ['fremder Text', () => 'x'],
  ])('%s → bleibt unknown, Rückfrage', (_label, unitCell) => {
    const out = parse(wienerNetzeLastgangCsv({ unitCell }))
    expect(out.ok).toBe(false)
    if (out.ok || out.kind !== 'needs_mapping') throw new Error('erwartet needs_mapping')
    expect(out.detection.unit).toBe('unknown')
    expect(out.issues.map((i) => i.field)).toContain('unit')
  })

  it('Einheit im Kopf der Wert-Spalte gilt, eine abweichende Einheiten-Spalte überstimmt sie nicht', () => {
    const out = parse(wienerNetzeLastgangCsv({ valueHeader: 'Wert (kW)' }))
    if (!out.ok) throw new Error('erwartet ok')
    expect(out.detection.unit).toBe('kW')
    expect(out.profile.readings[0]!.gridPowerKw).toBeCloseTo(WIENER_NETZE_FIRST_VALUE_KWH, 9)
  })
})
