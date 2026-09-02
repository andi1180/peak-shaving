import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  MAX_PEAK_POWER_KWP,
  PVGIS_WEATHER_YEARS,
  checkPvgisRequest,
  parsePvgisSeries,
  parsePvgisTime,
  pvgisSeriesCalcParams,
  type PvgisArrayDesign,
} from './pvgis'

/**
 * B22a — die reine Seite der PVGIS-Anbindung, gegen eine ECHTE Antwort geprüft (kein Netz im Test).
 *
 * Die Fixture ist eine am 02.09.2026 tatsächlich gelieferte `seriescalc`-Antwort (Wien 48,2082 /
 * 16,3738 · 10 kWp · 35° · Azimut 0 · Verlust 14 % · Wetterjahre 2014–2023), gekürzt auf vier
 * Kalendertage je Jahr (28.02., 29.02. in Schaltjahren, 01.03., 21.06.). Die vollständige Antwort
 * sind 8,2 MB; was nur an ihr prüfbar wäre, prüft `reference-profile.test.ts` an einer
 * synthetischen Vollreihe.
 */
const raw: unknown = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/pvgis-seriescalc-wien-2014-2023-gekuerzt.json', import.meta.url),
    'utf8',
  ),
)

const design: PvgisArrayDesign = {
  latitudeDeg: 48.2082,
  longitudeDeg: 16.3738,
  peakPowerKwp: 10.2,
  slopeDeg: 35,
  azimuthDeg: -47,
}

describe('B22a — PVGIS-Anfrage: was hinausgeht, geht nur geprüft hinaus', () => {
  it('fragt EINEN Aufruf über alle zehn Wetterjahre ab, mit PV-Rechnung', () => {
    const p = pvgisSeriesCalcParams(design)
    expect(p.startyear).toBe(String(PVGIS_WEATHER_YEARS.from))
    expect(p.endyear).toBe(String(PVGIS_WEATHER_YEARS.to))
    expect(PVGIS_WEATHER_YEARS.to - PVGIS_WEATHER_YEARS.from + 1).toBe(10)
    // Ohne `pvcalculation=1` liefert der Dienst kein `P` — dann gäbe es nichts zu rechnen.
    expect(p.pvcalculation).toBe('1')
    expect(p.outputformat).toBe('json')
    expect(p.aspect).toBe('-47')
    expect(p.angle).toBe('35')
    expect(p.peakpower).toBe('10.2')
  })

  it('trägt KEINE Verbrauchsdaten hinaus — die Parameterliste ist abschliessend (Prinzip 4)', () => {
    // Wer hier ein Feld ergänzt, muss diese Liste bewusst ändern: der Lastgang bleibt im Browser,
    // die Kopplung Verbrauch − Erzeugung geschieht dort (`applyEstimatedPv`).
    expect(Object.keys(pvgisSeriesCalcParams(design)).sort()).toEqual([
      'angle',
      'aspect',
      'endyear',
      'lat',
      'lon',
      'loss',
      'outputformat',
      'peakpower',
      'pvcalculation',
      'startyear',
    ])
  })

  it('weist unbrauchbare Parameter ab, bevor irgendetwas hinausgeht', () => {
    expect(checkPvgisRequest(design)).toEqual({ ok: true })
    expect(checkPvgisRequest({ ...design, latitudeDeg: 91 })).toEqual({
      ok: false,
      reason: 'coordinate_out_of_range',
    })
    expect(checkPvgisRequest({ ...design, longitudeDeg: Number.NaN })).toEqual({
      ok: false,
      reason: 'coordinate_out_of_range',
    })
    expect(checkPvgisRequest({ ...design, peakPowerKwp: 0 })).toEqual({
      ok: false,
      reason: 'peak_power_out_of_range',
    })
    // Die Obergrenze ist eine SPERRE gegen den Missbrauch der offenen Server Action, keine Kosmetik.
    expect(checkPvgisRequest({ ...design, peakPowerKwp: MAX_PEAK_POWER_KWP + 1 })).toEqual({
      ok: false,
      reason: 'peak_power_out_of_range',
    })
    expect(checkPvgisRequest({ ...design, peakPowerKwp: MAX_PEAK_POWER_KWP })).toEqual({ ok: true })
    expect(checkPvgisRequest({ ...design, slopeDeg: 91 })).toEqual({
      ok: false,
      reason: 'slope_out_of_range',
    })
    // Senkrecht (90°) ist ein realer Fall — die PV*SOL-Auslegung im Bestand nennt genau das.
    expect(checkPvgisRequest({ ...design, slopeDeg: 90 })).toEqual({ ok: true })
    expect(checkPvgisRequest({ ...design, azimuthDeg: 181 })).toEqual({
      ok: false,
      reason: 'azimuth_out_of_range',
    })
  })
})

