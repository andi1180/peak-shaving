import { describe, expect, it } from 'vitest'
import type { MonthlyTariffComparison } from 'shared'

import { formatEur } from '@/lib/format'

import { methodologyItemsFor, reportDisclaimer } from './content'
import type { PdfReportAnalysis, PdfReportInput } from './types'

/**
 * `PdfReportOrigin` — die zwei Kundentexte, die daran hängen: die Demo-Fusszeile (nur `demo`) und
 * der Datenschutz-Absatz „Ihre Verbrauchsdaten haben Ihren Rechner nicht verlassen" (nur
 * `client`). Ein Lauf über den Admin-/Übergabe-Pfad (`origin: 'transfer'`) ist echter Kundendaten,
 * kein Rechnernutzer und keine Demo — er darf keines von beiden behaupten.
 */

const MONTHS = <T,>(first: T): (T | null)[] => [first, ...Array<null>(11).fill(null)]

const COMPARISON: MonthlyTariffComparison = {
  currentTariffEur: MONTHS(120),
  spotWithoutControlEur: MONTHS(110),
  spotWithBatteryEur: MONTHS(95),
  coveredMonths: 1,
  fixedCosts: {
    networkBaseFeeEur: 0,
    meteringFeeEur: 0,
    eagFlatFeeEur: 0,
    usageChargeOnFixedEur: 0,
    supplierBaseFeeEur: 0,
    awattarBaseFeeEur: 4.79,
    supplierFeeEurPerMonth: 0,
    awattarFeeEurPerMonth: 4.79,
    coveredDays: 31,
  },
}

const ANALYSIS: PdfReportAnalysis = {
  current: {
    annualPeakKw: 48,
    monthlyPeaksKw: Array<number>(12).fill(48),
    billedKw: 48,
    leistungspreisCostPerYear: 3980.16,
  },
  perBattery: [],
  recommendation: {
    batteryId: 'keiner',
    rationale: { code: 'best_net_saving', totalSavingPerYear: 0, amortizationYears: 0, netSavingOverHorizon: 0, horizonYears: 10 },
  },
  assumptions: {
    roundTripEfficiency: 0.9,
    horizonYears: 10,
    energyPriceCtPerKwh: 24.5,
    einspeiseverguetungCtPerKwh: 7.2,
    billingModel: 'monthly_max_sum',
  },
  dataQuality: {
    coveredDays: 31,
    coveredMonths: 1,
    gapsInterpolated: 0,
    largestGapSlots: 0,
    warnings: [],
  },
  tariffOptimization: { computable: true, monthlyComparison: COMPARISON },
}

function inputWith(origin: PdfReportInput['origin']): Pick<PdfReportInput, 'analysis' | 'origin'> {
  return { analysis: ANALYSIS, origin }
}

describe('reportDisclaimer — nur am Prüfstand', () => {
  it('steht ausschliesslich bei `origin: "demo"`', () => {
    expect(reportDisclaimer('demo')).toContain('Demo-Berechnung')
  })

  it('fehlt bei echten Kundenläufen (client, transfer) und ohne Angabe', () => {
    expect(reportDisclaimer('client')).toBeNull()
    expect(reportDisclaimer('transfer')).toBeNull()
    expect(reportDisclaimer(undefined)).toBeNull()
  })
})

describe('methodologyItemsFor — der Datenschutz-Punkt nur im echten Client-Lauf', () => {
  it('steht bei `origin: "client"`', () => {
    const items = methodologyItemsFor(inputWith('client'))
    expect(items.map((i) => i.id)).toContain('methodik-prinzip4')
  })

  it('fehlt im Admin-/Übergabe-Pfad, am Prüfstand und ohne Angabe — auch aus der Agenda', () => {
    for (const origin of ['transfer', 'demo', undefined] as const) {
      const items = methodologyItemsFor(inputWith(origin))
      expect(items.map((i) => i.id)).not.toContain('methodik-prinzip4')
      expect(items.map((i) => i.title)).not.toContain(
        'Ihre Verbrauchsdaten haben Ihren Rechner nicht verlassen',
      )
    }
  })

  it('beschreibt den Fahrplan wie gerechnet: Vorabend-Planung, Leistungspreis-Obergrenze, Rückblick nur als Zahl hier', () => {
    const input: Pick<PdfReportInput, 'analysis' | 'origin'> = {
      origin: 'client',
      analysis: {
        ...ANALYSIS,
        tariffOptimization: {
          computable: true,
          monthlyComparison: { ...COMPARISON, spotWithBatteryHindsightEur: MONTHS(90) },
        },
      },
    }
    const items = methodologyItemsFor(input)
    const plan = items.find((i) => i.id === 'methodik-fahrplan')!

    expect(items.map((i) => i.title)).not.toContain('Bestmarke, nicht Alltagsbetrieb')
    expect(plan.body).toContain('am Vorabend')
    expect(plan.body).toContain('Der Leistungspreis-Anteil der Ersparnis ist deshalb eine Obergrenze')
    /* Obergrenze = aWATTar ohne Steuerung − Rückblick-Reihe = 110 − 90 über die 31 gemessenen Tage. */
    expect(plan.body).toContain(`über die 31 gemessenen Tage höchstens ${formatEur(20)}`)
  })
})
