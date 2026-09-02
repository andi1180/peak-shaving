import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import type { LoadProfile } from 'shared'

import { parseLoadProfile } from '../parser'
import { alignPvGrossToLoad } from '../simulation/pv'
import { generateStandardLoadProfile } from '../standard-profile/h0'
import { syntheticSeries } from './__fixtures__/synthetic-series'
import { parsePvgisSeries } from './pvgis'
import { buildPvReferenceProfile, expandReferenceToTimestamps } from './reference-profile'
import { applyEstimatedPv, buildEstimatedPvProfile, pvGeneratorEligibility } from './couple'

const raw: unknown = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/pvgis-seriescalc-wien-2014-2023-gekuerzt.json', import.meta.url),
    'utf8',
  ),
)
const parsedFixture = parsePvgisSeries(raw)
if (!parsedFixture.ok) throw new Error('PVGIS-Fixture parst nicht')

const reference = buildPvReferenceProfile(syntheticSeries(), parsedFixture.inputs)
if (!reference.ok) throw new Error('Referenzprofil baut nicht')

/** Das H0-Standardprofil — der wichtigste Anwendungsfall (§0.2): heute strikt positiv, also € 0. */
const h0 = generateStandardLoadProfile({
  annualConsumptionKwh: 4500,
  customerClass: 'privat',
  year: 2025,
  timeZone: 'Europe/Vienna',
})
if (!h0.ok) throw new Error('H0 erzeugt nicht')
const consumption: LoadProfile = h0.profile

const pvKw = expandReferenceToTimestamps(
  reference.profile,
  consumption.readings.map((r) => r.ts),
)

describe('B22a — die Kopplung: Verbrauch − Erzeugung → signierter Netz-Lastgang', () => {
  const coupled = applyEstimatedPv(consumption, pvKw)

  it('zieht die Erzeugung ab und erzeugt dadurch echte Einspeise-Slots', () => {
    expect(coupled.readings).toHaveLength(consumption.readings.length)
    for (let i = 0; i < coupled.readings.length; i++) {
      expect(coupled.readings[i]!.gridPowerKw).toBeCloseTo(
        (consumption.readings[i]!.gridPowerKw) - (pvKw[i] as number),
        12,
      )
    }
    // Der Ausgangspunkt: das H0-Profil hat KEINEN einzigen negativen Slot (Bestandsaufnahme 1.4).
    expect(consumption.readings.some((r) => r.gridPowerKw < 0)).toBe(false)
    // Nach der Kopplung sehr wohl — und genau daran hängt die Eigenverbrauchs-Ersparnis.
    expect(coupled.readings.filter((r) => r.gridPowerKw < 0).length).toBeGreaterThan(1000)
  })

  it('setzt `pvSource: estimated` und LÄSST `source` unverändert', () => {
    expect(coupled.pvSource).toBe('estimated')
    /*
     * ⚠ Der Kern der Contract-Entscheidung (§2.2). `source` beschreibt die Herkunft des VERBRAUCHS,
     * und die ändert eine geschätzte Erzeugung nicht. Würde hier `net_signed` gesetzt, sähe der
     * schwächste Fall des ganzen Rechners aus wie eine Messung — und der `standard_profile`-Blocker
     * fiele weg, also ausgerechnet die zweite, unabhängige Begründung dafür, dass hier keine
     * Spitzenkappung gerechnet wird.
     */
    expect(coupled.source).toBe('standard_profile')
    expect(coupled.intervalMinutes).toBe(consumption.intervalMinutes)
    expect(coupled.timezoneMeta).toBe(consumption.timezoneMeta)
  })

  it('übernimmt die Zeitstempel VERBATIM — dieselben Zeichenketten, nicht neu gebildete', () => {
    /*
     * `alignPvGrossToLoad` ordnet über einen exakten ISO-String-Vergleich zu (Bestandsaufnahme 1.1).
     * Eine neu formatierte, auch nur anders geschriebene Zeichenkette liesse die Zuordnung still ins
     * Leere laufen. Geprüft wird deshalb die IDENTITÄT der Zeichenkette, nicht ihre Gleichheit.
     */
    for (let i = 0; i < 200; i++) {
      expect(coupled.readings[i]!.ts).toBe(consumption.readings[i]!.ts)
    }
  })

  it('bricht ab, wenn die Erzeugungsreihe nicht zum Lastgang passt', () => {
    expect(() => applyEstimatedPv(consumption, pvKw.slice(0, -1))).toThrow(/verschiedene Längen/)
  })
})

