import { describe, expect, it } from 'vitest'
import type { BatteryRoiEntry, LoadProfile, TariffSourceRef } from 'shared'

import { formatEur, formatKw, formatKwh1, formatKwp, formatPercent } from '@/lib/format'
import { buildPrerequisitesChapter } from './prerequisites'
import { TARIFF_SOURCE_UNTRACKED } from './types'
import type { PdfReportAnalysis, PdfReportInput } from './types'

/**
 * Kapitel „Voraussetzungen" — Block 1–4.
 *
 * ⚠ Die erste Fixture (`URBANZ`) ist der einzige LIVE-GEPRÜFTE Fall: Bestandsbatterie, PV-Anlage,
 * Netzebene 7 ohne Leistungsmessung (`leistungspreisCostPerYear: 0`) — s. `summary.test.ts`. Die
 * übrigen Fälle prüfen nur die einzelnen Verzweigungen und sind synthetisch.
 */

const BATTERY = {
  id: 'kat-1',
  name: 'Katalog 1',
  manufacturer: 'Fixture',
  class: 'commercial' as const,
  usableCapacityKwh: 19.2,
  maxPowerKw: 10.6,
  roundTripEfficiency: 0.9,
  pricePerKwh: 350,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic' as const,
}

const ENTRY: BatteryRoiEntry = {
  battery: BATTERY,
  newBilledKw: 40,
  leistungspreisSavingPerYear: 0,
  energySavingPerYear: 400,
  energySavingOverCoveredPeriod: 400,
  energySavingBasis: 'full_price' as const,
  annualizationFactor: 1,
  coveredDays: 209,
  totalSavingPerYear: 400,
  warnings: [],
  notices: [],
  totalInvestment: 21000,
  subsidyAmount: 0,
  taxBenefit: 0,
  taxEffectsIncluded: false,
  netInvestment: 21000,
  amortizationYears: 17.5,
  netSavingOverHorizon: -9000,
}

function analysisFor(over: Partial<PdfReportAnalysis> = {}): PdfReportAnalysis {
  return {
    current: {
      annualPeakKw: 21.4,
      monthlyPeaksKw: Array<number>(12).fill(21.4),
      billedKw: 21.4,
      leistungspreisCostPerYear: 0,
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
      coveredDays: 209,
      coveredMonths: 8,
      gapsInterpolated: 0,
      largestGapSlots: 0,
      warnings: [],
    },
    tariffOptimization: {
      computable: true,
      monthlyComparison: {
        currentTariffEur: [1021.89, ...Array<null>(11).fill(null)],
        spotWithoutControlEur: [963.34, ...Array<null>(11).fill(null)],
        spotWithBatteryEur: [761.35, ...Array<null>(11).fill(null)],
        coveredMonths: 8,
        fixedCosts: {
          networkBaseFeeEur: 0,
          meteringFeeEur: 0,
          eagFlatFeeEur: 0,
          usageChargeOnFixedEur: 0,
          supplierBaseFeeEur: 0,
          awattarBaseFeeEur: 0,
          supplierFeeEurPerMonth: 0,
          awattarFeeEurPerMonth: 0,
          coveredDays: 209,
        },
      },
    },
    existingBatteryAnalysis: { entry: ENTRY, addonScenarios: [] },
    ...over,
  }
}

const LOAD_PROFILE: LoadProfile = {
  readings: [{ ts: '2025-03-17T00:00:00.000Z', gridPowerKw: 9 }],
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Vienna',
  source: 'net_signed',
}

const NETZEBENE_7_UNGEMESSEN: TariffSourceRef = {
  tariffSetId: 'wn-2026',
  tariffSetLabel: 'Wiener Netze 2026',
  tariffSetValidFrom: '2026-01-01',
  tariffProfileKey: 'wiener_netze:7',
  netzbetreiber: 'wiener_netze',
  netzebene: 7,
  overriddenFields: [],
}

