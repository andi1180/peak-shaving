import { describe, expect, it } from 'vitest'
import type { PvOutageMonth } from 'engine'
import type {
  LoadProfile,
  MonthlyTariffComparison,
  NetzbetreiberId,
  PvValueScenario,
  TariffSourceRef,
} from 'shared'

import { buildBasisChapter, DATA_SOURCES_TABLE_ID } from './basis'
import { reportInputForDisplay } from './price-display'
import { SECTION_ID } from './content'
import { reportLayoutOf } from './layout'
import { resolveReportText, type ReportText } from './report-text'
import type { ReportNotice } from './statement'
import { TARIFF_SOURCE_UNTRACKED } from './types'
import { buildWaysChapter } from './ways'
import type { PdfReportAnalysis, PdfReportInput, PdfReportTariffSource } from './types'

/**
 * D12 — der dritte Tarifquellen-Zustand im Kapitel „Annahmen und Datengrundlage".
 *
 * ⚠ GEPRÜFT WIRD ÜBER `buildBasisChapter`, NICHT ÜBER EINEN INTERNEN HELFER. Der dritte Zustand ist
 * eine nichtleere Zeichenkette und damit wahrheitswertig; der Fehler, der hier drohte, ist nicht
 * „falscher Satz", sondern ein `!source`-Zweig, der ihn als `TariffSourceRef` behandelt und beim
 * ersten Feldzugriff wirft. Das zeigt nur der gesamte Kapitel-Aufbau.
 */

/** Das Minimum, das der Kapitel-Aufbau liest — leerer Katalog, keine Warnungen, kein Blocker. */
const ANALYSIS: PdfReportAnalysis = {
  current: {
    annualPeakKw: 48,
    monthlyPeaksKw: [48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48],
    billedKw: 48,
    leistungspreisCostPerYear: 331.68, // 82,92 €/kW·a × 48 kW ÷ 12 (Summenmodell, 12 Monate)
  },
  perBattery: [],
  recommendation: { batteryId: 'keiner', rationale: { code: 'best_net_saving', totalSavingPerYear: 0, amortizationYears: 0, netSavingOverHorizon: 0, horizonYears: 10 } },
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
}

const LOAD_PROFILE: LoadProfile = {
  readings: [{ ts: '2025-03-17T00:00:00.000Z', gridPowerKw: 9 }],
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Vienna',
  source: 'net_signed',
}

const REAL_REF: TariffSourceRef = {
  tariffSetId: 'wn-2026',
  tariffSetLabel: 'Wiener Netze 2026',
  tariffSetValidFrom: '2026-01-01',
  tariffProfileKey: 'wiener_netze:6',
  netzbetreiber: 'wiener_netze',
  netzebene: 6,
  overriddenFields: [],
}

function chapterFor(tariffSource: PdfReportTariffSource, netzbetreiber?: NetzbetreiberId) {
  const input: PdfReportInput = {
    title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
    subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
    period: '17.03.2025 – 17.03.2025',
    printedAt: '16.09.2026',
    analysis: ANALYSIS,
    loadProfile: LOAD_PROFILE,
    tariffSource,
    netzbetreiber,
    tariffVintage: null,
  }
  return buildBasisChapter(input)
}

describe('buildBasisChapter — Herkunft der Tarifsätze', () => {
  it('nennt beim dritten Zustand die Unkenntnis und behauptet keine Herkunft', () => {
    const { tariffSource } = chapterFor(TARIFF_SOURCE_UNTRACKED)

    expect(tariffSource).toContain('nicht im Einzelnen nachverfolgt')
    // Weder die `null`-Aussage („aus Ihrer Eingabe") noch ein Tarifstand werden behauptet.
    expect(tariffSource).not.toContain('kein hinterlegter Stand gewählt')
    expect(tariffSource).not.toContain('Netzebene')
    // Der rohe Wert darf nicht als Beschriftung durchschlagen.
    expect(tariffSource).not.toContain(TARIFF_SOURCE_UNTRACKED)
  })

  it('lässt den `null`-Fall und einen echten TariffSourceRef unverändert', () => {
    expect(chapterFor(null).tariffSource).toBe(
      'Kein hinterlegter Stand gewählt — Leistungspreis, Abrechnungsmodell und ' +
        'Mindestleistung stammen unverändert aus Ihrer Eingabe.',
    )
    expect(chapterFor(REAL_REF).tariffSource).toBe(
      'Wiener Netze, Netzebene 6 · Stand „Wiener Netze 2026", gültig ab 2026-01-01. ' +
        'Die Vorgabewerte wurden unverändert übernommen.',
    )
  })

  /**
   * D9-Vorgriff — der Netzbetreiber als ANGABE im dritten Satz. Geprüft wird beides zusammen: dass
   * der Name erscheint UND dass der Rest des Satzes wortgleich bleibt; ein Zweig, der nur den Namen
   * anhängt und dabei die Unkenntnis verschweigt, bestünde die erste Hälfte allein.
   */
  it('nennt den Netzbetreiber, wenn der Weg ihn kennt — ohne eine Herkunft zu behaupten', () => {
    const { tariffSource } = chapterFor(TARIFF_SOURCE_UNTRACKED, 'wiener_netze')

    expect(tariffSource).toContain('(Netzbetreiber: Wiener Netze)')
    expect(tariffSource).toContain('nicht im Einzelnen nachverfolgt')
    expect(tariffSource).toContain('hält dieser Report nicht fest')
    // Die rohe Kennung darf nicht als Beschriftung durchschlagen.
    expect(tariffSource).not.toContain('wiener_netze')
  })

  it('lässt den Satz ohne Netzbetreiber unverändert — kein Platzhalter', () => {
    expect(chapterFor(TARIFF_SOURCE_UNTRACKED).tariffSource).toBe(
      'Herkunft für diese Auswertung nicht im Einzelnen nachverfolgt — gerechnet ' +
        'wurde mit den Leistungspreis-, Abrechnungs- und Mindestleistungswerten, die zu diesem ' +
        'Zählpunkt hinterlegt sind. Ob sie aus einer Netzrechnung oder aus einem hinterlegten ' +
        'Tarifstand stammen, hält dieser Report nicht fest.',
    )
  })

  it('baut in allen drei Zuständen dasselbe übrige Kapitel', () => {
    const untracked = chapterFor(TARIFF_SOURCE_UNTRACKED)
    const empty = chapterFor(null)

    expect(untracked.assumptions).toEqual(empty.assumptions)
    expect(untracked.dataQuality).toBeNull()
    expect(untracked.blocker).toBeNull()
  })
})

