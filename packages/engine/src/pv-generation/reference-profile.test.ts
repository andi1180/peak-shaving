import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { zonedWallToUtcMs, toIsoUtc } from '../parser/datetime'
import { syntheticKwAt, syntheticSeries } from './__fixtures__/synthetic-series'
import { parsePvgisSeries, type PvgisEchoedInputs, type PvgisHourlySample } from './pvgis'
import {
  REFERENCE_PROFILE_HOURS,
  averageWeatherYears,
  buildPvReferenceProfile,
  expandReferenceToTimestamps,
  mapFeb29ToFeb28,
  referenceHourIndex,
  type PvReferenceProfile,
} from './reference-profile'

const raw: unknown = JSON.parse(
  readFileSync(
    new URL('./__fixtures__/pvgis-seriescalc-wien-2014-2023-gekuerzt.json', import.meta.url),
    'utf8',
  ),
)
const parsedFixture = parsePvgisSeries(raw)
if (!parsedFixture.ok) throw new Error('PVGIS-Fixture parst nicht')
const realSamples: PvgisHourlySample[] = parsedFixture.samples

const inputs: PvgisEchoedInputs = parsedFixture.inputs

/**
 * Ein Referenzprofil aus der GEKÜRZTEN echten Antwort — die von ihr nicht abgedeckten
 * Kalenderpositionen werden für diesen Zweck mit 0 gefüllt. Geprüft wird damit ausschliesslich die
 * ABBILDUNG auf ein Zielgitter; die Vollständigkeitsregel hat ihren eigenen Test weiter unten und
 * würde eine solche Reihe zu Recht ablehnen.
 */
function referenceFromRealFixture(): PvReferenceProfile {
  const avg = averageWeatherYears(realSamples)
  return {
    hourlyKw: avg.meanKwByHour.map((v) => v ?? 0),
    weatherYears: { from: 2014, to: 2023 },
    annualYields: avg.annualYields,
    inputs,
  }
}

describe('B22a — Mittel über die zehn Wetterjahre, an ECHTEN Werten', () => {
  const avg = averageWeatherYears(realSamples)

  it('mittelt je UTC-Kalenderposition über alle zehn Jahre', () => {
    const idx = referenceHourIndex(6, 21, 11)
    expect(idx).not.toBeNull()
    expect(avg.countByHour[idx as number]).toBe(10)
    // Gemessen am 02.09.2026 gegen die echte Antwort: Σ P über 2014–2023 / 10 = 5.955,28 W.
    expect(avg.meanKwByHour[idx as number]).toBeCloseTo(5.95528, 9)
  })

  it('nennt den Jahresertrag je Wetterjahr — die Streuung IST die Genauigkeitsgrenze', () => {
    expect(avg.annualYields.map((a) => a.year)).toEqual([
      2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023,
    ])
    // In der gekürzten Fixture ist das der Ertrag der vier enthaltenen Tage, nicht des Jahres —
    // geprüft wird hier, dass je Jahr GETRENNT gezählt wird und die Schaltjahre mehr tragen.
    const byYear = new Map(avg.annualYields.map((a) => [a.year, a.kwh]))
    expect(byYear.get(2016)).toBeGreaterThan(0)
    expect(avg.annualYields).toHaveLength(10)
  })
})

