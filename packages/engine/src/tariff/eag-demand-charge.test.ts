import { buildLevySchedule } from 'shared'
import type { LoadProfile, TariffPricingInputs } from 'shared'
import { describe, expect, it } from 'vitest'

import { eagDemandChargePerYear } from './eag-demand-charge'

/**
 * Der Grundpreis-Teil des EAG-Förderbeitrags als Jahresgrösse — gemessen an den ECHTEN belegten
 * Sätzen aus `packages/shared/src/levies.ts` (EX104), nicht an erfundenen.
 *
 * Der Zuschnitt spiegelt den Bäckerei-Fixture: ein 2026er-Fenster an Wiener Netze, einmal auf
 * Netzebene 6 (Grundpreis ist dort ein LEISTUNGSpreis) und einmal auf NE 7 ohne Leistungsmessung
 * (fixer Jahresbetrag — der Urbanz-Zuschnitt).
 */

const BILLED_KW = 20.78
/** EX104, Tarifjahr 2026, Netzebene 6 — s. `levies.ts`. */
const NE6_RATE_EUR_PER_KW_YEAR = 5.252

function profile(fromUtc: string, toUtc: string): LoadProfile {
  return {
    readings: [
      { ts: fromUtc, gridPowerKw: 1 },
      { ts: toUtc, gridPowerKw: 1 },
    ],
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'import_only',
  }
}

function pricing(netzebene: number, variant: string | null, from: string, to: string): TariffPricingInputs {
  return {
    gridTariffRows: null,
    spotPrices: null,
    levies: buildLevySchedule('wiener_netze', netzebene, from, to, variant),
  }
}

/** Der Bäckerei-Zuschnitt: ein volles Kalenderjahr 2026 in Ortszeit. */
const YEAR_2026 = profile('2025-12-31T23:00:00Z', '2026-12-31T22:45:00Z')

describe('eagDemandChargePerYear', () => {
  it('Netzebene 6, 2026er-Fenster: Satz × abgerechneter Leistungswert', () => {
    expect(eagDemandChargePerYear(YEAR_2026, pricing(6, null, '2026-01-01', '2026-12-31'), BILLED_KW)).toBeCloseTo(
      NE6_RATE_EUR_PER_KW_YEAR * BILLED_KW,
      9,
    )
  })

  it('NE 7 ohne Leistungsmessung bleibt aussen vor — dort ist der Grundpreis ein fixer Jahresbetrag', () => {
    /*
     * Der Urbanz-Fall. Ein Betrag entstünde hier zu Unrecht: dieser Satz steckt bereits
     * tagesanteilig in `MonthlyFixedCosts.eagFlatFeeEur`, und eine zweite Ausweisung wäre genau die
     * Doppelzählung, gegen die dieses Modul gebaut ist.
     */
    expect(
      eagDemandChargePerYear(
        YEAR_2026,
        pricing(7, 'ohne_leistungsmessung', '2026-01-01', '2026-12-31'),
        BILLED_KW,
      ),
    ).toBeUndefined()
  })

  it('ein Fenster über einen SATZWECHSEL hat KEINE eine Jahreszahl', () => {
    /*
     * Der Förderbeitrag wird je Tarifjahr neu festgesetzt. Einen der beiden Sätze stellvertretend
     * auszugeben wäre für die andere Hälfte des Zeitraums falsch — dieselbe Haltung wie bei der
     * periodengenauen Gebrauchsabgabe.
     *
     * ⚠ Der Plan ist HIER VON HAND gebaut und nicht aus `buildLevySchedule` geholt, und das ist ein
     * Befund und keine Bequemlichkeit: die Elektrizitätsabgabe ist heute NUR für 2026 belegt, ein
     * 2025/2026-Fenster trägt deshalb überhaupt keinen 2025er-Abgabenzeitraum (gemessen). Mit den
     * heutigen Sätzen ist dieser Zweig also gar nicht erreichbar — mit den 2027ern wird er es.
     */
    const period = (validFrom: string, validUntil: string | null, amount: number) => ({
      validFrom,
      validUntil,
      elektrizitaetsabgabeCtPerKwh: 0.1,
      eagFoerderbeitragCtPerKwh: 0.209,
      eagFoerderbeitragGrundpreisAmount: amount,
      eagFoerderbeitragGrundpreisUnit: 'eur_per_kw_year' as const,
      eagPauschaleEurPerYear: 553.36,
      gebrauchsabgabeRate: 0.07,
    })
    const span = profile('2025-12-30T23:00:00Z', '2026-06-30T22:00:00Z')

    expect(
      eagDemandChargePerYear(
        span,
        {
          gridTariffRows: null,
          spotPrices: null,
          levies: { periods: [period('2025-01-01', '2025-12-31', 7.358), period('2026-01-01', null, 5.252)] },
        },
        BILLED_KW,
      ),
    ).toBeUndefined()
  })

  it('ohne abgerechneten Leistungswert und ohne belegte Sätze entsteht keine Zahl', () => {
    expect(eagDemandChargePerYear(YEAR_2026, pricing(6, null, '2026-01-01', '2026-12-31'), 0)).toBeUndefined()
    // Netz NÖ: keine Gebrauchsabgabe belegt → gar kein Abgabenzeitraum, also auch kein Grundpreis.
    expect(
      eagDemandChargePerYear(
        YEAR_2026,
        { gridTariffRows: null, spotPrices: null, levies: buildLevySchedule('netz_noe', 6, '2026-01-01', '2026-12-31') },
        BILLED_KW,
      ),
    ).toBeUndefined()
  })
})