/**
 * D5 — der PV-Befund hängt an ZWEI Bedingungen, und der Fehler, der hier droht, ist ein Hinweis, der
 * bei einem Betrieb ohne PV-Anlage steht: dort ist ein fehlender Mittagseinbruch der Normalzustand
 * und kein Befund.
 */
const OUTAGE_MONTHS: PvOutageMonth[] = [
  { year: 2025, month: 2, daysWithDayWindowData: 28, minDayWindowKw: 21 },
  { year: 2025, month: 3, daysWithDayWindowData: 31, minDayWindowKw: 18.4 },
]

function pvChapterFor(
  hasPv: boolean | undefined,
  pvOutageMonths: PvOutageMonth[] | undefined,
  /** Gibt es das Kapitel „Ihre PV-Anlage"? Es hängt allein an `analysis.pvValue`. */
  pvValue?: PvValueScenario,
) {
  const input: PdfReportInput = {
    title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
    subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
    period: '01.01.2025 – 31.12.2025',
    printedAt: '17.09.2026',
    analysis: pvValue ? { ...ANALYSIS, pvValue } : ANALYSIS,
    loadProfile: LOAD_PROFILE,
    tariffSource: TARIFF_SOURCE_UNTRACKED,
    tariffVintage: null,
    hasPv,
    pvOutageMonths,
  }
  return buildBasisChapter(input)
}

/** Ein PV-Kapitel, das es gibt — gelesen wird davon hier nur, DASS es da ist. */
const PV_VALUE: PvValueScenario = {
  coveredDays: 209,
  measured: { withPvEur: 1000, withoutPvEur: 1654, valueEur: 654 },
  annual: null,
  months: [{ year: 2025, month: 2, selfConsumptionKwh: null, outage: true }],
  estimatedGenerationKwh: 5212.67,
}

describe('buildBasisChapter — Monate ohne erkennbaren PV-Beitrag (D5)', () => {
  it('nennt die betroffenen Monate, wenn eine Anlage angegeben ist und Monate erkannt wurden', () => {
    const { pvOutage } = pvChapterFor(true, OUTAGE_MONTHS)

    expect(pvOutage?.id).toBe('pv_outage')
    expect(pvOutage?.list?.items).toEqual(['Februar 2025', 'März 2025'])
    // Beobachtung über den Zeitraum — ausdrücklich keine Aussage über die Anlage von heute.
    expect(pvOutage?.hints.join(' ')).toContain('keine Aussage über den heutigen Zustand')
  })

  /**
   * ⚠ MIT DEM PV-KAPITEL BLEIBT HIER DIE BEOBACHTUNG, NICHT IHRE DEUTUNG.
   *
   * Beides nebeneinander wäre derselbe Befund in zwei Ausführlichkeiten. Die betroffenen Monate
   * bleiben, weil sie die Angabe zur Datengrundlage SIND; die Einordnung wandert ins Kapitel, und
   * der Hinweis nennt es beim Namen.
   */
  it('kürzt sich auf einen Zeiger, sobald es das Kapitel „Ihre PV-Anlage" gibt', () => {
    const { pvOutage } = pvChapterFor(true, OUTAGE_MONTHS, PV_VALUE)

    expect(pvOutage?.id).toBe('pv_outage')
    expect(pvOutage?.body).toContain('steht im Kapitel „Ihre PV-Anlage"')
    /* Die Deutung ist WEG — sie steht jetzt genau einmal, im Kapitel. */
    expect(pvOutage?.hints).toEqual([])
    expect(pvOutage?.body).not.toContain('Verschattung')
    /* Die Monate bleiben: ohne sie wäre der Zeiger ein Verweis ohne Gegenstand. */
    expect(pvOutage?.list?.items).toEqual(['Februar 2025', 'März 2025'])
    /* Und der Titel ist derselbe wie ohne Kapitel — der Methodik-Absatz verlangt Gleichnamigkeit. */
    expect(pvOutage?.title).toBe(pvChapterFor(true, OUTAGE_MONTHS).pvOutage?.title)
  })

  it('schweigt ohne PV-Angabe und ohne erkannte Monate', () => {
    // Beide Male derselbe Zustand im Kapitel, und beide Male aus einem anderen Grund.
    expect(pvChapterFor(false, OUTAGE_MONTHS).pvOutage).toBeNull()
    expect(pvChapterFor(undefined, OUTAGE_MONTHS).pvOutage).toBeNull()
    expect(pvChapterFor(true, []).pvOutage).toBeNull()
    expect(pvChapterFor(true, undefined).pvOutage).toBeNull()
  })
})

