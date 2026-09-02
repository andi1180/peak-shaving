import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import type { BatteryCandidate, LoadProfile, TariffParams } from 'shared'

import { parseLoadProfile } from '../parser'
import {
  applyEstimatedPv,
  buildPvReferenceProfile,
  expandReferenceToTimestamps,
  parsePvgisSeries,
} from '../pv-generation'
import { syntheticSeries } from '../pv-generation/__fixtures__/synthetic-series'
import { peakShavingBlockers } from '../simulation/peak-shaving'
import { simulateBattery } from '../simulation/simulate'
import { generateStandardLoadProfile } from '../standard-profile/h0'
import { positiveAnnualPeakKw } from '../peaks/metrics'
import { getTariffStrategy } from '../tariff/strategy'
import { computeBatterySavings } from './attribute'

/**
 * B22 — eine GESCHÄTZTE PV-Erzeugung nimmt dem Lastgang die Spitzenkappung: weder gerechnet noch
 * kreditiert (Pflichtenheft PV-Zeitreihengenerator §2.2, Prüfkriterium §5 Punkt 1).
 *
 * ── ⚠ DER PRÜFPUNKT IST DER GEGENBEWEIS, NICHT DIE NULL ────────────────────────────────────────
 * „Bei geschätzter PV ist die Spitzenkappungs-Ersparnis € 0" allein bliebe auch dann grün, wenn
 * diese Batterie auf diesem Lastgang ohnehin nichts kappte. Jeder Fall unten führt deshalb den
 * Gegenbeweis daneben: DERSELBE Tarif MIT Leistungsmessung, dieselbe Batterie, dieselben Messwerte —
 * nur ohne die Kennzeichnung. Dort muss unverändert gekappt und kreditiert werden.
 *
 * Muster: `standard-profile-no-peak-shaving.test.ts` (Delta 9b-1) und
 * `no-demand-charge-no-peak-shaving.test.ts` (Delta 3).
 */

const battery: BatteryCandidate = {
  id: 'demo-commercial-60-30',
  name: 'Demo Commercial 60/30',
  manufacturer: 'Demo',
  class: 'commercial',
  usableCapacityKwh: 60,
  maxPowerKw: 30,
  roundTripEfficiency: 0.9,
  pricePerKwh: 350,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic',
}

/** Wiener Netze NE 7 mit Leistungsmessung — der einzige real belegte Satz (B11). */
const mitLeistungsmessung: TariffParams = {
  billingModel: 'annual_max',
  leistungspreisEurPerKwYear: 82.92,
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  energyPriceNightCtPerKwh: 12,
  einspeiseverguetungCtPerKwh: 8,
}

function fixture(name: string): LoadProfile {
  const csv = readFileSync(new URL(`../../../../dev-fixtures/${name}`, import.meta.url), 'utf8')
  const parsed = parseLoadProfile({ content: csv, format: 'csv' })
  if (!parsed.ok) throw new Error(`Fixture ${name} parst nicht: ${JSON.stringify(parsed)}`)
  return parsed.profile
}

const pvgisRaw: unknown = JSON.parse(
  readFileSync(
    new URL('../pv-generation/__fixtures__/pvgis-seriescalc-wien-2014-2023-gekuerzt.json', import.meta.url),
    'utf8',
  ),
)
const parsedPvgis = parsePvgisSeries(pvgisRaw)
if (!parsedPvgis.ok) throw new Error('PVGIS-Fixture parst nicht')
const reference = buildPvReferenceProfile(syntheticSeries(), parsedPvgis.inputs)
if (!reference.ok) throw new Error('Referenzprofil baut nicht')

/** Die geschätzte Erzeugung für einen Lastgang, auf `kwp` skaliert (die Fixture liefert ~1 kWp). */
function estimatedPvKw(load: LoadProfile, kwp: number): number[] {
  return expandReferenceToTimestamps(
    reference.profile,
    load.readings.map((r) => r.ts),
  ).map((v) => v * kwp)
}

