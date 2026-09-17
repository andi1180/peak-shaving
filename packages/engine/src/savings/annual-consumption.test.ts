import { describe, expect, it } from 'vitest'
import type { LoadProfile, LoadReading } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { DAYS_PER_YEAR } from './annualization'
import { estimateAnnualConsumption } from './annual-consumption'

/**
 * D6 Teil 1 — die Referenzraten-Hochrechnung. Die Fixtures setzen den TAGESVERBRAUCH je
 * Kalendermonat, damit die erwartete Referenzrate nicht nachgerechnet, sondern vorgegeben ist.
 */

const TZ = 'Europe/Vienna'
const SLOT_MS = 15 * 60 * 1000

/**
 * Viertelstundenreihe von `fromUtcIso` (einschliesslich) bis `toUtcIso` (ausschliesslich).
 *
 * ⚠ Die Leistung je Intervall entscheidet der LOKALE Monat des Zeitstempels. Dadurch ist die
 * erwartete Tagesrate eines Monats exakt `kWh/Tag = kW × 24` — unabhängig davon, wie viele
 * Intervalle der Monat trägt und ob eine Zeitumstellung darin liegt.
 */
function series(fromUtcIso: string, toUtcIso: string, kwhPerDayOf: (month: number) => number) {
  const readings: LoadReading[] = []
  for (let ms = Date.parse(fromUtcIso); ms < Date.parse(toUtcIso); ms += SLOT_MS) {
    const { month } = utcMsToLocalFields(ms, TZ)
    readings.push({ ts: new Date(ms).toISOString(), gridPowerKw: kwhPerDayOf(month) / 24 })
  }
  return readings
}

function profileOf(readings: LoadReading[], source: LoadProfile['source'] = 'net_signed'): LoadProfile {
  return { readings, intervalMinutes: 15, timezoneMeta: TZ, source }
}

/** Der Zielwert aus dem Urbanz-Referenzfall: Tagesverbrauch der kältesten verfügbaren Periode. */
const URBANZ_WINTER_KWH_PER_DAY = 51.96
const SUMMER_KWH_PER_DAY = 28