/**
 * D9 — die Datenquellen-Tabelle.
 *
 * ⚠ Geprüft wird über `buildBasisChapter` und an den ZELLEN, nicht an einem internen Helfer: der
 * Fehler, der hier droht, ist eine Zeile, die eine Quelle NENNT, ohne eine zu haben — und der ist
 * nur am zusammengesetzten Text sichtbar.
 */
const BATTERY_ANALYSIS: PdfReportAnalysis = {
  ...ANALYSIS,
  perBattery: [
    {
      battery: {
        id: 'ps-c60',
        name: 'PeakStore C60',
        manufacturer: 'Demo Energy',
        class: 'commercial',
        usableCapacityKwh: 60,
        maxPowerKw: 30,
        roundTripEfficiency: 0.9,
        pricePerKwh: 420,
        inverterIncluded: true,
        requiresFoundation: false,
        controlType: 'dynamic',
      },
      newBilledKw: 36,
      leistungspreisSavingPerYear: 995,
      selfConsumptionSavingPerYear: 0,
      loadShiftSavingPerYear: 0,
      selfConsumptionSavingOverCoveredPeriod: 0,
      loadShiftSavingOverCoveredPeriod: 0,
      annualizationFactor: 1,
      coveredDays: 365,
      totalSavingPerYear: 995,
      warnings: [],
      notices: [],
      totalInvestment: 25200,
      subsidyAmount: 0,
      taxBenefit: 0,
      taxEffectsIncluded: false,
      netInvestment: 25200,
      amortizationYears: 25.3,
      netSavingOverHorizon: 0,
    },
  ],
  recommendation: { batteryId: 'ps-c60', rationale: { code: 'best_net_saving', totalSavingPerYear: 0, amortizationYears: 0, netSavingOverHorizon: 0, horizonYears: 10 } },
}

function dataSourcesFor(provenance: PdfReportInput['tariffProvenance']) {
  const input: PdfReportInput = {
    title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
    subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
    period: '01.01.2025 – 31.12.2025',
    printedAt: '17.09.2026',
    analysis: BATTERY_ANALYSIS,
    loadProfile: LOAD_PROFILE,
    tariffSource: TARIFF_SOURCE_UNTRACKED,
    tariffVintage: null,
    tariffProvenance: provenance,
  }
  return buildBasisChapter(input).dataSources
}

/**
 * Die Beschreibung des Schlusskapitels, so weit die Datenquellen-Tabelle sie braucht: steht der
 * Datenqualitäts-Hinweis über ihr oder nicht? Stufe D löst den Verweis in der Zelle dagegen auf.
 */
function layoutFor(dataQuality: ReportNotice | null) {
  return reportLayoutOf([
    ...(dataQuality
      ? [
          {
            id: 'data_quality' as const,
            section: SECTION_ID.basis,
            title: dataQuality.title,
            amount: null,
            rows: {},
          },
        ]
      : []),
    {
      id: DATA_SOURCES_TABLE_ID,
      section: SECTION_ID.basis,
      title: '',
      amount: null,
      rows: {},
    },
  ])
}

/** Die dritte Spalte („Zeitraum / Stand") einer Zeile — aufgelöst wie im Dokument. */
function vintageOf(
  table: ReturnType<typeof dataSourcesFor>,
  key: string,
  dataQuality: ReportNotice | null = null,
): string {
  const cell = table.rows.find((row) => row.key === key)?.cells[2] ?? ''
  return resolveReportText(cell, layoutFor(dataQuality), DATA_SOURCES_TABLE_ID)
}

