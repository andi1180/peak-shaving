import { readFileSync } from 'node:fs'
import type { BatteryCandidate, TariffPricingInputs } from 'shared'
import { describe, expect, it } from 'vitest'

import { computeAnalysis, mapDraftToTariffParams, parseLoadProfile } from '../src'

/**
 * Der Steinhauser-Fall (25.09.2026): „Zählpunkt rechnen" brach ab mit
 * `energyPriceCtPerKwh / einspeiseverguetungCtPerKwh / minBillableKw: Required`. Der Entwurf trägt
 * die Schlüssel des echten Zählpunkts (Werte ohne Personenbezug), nach „Ohne Rechnung fortfahren".
 * Lastgang, Preisdaten und Katalog: die eingefrorenen Eingaben des Bäckerei-Golden-Falls.
 */
const STEINHAUSER_DRAFT: Record<string, unknown> = {
  hasPv: false,
  netzebene: 'NE 7',
  billingModel: 'monthly_max_sum',
  netzbetreiber: 'wiener_netze',
  invoiceSkipped: true,
  meteringVariant: 'ohne_leistungsmessung',
  leistungspreisEurPerKwYear: 0,
  wantsBatteryRecommendation: true,
}

const GOLDEN = new URL('./golden/baeckerei/', import.meta.url)
const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(name, GOLDEN), 'utf8')) as T

describe('Steinhauser — Kunde ohne Stromrechnung', () => {
  it('rechnet durch: kein „Ihr Tarif heute", aWATTar-Wege und Speicherbewertung stehen', () => {
    const tariff = mapDraftToTariffParams(STEINHAUSER_DRAFT)
    const csv = readFileSync(new URL('lastgang.csv', GOLDEN), 'utf8')
    const parsed = parseLoadProfile({ content: csv, fileName: 'lastgang.csv', format: 'csv' })
    if (!parsed.ok) throw new Error('Lastgang ist nicht lesbar')

    const result = computeAnalysis(
      {
        tariff,
        pv: null,
        tariffPricing: readJson<TariffPricingInputs>('tariff-pricing.json'),
        load: {
          fileName: 'lastgang.csv',
          profile: parsed.profile,
          dataQuality: parsed.dataQuality,
        },
      },
      10,
      readJson<BatteryCandidate[]>('battery-catalog.json'),
    )

    const status = result.tariffOptimization
    const monthly = status?.computable === true ? status.monthlyComparison : undefined
    expect(monthly?.currentTariffEur).toBeNull()
    expect(monthly?.spotWithoutControlEur.some((v) => v !== null)).toBe(true)
    expect(result.recommendation).not.toBeNull()
    expect(result.assumptions.energyPriceCtPerKwh).toBeNull()
  })

  it('⚠ ohne den Vermerk „Ohne Rechnung fortfahren" bleibt es beim benannten Abbruch', () => {
    // Leere Tariffelder allein sind KEIN „unbekannt" — so steht der echte Entwurf heute da.
    expect(() => mapDraftToTariffParams({ ...STEINHAUSER_DRAFT, invoiceSkipped: false })).toThrow(
      /energyPriceCtPerKwh.*Ohne Rechnung fortfahren/,
    )
  })
})