describe('B22 — geschätzte PV auf einem GEMESSENEN Lastgang: nur ein Feld unterscheidet sich', () => {
  /*
   * Der schärfste denkbare Gegenbeweis: derselbe echte Lastgang, Messwert für Messwert identisch,
   * einmal mit und einmal ohne `pvSource`. Was sich in der Ersparnis ändert, kann dann NUR an der
   * Kennzeichnung liegen.
   */
  const gemessen = fixture('demo-baeckerei-mit-pv-netzlastgang-2023.csv')
  const alsGeschaetzt: LoadProfile = { ...gemessen, pvSource: 'estimated' }

  it('nennt genau diesen einen Grund — und beim gemessenen Lastgang gar keinen', () => {
    expect(peakShavingBlockers(gemessen, battery, mitLeistungsmessung)).toEqual([])
    expect(peakShavingBlockers(alsGeschaetzt, battery, mitLeistungsmessung)).toEqual(['estimated_pv'])
  })

  it('⚠ liefert € 0 Spitzenkappung — und der gemessene Lastgang daneben eine positive Zahl', () => {
    const oldBilledKw = getTariffStrategy('annual_max').billedKw(gemessen, mitLeistungsmessung)
    const g = computeBatterySavings(gemessen, battery, mitLeistungsmessung)
    const s = computeBatterySavings(alsGeschaetzt, battery, mitLeistungsmessung)

    console.log(
      `[B22] Spitzenkappung: gemessen €${g.leistungspreisSavingPerYear.toFixed(2)} ` +
        `(newBilledKw ${g.newBilledKw.toFixed(3)} von ${oldBilledKw.toFixed(3)} kW) · ` +
        `geschätzt €${s.leistungspreisSavingPerYear.toFixed(2)} ` +
        `(newBilledKw ${s.newBilledKw.toFixed(3)} kW)`,
    )

    expect(s.leistungspreisSavingPerYear).toBe(0)
    expect(s.newBilledKw).toBe(oldBilledKw)

    expect(g.leistungspreisSavingPerYear).toBeGreaterThan(0)
    expect(g.newBilledKw).toBeLessThan(oldBilledKw)
  })

  it('simuliert reserve-frei — die Gegenprobe beweist, dass sonst wirklich gekappt würde', () => {
    const g = simulateBattery(gemessen, battery, mitLeistungsmessung)
    const s = simulateBattery(alsGeschaetzt, battery, mitLeistungsmessung)

    expect(s.capKwByPeriod.every((c) => c === Infinity)).toBe(true)
    expect(s.socFloorKwh.every((v) => v === 0)).toBe(true)

    const rawPeak = positiveAnnualPeakKw(gemessen)
    expect(g.capKwByPeriod.every((c) => Number.isFinite(c) && c < rawPeak)).toBe(true)
    expect(g.socFloorKwh.some((v) => v > 0)).toBe(true)
  })

  it('sagt im Report-Contract, WARUM — und die Summe der Anteile bleibt exakt', () => {
    const s = computeBatterySavings(alsGeschaetzt, battery, mitLeistungsmessung)
    expect(s.warnings.some((w) => /Geschätzte PV-Erzeugung/.test(w))).toBe(true)
    expect(s.totalSavingPerYear).toBeCloseTo(
      s.leistungspreisSavingPerYear + s.selfConsumptionSavingPerYear + s.loadShiftSavingPerYear,
      12,
    )

    const g = computeBatterySavings(gemessen, battery, mitLeistungsmessung)
    expect(g.warnings.some((w) => /Geschätzte PV-Erzeugung/.test(w))).toBe(false)
  })
})

describe('B22 — der Fall, für den es sonst GAR KEINEN Blocker gäbe', () => {
  /*
   * Echter Lastgang ohne Einspeisespalte (`import_only`, der reale Urbanz-Fall) minus geschätzter
   * Erzeugung. Weder `standard_profile` noch `no_demand_charge` greifen hier — ohne `estimated_pv`
   * würde auf einem zur Hälfte geschätzten Lastgang voll gekappt und kreditiert.
   */
  const verbrauch = fixture('demo-baeckerei-lastgang-2023.csv')
  const pvKw = estimatedPvKw(verbrauch, 30)
  const gekoppelt = applyEstimatedPv(verbrauch, pvKw)
  /** Dieselben Messwerte, nur ohne die Kennzeichnung — der Gegenbeweis. */
  const alsGemessen: LoadProfile = { ...gekoppelt, pvSource: undefined, source: 'net_signed' }

  it('greift als EINZIGER Grund', () => {
    expect(gekoppelt.source).toBe('import_only')
    expect(peakShavingBlockers(gekoppelt, battery, mitLeistungsmessung)).toEqual(['estimated_pv'])
    expect(peakShavingBlockers(alsGemessen, battery, mitLeistungsmessung)).toEqual([])
  })

  it('⚠ € 0 gegen eine dreistellige Zahl auf denselben Messwerten', () => {
    const oldBilledKw = getTariffStrategy('annual_max').billedKw(gekoppelt, mitLeistungsmessung)
    const s = computeBatterySavings(gekoppelt, battery, mitLeistungsmessung)
    const m = computeBatterySavings(alsGemessen, battery, mitLeistungsmessung)

    console.log(
      `[B22] import_only + geschätzte PV: Spitzenkappung geschätzt €${s.leistungspreisSavingPerYear.toFixed(2)} · ` +
        `dieselben Messwerte als gemessen €${m.leistungspreisSavingPerYear.toFixed(2)} ` +
        `(billedKw ${oldBilledKw.toFixed(3)} → ${m.newBilledKw.toFixed(3)} kW)`,
    )

    expect(s.leistungspreisSavingPerYear).toBe(0)
    expect(s.newBilledKw).toBe(oldBilledKw)
    expect(m.leistungspreisSavingPerYear).toBeGreaterThan(0)
  })

  it('lässt Eigenverbrauch und Lastverschiebung ausdrücklich stehen — nur die Spitze fällt weg', () => {
    const ohnePv = computeBatterySavings(verbrauch, battery, mitLeistungsmessung)
    const mitPv = computeBatterySavings(gekoppelt, battery, mitLeistungsmessung)

    console.log(
      `[B22] Eigenverbrauch ohne geschätzte PV €${ohnePv.selfConsumptionSavingPerYear.toFixed(2)} → ` +
        `mit €${mitPv.selfConsumptionSavingPerYear.toFixed(2)}`,
    )

    // Der Ausgangspunkt: ein Lastgang ohne Einspeisung kann keinen Eigenverbrauch tragen.
    expect(ohnePv.selfConsumptionSavingPerYear).toBe(0)
    // Und genau das ändert der Generator — das ist sein ganzer Zweck.
    expect(mitPv.selfConsumptionSavingPerYear).toBeGreaterThan(0)
  })
})