describe('buildBasisChapter — Datenquellen-Tabelle (D9)', () => {
  it('füllt alle drei Zeilengruppen und nennt den echten Stand der Preisblatt-Zeile', () => {
    const table = dataSourcesFor({
      gridTariffValidFrom: ['2026-01-01'],
      invoicePeriods: [{ from: '2025-01-01', to: '2025-12-31', assumed: false }],
    })

    expect(table.rows.filter((row) => row.heading).map((row) => row.cells[0])).toEqual([
      'Lastgang',
      'Tarif',
      'Batterie',
    ])
    expect(vintageOf(table, 'load_readings')).toContain('01.01.2025 – 31.12.2025')
    expect(vintageOf(table, 'load_readings')).toContain('365 abgedeckte Tage')
    // D8: die gezeigte Abdeckungszahl ist benannt und steht nicht neben einer zweiten.
    expect(vintageOf(table, 'load_readings')).toContain('Slot-Zählung')

    // Der echte Gültigkeitsbeginn tritt an die Stelle von „nicht nachverfolgt".
    expect(vintageOf(table, 'tariff_grid')).toContain('gültig ab 01.01.2026')
    expect(vintageOf(table, 'tariff_grid')).not.toContain('nicht nachverfolgt')
    expect(vintageOf(table, 'tariff_supplier')).toContain('01.01.2025 – 31.12.2025')
    expect(vintageOf(table, 'tariff_supplier')).toContain('ausgeschrieben')

    expect(table.rows.find((row) => row.key === 'battery_device')?.cells[0]).toBe(
      'Demo Energy PeakStore C60',
    )
  })

  /**
   * Der Verweis „wie im Datenqualitäts-Hinweis oben" zeigt nur dann auf etwas — die Box steht nur
   * bei `dataQuality.warnings.length > 0` (`buildDataQuality`), dieselbe Bedingung wie hier.
   */
  it('verweist auf den Datenqualitäts-Hinweis nur, wenn er auch steht', () => {
    // ANALYSIS/BATTERY_ANALYSIS tragen `warnings: []` — bisher stand der Verweis trotzdem da.
    const withoutWarnings = dataSourcesFor({ gridTariffValidFrom: [], invoicePeriods: [] })
    expect(vintageOf(withoutWarnings, 'load_readings')).not.toContain('Datenqualitäts-Hinweis')
    expect(vintageOf(withoutWarnings, 'load_readings')).toContain('Slot-Zählung')

    const chapter = buildBasisChapter({
      title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
      subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
      period: '01.01.2025 – 31.12.2025',
      printedAt: '17.09.2026',
      analysis: {
        ...BATTERY_ANALYSIS,
        dataQuality: { ...BATTERY_ANALYSIS.dataQuality, warnings: ['grosse Lücke im Mai'] },
      },
      loadProfile: LOAD_PROFILE,
      tariffSource: TARIFF_SOURCE_UNTRACKED,
      tariffVintage: null,
      tariffProvenance: { gridTariffValidFrom: [], invoicePeriods: [] },
    })
    expect(vintageOf(chapter.dataSources, 'load_readings', chapter.dataQuality)).toContain(
      'wie im Datenqualitäts-Hinweis oben',
    )
  })

  it('behält „nicht nachverfolgt", solange keine Preisblatt-Zeile vorliegt', () => {
    const table = dataSourcesFor({ gridTariffValidFrom: [], invoicePeriods: [] })

    expect(vintageOf(table, 'tariff_grid')).toContain('nicht nachverfolgt')
    expect(vintageOf(table, 'tariff_grid')).not.toContain('gültig ab')
  })

  it('fällt ohne Rechnungs-Extraktion auf die Fundstelle des Vergleichstarifs zurück', () => {
    const table = dataSourcesFor({ gridTariffValidFrom: ['2026-01-01'], invoicePeriods: [] })

    expect(vintageOf(table, 'tariff_supplier')).toContain('Kundenrechnung: nicht erfasst')
    expect(vintageOf(table, 'tariff_supplier')).toContain('aWATTar')
  })

  /**
   * ⚠ Ohne diesen Zusatz sähe ein Gerätename zwischen Zeilen mit echten Fundstellen aus wie eine
   * geprüfte Quelle — er muss deshalb auch dort stehen, wo gar kein Gerät ausgewiesen ist.
   */
  it('weist die fehlende Geräte-Herkunft in jedem Fall aus', () => {
    const withDevice = dataSourcesFor({ gridTariffValidFrom: [], invoicePeriods: [] })
    expect(vintageOf(withDevice, 'battery_device')).toContain('Katalogstand nicht übergeben')

    const withoutCatalog = buildBasisChapter({
      title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
      subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
      period: null,
      printedAt: '17.09.2026',
      analysis: ANALYSIS,
      loadProfile: LOAD_PROFILE,
      tariffSource: TARIFF_SOURCE_UNTRACKED,
      tariffVintage: null,
    }).dataSources

    expect(vintageOf(withoutCatalog, 'battery_device')).toContain(
      'keine Herkunfts- oder Preisquelle',
    )
    expect(withoutCatalog.rows.find((row) => row.key === 'battery_device')?.cells[0]).toBe(
      'kein Gerät ausgewiesen',
    )
    // Ohne Lastgang-Zeitraum steht die Leerstelle ausgeschrieben da, kein Strich.
    expect(vintageOf(withoutCatalog, 'load_readings')).toContain('nicht erfasst')
  })

  it('sagt bei leerem Katalog, dass für die Kategorie kein Speicher freigegeben ist (K3d)', () => {
    const table = buildBasisChapter({
      title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
      subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
      period: null,
      printedAt: '23.09.2026',
      analysis: {
        ...ANALYSIS,
        recommendation: null,
        noRecommendationReason: 'no_candidates',
        assumptions: { ...ANALYSIS.assumptions, roundTripEfficiency: null },
      },
      loadProfile: LOAD_PROFILE,
      tariffSource: TARIFF_SOURCE_UNTRACKED,
      tariffVintage: null,
    }).dataSources

    expect(vintageOf(table, 'battery_device')).toContain(
      'Für diese Kundenkategorie ist noch kein Speicher im Katalog freigegeben.',
    )
    expect(vintageOf(table, 'battery_device')).not.toContain('führt weder')
  })

  it('beschreibt den Bestandsspeicher als eigenes Gerät mit Kundenangaben (H3)', () => {
    const own = BATTERY_ANALYSIS.perBattery[0]!
    const table = buildBasisChapter({
      title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
      subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
      period: null,
      printedAt: '23.09.2026',
      analysis: {
        ...BATTERY_ANALYSIS,
        existingBatteryAnalysis: { entry: own, addonScenarios: [] },
      },
      loadProfile: LOAD_PROFILE,
      tariffSource: TARIFF_SOURCE_UNTRACKED,
      tariffVintage: null,
    }).dataSources

    expect(vintageOf(table, 'battery_device')).toContain('Ihr eigener Speicher')
    expect(vintageOf(table, 'battery_device')).toContain('nach Ihren Angaben')
    expect(vintageOf(table, 'battery_device')).not.toContain('führt weder')
  })

  it('weist den Listenpreis bei Privatkunden inkl. USt aus, bei Betrieben netto (H3)', () => {
    const base: PdfReportInput = {
      title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
      subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
      period: null,
      printedAt: '23.09.2026',
      analysis: BATTERY_ANALYSIS,
      loadProfile: LOAD_PROFILE,
      tariffSource: TARIFF_SOURCE_UNTRACKED,
      tariffVintage: null,
      batteryCatalogMeta: {
        'ps-c60': {
          memodoId: null,
          priceAsOf: '2026-09-01',
          rteSource: 'datenblatt',
          listPriceNet: 25200,
        },
      },
    }
    const net = buildBasisChapter(reportInputForDisplay(base)).dataSources
    const gross = buildBasisChapter(
      reportInputForDisplay({ ...base, priceDisplay: 'gross' }),
    ).dataSources

    expect(vintageOf(net, 'battery_device')).toContain(
      'Hardware-Listenpreis netto, exkl. Installation',
    )
    expect(vintageOf(gross, 'battery_device')).toContain(
      'Hardware-Listenpreis inkl. 20 % USt, exkl. Installation',
    )
  })

  it('nennt am Wirkungsgrad die Herkunft aus dem Katalog (K3d)', () => {
    const { assumptions } = buildBasisChapter({
      title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
      subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
      period: null,
      printedAt: '23.09.2026',
      analysis: BATTERY_ANALYSIS,
      loadProfile: LOAD_PROFILE,
      tariffSource: TARIFF_SOURCE_UNTRACKED,
      tariffVintage: null,
      batteryCatalogMeta: {
        'ps-c60': { memodoId: null, priceAsOf: null, rteSource: 'annahme', listPriceNet: 25200 },
      },
    })

    expect(
      assumptions.rows.find((row) => row.label === 'Wirkungsgrad (PeakStore C60)')?.value,
    ).toMatch(/\(angenommen\)$/)
  })
})