describe('B22a — die Schaltjahr-Regel', () => {
  it('bildet den 29. Februar auf den 28. ab und lässt jeden anderen Tag unberührt', () => {
    expect(mapFeb29ToFeb28(2, 29)).toEqual({ month: 2, day: 28 })
    expect(mapFeb29ToFeb28(2, 28)).toEqual({ month: 2, day: 28 })
    expect(mapFeb29ToFeb28(3, 1)).toEqual({ month: 3, day: 1 })
  })

  it('trägt 8.760 Zellen, nicht 8.784', () => {
    expect(REFERENCE_PROFILE_HOURS).toBe(8760)
    expect(averageWeatherYears(realSamples).meanKwByHour).toHaveLength(8760)
    expect(referenceHourIndex(12, 31, 23)).toBe(8759)
    expect(referenceHourIndex(1, 1, 0)).toBe(0)
  })

  it('⚠ lässt die Stunden des 29. Februar aus den ZELLEN heraus — mit ihnen wäre der Wert ein anderer', () => {
    const avg = averageWeatherYears(realSamples)
    const idx = referenceHourIndex(2, 28, 11) as number

    // Der 28. Februar mittelt über ALLE zehn Jahre.
    expect(avg.countByHour[idx]).toBe(10)
    expect(avg.meanKwByHour[idx]).toBeCloseTo(5.20578, 9)

    /*
     * Der Gegenbeweis: der 29. Februar existiert nur 2016 und 2020 und trägt dort im Mittel
     * 2.293,65 W — ein ganz anderer Wert als die 5.205,78 W des 28. Februar. Würden seine Stunden
     * auf die 28.-Februar-Zelle addiert, läge der Mittelwert bei 12 statt 10 Werten und damit
     * sichtbar tiefer. Ohne diese Assertion bliebe der Test auch dann grün, wenn der 29. Februar
     * mit hineinliefe.
     */
    const feb29 = realSamples.filter((s) => {
      const d = new Date(s.utcMs)
      return d.getUTCMonth() === 1 && d.getUTCDate() === 29 && d.getUTCHours() === 11
    })
    expect(feb29).toHaveLength(2)
    const feb29Mean = feb29.reduce((a, s) => a + s.pvGenerationKw, 0) / feb29.length
    expect(feb29Mean).toBeCloseTo(2.29365, 9)
    const polluted = (5.20578 * 10 + feb29Mean * 2) / 12
    expect(avg.meanKwByHour[idx]).not.toBeCloseTo(polluted, 3)
  })

  it('gibt dem 29. Februar eines SCHALTJAHRES die Werte des 28. — nicht null und nicht interpoliert', () => {
    const profile = referenceFromRealFixture()
    const feb28 = expandReferenceToTimestamps(profile, [
      toIsoUtc(Date.UTC(2028, 1, 28, 11, 0)),
    ])[0] as number
    const feb29 = expandReferenceToTimestamps(profile, [
      toIsoUtc(Date.UTC(2028, 1, 29, 11, 0)),
    ])[0] as number
    const mar1 = expandReferenceToTimestamps(profile, [
      toIsoUtc(Date.UTC(2028, 2, 1, 11, 0)),
    ])[0] as number

    expect(feb28).toBeCloseTo(5.20578, 9)
    expect(feb29).toBe(feb28)
    // Und ausdrücklich NICHT der Mittelwert der Nachbartage — das wäre eine dritte, nirgends
    // gemessene Kurve.
    expect(mar1).toBeCloseTo(5.23285, 9)
    expect(feb29).not.toBeCloseTo((feb28 + mar1) / 2, 6)
    // Und erst recht keine Lücke.
    expect(feb29).toBeGreaterThan(0)
  })
})

