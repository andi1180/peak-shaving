import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import type { BatteryCandidate, LoadProfile, TariffParams } from 'shared'

import { parseLoadProfile } from '../parser'
import { generateStandardLoadProfile } from '../standard-profile/h0'
import { annualizationFactor, coveredDaysOf, DAYS_PER_YEAR } from './annualization'
import { computeBatterySavings } from './attribute'

/**
 * §3.7 — Jahres-Hochrechnung der beiden ENERGIE-Töpfe bei einem Teilzeitraum-Lastgang.
 *
 * ⚠ Der Prüfpunkt ist NICHT „die Zahl ist grösser geworden". Gemessen wird, dass die beiden
 * Grössen im Contract auseinandergehalten werden: die HOCHGERECHNETE (`…PerYear`, geht in
 * `totalSavingPerYear` und damit in Amortisation/Netto-Ersparnis) und die GEMESSENE
 * (`…OverCoveredPeriod`, die Summe über die tatsächlich vorhandenen Tage). Ein Test, der nur die
 * erste prüfte, bliebe auch dann grün, wenn die zweite still verschwände — und genau sie ist die
 * Zahl, auf die sich ein Kunde berufen kann.
 *
 * Der Leistungspreis-Anteil ist der GEGENBEWEIS in jedem Fall: er ist ratenbasiert (€/kW·Jahr) und
 * darf sich NICHT bewegen. Ohne ihn bewiese ein grösseres `total` nichts darüber, WELCHE Töpfe
 * skaliert wurden.
 */

const STEP_MS = 15 * 60 * 1000
const SLOTS_PER_DAY = 96
const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * Ein Tag (96 × 15 min) mit PV-Einspeisung UND einer Spitze am `spike`-Tag:
 *  - idx 0–23   (00–06 h): 5 kW  · NT-Fenster (günstig) → Lastverschiebung
 *  - idx 24–39  (06–10 h): 15 kW (bzw. `SPIKE_KW` am Spitzentag)
 *  - idx 40–55  (10–14 h): −20 kW · Einspeisung → Eigenverbrauch
 *  - idx 56–79  (14–20 h): 25 kW · teurer Nachmittag
 *  - idx 80–87  (20–22 h): 15 kW
 *  - idx 88–95  (22–24 h): 5 kW  · NT-Fenster
 */
const SPIKE_KW = 90
function day(spike: boolean): number[] {
  const d = new Array<number>(SLOTS_PER_DAY)
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    if (i < 24) d[i] = 5
    else if (i < 32) d[i] = spike ? SPIKE_KW : 15
    else if (i < 40) d[i] = 15
    else if (i < 56) d[i] = -20
    else if (i < 80) d[i] = 25
    else if (i < 88) d[i] = 15
    else d[i] = 5
  }
  return d
}

/** `days` identische Tage ab 1. Jänner; der Tag in der Mitte trägt die Spitze. */
function profile(days: number, source: LoadProfile['source'] = 'net_signed'): LoadProfile {
  const t0 = Date.parse('2025-01-01T00:00:00Z')
  const readings = Array.from({ length: days }, (_, i) => day(i === Math.floor(days / 2)))
    .flat()
    .map((gridPowerKw, i) => ({ ts: iso(t0 + i * STEP_MS), gridPowerKw }))
  return { readings, intervalMinutes: 15, timezoneMeta: 'UTC', source }
}

const battery: BatteryCandidate = {
  id: 'ann-1',
  name: 'Test',
  manufacturer: 'Demo',
  class: 'commercial',
  usableCapacityKwh: 100,
  maxPowerKw: 50,
  roundTripEfficiency: 0.9,
  pricePerKwh: 400,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic',
}

/** NT-Fenster 22:00–06:00 zu 12 ct → beide Energie-Töpfe sind gleichzeitig aktiv. */
const tariff: TariffParams = {
  leistungspreisEurPerKwYear: 100,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
  timeOfUseWindows: [{ from: '22:00', to: '06:00', ctPerKwh: 12 }],
}