/**
 * D9 — die Tarifkomponenten-Tabelle.
 *
 * Geprüft wird an den ZELLEN über `buildBasisChapter`: der Fehler, der hier droht, ist eine 0, die
 * als Wert dasteht, wo nichts angegeben wurde — und der ist nur am fertigen Text sichtbar.
 */
function analysisWithSupplierFee(supplierFeeEurPerMonth: number): PdfReportAnalysis {
  return {
    ...ANALYSIS,
    tariffOptimization: {
      computable: true,
      monthlyComparison: {
        currentTariffEur: Array(12).fill(100),
        spotWithoutControlEur: Array(12).fill(90),
        spotWithBatteryEur: Array(12).fill(85),
        coveredMonths: 12,
        fixedCosts: {
          networkBaseFeeEur: 240,
          meteringFeeEur: 0,
          eagFlatFeeEur: 0,
          usageChargeOnFixedEur: 0,
          supplierBaseFeeEur: supplierFeeEurPerMonth * 12,
          awattarBaseFeeEur: 65.88,
          supplierFeeEurPerMonth,
          awattarFeeEurPerMonth: 5.49,
          coveredDays: 365,
        },
      },
    },
  }
}

/** Möglichst viele gesetzte Felder: Monatsvergleich mit Grundgebühr, dazu eine Tarifauswahl. */
const FULL_ANALYSIS: PdfReportAnalysis = analysisWithSupplierFee(5.99)

function componentsFor(analysis: PdfReportAnalysis, tariffSource: PdfReportTariffSource) {
  return buildBasisChapter({
    title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
    subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
    period: '01.01.2025 – 31.12.2025',
    printedAt: '17.09.2026',
    analysis,
    loadProfile: LOAD_PROFILE,
    tariffSource,
    tariffVintage: null,
  }).tariffComponents
}

/** Eine Zeile als `[Position, Wert, Status]` — oder `undefined`, wenn sie fehlt. */
function componentRow(
  table: ReturnType<typeof componentsFor>,
  key: string,
): ReportText[] | undefined {
  return table.rows.find((row) => row.key === key)?.cells
}

