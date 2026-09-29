import { describe, expect, it } from 'vitest'
import {
  WIENER_NETZE_PLACEHOLDER_ROWS as PLACEHOLDER_ROWS,
  WIENER_NETZE_ROWS as ROWS,
  wienerNetzeLastgangCsv,
} from 'shared/fixtures'

import { parseLoadProfile } from './parse'

/**
 * Platzhalter „-" in Wert-Zellen zählen bei der Spaltenerkennung wie leere Zellen (29.09.2026).
 *
 * Synthetisch im Layout eines Wiener-Netze-Exports: die ersten 57 % der Zeilen tragen „-" (Zähler
 * noch nicht fernausgelesen), danach echte Werte. Vorher: Kopf-Stichprobe 0 % numerisch, verteilte
 * ~43 % < 0,6 → `no_value_column`.
 */

const parse = (csv: string) =>
  parseLoadProfile({ content: csv, format: 'csv' }, { timezone: 'UTC', unit: 'kWh' })

describe('Platzhalter „-" in Wert-Zellen', () => {
  it('Wiener-Netze-Layout mit langem „-"-Vorlauf: Wert-Spalte gefunden, Platzhalter übersprungen', () => {
    const out = parse(wienerNetzeLastgangCsv())
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
    const out = parse(wienerNetzeLastgangCsv({ placeholderRows: ROWS }))
    expect(out.ok).toBe(false)
    if (out.ok || out.kind !== 'error') return
    expect(out.error.code).toBe('no_value_column')
  })
})