function inputFor(over: Partial<PdfReportInput> = {}): PdfReportInput {
  return {
    title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
    subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
    period: '17.03.2025 – 12.10.2025',
    printedAt: '21.09.2026',
    analysis: analysisFor(),
    loadProfile: LOAD_PROFILE,
    tariffSource: NETZEBENE_7_UNGEMESSEN,
    hasPv: true,
    pvPeakPowerKwp: 9.8,
    tariffVintage: null,
    ...over,
  }
}

describe('buildPrerequisitesChapter — Urbanz-Fall (Bestandsbatterie, PV, NE7 ohne Leistungsmessung)', () => {
  const chapter = buildPrerequisitesChapter(inputFor())

  it('zeigt eine Zeile je Anlagenteil mit den erfassten Werten', () => {
    expect(chapter.overview.rows).toEqual([
      {
        label: 'Ihre Batterie',
        value: `${formatKwh1(19.2)} · ${formatKw(10.6)} · ${formatPercent(90)} Wirkungsgrad`,
        tone: 'neutral',
      },
      { label: 'Ihre PV-Anlage', value: `${formatKwp(9.8)}, bestehend`, tone: 'neutral' },
      {
        label: 'Ihr Netzanschluss',
        value: 'Netzebene 7, ohne Leistungsmessung',
        tone: 'neutral',
      },
    ])
  })

  it('⚠ schreibt „geplant" statt „bestehend", sobald die Anlage erst geplant ist', () => {
    /*
     * „bestehend" ist eine TATSACHENBEHAUPTUNG über den Betrieb des Kunden. Sie stand hier bis zum
     * 22.09.2026 unbedingt — auch über einer Anlage, die erst bestellt ist: die Station konnte die
     * beiden Fälle gar nicht trennen. Eine FEHLENDE Stufe bleibt „bestehend", weil jeder vor dieser
     * Änderung erfasste Zählpunkt genau das meinte.
     */
    const geplant = buildPrerequisitesChapter(inputFor({ pvStage: 'planned' }))
    expect(geplant.overview.rows).toContainEqual({
      label: 'Ihre PV-Anlage',
      value: `${formatKwp(9.8)}, geplant`,
      tone: 'neutral',
    })
    expect(buildPrerequisitesChapter(inputFor({ pvStage: undefined })).overview.rows).toContainEqual(
      { label: 'Ihre PV-Anlage', value: `${formatKwp(9.8)}, bestehend`, tone: 'neutral' },
    )
  })

  it('nennt im Rahmen-Satz die zwei tragenden Quellen und keine Spitzenkappung', () => {
    expect(chapter.framing.body).toBe(
      'Ihr Anschluss hat keinen Leistungspreis-Bestandteil (eine Zusatzgebühr für hohe ' +
        'Verbrauchsspitzen, vor allem bei Gewerbekunden üblich). Ihre Batterie kann bei Ihnen ' +
        'deshalb keine Ersparnis durchs „Kappen von Spitzen" bringen. Die gesamte Ersparnis in ' +
        'dieser Auswertung kommt aus zwei anderen Quellen: dem gewählten Tarif und, falls ' +
        'aWATTar, der gezielten Steuerung der Batterie.',
    )
  })

  it('führt Kosten (identisch zur Kapitel-1-Kopfzahl), Zeitraum und Spitze', () => {
    expect(chapter.consumption.rows).toEqual([
      { label: 'Kosten', value: `${formatEur(1021.89)} (netto)`, tone: 'neutral' },
      { label: 'Zeitraum', value: '209 gemessene Tage', tone: 'neutral' },
      { label: 'Höchste gemessene Verbrauchsspitze', value: formatKw(21.4), tone: 'neutral' },
    ])
  })

  it('⚠ nennt die Spitze nur „gemessen", solange keine Schätzung abgezogen wurde', () => {
    /*
     * Wurde eine PVGIS-Schätzung vom Verbrauch abgezogen (PV-Stufe „geplant"), steht die Spitze
     * dort, wo die GESCHÄTZTE Erzeugung gerade klein war. Der Report sagt das auf Seite 7 bereits
     * („jede Lastspitze dieses Lastgangs zur Hälfte eine Schätzung"); dieselbe Zahl hier als
     * „gemessen" zu beschriften widerspräche dem eigenen Hinweis im selben Dokument.
     */
    const labelOf = (profile: LoadProfile) =>
      buildPrerequisitesChapter(inputFor({ loadProfile: profile })).consumption.rows.at(-1)?.label

    // Roher Lastgang — kein PV, oder PV „in Betrieb": das Label bleibt Wort für Wort dasselbe.
    expect(labelOf(LOAD_PROFILE)).toBe('Höchste gemessene Verbrauchsspitze')

    // Gekoppelt: `pvSource: 'estimated'` ist die Eigenschaft des LASTGANGS, der gerechnet wurde.
    expect(labelOf({ ...LOAD_PROFILE, pvSource: 'estimated' })).toBe(
      'Höchste Verbrauchsspitze (nach Abzug der geschätzten PV-Erzeugung)',
    )

    // ⚠ Nur das Label — die Zahl ist in beiden Fällen dieselbe Spitze des gerechneten Lastgangs.
    const value = (profile: LoadProfile) =>
      buildPrerequisitesChapter(inputFor({ loadProfile: profile })).consumption.rows.at(-1)?.value
    expect(value({ ...LOAD_PROFILE, pvSource: 'estimated' })).toBe(value(LOAD_PROFILE))
  })

  it('zeigt keinen Preisgrundlage-Hinweis ohne `tariffVintage`', () => {
    expect(chapter.priceBasis).toBeNull()
  })
})

