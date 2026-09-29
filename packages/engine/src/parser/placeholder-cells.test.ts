import { describe, expect, it } from 'vitest'

import { parseLoadProfile } from './parse'

/**
 * Platzhalter „-" in Wert-Zellen zählen bei der Spaltenerkennung wie leere Zellen (29.09.2026).
 *
 * Synthetisch im Layout eines Wiener-Netze-Exports: die ersten 57 % der Zeilen tragen „-" (Zähler
 * noch nicht fernausgelesen), danach echte Werte. Vorher: Kopf-Stichprobe 0 % numerisch, verteilte
 * ~43 % < 0,6 → `no_value_column`.
 */

const HEADER =
  'Startdatum;Enddatum;Zählpunktbezeichnung;Name der Energiegemeinschaft;ID der Energiegemeinschaft;' +
  'OBIS;OBIS Kurzbeschreibung;Wert;Einheit;Qualität;Qualitätbeschreibung'
const METER = 'AT0010000000000000001000000000001'
const STEP_MS = 15 * 60 * 1000
const START_MS = Date.UTC(2025, 5, 1, 0, 0)
const ROWS = 14 * 96
const PLACEHOLDER_ROWS = 770

const pad = (x: number) => String(x).padStart(2, '0')
function at(ms: number): string {
  const d = new Date(ms)
  return (
    `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`
  )
}

function buildCsv(placeholder: (i: number) => boolean): string {
  const out = [HEADER]
  for (let i = 0; i < ROWS; i++) {
    const ms = START_MS + i * STEP_MS
    const measured = !placeholder(i)
    const value = measured ? (0.5 + (i % 7) * 0.125).toFixed(3).replace('.', ',') : '-'
    const quality = measured ? 'L1;Gemessen' : '-;Wert noch nicht Vorhanden'
    out.push(
      `${at(ms)};${at(ms + STEP_MS)};${METER};-;-;1-1:1.9.0 P.01;Verbrauch;${value};KWH;${quality}`,
    )
  }
  return out.join('\n')
}

const parse = (csv: string) =>
  parseLoadProfile({ content: csv, format: 'csv' }, { timezone: 'UTC', unit: 'kWh' })

describe('Platzhalter „-" in Wert-Zellen', () => {
  it('Wiener-Netze-Layout mit langem „-"-Vorlauf: Wert-Spalte gefunden, Platzhalter übersprungen', () => {
    const out = parse(buildCsv((i) => i < PLACEHOLDER_ROWS))
    if (!out.ok)
      throw new Error(
        `erwartet ok, erhalten ${JSON.stringify(out.kind === 'error' ? out.error : out.issues)}`,
      )

    expect(out.detection.columns.value).toBe(7)
    expect(out.profile.readings).toHaveLength(ROWS - PLACEHOLDER_ROWS)
    expect(out.dataQuality.warnings[0]).toMatch(
      new RegExp(
        `^${PLACEHOLDER_ROWS} Zeile\\(n\\) ohne Messwert \\(01\\.06\\.2025 bis 09\\.06\\.2025\\)`,
      ),
    )
    // Gegenprobe: die reinen „-"-Spalten (Energiegemeinschaft) sind keine Kandidaten — sonst stünde
    // hier `needs_mapping` mit mehreren Wert-Spalten statt einer eindeutigen Erkennung.
    expect(out.detection.source).toBe('import_only')
  })

  it('nur Platzhalter in der Wert-Spalte bleibt no_value_column', () => {
    const out = parse(buildCsv(() => true))
    expect(out.ok).toBe(false)
    if (out.ok || out.kind !== 'error') return
    expect(out.error.code).toBe('no_value_column')
  })
})