describe('buildBasisChapter — Tarifkomponenten-Tabelle (D9)', () => {
  it('führt jedes erreichbare Feld als eigene Zeile, mit Wert und Herkunft', () => {
    const table = componentsFor(FULL_ANALYSIS, REAL_REF)

    expect(table.columns.map((column) => column.label)).toEqual(['Position', 'Wert', 'Status'])
    expect(table.rows.map((row) => row.key)).toEqual([
      'tariff_leistungspreis',
      'tariff_billing_model',
      'tariff_energy_price',
      'tariff_einspeiseverguetung',
      'tariff_supplier_fee',
      'tariff_netzebene',
    ])

    // 331,68 € ÷ (48 kW ÷ 12) = 82,92 €/kW·a — zurückgerechnet, nicht geraten.
    expect(componentRow(table, 'tariff_leistungspreis')?.[1]).toBe('€ 82,92 / kW·a')
    expect(componentRow(table, 'tariff_leistungspreis')?.[2]).toBe(
      'Vorgabewert aus Stand „Wiener Netze 2026"',
    )
    // Menschenlesbar, über die bestehende Übersetzung — keine rohe Kennung im Kundendokument.
    expect(componentRow(table, 'tariff_billing_model')?.[1]).toBe('Summe der 12 Monatshöchstwerte')
    expect(componentRow(table, 'tariff_supplier_fee')?.[1]).toBe('€ 5,99 / Monat')
    expect(componentRow(table, 'tariff_netzebene')).toEqual([
      'Netzebene',
      '6',
      'aus der Tarifauswahl (Wiener Netze)',
    ])
  })

  it('nennt die Herkunft je Feld und markiert ein überschriebenes als selbst eingetragen', () => {
    const table = componentsFor(FULL_ANALYSIS, {
      ...REAL_REF,
      overriddenFields: ['leistungspreisEurPerKwYear'],
    })

    expect(componentRow(table, 'tariff_leistungspreis')?.[2]).toBe(
      'selbst eingetragen — abweichend vom Stand „Wiener Netze 2026"',
    )
    expect(componentRow(table, 'tariff_billing_model')?.[2]).toBe(
      'Vorgabewert aus Stand „Wiener Netze 2026"',
    )
    expect(componentsFor(FULL_ANALYSIS, null).rows[0]?.cells[2]).toBe(
      'unverändert aus Ihrer Eingabe (Netzrechnung)',
    )
    expect(componentsFor(FULL_ANALYSIS, TARIFF_SOURCE_UNTRACKED).rows[0]?.cells[2]).toBe(
      'Herkunft nicht im Einzelnen nachverfolgt',
    )
  })

  /**
   * Der eigentliche Punkt der Übung (§3.9): eine nicht erfasste Grundgebühr wird intern als 0
   * gerechnet — als Wert gedruckt behauptete die 0 einen Tarif ohne Grundgebühr.
   */
  it('schreibt „keine Angabe" statt einer 0 und lässt nicht erreichte Felder ganz weg', () => {
    const table = componentsFor(analysisWithSupplierFee(0), REAL_REF)
    const fee = componentRow(table, 'tariff_supplier_fee')
    expect(fee?.[1]).toBe('keine Angabe')
    expect(fee?.[1]).not.toContain('0')
    expect(fee?.[2]).toBe('nicht erfasst — im Tarifvergleich mit 0 gerechnet')

    // Nur die fünf Pflichtfelder: kein Monatsvergleich, keine Tarifauswahl → beide Zeilen fehlen,
    // und zwar ohne Ersatz-„keine Angabe" — sie haben diesen Render-Lauf nie erreicht.
    const bare = componentsFor(ANALYSIS, TARIFF_SOURCE_UNTRACKED)
    expect(bare.rows.map((row) => row.key)).toEqual([
      'tariff_leistungspreis',
      'tariff_billing_model',
      'tariff_energy_price',
      'tariff_einspeiseverguetung',
    ])
    expect(bare.rows.flatMap((row) => row.cells)).not.toContain('keine Angabe')
  })

  /**
   * Die drei Zeilen, die es vor D9 schon gab, sind ZEICHENGLEICH umgezogen — und sie stehen nicht
   * zusätzlich weiter oben in der Annahmen-Tabelle.
   */
  it('trägt die drei bestehenden Werte unverändert und genau einmal', () => {
    const chapter = buildBasisChapter({
      title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
      subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
      period: '01.01.2025 – 31.12.2025',
      printedAt: '17.09.2026',
      analysis: ANALYSIS,
      loadProfile: LOAD_PROFILE,
      tariffSource: TARIFF_SOURCE_UNTRACKED,
      tariffVintage: null,
    })

    expect(componentRow(chapter.tariffComponents, 'tariff_billing_model')?.slice(0, 2)).toEqual([
      'Abrechnungsmodell',
      'Summe der 12 Monatshöchstwerte',
    ])
    expect(componentRow(chapter.tariffComponents, 'tariff_energy_price')?.slice(0, 2)).toEqual([
      'Arbeitspreis',
      '€ 0,25 / kWh',
    ])
    expect(
      componentRow(chapter.tariffComponents, 'tariff_einspeiseverguetung')?.slice(0, 2),
    ).toEqual(['Einspeisevergütung', '€ 0,07 / kWh'])

    expect(chapter.assumptions.rows.map((row) => row.label)).toEqual(['Betrachtungshorizont'])
  })
})

