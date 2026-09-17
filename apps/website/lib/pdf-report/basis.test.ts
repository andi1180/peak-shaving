import { describe, expect, it } from 'vitest'
import type { PvOutageMonth } from 'engine'
import type { LoadProfile, NetzbetreiberId, TariffSourceRef } from 'shared'

import { buildBasisChapter } from './basis'
import { TARIFF_SOURCE_UNTRACKED } from './types'
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
    leistungspreisCostPerYear: 3980.16,
  },
  perBattery: [],
  recommendation: { batteryId: 'keiner', rationale: 'leerer Katalog' },
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
      'Tarifsätze: kein hinterlegter Stand gewählt — Leistungspreis, Abrechnungsmodell und ' +
        'Mindestleistung stammen unverändert aus Ihrer Eingabe.',
    )
    expect(chapterFor(REAL_REF).tariffSource).toBe(
      'Tarifsätze: Wiener Netze, Netzebene 6 · Stand „Wiener Netze 2026", gültig ab 2026-01-01. ' +
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
      'Tarifsätze: Herkunft für diese Auswertung nicht im Einzelnen nachverfolgt — gerechnet ' +
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

function pvChapterFor(hasPv: boolean | undefined, pvOutageMonths: PvOutageMonth[] | undefined) {
  const input: PdfReportInput = {
    title: 'Wirtschaftlichkeitsanalyse Batteriespeicher',
    subtitle: 'Auf Basis Ihres Viertelstunden-Lastgangs',
    period: '01.01.2025 – 31.12.2025',
    printedAt: '17.09.2026',
    analysis: ANALYSIS,
    loadProfile: LOAD_PROFILE,
    tariffSource: TARIFF_SOURCE_UNTRACKED,
    tariffVintage: null,
    hasPv,
    pvOutageMonths,
  }
  return buildBasisChapter(input)
}

describe('buildBasisChapter — Monate ohne erkennbaren PV-Beitrag (D5)', () => {
  it('nennt die betroffenen Monate, wenn eine Anlage angegeben ist und Monate erkannt wurden', () => {
    const { pvOutage } = pvChapterFor(true, OUTAGE_MONTHS)

    expect(pvOutage?.id).toBe('pv_outage')
    expect(pvOutage?.list?.items).toEqual(['Februar 2025', 'März 2025'])
    // Beobachtung über den Zeitraum — ausdrücklich keine Aussage über die Anlage von heute.
    expect(pvOutage?.hints.join(' ')).toContain('keine Aussage über den heutigen Zustand')
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
      totalInvestment: 25200,
      subsidyAmount: 0,
      taxBenefit: 0,
      taxEffectsIncluded: false,
      netInvestment: 25200,
      amortizationYears: 25.3,
      netSavingOverHorizon: 0,
    },
  ],
  recommendation: { batteryId: 'ps-c60', rationale: 'bester ROI' },
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

/** Die dritte Spalte („Zeitraum / Stand") einer Zeile — dort steht jede Herkunftsangabe. */
function vintageOf(table: ReturnType<typeof dataSourcesFor>, key: string): string {
  return table.rows.find((row) => row.key === key)?.cells[2] ?? ''
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
    expect(vintageOf(withDevice, 'battery_device')).toContain('keine Herkunfts- oder Preisquelle')

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
})