describe('B22a — der 10-min-Versatz wird entfernt, nicht übernommen', () => {
  it('liest `20200621:1110` als den STUNDENBEGINN 11:00 UTC', () => {
    const ms = parsePvgisTime('20200621:1110')
    expect(ms).not.toBeNull()
    expect(new Date(ms as number).toISOString()).toBe('2020-06-21T11:00:00.000Z')
  })

  it('verwirft die Minute, statt sie zu runden', () => {
    // `:0050` würde gerundet zur NÄCHSTEN Stunde — der Dienst kann den Versatz künftig anders
    // setzen, und eine Rundung machte daraus je nach Wert eine andere Stunde.
    expect(new Date(parsePvgisTime('20200621:1150') as number).toISOString()).toBe(
      '2020-06-21T11:00:00.000Z',
    )
    expect(new Date(parsePvgisTime('20200621:1100') as number).toISOString()).toBe(
      '2020-06-21T11:00:00.000Z',
    )
  })

  it('lehnt einen unlesbaren Zeitstempel ab, statt ihn zu deuten', () => {
    expect(parsePvgisTime('2020-06-21T11:10')).toBeNull()
    expect(parsePvgisTime('20200621')).toBeNull()
    expect(parsePvgisTime('')).toBeNull()
  })
})

describe('B22a — die echte Antwort wird gelesen, und Halbheiten werden abgelehnt', () => {
  it('liest die gekürzte ECHTE Antwort samt zurückgespiegelter Eingaben', () => {
    const out = parsePvgisSeries(raw)
    expect(out.ok).toBe(true)
    if (!out.ok) return

    // 10 Jahre × 3 Tage à 24 h + 2 Schaltjahre × 24 h = 768.
    expect(out.samples).toHaveLength(768)
    expect(out.inputs).toEqual({
      latitudeDeg: 48.2082,
      longitudeDeg: 16.3738,
      elevationM: 186,
      peakPowerKwp: 10,
      systemLossPercent: 14,
      slopeDeg: 35,
      azimuthDeg: 0,
      radiationDb: 'PVGIS-SARAH3',
    })
  })

  it('rechnet W in kW um — an genau einer Stelle', () => {
    const out = parsePvgisSeries(raw)
    if (!out.ok) throw new Error('Fixture parst nicht')
    const noon = out.samples.find((s) => s.utcMs === Date.UTC(2020, 5, 21, 11))
    expect(noon).toBeDefined()
    // Die Rohzeile der Fixture trägt an dieser Stelle Watt im vierstelligen Bereich; in kW muss
    // daraus ein einstelliger Wert werden. Ohne die Umrechnung wäre die „PV-Anlage" 1.000-mal so
    // gross — und die Ersparnis-Zahl sähe trotzdem plausibel aus.
    expect(noon?.pvGenerationKw).toBeGreaterThan(1)
    expect(noon?.pvGenerationKw).toBeLessThan(11)
  })

  it('bricht bei EINEM unlesbaren Eintrag ab, statt ihn zu überspringen', () => {
    const good = parsePvgisSeries(raw)
    if (!good.ok) throw new Error('Fixture parst nicht')

    const broken = structuredClone(raw) as { outputs: { hourly: Record<string, unknown>[] } }
    broken.outputs.hourly[5]!.P = 'viel'
    expect(parsePvgisSeries(broken)).toEqual({ ok: false, reason: 'unexpected_shape' })

    const negative = structuredClone(raw) as { outputs: { hourly: Record<string, unknown>[] } }
    negative.outputs.hourly[5]!.P = -1
    expect(parsePvgisSeries(negative)).toEqual({ ok: false, reason: 'unexpected_shape' })

    const badTime = structuredClone(raw) as { outputs: { hourly: Record<string, unknown>[] } }
    badTime.outputs.hourly[5]!.time = '2020-06-21 11:10'
    expect(parsePvgisSeries(badTime)).toEqual({ ok: false, reason: 'unexpected_shape' })
  })

  it('lehnt eine Antwort ohne Reihe oder ohne Eingaben ab', () => {
    expect(parsePvgisSeries(null)).toEqual({ ok: false, reason: 'unexpected_shape' })
    expect(parsePvgisSeries({})).toEqual({ ok: false, reason: 'unexpected_shape' })
    const empty = structuredClone(raw) as { outputs: { hourly: unknown[] } }
    empty.outputs.hourly = []
    expect(parsePvgisSeries(empty)).toEqual({ ok: false, reason: 'unexpected_shape' })
    const noInputs = structuredClone(raw) as Record<string, unknown>
    delete noInputs.inputs
    expect(parsePvgisSeries(noInputs)).toEqual({ ok: false, reason: 'unexpected_shape' })
  })

  it('lehnt die Fehlerantwort des Dienstes ab — sie ist keine Reihe', () => {
    // Real gemessen: `startyear=1990` antwortet mit genau diesem Rumpf und HTTP 400.
    expect(
      parsePvgisSeries({
        message: 'startyear: Incorrect value. Please, enter an integer between 2005 and 2023.',
        status: 400,
      }),
    ).toEqual({ ok: false, reason: 'unexpected_shape' })
  })
})