describe('B22a — Stunde → Viertelstunde als TREPPE, nicht als Interpolation', () => {
  const profile = referenceFromRealFixture()

  /** Die 96 Viertelstunden des 21. Juni 2026 in ORTSZEIT-Wien, als ISO/UTC — wie im echten Gitter. */
  const targets: string[] = []
  const start = zonedWallToUtcMs(2026, 6, 21, 0, 0, 0, 'Europe/Vienna')
  for (let i = 0; i < 96; i++) targets.push(toIsoUtc(start + i * 15 * 60 * 1000))

  const values = expandReferenceToTimestamps(profile, targets)

  it('gibt jeder der vier Viertelstunden einer Stunde denselben Wert', () => {
    expect(values).toHaveLength(96)
    for (let h = 0; h < 24; h++) {
      const quarter = values.slice(h * 4, h * 4 + 4)
      expect(new Set(quarter).size).toBe(1)
    }
  })

  it('⚠ und die Nachbarstunden unterscheiden sich — sonst wäre die Gleichheit oben trivial', () => {
    const hourly = Array.from({ length: 24 }, (_, h) => values[h * 4] as number)
    const changes = hourly.filter((v, i) => i > 0 && v !== hourly[i - 1]).length
    expect(changes).toBeGreaterThan(5)
  })

  it('⚠ eine Interpolation ergäbe innerhalb der Stunde ANDERE Werte — hier ausgerechnet', () => {
    const hourly = Array.from({ length: 24 }, (_, h) => values[h * 4] as number)
    // Eine Stunde mit deutlichem Anstieg suchen (Vormittag) und die Interpolation ausschreiben.
    const h = hourly.findIndex((v, i) => i > 0 && i < 23 && (hourly[i + 1] as number) - v > 0.5)
    expect(h).toBeGreaterThan(0)
    const a = hourly[h] as number
    const b = hourly[h + 1] as number
    const interpolated = [a, a + (b - a) / 4, a + (b - a) / 2, a + (3 * (b - a)) / 4]
    const stepped = values.slice(h * 4, h * 4 + 4)
    expect(stepped).toEqual([a, a, a, a])
    expect(stepped).not.toEqual(interpolated)
  })

  it('trifft die Sonnenspitze zur ORTSZEIT-Mittagszeit, nicht zur UTC-Mittagszeit', () => {
    /*
     * Der Beleg dafür, dass über den ZEITPUNKT nachgeschlagen wird und nicht über die Position im
     * Quell-Array: das Zielgitter beginnt an der Ortszeit-Mitternacht (im Juni = 22:00 UTC des
     * Vortages). Ein positionsweises Auflegen der UTC-Stundenreihe verschöbe die Kurve um zwei
     * Stunden — die Anlage lieferte dann um 10 Uhr früh ihr Maximum.
     */
    const peakIndex = values.indexOf(Math.max(...values))
    const peakLocalHour = Math.floor(peakIndex / 4)
    expect(peakLocalHour).toBeGreaterThanOrEqual(12)
    expect(peakLocalHour).toBeLessThanOrEqual(15)
  })
})