describe('B22a — das begleitende PV-Profil ist Beiwerk der Anzeige', () => {
  const coupled = applyEstimatedPv(consumption, pvKw)
  const pvProfile = buildEstimatedPvProfile(consumption, pvKw)

  it('deckt jeden Slot ab und löst die Konsistenzprüfung NIE aus — per Konstruktion', () => {
    const alignment = alignPvGrossToLoad(coupled, pvProfile)
    expect(alignment.matchedSlots).toBe(coupled.readings.length)
    // `Einspeisung = max(0, −(Verbrauch − PV)) ≤ PV`, solange der Verbrauch nicht negativ ist.
    expect(alignment.inconsistentSlots).toBe(0)
  })

  it('trägt dieselben Zeitstempel-Zeichenketten wie der Lastgang', () => {
    for (let i = 0; i < 200; i++) {
      expect(pvProfile.readings[i]!.ts).toBe(coupled.readings[i]!.ts)
    }
  })
})

describe('B22a — wo der Generator NICHT angeboten wird (§2.4)', () => {
  it('bietet ihn für ein Standardprofil und einen reinen Bezugs-Lastgang an', () => {
    expect(pvGeneratorEligibility(consumption)).toEqual({ offered: true })

    const csv = readFileSync(
      new URL('../../../../dev-fixtures/demo-baeckerei-lastgang-2023.csv', import.meta.url),
      'utf8',
    )
    const parsed = parseLoadProfile({ content: csv, format: 'csv' })
    if (!parsed.ok) throw new Error('Demo-Fixture parst nicht')
    expect(parsed.profile.source).toBe('import_only')
    expect(pvGeneratorEligibility(parsed.profile)).toEqual({ offered: true })
  })

  it('verweigert ihn, wo Einspeisung GEMESSEN vorliegt — dort steht die Ersparnis bereits', () => {
    const csv = readFileSync(
      new URL('../../../../dev-fixtures/demo-baeckerei-mit-pv-netzlastgang-2023.csv', import.meta.url),
      'utf8',
    )
    const parsed = parseLoadProfile({ content: csv, format: 'csv' })
    if (!parsed.ok) throw new Error('PV-Demo-Fixture parst nicht')
    expect(parsed.profile.source).toBe('net_signed')
    expect(pvGeneratorEligibility(parsed.profile)).toEqual({
      offered: false,
      reason: 'measured_feed_in',
    })
  })

  it('⚠ verweigert ihn AUCH bei falsch etikettiertem `import_only` — der bekannte Parser-Defekt', () => {
    /*
     * Die Vorzeichen-Erkennung des Parsers liest nur die ersten 60 Zeilen; ein signierter Lastgang,
     * dessen erste Einspeisung spät im Jahr liegt, wird als `import_only` etikettiert. Eine Regel,
     * die nur `source` läse, böte ihm den Generator an — und die geschätzte Erzeugung käme zur
     * gemessenen hinzu.
     */
    const spaeteEinspeisung: LoadProfile = {
      ...consumption,
      source: 'import_only',
      readings: consumption.readings.map((r, i) =>
        i === consumption.readings.length - 1 ? { ...r, gridPowerKw: -2 } : r,
      ),
    }
    expect(spaeteEinspeisung.readings.slice(0, 60).some((r) => r.gridPowerKw < 0)).toBe(false)
    expect(pvGeneratorEligibility(spaeteEinspeisung)).toEqual({
      offered: false,
      reason: 'measured_feed_in',
    })
  })

  it('verweigert ihn für einen bereits gekoppelten Lastgang — kein zweites Aufaddieren', () => {
    expect(pvGeneratorEligibility(applyEstimatedPv(consumption, pvKw))).toEqual({
      offered: false,
      reason: 'measured_feed_in',
    })
  })
})
