import { readFileSync } from 'node:fs'
import type { LoadProfile, TariffParams, TariffPricingInputs } from 'shared'
import { describe, expect, it } from 'vitest'

import { AnalysisRefusedError, computeAnalysis, parseLoadProfile } from '../src'

/** Benannte Verweigerungen statt Schätzung (`refusal.ts`) — gegen die Bäckerei-Eingaben. */
const GOLDEN = new URL('./golden/baeckerei/', import.meta.url)

function baeckerei(): LoadProfile {
  const csv = readFileSync(new URL('lastgang.csv', GOLDEN), 'utf8')
  const parsed = parseLoadProfile({ content: csv, fileName: 'lastgang.csv', format: 'csv' })
  if (!parsed.ok) throw new Error('Lastgang ist nicht lesbar')
  return parsed.profile
}

function refusalOf(tariff: TariffParams, profile: LoadProfile, pricing?: TariffPricingInputs) {
  try {
    computeAnalysis(
      {
        tariff,
        pv: null,
        tariffPricing: pricing,
        load: {
          fileName: 'lastgang.csv',
          profile,
          dataQuality: {
            coveredDays: 365,
            coveredMonths: 12,
            gapsInterpolated: 0,
            largestGapSlots: 0,
            warnings: [],
          },
        },
      },
      10,
      [],
    )
  } catch (error) {
    if (error instanceof AnalysisRefusedError) return error
    throw error
  }
  return null
}

describe('AnalysisRefusedError', () => {
  it('Einspeisung im Lastgang ohne Einspeisevergütung → benannte Lücke', () => {
    const profile = baeckerei()
    const feedIn: LoadProfile = {
      ...profile,
      readings: profile.readings.map((r, i) => (i % 96 === 48 ? { ...r, gridPowerKw: -2 } : r)),
    }
    const tariff: TariffParams = {
      leistungspreisEurPerKwYear: 0,
      billingModel: null,
      minBillableKw: 0,
      energyPriceCtPerKwh: 20,
    }
    expect(refusalOf(tariff, feedIn)?.refusal).toEqual({ reason: 'feed_in_tariff_missing' })
    // Gegenprobe: ohne Einspeisung wird die fehlende Vergütung nicht gebraucht.
    expect(refusalOf(tariff, profile)).toBeNull()
  })

  it('Liefertarif unbekannt ohne rechenbare aWATTar-Reihe → Abbruch mit der fehlenden Grundlage', () => {
    const pricing = JSON.parse(
      readFileSync(new URL('tariff-pricing.json', GOLDEN), 'utf8'),
    ) as TariffPricingInputs
    const tariff: TariffParams = {
      supplierTariff: 'unknown',
      leistungspreisEurPerKwYear: 0,
      billingModel: null,
      minBillableKw: 0,
    }
    const error = refusalOf(tariff, baeckerei(), { ...pricing, spotPrices: null })
    expect(error?.refusal).toMatchObject({
      reason: 'supplier_tariff_unknown_without_price_basis',
      blocker: { side: 'spot_price' },
    })
    expect(error?.message).toMatch(/Spotpreise/)
  })
})
