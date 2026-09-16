import { describe, expect, it } from 'vitest'
import {
  EXISTING_BATTERY_DRAFT_KEYS,
  PV_UPLOAD_DRAFT_KEYS,
  UNSUPPORTED_ANALYSIS_DRAFT_KEYS,
} from 'shared'

import { BATTERY_DRAFT_KEYS, BATTERY_RECOMMENDATION_KEY } from './battery-draft'
import { PV_DRAFT_KEYS } from './pv-draft'
import {
  PV_ESTIMATED_ANNUAL_KWH_KEY,
  PV_ESTIMATED_SPREAD_PERCENT_KEY,
  PV_ESTIMATED_WEATHER_YEAR_FROM_KEY,
  PV_ESTIMATED_WEATHER_YEAR_TO_KEY,
  PV_PROFILE_SOURCE_KEY,
  PV_SOURCE_DOCUMENT_ID_KEY,
} from './pv-profile-draft'

/**
 * D3 — die Schlüsselnamen entstehen HIER, gelesen werden sie im Analyse-Lauf (`shared`/`engine`).
 *
 * ⚠ OHNE DIESEN TEST WÄRE EINE UMBENENNUNG STILL: die Abbildung fände den Schlüssel nicht mehr,
 * liesse Batterie oder PV weg und gäbe eine unvollständige Rechnung als vollständige aus. Seit
 * Baustein 2 gilt das für die GELESENEN Namen genauso wie für die gesperrten.
 */
describe('Entwurfs-Schlüssel des Analyse-Laufs (D3)', () => {
  it('liest die Bestandsbatterie unter den Namen, die die Station schreibt', () => {
    const written = new Set(BATTERY_DRAFT_KEYS)
    for (const key of Object.values(EXISTING_BATTERY_DRAFT_KEYS)) {
      expect(written.has(key)).toBe(true)
    }
  })

  it('liest die hochgeladene PV-Reihe unter den Namen, die die Stationen schreiben', () => {
    const written = new Set([...PV_DRAFT_KEYS, PV_SOURCE_DOCUMENT_ID_KEY, PV_PROFILE_SOURCE_KEY])
    for (const key of Object.values(PV_UPLOAD_DRAFT_KEYS)) {
      expect(written.has(key)).toBe(true)
    }
  })

  it('sperrt genau die vier PVGIS-Kennzahlen — und keinen Schlüssel eines verarbeiteten Wegs', () => {
    const generated = [
      PV_ESTIMATED_ANNUAL_KWH_KEY,
      PV_ESTIMATED_SPREAD_PERCENT_KEY,
      PV_ESTIMATED_WEATHER_YEAR_FROM_KEY,
      PV_ESTIMATED_WEATHER_YEAR_TO_KEY,
    ]
    expect([...UNSUPPORTED_ANALYSIS_DRAFT_KEYS].sort()).toEqual([...generated].sort())

    // Alles andere, was die zwei Stationen schreiben, wird verarbeitet — `wantsBatteryRecommendation`
    // war nie gesperrt, die übrigen Batterie-/PV-Schlüssel sind es seit Baustein 2 nicht mehr.
    const blocked = new Set(UNSUPPORTED_ANALYSIS_DRAFT_KEYS)
    const processed = [...BATTERY_DRAFT_KEYS, ...PV_DRAFT_KEYS, BATTERY_RECOMMENDATION_KEY].filter(
      (key) => !generated.includes(key),
    )
    expect(processed.filter((key) => blocked.has(key))).toEqual([])
  })
})