describe('B22 — die schwächste Grundlage im ganzen Rechner: Standardprofil + geschätzte PV', () => {
  /*
   * Synthetischer Verbrauch minus geschätzter Erzeugung — und zugleich der WICHTIGSTE
   * Anwendungsfall (§0.2). Dass hier keine Spitzenkappung entsteht, folgt schon aus dem
   * `standard_profile`-Blocker; das Pflichtenheft verlangt trotzdem einen ausdrücklichen Testfall,
   * damit die Zusage nicht an einer Bedingung hängt, die jemand später für überflüssig hält.
   */
  const h0 = generateStandardLoadProfile({
    annualConsumptionKwh: 4500,
    customerClass: 'privat',
    year: 2025,
    timeZone: 'Europe/Vienna',
  })
  if (!h0.ok) throw new Error('H0 erzeugt nicht')
  const gekoppelt = applyEstimatedPv(h0.profile, estimatedPvKw(h0.profile, 10))

  it('nennt BEIDE Gründe und kreditiert nichts', () => {
    expect(peakShavingBlockers(gekoppelt, battery, mitLeistungsmessung)).toEqual([
      'standard_profile',
      'estimated_pv',
    ])
    const s = computeBatterySavings(gekoppelt, battery, mitLeistungsmessung)
    expect(s.leistungspreisSavingPerYear).toBe(0)
    expect(
      s.warnings.filter((w) => /Synthetisches Standardlastprofil|Geschätzte PV-Erzeugung/.test(w)),
    ).toHaveLength(2)
  })

  it('macht aus € 0,00 Eigenverbrauch eine echte Zahl — der Hebel, für den B22 gebaut wird', () => {
    const ohne = computeBatterySavings(h0.profile, battery, mitLeistungsmessung)
    const mit = computeBatterySavings(gekoppelt, battery, mitLeistungsmessung)

    console.log(
      `[B22] H0 4.500 kWh: Eigenverbrauch ohne PV €${ohne.selfConsumptionSavingPerYear.toFixed(2)} → ` +
        `mit geschätzter PV €${mit.selfConsumptionSavingPerYear.toFixed(2)} · ` +
        `total €${ohne.totalSavingPerYear.toFixed(2)} → €${mit.totalSavingPerYear.toFixed(2)}`,
    )

    expect(ohne.selfConsumptionSavingPerYear).toBe(0)
    expect(mit.selfConsumptionSavingPerYear).toBeGreaterThan(0)
    // Die Spitzenkappung bleibt in BEIDEN Fällen bei 0 (`standard_profile` greift schon vorher).
    expect(ohne.leistungspreisSavingPerYear).toBe(0)
    expect(mit.leistungspreisSavingPerYear).toBe(0)

    /*
     * ⚠ GEMESSEN UND BEWUSST NICHT ALS RICHTUNG BEHAUPTET: die GESAMT-Ersparnis kann durch die
     * geschätzte PV auch SINKEN. In diesem Lauf tut sie es (€ 431,40 → € 167,71), weil die
     * eingespeicherte PV dieselbe Kapazität belegt, die vorher nachts günstig geladen wurde — die
     * Lastverschiebung bricht stärker ein, als der Eigenverbrauch zulegt. Dieselbe Art Umverteilung
     * zwischen den Töpfen wie bei der Tages-Rangfolge (02.09.2026), nur mit umgekehrtem Vorzeichen.
     * Ein Test, der hier eine Richtung erzwänge, wäre eine Behauptung über den Tarif, nicht über
     * den Generator.
     */
    expect(mit.totalSavingPerYear).not.toBe(ohne.totalSavingPerYear)
  })
})