describe('§3.7 Jahres-Hochrechnung — der Faktor selbst', () => {
  it('leitet `coveredDays` aus dem Gitter ab und liefert 365/coveredDays', () => {
    expect(coveredDaysOf(profile(180))).toBe(180)
    expect(annualizationFactor(profile(180))).toBe(DAYS_PER_YEAR / 180)
  })

  it('volle Jahresabdeckung → exakt 1,0 (keine Skalierung)', () => {
    expect(annualizationFactor(profile(365))).toBe(1)
  })

  it('skaliert NIE nach unten: 366 Tage (Schaltjahr/Überhang) → 1,0', () => {
    expect(annualizationFactor(profile(366))).toBe(1)
  })

  it('Standardprofil → 1,0, unabhängig von der Tageszahl (an der HERKUNFT ausgeschlossen)', () => {
    // Ein synthetisches Profil deckt konstruktionsgemäss ein Jahr ab; hier bewusst als 180-Tage-
    // Profil etikettiert, damit der Test die Herkunfts-Bedingung misst und nicht die Tageszahl.
    expect(annualizationFactor(profile(180, 'standard_profile'))).toBe(1)
  })

  it('leeres Profil → 1,0 statt Infinity', () => {
    expect(
      annualizationFactor({ readings: [], intervalMinutes: 15, timezoneMeta: 'UTC', source: 'net_signed' }),
    ).toBe(1)
  })
})

describe('§3.7 Jahres-Hochrechnung — 180-von-365-Tage-Profil, exakt nachrechenbar', () => {
  const halfYear = computeBatterySavings(profile(180), battery, tariff)
  const fullYear = computeBatterySavings(profile(365), battery, tariff)

  it('Verifikations-Zahlen (180 Tage)', () => {
    console.log(
      `[§3.7 Hochrechnung] coveredDays=${halfYear.coveredDays} · Faktor=${halfYear.annualizationFactor.toFixed(6)}\n` +
        `  Eigenverbrauch:   gemessen €${halfYear.selfConsumptionSavingOverCoveredPeriod.toFixed(2)} → ` +
        `hochgerechnet €${halfYear.selfConsumptionSavingPerYear.toFixed(2)}\n` +
        `  Lastverschiebung: gemessen €${halfYear.loadShiftSavingOverCoveredPeriod.toFixed(2)} → ` +
        `hochgerechnet €${halfYear.loadShiftSavingPerYear.toFixed(2)}\n` +
        `  Leistungspreis (ratenbasiert, unskaliert): €${halfYear.leistungspreisSavingPerYear.toFixed(2)}\n` +
        `  total=€${halfYear.totalSavingPerYear.toFixed(2)}`,
    )
    expect(halfYear.coveredDays).toBe(180)
  })

  it('beide Energie-Töpfe: hochgerechnet = gemessen × Faktor, exakt', () => {
    const factor = DAYS_PER_YEAR / 180
    expect(halfYear.annualizationFactor).toBe(factor)

    // Der Fall ist nicht-trivial: beide Töpfe tragen echte Beträge.
    expect(halfYear.selfConsumptionSavingOverCoveredPeriod).toBeGreaterThan(0)
    expect(halfYear.loadShiftSavingOverCoveredPeriod).toBeGreaterThan(0)

    expect(halfYear.selfConsumptionSavingPerYear).toBe(
      halfYear.selfConsumptionSavingOverCoveredPeriod * factor,
    )
    expect(halfYear.loadShiftSavingPerYear).toBe(halfYear.loadShiftSavingOverCoveredPeriod * factor)
  })

  it('⚠ der GEGENBEWEIS: der Leistungspreis-Anteil wird NICHT mitskaliert', () => {
    // Ratenbasiert (€/kW·Jahr) — dieselbe Spitze in 180 wie in 365 Tagen ergibt denselben Betrag.
    // Ohne diese Assertion bewiese ein grösseres `total` nichts darüber, WELCHE Töpfe skaliert wurden.
    expect(halfYear.leistungspreisSavingPerYear).toBeGreaterThan(0)
    expect(halfYear.leistungspreisSavingPerYear).toBe(fullYear.leistungspreisSavingPerYear)
    expect(halfYear.newBilledKw).toBe(fullYear.newBilledKw)
  })

  it('Summe der drei Anteile = totalSavingPerYear, exakt (Prinzip 2 bleibt)', () => {
    expect(halfYear.totalSavingPerYear).toBeCloseTo(
      halfYear.leistungspreisSavingPerYear +
        halfYear.selfConsumptionSavingPerYear +
        halfYear.loadShiftSavingPerYear,
      10,
    )
  })

  it('Volljahr: Faktor 1, gemessener und hochgerechneter Wert IDENTISCH', () => {
    expect(fullYear.annualizationFactor).toBe(1)
    expect(fullYear.coveredDays).toBe(365)
    expect(fullYear.selfConsumptionSavingPerYear).toBe(fullYear.selfConsumptionSavingOverCoveredPeriod)
    expect(fullYear.loadShiftSavingPerYear).toBe(fullYear.loadShiftSavingOverCoveredPeriod)
  })
})

