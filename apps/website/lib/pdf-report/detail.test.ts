import { describe, expect, it } from 'vitest'
import type { BatteryNotice, MonthlyTariffComparison } from 'shared'

import { CONTROLLED_WAY_LABEL } from '@/lib/report-copy'
import { buildTariffComponents } from './basis'
import { SECTION_ID } from './content'
import {
  buildDetailChapter,
  buildMonthly,
  buildMonthlyChapter,
  detailChartPlan,
  hasMonthlyChapter,
} from './detail'
import { reportLayoutOf } from './layout'
import { resolveReportText } from './report-text'
import { buildReportSummary } from './summary'
import { TARIFF_SOURCE_UNTRACKED } from './types'
import type { PdfReportAnalysis } from './types'

/**
 * D7 — der Monatsvergleich als eigenes Kapitel.
 *
 * Geprüft wird die ABGRENZUNG zum Detail-Kapitel: mit Bestandsanlage steht der Vergleich dort (an
 * der Stelle des Kostenverlaufs), ohne sie hier — und dann muss der Kostenverlauf stehen bleiben,
 * weil er für diesen Leser das Bild zur offenen Kauffrage ist.
 */

const COMPARISON: MonthlyTariffComparison = {
  currentTariffEur: [120, ...Array<null>(11).fill(null)],
  spotWithoutControlEur: [110, ...Array<null>(11).fill(null)],
  spotWithBatteryEur: [95, ...Array<null>(11).fill(null)],
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

const BATTERY = {
  id: 'kat-1',
  name: 'Katalog 1',
  manufacturer: 'Fixture',
  class: 'commercial' as const,
  usableCapacityKwh: 60,
  maxPowerKw: 20,
  roundTripEfficiency: 0.9,
  pricePerKwh: 350,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic' as const,
}

const ENTRY = {
  battery: BATTERY,
  newBilledKw: 40,
  leistungspreisSavingPerYear: 800,
  energySavingPerYear: 400,
  energySavingOverCoveredPeriod: 400,
  energySavingBasis: 'full_price' as const,
  annualizationFactor: 1,
  coveredDays: 365,
  totalSavingPerYear: 1200,
  warnings: [],
  notices: [] as BatteryNotice[],
  totalInvestment: 21000,
  subsidyAmount: 0,
  taxBenefit: 0,
  taxEffectsIncluded: false,
  netInvestment: 21000,
  amortizationYears: 17.5,
  netSavingOverHorizon: -9000,
}

function analysisFor(withExisting: boolean): PdfReportAnalysis {
  return {
    current: {
      annualPeakKw: 48,
      monthlyPeaksKw: Array<number>(12).fill(48),
      billedKw: 48,
      leistungspreisCostPerYear: 3980.16,
    },
    perBattery: [ENTRY],
    recommendation: { batteryId: BATTERY.id, rationale: { code: 'best_net_saving', totalSavingPerYear: 0, amortizationYears: 0, netSavingOverHorizon: 0, horizonYears: 10 } },
    assumptions: {
      roundTripEfficiency: 0.9,
      horizonYears: 10,
      energyPriceCtPerKwh: 24.5,
      einspeiseverguetungCtPerKwh: 7.2,
      billingModel: 'monthly_max_sum',
    },
    dataQuality: {
      coveredDays: 365,
      coveredMonths: 12,
      gapsInterpolated: 0,
      largestGapSlots: 0,
      warnings: [],
    },
    tariffOptimization: { computable: true, monthlyComparison: COMPARISON },
    ...(withExisting ? { existingBatteryAnalysis: { entry: ENTRY, addonScenarios: [] } } : {}),
  }
}

/**
 * Stufe D — die Beschreibung von Kapitel 1, aus der gebauten Zusammenfassung selbst gebildet.
 * Gegen sie lösen sich die Verweise auf, die dieser Baustein trägt.
 */
function resultsLayout(analysis: PdfReportAnalysis) {
  const summary = buildReportSummary({ analysis, loadProfile: { source: 'net_signed' } })
  return reportLayoutOf(
    summary.statements.map((statement) => ({
      id: statement.id,
      section: SECTION_ID.results,
      title: statement.title,
      amount: statement.amount ? statement.amount.caption : null,
      rows: Object.fromEntries(
        statement.rows.flatMap((r) => (r.key ? [[r.key, r.label] as const] : [])),
      ),
    })),
  )
}

describe('Monatsvergleich als eigenes Kapitel (D7)', () => {
  it('ohne Bestandsanlage: eigenes Kapitel NEBEN dem Kostenverlauf, Reihe fallunabhängig benannt', () => {
    const analysis = analysisFor(false)

    expect(hasMonthlyChapter(analysis)).toBe(true)
    // Der Kostenverlauf bleibt — er ist das Bild zur Kaufaussage, die hier offen ist.
    expect(detailChartPlan(analysis).cost?.kind).toBe('cumulative')

    const chapter = buildMonthlyChapter(analysis)!
    /*
     * ⚠ Seit dem 21.09.2026 heisst die dritte Reihe ÜBERALL gleich (`CONTROLLED_WAY_LABEL`) und
     * nennt kein Gerät mehr. Die frühere Erwartung war die Fallunterscheidung selbst — sie prüfte,
     * dass hier NICHT „Ihrem Speicher" steht; das gilt weiterhin, nur eben ohne zweiten Wortlaut.
     */
    const text = [chapter.figure.caption, ...chapter.statement.rows.map((r) => r.label)].join(' | ')
    expect(text).toContain(CONTROLLED_WAY_LABEL)
    expect(text).not.toContain('Ihrem Speicher')
    expect(text).not.toContain('der empfohlenen Batterie')

    /*
     * Seit dem Zusammenfassungs-Umbau nennt der Satz weder die Kernergebnis-Seite noch einen ihrer
     * Bausteine — die gibt es nicht mehr (Ein-Spanne-Regel D8). Was bleibt, ist die Feststellung,
     * dass die drei Summen hier absolut stehen.
     */
    const body = resolveReportText(
      chapter.statement.body,
      resultsLayout(analysis),
      'monthly_comparison',
    )
    expect(body).toContain('Hier stehen die drei Summen absolut.')
    expect(body).not.toContain('Kernergebnis')
  })

  /**
   * Sobald die vorausschauende Reihe vorliegt, zeigt Weg 4 SIE — dieselbe Auswahl wie im
   * Wege-Kapitel (`ways.ts`/`tariffWayCosts`). Vorher las diese Zeile immer `spotWithBatteryEur`
   * (die einfache Reihe) und zeigte damit unter demselben Namen einen anderen Betrag als der
   * Balken im Wege-Kapitel.
   */
  it('zeigt bei vorliegender Prognose deren Betrag, nicht den der einfachen Reihe', () => {
    const predictive: MonthlyTariffComparison = {
      ...COMPARISON,
      spotWithPredictiveControlEur: [90, ...Array<null>(11).fill(null)],
    }
    const { statement } = buildMonthly(predictive, {
      annualPeakKw: 48,
      monthlyPeaksKw: Array<number>(12).fill(48),
      billedKw: 0,
      leistungspreisCostPerYear: 0,
    })
    const row = statement.rows.find((r) => r.label === CONTROLLED_WAY_LABEL)

    expect(row?.value).toBe('€ 90')
    expect(row?.value).not.toBe('€ 95')
  })

  /**
   * Kein Tages-Energiefluss (die Fixture trägt keinen `dispatchTrace`) heisst: an seiner Stelle
   * steht nichts, nicht einmal eine Begründung — das Kapitel trägt dafür seit hierher kein
   * `flowMissing`-Feld mehr.
   */
  it('ohne Energiefluss-Tag bleibt `flow` `null`, ohne einen Begründungs-Text daneben', () => {
    const chapter = buildDetailChapter(analysisFor(false))
    expect(chapter.flow).toBeNull()
    expect('flowMissing' in chapter).toBe(false)
  })

  it('mit Bestandsanlage: KEIN eigenes Kapitel — der Vergleich steht im Detail-Kapitel', () => {
    const analysis = analysisFor(true)

    expect(hasMonthlyChapter(analysis)).toBe(false)
    expect(buildMonthlyChapter(analysis)).toBeNull()
    expect(detailChartPlan(analysis).cost?.kind).toBe('monthly')

    // Regression: derselbe Schlusssatz wie im Katalog-Fall — er verzweigt nicht mehr.
    expect(
      resolveReportText(
        buildDetailChapter(analysis).cost?.statement?.body ?? '',
        resultsLayout(analysis),
        'monthly_comparison',
      ),
    ).toContain('Hier stehen die drei Summen absolut.')
  })

  /**
   * Die Lieferanten-Grundgebühr steht ZWEIMAL im Report — in dieser Bildunterschrift und in der
   * Tarifkomponenten-Tabelle des Schlusskapitels. Beide lesen dasselbe Feld; die Bildunterschrift
   * rundete es auf ganze Euro und zeigte für 3,50 € ein „€ 4" neben dem „€ 3,50" der Tabelle.
   */
  it('nennt die Grundgebühr mit demselben Wert wie die Tarifkomponenten-Tabelle', () => {
    const analysis = {
      ...analysisFor(false),
      tariffOptimization: {
        computable: true as const,
        monthlyComparison: {
          ...COMPARISON,
          fixedCosts: { ...COMPARISON.fixedCosts, supplierFeeEurPerMonth: 3.5 },
        },
      },
    }

    const body = resolveReportText(
      buildMonthlyChapter(analysis)!.statement.body,
      resultsLayout(analysis),
      'monthly_comparison',
    )
    const tabelle = buildTariffComponents({
      title: 'Report',
      subtitle: '',
      period: null,
      printedAt: '2026-09-23',
      tariffVintage: null,
      analysis,
      // Die Tabelle liest den Lastgang nicht — er steht hier nur, weil der Eingabetyp ihn verlangt.
      loadProfile: {
        readings: [{ ts: '2025-03-17T00:00:00.000Z', gridPowerKw: 9 }],
        intervalMinutes: 15,
        timezoneMeta: 'Europe/Vienna',
        source: 'net_signed',
      },
      tariffSource: TARIFF_SOURCE_UNTRACKED,
    })
    const zelle = tabelle.rows.find((r) => r.key === 'tariff_supplier_fee')!.cells[1]

    expect(zelle).toBe('€\u00a03,50 / Monat')
    expect(body).toContain('Ihr Lieferant €\u00a03,50/Monat')
    expect(body).not.toContain('€\u00a04/Monat')
  })

  /**
   * Der Vorbehalt „Nicht enthalten ist der Leistungspreis" nennt einen Posten, den ein Anschluss
   * ohne Leistungsmessung (Netzebene 7, der Urbanz-Fall) gar nicht hat — dieselbe Bedingung wie
   * der Rahmen-Hinweis im Kapitel „Voraussetzungen".
   */
  it('der Leistungspreis-Vorbehalt steht nur, wo es den Posten gibt', () => {
    const satz = 'Nicht enthalten ist der Leistungspreis'
    const bodyFor = (analysis: PdfReportAnalysis) =>
      resolveReportText(
        buildMonthlyChapter(analysis)!.statement.body,
        resultsLayout(analysis),
        'monthly_comparison',
      )

    const mit = analysisFor(false)
    expect(bodyFor(mit)).toContain(satz)

    const ohne: PdfReportAnalysis = {
      ...mit,
      current: { ...mit.current, leistungspreisCostPerYear: 0 },
    }
    const body = bodyFor(ohne)
    expect(body).not.toContain(satz)
    /* Ersatzlos, nicht umformuliert: der Satz davor und der danach schliessen direkt aneinander. */
    expect(body).toContain('/Monat). Hier stehen die drei Summen absolut.')
  })

  it('ohne berechenbaren Hebel gibt es das Kapitel nicht', () => {
    const analysis = analysisFor(false)
    expect(hasMonthlyChapter({ ...analysis, tariffOptimization: undefined })).toBe(false)
  })
})
