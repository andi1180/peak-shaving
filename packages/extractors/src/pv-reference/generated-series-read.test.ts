import { applyEstimatedPv, buildEstimatedPvProfile } from 'engine'
import { describe, expect, it } from 'vitest'
import type { LoadProfile } from 'shared'

import {
  GENERATED_PV_SERIES_FORMAT,
  buildGeneratedPvSeriesFile,
} from './generated-series'
import {
  GeneratedPvSeriesError,
  coupleGeneratedPvSeries,
  readGeneratedPvSeries,
} from './generated-series-read'

/**
 * Leser und Kopplung der abgelegten Schätzreihe. Kein Netz, keine Attrappe — was hier schiefgehen
 * kann, ist eine falsch gelesene Datei und eine Reihe, die zu einem anderen Lastgang gehört.
 */

/*
 * ⚠ Die Zeitstempel sind absichtlich uneinheitlich geschrieben (wie im Nachbartest): der Leser darf
 * sie nicht über `Date` neu bilden, sonst liefe der Abgleich mit dem Lastgang still ins Leere.
 * `pvReadingSchema` verlangt allerdings die Z-Form — deshalb hier zwei kanonische und einer ohne
 * Millisekunden.
 */
const TIMESTAMPS = ['2025-01-02T08:00:00.000Z', '2025-01-02T09:00:00Z', '2025-01-02T10:00:00.000Z']

const CONSUMPTION: LoadProfile = {
  readings: TIMESTAMPS.map((ts, i) => ({ ts, gridPowerKw: 10 + i })),
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Vienna',
  source: 'import_only',
}

/** Dieselbe Datei, die `buildGeneratedPvSeriesFile` ablegt — nicht eine von Hand geschriebene. */
function serializedSeries(): string {
  return buildGeneratedPvSeriesFile({
    hourlySeries: [Array.from({ length: 8760 }, (_, i) => (i % 24 === 8 ? 6 : 0))],
    timestamps: TIMESTAMPS,
    weatherYears: { from: 2014, to: 2023 },
    smoothingOptimismPercent: 4.9,
  }).text
}

describe('readGeneratedPvSeries', () => {
  it('entpackt Format, Wetterjahre, Glättungs-Aufschlag und die Werte', () => {
    const document = readGeneratedPvSeries(serializedSeries())

    expect(document.format).toBe(GENERATED_PV_SERIES_FORMAT)
    expect(document.weatherYears).toEqual({ from: 2014, to: 2023 })
    expect(document.smoothingOptimismPercent).toBe(4.9)
    // Die Zeitstempel kommen VERBATIM zurück, nicht kanonisiert.
    expect(document.readings.map((r) => r.ts)).toEqual(TIMESTAMPS)
  })

  it('weist ein fremdes oder fehlendes Format ab, statt es still zu lesen', () => {
    const fremd = JSON.parse(serializedSeries()) as Record<string, unknown>
    fremd.format = 'coolin.pv-generated-series.v2'

    expect(() => readGeneratedPvSeries(JSON.stringify(fremd))).toThrow(GeneratedPvSeriesError)
    expect(() => readGeneratedPvSeries(JSON.stringify(fremd))).toThrow(/Unbekanntes Format/)

    // Fehlendes Feld: ohne die Prüfung liefe der Rest durch — die Werte daneben sind ja gültig.
    delete fremd.format
    expect(() => readGeneratedPvSeries(JSON.stringify(fremd))).toThrow(
      expect.objectContaining({ reason: 'unknown_format' }),
    )
  })
})

describe('coupleGeneratedPvSeries', () => {
  it('liefert genau das, was die Engine-Funktionen für dieselbe Reihe liefern', () => {
    const document = readGeneratedPvSeries(serializedSeries())
    const pvGenerationKw = document.readings.map((r) => r.pvGenerationKw)

    const coupled = coupleGeneratedPvSeries(CONSUMPTION, document)

    expect(coupled.profile).toEqual(applyEstimatedPv(CONSUMPTION, pvGenerationKw))
    expect(coupled.pv).toEqual(buildEstimatedPvProfile(CONSUMPTION, pvGenerationKw))
    expect(coupled.smoothingOptimismPercent).toBe(4.9)
    // Aufschlag und Wetterjahre reisen zusammen — ein Aufschlag ohne sein Jahrzehnt sagt nichts.
    expect(coupled.weatherYears).toEqual({ from: 2014, to: 2023 })
  })

  it('bricht ab, wenn die Reihe zu einem anderen Lastgang gehört', () => {
    const document = readGeneratedPvSeries(serializedSeries())
    // Derselbe Umfang, ein verschobener Zeitstempel — positionsweise addiert fiele das nirgends auf.
    const anderer: LoadProfile = {
      ...CONSUMPTION,
      readings: CONSUMPTION.readings.map((r, i) =>
        i === 1 ? { ...r, ts: '2025-01-03T09:00:00Z' } : r,
      ),
    }

    expect(() => coupleGeneratedPvSeries(anderer, document)).toThrow(/passt ab Wert 2 nicht/)
  })
})