describe('§3.7 Jahres-Hochrechnung — der Faktor stimmt mit dem überein, was der PARSER meldet', () => {
  /*
   * ⚠ Der eigentliche Wächter dieser Datei. `coveredDaysOf` leitet die Tageszahl aus dem Profil ab,
   * statt sie durch die Engine gereicht zu bekommen (s. `annualization.ts`) — das ist nur zulässig,
   * solange sie mit `dataQuality.coveredDays` des Parsers übereinstimmt. Gemessen an einer ECHTEN
   * Datei, die den vollen Weg (Rohtext → `prepareSeries` → `LoadProfile`) genommen hat, nicht an
   * einem im Code konstruierten Profil.
   */
  it('Volljahres-Demo (365 Tage): abgeleitet == dataQuality.coveredDays, Faktor 1', () => {
    const csv = readFileSync(
      new URL('../../../../dev-fixtures/demo-baeckerei-lastgang-2025.csv', import.meta.url),
      'utf8',
    )
    const out = parseLoadProfile({ content: csv, format: 'csv' })
    if (!out.ok) throw new Error(`Demo-Fixture parst nicht: ${JSON.stringify(out)}`)

    expect(coveredDaysOf(out.profile)).toBe(out.dataQuality.coveredDays)
    expect(annualizationFactor(out.profile)).toBe(1)
  })

  it('Teiljahres-Fixture (1 Monat): abgeleitet == dataQuality.coveredDays, Faktor > 1', () => {
    const csv = readFileSync(
      new URL('../../../../dev-fixtures/teiljahr-lastgang-juni-2026.csv', import.meta.url),
      'utf8',
    )
    const out = parseLoadProfile({ content: csv, format: 'csv' })
    if (!out.ok) throw new Error(`Teiljahr-Fixture parst nicht: ${JSON.stringify(out)}`)

    const days = out.dataQuality.coveredDays
    console.log(`[§3.7 Hochrechnung] Teiljahr-Fixture: coveredDays=${days} → Faktor ${(365 / days).toFixed(4)}`)
    expect(coveredDaysOf(out.profile)).toBe(days)
    expect(days).toBeLessThan(DAYS_PER_YEAR)
    expect(annualizationFactor(out.profile)).toBe(DAYS_PER_YEAR / days)
  })
})

describe('§3.7 Jahres-Hochrechnung — ein Standardprofil bleibt unangetastet', () => {
  it('volles Jahr aus dem Generator: Faktor 1, beide Paare identisch', () => {
    const outcome = generateStandardLoadProfile({
      annualConsumptionKwh: 4200,
      customerClass: 'privat',
      year: 2025,
      timeZone: 'Europe/Vienna',
    })
    if (!outcome.ok) throw new Error('Standardprofil nicht erzeugbar — der Test prüfte sonst nichts.')

    const s = computeBatterySavings(outcome.profile, battery, tariff)
    expect(s.annualizationFactor).toBe(1)
    expect(s.selfConsumptionSavingPerYear).toBe(s.selfConsumptionSavingOverCoveredPeriod)
    expect(s.loadShiftSavingPerYear).toBe(s.loadShiftSavingOverCoveredPeriod)
  })
})