/**
 * D9 — Berechnungsmethodik je Kennzahl und die bekannten Einschränkungen.
 *
 * ⚠ Geprüft wird an der ZUSAMMENSETZUNG der Liste und nicht an einem Wortlaut: der Fehler, der hier
 * droht, ist ein Absatz zu einer Kennzahl, die dieser Report gar nicht zeigt — eine Methodik ohne
 * Zahl schickt den Leser auf die Suche nach etwas, das es nicht gibt.
 */
const PROJECTION: NonNullable<PdfReportAnalysis['annualProjection']> = {
  currentTariffEur: { measuredEur: 9000, projectedEur: 4000, totalEur: 13000 },
  spotWithoutControlEur: { measuredEur: 8200, projectedEur: 3600, totalEur: 11800 },
  windowFromDate: '2025-01-01',
  windowToDate: '2025-12-31',
  measuredDays: 209,
  projectedDays: 156,
  consumption: {
    method: 'winter_reference',
    missingDays: 156,
    referenceRateKwhPerDay: 480,
    referenceSegments: [],
    estimatedAnnualConsumptionKwh: 175000,
  },
  marketPrices: {
    coverage: [],
    hoursByOrigin: { database: 0, fetched: 0, assumed: 0 },
    missingRanges: [],
  },
}

function basisFor(
  analysis: PdfReportAnalysis,
  pv?: Pick<PdfReportInput, 'hasPv' | 'pvOutageMonths'>,
) {
  return buildBasisChapter({
    title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
    subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
    period: '01.01.2025 – 31.12.2025',
    printedAt: '17.09.2026',
    analysis,
    loadProfile: LOAD_PROFILE,
    tariffSource: TARIFF_SOURCE_UNTRACKED,
    tariffVintage: null,
    ...pv,
  })
}

/** Tarifvergleich berechenbar UND ein durchgerechneter Speicher — der volle Fall. */
const FULL_WITH_BATTERY: PdfReportAnalysis = {
  ...FULL_ANALYSIS,
  perBattery: BATTERY_ANALYSIS.perBattery,
  recommendation: BATTERY_ANALYSIS.recommendation,
}

/**
 * Fünf Wege: derselbe volle Fall, zusätzlich mit dem selbst gefundenen Vergleichstarif. Der
 * Leistungspreis-Weg steckt bereits in `BATTERY_ANALYSIS` (`leistungspreisSavingPerYear: 995`).
 */
const FIVE_WAYS: PdfReportAnalysis = {
  ...FULL_WITH_BATTERY,
  tariffOptimization: {
    computable: true,
    monthlyComparison: {
      ...(FULL_WITH_BATTERY.tariffOptimization as { monthlyComparison: MonthlyTariffComparison })
        .monthlyComparison,
      comparisonTariffEur: Array(12).fill(95),
      comparisonSupplier: 'ENSTROGA',
    },
  },
}

/**
 * Die Berechnungsmethodik: EIN gemeinsamer Absatz, darunter je aktivem Weg eine Zeile.
 *
 * ⚠ DIE EIGENTLICHE PROBE IST DIE LETZTE. Die Liste stammt aus derselben Quelle wie das
 * Wege-Kapitel selbst (`methodNotes`, `ways.ts`); dass sie mitwächst, ist damit keine Absprache,
 * sondern Bauart — und genau das misst der Vergleich der Titel gegen das Kapitel.
 */