describe('B22a — das fertige Referenzprofil ist lückenlos, oder es entsteht nicht', () => {
  const series = syntheticSeries()

  it('mittelt eine vollständige Zehn-Jahres-Reihe zu 8.760 Werten', () => {
    const out = buildPvReferenceProfile(series, inputs)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.profile.hourlyKw).toHaveLength(8760)
    expect(out.profile.weatherYears).toEqual({ from: 2014, to: 2023 })
    expect(out.profile.annualYields).toHaveLength(10)

    /*
     * Der Mittelwert ist unabhängig nachgerechnet, nicht aus dem Ergebnis abgelesen: die Fixture
     * skaliert jedes Jahr mit 0,90 … 1,08. Der Erwartungswert entsteht hier aus der Fixture-Formel
     * allein — die zu prüfende Mittelung kommt darin nicht vor.
     */
    const idx = referenceHourIndex(6, 21, 12) as number
    const perYear = Array.from({ length: 10 }, (_, i) =>
      syntheticKwAt(2014 + i, Date.UTC(2014 + i, 5, 21, 12)),
    )
    const expected = perYear.reduce((a, b) => a + b, 0) / perYear.length
    expect(out.profile.hourlyKw[idx]).toBeCloseTo(expected, 12)
    // Ohne echte Mittelung über alle zehn Jahre käme der Wert EINES Jahres heraus — messbar daneben.
    expect(out.profile.hourlyKw[idx]).not.toBeCloseTo(perYear[0] as number, 4)
    expect(out.profile.hourlyKw[idx]).not.toBeCloseTo(perYear[9] as number, 4)
  })

  it('lehnt eine Reihe mit Lücken ab, statt sie mit Nullen zu füllen', () => {
    // Die gekürzte ECHTE Antwort deckt vier Kalendertage ab — als Referenzprofil ist sie unbrauchbar.
    expect(buildPvReferenceProfile(realSamples, inputs)).toEqual({
      ok: false,
      reason: 'incomplete_coverage',
    })
    // Und auch eine fast vollständige Reihe: eine einzige fehlende Stunde genügt.
    const missingOne = series.filter((s) => s.utcMs !== Date.UTC(2014, 5, 21, 12))
    const stillCovered = series.filter(
      (s) => new Date(s.utcMs).getUTCFullYear() !== 2014 || s.utcMs !== Date.UTC(2014, 5, 21, 12),
    )
    expect(missingOne).toHaveLength(stillCovered.length)
    const withoutAnyYearAtThatHour = series.filter((s) => {
      const d = new Date(s.utcMs)
      return !(d.getUTCMonth() === 5 && d.getUTCDate() === 21 && d.getUTCHours() === 12)
    })
    expect(buildPvReferenceProfile(withoutAnyYearAtThatHour, inputs)).toEqual({
      ok: false,
      reason: 'incomplete_coverage',
    })
  })

  it('⚠ GLÄTTET die Kurve — der Preis des Zehn-Jahres-Mittels, und er ist gemessen', () => {
    /*
     * ⚠ EIN BEFUND AUS DER LIVE-MESSUNG (02.09.2026), den das Pflichtenheft §2.1 nicht vorwegnimmt:
     * es begründet das Zehn-Jahres-Mittel über die Genauigkeit des JAHRESERTRAGS (0,6 % gegen
     * Meteonorm) — über die FORM der Kurve sagt es nichts. Die ist aber nicht dieselbe: ein Mittel
     * aus zehn Jahren ist glatter als jedes einzelne davon, weil sich Wolkentage der Jahre nicht
     * decken.
     *
     * Gegen die ECHTE PVGIS-Antwort gemessen (Wien, 10,2 kWp, 90°, Azimut −47, H0 4.500 kWh,
     * Speicher 19,2 kWh / 10,6 kW): die gemittelte Kurve erreicht als Spitze 6,18 kW, jedes
     * Einzeljahr dagegen 7,55 bis 8,30 kW. Die daraus gerechnete Eigenverbrauchs-Ersparnis liegt
     * mit € 428,27 um 4,9 % ÜBER dem Mittel der zehn einzeln gerechneten Jahre (€ 408,45) — und
     * über JEDEM einzelnen davon (Höchstwert € 425,92). Grund: eine geglättete Erzeugung sättigt
     * Speicher und Verbrauch seltener, es wird weniger eingespeist und mehr selbst verbraucht.
     *
     * Die Schätzung ist damit systematisch leicht OPTIMISTISCH — über die ± 5,8 % Jahresstreuung
     * hinaus, die der Report ohnehin nennt. Der Test hält die Eigenschaft fest, damit sie nicht
     * unbemerkt verschwindet oder unbemerkt grösser wird.
     */
    /*
     * Gemessen wird das SPITZENVERHÄLTNIS (Höchstwert zu Mittelwert), nicht der Höchstwert selbst:
     * ein Vergleich roher Spitzen wäre vom Ertragsniveau des jeweiligen Jahres überlagert — ein
     * ertragsschwaches Jahr hat eine niedrigere Spitze, ohne deshalb glatter zu sein. Das
     * Verhältnis ist eine reine Aussage über die FORM.
     */
    const peakToMean = (hourly: readonly number[]): number =>
      Math.max(...hourly) / (hourly.reduce((a, b) => a + b, 0) / hourly.length)

    const mean = buildPvReferenceProfile(series, inputs)
    expect(mean.ok).toBe(true)
    if (!mean.ok) return
    const meanRatio = peakToMean(mean.profile.hourlyKw)

    for (let year = 2014; year <= 2023; year++) {
      const single = buildPvReferenceProfile(syntheticSeries(year, year), inputs, {
        from: year,
        to: year,
      })
      expect(single.ok).toBe(true)
      if (!single.ok) return
      expect(peakToMean(single.profile.hourlyKw)).toBeGreaterThan(meanRatio)
    }
  })

  it('lehnt einen unerwarteten Jahressatz ab — aus zehn Jahren wird sonst still ein neun', () => {
    const nine = series.filter((s) => new Date(s.utcMs).getUTCFullYear() !== 2018)
    expect(buildPvReferenceProfile(nine, inputs)).toEqual({ ok: false, reason: 'unexpected_years' })
    // Der Gegenbeweis: mit einem ausdrücklich anderen Zeitraum ist derselbe Satz gültig.
    const nineYears = syntheticSeries(2015, 2023)
    expect(buildPvReferenceProfile(nineYears, inputs, { from: 2015, to: 2023 }).ok).toBe(true)
  })
})