describe('estimateAnnualConsumption', () => {
  it('leitet die Rate aus den abgedeckten Wintertagen ab (Urbanz-Muster: Ende Jänner + Februar)', () => {
    /*
     * Echte Daten ab dem 26. Jänner bis Ende August, danach Lücke bis zum Jahresende. Winter ist
     * damit NUR über die sechs Jänner-Tage und den ganzen Februar abgedeckt — genau die Lage, in der
     * der Gesamtdurchschnitt (`annualizationFactor`) die fehlenden Wintermonate zu billig bewertete.
     */
    const readings = series('2025-01-25T23:00:00.000Z', '2025-08-31T22:00:00.000Z', (m) =>
      m === 1 || m === 2 ? URBANZ_WINTER_KWH_PER_DAY : SUMMER_KWH_PER_DAY,
    )
    const out = estimateAnnualConsumption(profileOf(readings))

    expect(out.method).toBe('winter_reference')
    expect(out.referenceRateKwhPerDay).toBeCloseTo(URBANZ_WINTER_KWH_PER_DAY, 6)
    expect(out.referenceSegments.map((s) => s.month)).toEqual([1, 2])
    expect(out.referenceSegments[0]?.days).toBeCloseTo(6, 2)
    expect(out.referenceSegments[1]?.days).toBeCloseTo(28, 2)

    // Die Lücke wird mit der WINTER-Rate bewertet, nicht mit dem Gesamtdurchschnitt.
    expect(out.missingDays).toBe(DAYS_PER_YEAR - out.coveredDays)
    expect(out.estimatedAnnualConsumptionKwh).toBeCloseTo(
      out.measuredConsumptionKwh + URBANZ_WINTER_KWH_PER_DAY * out.missingDays,
      6,
    )
    /*
     * Grössenordnungs-Check gegen den Referenzfall: knapp 218 gemessene Tage (davon 34 Winter) und
     * 147 hochgerechnete ergeben eine Jahresmenge im Bereich von 15 MWh. Der Gesamtdurchschnitt
     * läge spürbar darunter — er bewertete die fehlenden Wintertage mit Sommerverbrauch.
     */
    const flatAverage =
      (out.measuredConsumptionKwh / out.coveredDays) * DAYS_PER_YEAR
    expect(out.estimatedAnnualConsumptionKwh).toBeGreaterThan(flatAverage)
    expect(out.estimatedAnnualConsumptionKwh).toBeGreaterThan(14_000)
    expect(out.estimatedAnnualConsumptionKwh).toBeLessThan(16_000)
  })

  it('fällt ohne jeden Wintertag auf den Monat mit dem höchsten Tagesdurchschnitt zurück', () => {
    // April bis August, kein Dezember/Jänner/Februar — Juni ist der stärkste Monat.
    const readings = series('2025-03-31T22:00:00.000Z', '2025-08-31T22:00:00.000Z', (m) =>
      m === 6 ? 44 : 30,
    )
    const out = estimateAnnualConsumption(profileOf(readings))

    expect(out.method).toBe('month_maximum')
    expect(out.referenceSegments.map((s) => s.month)).toEqual([6])
    expect(out.referenceRateKwhPerDay).toBeCloseTo(44, 6)
    expect(out.estimatedAnnualConsumptionKwh).toBeCloseTo(
      out.measuredConsumptionKwh + 44 * out.missingDays,
      6,
    )
  })

  it('rechnet ein volles Jahr nicht hoch und skaliert es auch nicht nach unten', () => {
    const readings = series('2024-12-31T23:00:00.000Z', '2025-12-31T23:00:00.000Z', () => 40)
    const out = estimateAnnualConsumption(profileOf(readings))

    expect(out.method).toBe('full_period')
    expect(out.coveredDays).toBeGreaterThanOrEqual(DAYS_PER_YEAR)
    expect(out.missingDays).toBe(0)
    expect(out.referenceRateKwhPerDay).toBeNull()
    expect(out.referenceSegments).toEqual([])
    expect(out.estimatedAnnualConsumptionKwh).toBe(out.measuredConsumptionKwh)
  })

  it('unterscheidet Standardprofil und leeren Lastgang als eigene Fälle', () => {
    const halfYear = series('2025-03-31T22:00:00.000Z', '2025-08-31T22:00:00.000Z', () => 30)

    // An der HERKUNFT ausgeschlossen, nicht über die Tageszahl — wie in `annualizationFactor`.
    expect(estimateAnnualConsumption(profileOf(halfYear, 'standard_profile')).method).toBe(
      'synthetic_profile',
    )
    const empty = estimateAnnualConsumption(profileOf([]))
    expect(empty.method).toBe('no_data')
    expect(empty.estimatedAnnualConsumptionKwh).toBe(0)
    expect(empty.referenceRateKwhPerDay).toBeNull()
  })

  it('zählt Einspeisung nicht als negativen Verbrauch', () => {
    const readings = series('2025-01-31T23:00:00.000Z', '2025-02-28T23:00:00.000Z', () => 24)
    const withFeedIn = readings.map((r, i) => (i % 4 === 0 ? { ...r, gridPowerKw: -20 } : r))

    const plain = estimateAnnualConsumption(profileOf(readings))
    const feedIn = estimateAnnualConsumption(profileOf(withFeedIn))

    // Die eingespeisten Intervalle zählen als 0 kWh, nicht als Abzug — also genau drei Viertel.
    expect(feedIn.measuredConsumptionKwh).toBeCloseTo(plain.measuredConsumptionKwh * 0.75, 6)
    expect(feedIn.measuredConsumptionKwh).toBeGreaterThan(0)
  })
})