describe('buildPrerequisitesChapter — ohne Bestandsanlage und ohne PV', () => {
  const chapter = buildPrerequisitesChapter(
    inputFor({
      analysis: analysisFor({ existingBatteryAnalysis: undefined }),
      hasPv: false,
      pvPeakPowerKwp: undefined,
      tariffSource: TARIFF_SOURCE_UNTRACKED,
    }),
  )

  it('lässt Batterie- und PV-Zeile ganz weg statt sie leer zu zeigen', () => {
    expect(chapter.overview.rows).toEqual([
      {
        label: 'Ihr Netzanschluss',
        value: 'Netzebene nicht erfasst, ohne Leistungsmessung',
        tone: 'neutral',
      },
    ])
  })

  it('formuliert den Rahmen-Satz ohne Batteriebezug und mit „eines Speichers"', () => {
    expect(chapter.framing.body).toContain('der gezielten Steuerung eines Speichers')
    expect(chapter.framing.body).not.toContain('Ihre Batterie')
  })
})

describe('buildPrerequisitesChapter — mit Leistungspreis (ungetestet, Fixture)', () => {
  it('nennt die Spitzenkappung als zusätzlichen Hebel', () => {
    const chapter = buildPrerequisitesChapter(
      inputFor({ analysis: analysisFor({ current: { ...analysisFor().current, leistungspreisCostPerYear: 400 } }) }),
    )
    expect(chapter.overview.rows.find((r) => r.label === 'Ihr Netzanschluss')).toEqual({
      label: 'Ihr Netzanschluss',
      value: 'Netzebene 7, mit Leistungsmessung',
      tone: 'neutral',
    })
    expect(chapter.framing.body).toContain('kann hier zusätzlich Kosten senken')
  })
})

describe('buildPrerequisitesChapter — Preisgrundlage aus älterer Rechnung', () => {
  it('zeigt den Hinweis mit dem Preisstand-Satz und dem Netzkosten/Steuern-Zusatz', () => {
    const note =
      'Arbeitspreis und Grundgebühr basieren auf einer 2025er-Vorjahresrechnung — für 2026 gibt ' +
      'es noch keine Jahresabrechnung. Für eine aktuelle Zahl wird die 2026er-Jahresrechnung des ' +
      'Kunden benötigt.'
    const chapter = buildPrerequisitesChapter(inputFor({ tariffVintage: note }))

    expect(chapter.priceBasis?.body).toContain(note)
    expect(chapter.priceBasis?.body).toContain('bereits auf dem aktuellen Jahresstand gerechnet')
  })
})
