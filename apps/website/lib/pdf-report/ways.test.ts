import { describe, expect, it } from 'vitest'
import { analysisForDisplay } from 'shared'
import type { BatteryResultEntry, MonthlyTariffComparison } from 'shared'

import { waysSectionTitle } from './content'
import { buildSummaryKpis, summaryWaysOf } from './summary'
import type { PdfReportAnalysis } from './types'
import { buildWaysChapter, hasWaysChapter, waysCountOf } from './ways'

/**
 * D7-Revision — das Wege-Kapitel führt je Kunde DREI BIS FÜNF Wege.
 *
 * Geprüft wird vor allem, dass jeder Weg NUR dasteht, wenn er zutrifft (Weg 2 ohne Angabe, Weg 5
 * ohne Leistungspreis), und dass die Balken dieselben Zahlen tragen wie `summaryWaysOf` — nicht
 * eine zweite, eigene Rechnung.
 */

const MONTHS = <T,>(first: T): (T | null)[] => [first, ...Array<null>(11).fill(null)]

function comparisonWith(args: {
  current: number
  spot: number
  battery: number
  /** Weg 2 — fehlt, wenn der Kunde keinen Vergleichstarif angegeben hat. */
  comparison?: number
  comparisonSupplier?: string
  /** Weg 4 — die vorausschauende Reihe, wenn die Engine sie rechnen konnte. */
  predictive?: number
}): MonthlyTariffComparison {
  return {
    currentTariffEur: MONTHS(args.current),
    spotWithoutControlEur: MONTHS(args.spot),
    spotWithBatteryEur: MONTHS(args.battery),
    ...(args.comparison === undefined
      ? {}
      : {
          comparisonTariffEur: MONTHS(args.comparison),
          comparisonSupplier: args.comparisonSupplier ?? 'ENSTROGA',
        }),
    ...(args.predictive === undefined
      ? {}
      : { spotWithPredictiveControlEur: MONTHS(args.predictive) }),
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
}

/** Ein Eintrag, dessen Speicher den abgerechneten Leistungswert senkt (Weg 5 trifft zu). */
function entryWith(leistungspreisSavingPerYear: number): BatteryResultEntry {
  return {
    battery: {
      id: 'kat-1',
      name: 'Test',
      manufacturer: 'Test',
      class: 'commercial',
      usableCapacityKwh: 30,
      maxPowerKw: 10,
      roundTripEfficiency: 0.9,
      pricePerKwh: 500,
      inverterIncluded: true,
      requiresFoundation: false,
      controlType: 'dynamic',
    },
    newBilledKw: 40,
    leistungspreisSavingPerYear,
    selfConsumptionSavingPerYear: 100,
    loadShiftSavingPerYear: 50,
    selfConsumptionSavingOverCoveredPeriod: 100,
    loadShiftSavingOverCoveredPeriod: 50,
    annualizationFactor: 1,
    coveredDays: 31,
    totalSavingPerYear: leistungspreisSavingPerYear + 150,
    warnings: [],
    dispatchTrace: undefined as unknown as BatteryResultEntry['dispatchTrace'],
  }
}

function analysisWith(args: {
  comparison?: MonthlyTariffComparison
  peakSaving?: number
}): PdfReportAnalysis {
  const entry = entryWith(args.peakSaving ?? 0)
  return {
    current: {
      annualPeakKw: 48,
      monthlyPeaksKw: Array<number>(12).fill(48),
      billedKw: 48,
      leistungspreisCostPerYear: 3980.16,
    },
    perBattery: [entry as never],
    recommendation: { batteryId: 'kat-1', rationale: { code: 'best_net_saving', totalSavingPerYear: 0, amortizationYears: 0, netSavingOverHorizon: 0, horizonYears: 10 } },
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
    tariffOptimization: args.comparison
      ? { computable: true, monthlyComparison: args.comparison }
      : undefined,
  }
}

describe('Wege-Kapitel (D7-Revision)', () => {
  it('ohne berechenbaren Monatsvergleich gibt es das Kapitel nicht', () => {
    const analysis = analysisWith({})
    expect(hasWaysChapter(analysis)).toBe(false)
    expect(buildWaysChapter(analysis)).toBeNull()
    expect(waysCountOf(analysis)).toBe(0)
  })

  it('Leistungspreis + Bestandsbatterie: alle fünf Wege, Weg 5 mit einer Zahl > 0', () => {
    const analysis = analysisWith({
      comparison: comparisonWith({
        current: 120,
        spot: 110,
        battery: 95,
        comparison: 112,
        comparisonSupplier: 'ENSTROGA',
        predictive: 97,
      }),
      peakSaving: 1200,
    })
    const chapter = buildWaysChapter(analysis)!

    expect(waysCountOf(analysis)).toBe(5)
    expect(chapter.wayCount).toBe(5)
    expect(waysSectionTitle(chapter.wayCount)).toBe('Fünf Wege zu weniger Stromkosten')

    expect(chapter.statements.map((s) => s.id)).toEqual([
      'ways_current',
      'ways_comparison_tariff',
      'ways_tariff_switch',
      'ways_load_control',
      'ways_peak_shaving',
    ])

    // Weg 5 zeigt eine Zahl > 0 UND sagt, dass sie ein Jahreswert ist.
    const peak = chapter.statements.find((s) => s.id === 'ways_peak_shaving')!
    expect(String(peak.body)).toContain('1.200')
    expect(String(peak.body)).toContain('pro Jahr')

    // Vier Balken — die Lastspitzenkappung ist ausdrücklich keiner (andere Einheit).
    expect(chapter.bars.map((b) => b.key)).toEqual([
      'today',
      'comparison',
      'uncontrolled',
      'controlled',
    ])
    // Und sie tragen dieselben Beträge wie `summaryWaysOf` — keine zweite Rechnung.
    const ways = summaryWaysOf(analysis)!
    expect(chapter.bars.map((b) => b.eur)).toEqual([
      ways.costTodayEur,
      ...ways.ways.map((w) => w.costEur),
    ])
    // Weg 4 rechnet mit der VORAUSSCHAUENDEN Reihe (97), nicht mit der Bestmarke (95).
    expect(ways.controlVariant).toBe('predictive')
    expect(ways.ways.find((w) => w.id === 'controlled')!.costEur).toBe(97)
    expect(String(chapter.statements[3]!.body)).toContain('Vorausberechnung')
  })

  /* D8 — die Ein-Spanne-Regel: GENAU EINE Kern-Ersparnis-Aussage im ganzen Dokument. */
  it('kein Weg trägt eine eigene Ersparnis-Kopfzahl — die einzige steht in der Zusammenfassung', () => {
    const analysis = analysisWith({
      comparison: comparisonWith({
        current: 120,
        spot: 110,
        battery: 95,
        comparison: 112,
        predictive: 97,
      }),
      peakSaving: 1200,
    })
    const chapter = buildWaysChapter(analysis)!

    // Fünf Absätze, fünf Beträge — und KEINER davon als Kopfzahl neben der Spanne aus Kapitel 1.
    expect(chapter.statements).toHaveLength(5)
    expect(chapter.statements.every((s) => s.amount === null)).toBe(true)

    // Und in Kapitel 1 steht die Ersparnis genau einmal, als Spanne.
    const kpis = buildSummaryKpis(analysis, summaryWaysOf(analysis)!)
    expect(kpis.filter((k) => k.id === 'possible_saving')).toHaveLength(1)
    expect(kpis.find((k) => k.id === 'possible_saving')!.value).toContain('–')
  })

  it('ohne Leistungspreis-Ersparnis erscheint Weg 5 nicht', () => {
    const analysis = analysisWith({
      comparison: comparisonWith({ current: 120, spot: 110, battery: 95 }),
      peakSaving: 0,
    })
    const chapter = buildWaysChapter(analysis)!

    expect(chapter.statements.map((s) => s.id)).not.toContain('ways_peak_shaving')
    expect(chapter.wayCount).toBe(3)
    expect(waysSectionTitle(chapter.wayCount)).toBe('Drei Wege zu weniger Stromkosten')
  })

  it('ohne eingegebenen Vergleichstarif erscheint Weg 2 nicht — kein Platzhalter, kein Nullwert', () => {
    const analysis = analysisWith({
      comparison: comparisonWith({ current: 120, spot: 110, battery: 95 }),
      peakSaving: 1200,
    })
    const chapter = buildWaysChapter(analysis)!

    expect(chapter.statements.map((s) => s.id)).not.toContain('ways_comparison_tariff')
    expect(chapter.bars.map((b) => b.key)).not.toContain('comparison')
    expect(summaryWaysOf(analysis)!.comparisonSupplier).toBeNull()
    expect(chapter.wayCount).toBe(4)
  })

  it('ohne vorausschauende Reihe zeigt Weg 4 die einfache Ladesteuerung und sagt es nicht als Prognose', () => {
    const analysis = analysisWith({
      comparison: comparisonWith({ current: 120, spot: 110, battery: 95 }),
    })
    const ways = summaryWaysOf(analysis)!
    const chapter = buildWaysChapter(analysis)!

    expect(ways.controlVariant).toBe('simple')
    expect(ways.ways.find((w) => w.id === 'controlled')!.costEur).toBe(95)
    const control = chapter.statements.find((s) => s.id === 'ways_load_control')!
    expect(String(control.body)).not.toContain('Vorausberechnung')
    expect(String(control.body)).toContain('gespart')
  })

  /**
   * Die Bildunterschrift trug bis hierher hartkodiert „exkl. MwSt." — bei Privatkunden (H3, USt
   * inkl.) eine falsche Aussage. Sie hängt jetzt an `displayedPriceLabel` wie der Rest des
   * Dokuments, statt einen eigenen Text zu behaupten.
   */
  it('die Bildunterschrift nennt netto oder inkl. USt, nie „exkl. MwSt."', () => {
    const analysis = analysisWith({
      comparison: comparisonWith({ current: 120, spot: 110, battery: 95 }),
    })

    const netto = buildWaysChapter(analysis)!
    expect(netto.figure.caption).toContain('Alle Beträge netto.')
    expect(netto.figure.caption).not.toContain('exkl. MwSt')

    const brutto = buildWaysChapter(analysisForDisplay(analysis, 'gross'))!
    expect(brutto.figure.caption).toContain('Alle Beträge inkl. 20 % USt.')
    expect(brutto.figure.caption).not.toContain('exkl. MwSt')
  })
})