describe('buildBasisChapter — Berechnungsmethodik je Kennzahl (D9)', () => {
  it('führt bei fünf aktiven Wegen alle fünf Kurzeinträge, keiner fehlt', () => {
    const chapter = basisFor(FIVE_WAYS, { hasPv: true, pvOutageMonths: OUTAGE_MONTHS })

    expect(chapter.methodPerMetric.map((item) => item.id)).toEqual([
      'method_shared',
      'method_ways_current',
      'method_ways_comparison_tariff',
      'method_ways_tariff_switch',
      'method_ways_load_control',
      'method_ways_peak_shaving',
      'method_pv_outage',
    ])

    /* Der gemeinsame Absatz trägt die geteilte Rechnung — einmal, und nirgends sonst. */
    const shared = chapter.methodPerMetric.find((i) => i.id === 'method_shared')
    expect(shared?.kind).toBe('text')
    expect(shared?.body).toContain('DERSELBEN Rechnung, Viertelstunde für Viertelstunde')
    expect(shared?.body).toContain('tagesanteilig')
    expect(shared?.body).toContain('Leistungspreis steht in keiner dieser Zahlen')

    /* Die Schwelle ist das MITTEL des jeweiligen Kalendertags — nicht die des ganzen Zeitraums. */
    const loadControl = chapter.methodPerMetric.find((i) => i.id === 'method_ways_load_control')
    expect(loadControl?.body).toContain('arithmetischen Mittel')
    expect(loadControl?.body).toContain('ihres eigenen Kalendertags')

    /*
     * ⚠ Die Kappung ist KEINE Zeile der Aufzählung: sie ist keine Viertelstunden-Grösse, und der
     * Renderer setzt `text` deshalb als eigenen Absatz. Die vier Wege davor sind `way`.
     */
    const kinds = Object.fromEntries(chapter.methodPerMetric.map((i) => [i.id, i.kind]))
    expect(kinds['method_ways_peak_shaving']).toBe('text')
    expect(kinds['method_ways_tariff_switch']).toBe('way')
    expect(
      chapter.methodPerMetric.find((i) => i.id === 'method_ways_peak_shaving')?.body,
    ).toContain('NICHT aus der Viertelstunden-Rechnung')
  })

  /**
   * Der Titel des Methodik-Absatzes folgt derselben Singular/Plural-Regel wie der Hinweis selbst
   * (`pvOutageTitle`, beide aus `months.length`) — bisher stand hier immer der Plural.
   */
  it('folgt bei einem einzelnen Ausfallmonat derselben Singular-Fassung wie der Hinweis', () => {
    const chapter = basisFor(FULL_WITH_BATTERY, {
      hasPv: true,
      pvOutageMonths: OUTAGE_MONTHS.slice(0, 1),
    })

    expect(chapter.pvOutage?.title).toBe('Ein Monat ohne erkennbaren PV-Beitrag')
    expect(chapter.methodPerMetric.find((i) => i.id === 'method_pv_outage')?.title).toBe(
      'Ein Monat ohne erkennbaren PV-Beitrag',
    )
  })

  it('lässt weg, was dieser Report nicht zeigt — bis hin zur leeren Liste', () => {
    /*
     * Der Urbanz-Zuschnitt: kein Vergleichstarif und kein Leistungspreis-Weg (ohne Speicher gibt
     * es keine Kappung) — drei Wege, drei Zeilen, und kein Eintrag zu einem Weg, den das Kapitel
     * gar nicht führt.
     */
    expect(basisFor(FULL_ANALYSIS).methodPerMetric.map((item) => item.id)).toEqual([
      'method_shared',
      'method_ways_current',
      'method_ways_tariff_switch',
      'method_ways_load_control',
    ])
    /* Ohne berechenbaren Vergleich bleibt nichts übrig — dann entfällt auch die Überschrift. */
    expect(basisFor(BATTERY_ANALYSIS).methodPerMetric).toEqual([])
  })

  /*
   * ⚠ DIE PROBE, UM DIE ES GEHT. Sie misst nicht eine Liste gegen eine erwartete, sondern gegen
   * DAS WEGE-KAPITEL: jeder Weg, den das Kapitel führt, hat hier genau einen Eintrag, mit
   * wortgleichem Titel und in derselben Reihenfolge. Ein künftiger sechster Weg erscheint damit
   * von selbst — `basis.ts` zählt die Wege nicht auf und kann sie folglich auch nicht vergessen.
   */
  it('folgt dem Wege-Kapitel Weg für Weg, ohne eigene Aufzählung', () => {
    for (const analysis of [FULL_ANALYSIS, FULL_WITH_BATTERY, FIVE_WAYS]) {
      const ways = buildWaysChapter(analysis)!
      const items = basisFor(analysis).methodPerMetric

      expect(items.at(0)?.id).toBe('method_shared')
      expect(items.slice(1).map((item) => item.title)).toEqual(
        ways.statements.map((statement) => statement.title),
      )
      expect(items).toHaveLength(1 + ways.wayCount)
    }
  })
})

describe('buildBasisChapter — Bekannte Einschränkungen (D9)', () => {
  it('steht in jedem Report und nennt die Hochrechnung nur, wo es eine gibt', () => {
    for (const analysis of [ANALYSIS, FULL_ANALYSIS, FULL_WITH_BATTERY]) {
      const { limitations } = basisFor(analysis)
      expect(limitations.id).toBe('limitations')
      expect(limitations.tone).toBe('neutral')
      expect(limitations.hints[0]).toContain('netto')
      expect(limitations.hints.join(' ')).toContain('Tarifkomponenten')
      // Unverdrahtet (D4/D10): der mittlere Punkt erscheint heute in keinem Report.
      expect(limitations.hints.join(' ')).not.toContain('Jahres-Hochrechnung')
    }

    const projected = basisFor({ ...FULL_WITH_BATTERY, annualProjection: PROJECTION }).limitations
    expect(projected.hints).toHaveLength(3)
    expect(projected.hints[1]).toContain('kältesten verfügbaren Zeitraum')
  })

  it('weist die ohne Standort angenommene Wiener Gebrauchsabgabe aus — und nur dann', () => {
    const assumed = basisFor({
      ...FULL_ANALYSIS,
      assumptions: { ...FULL_ANALYSIS.assumptions, levyLocationAssumed: 'vienna' },
    }).limitations
    expect(assumed.hints.join(' ')).toContain('Gebrauchsabgabe Wien angenommen — Standort nicht angegeben')
    expect(basisFor(FULL_ANALYSIS).limitations.hints.join(' ')).not.toContain('angenommen')
  })
})
