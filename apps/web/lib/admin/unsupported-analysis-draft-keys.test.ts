import { describe, expect, it } from 'vitest'
import { UNSUPPORTED_ANALYSIS_DRAFT_KEYS } from 'shared'

import { BATTERY_DRAFT_KEYS, BATTERY_RECOMMENDATION_KEY } from './battery-draft'
import { PV_DRAFT_KEYS } from './pv-draft'

/**
 * D3 — die Sperre in `shared` schreibt die Schlüsselnamen aus, die HIER entstehen.
 *
 * ⚠ OHNE DIESEN TEST WÄRE EINE UMBENENNUNG STILL: der Analyse-Lauf fände den Schlüssel nicht mehr,
 * liesse die PV-Angabe weg und gäbe eine unvollständige Rechnung als vollständige aus.
 * `wantsBatteryRecommendation` steht ausdrücklich NICHT in der Sperre — es ist der Regelfall jeder
 * Analyse und würde mit aufgeführt genau die Läufe blockieren, für die dieser Weg gebaut ist.
 */
describe('Sperre gegen halb verarbeitete Entwürfe (D3)', () => {
  it('führt jeden PV- und Bestandsbatterie-Schlüssel der Wizard-Stationen', () => {
    const blocked = new Set(UNSUPPORTED_ANALYSIS_DRAFT_KEYS)
    const expected = [
      ...BATTERY_DRAFT_KEYS.filter((key) => key !== BATTERY_RECOMMENDATION_KEY),
      ...PV_DRAFT_KEYS,
    ]

    expect(expected.filter((key) => !blocked.has(key))).toEqual([])
    expect(blocked.has(BATTERY_RECOMMENDATION_KEY)).toBe(false)
  })
})
