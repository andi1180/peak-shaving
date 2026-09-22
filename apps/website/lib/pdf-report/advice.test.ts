import { describe, expect, it } from 'vitest'
import type {
  AddonBatteryScenario,
  BatteryRoiEntry,
  LoadProfile,
  MonthlyTariffComparison,
  PvValueScenario,
} from 'shared'

import { buildAdviceChapter, hasAdviceChapter } from './advice'
import { buildReportContext } from './context'
import { buildReportLayout } from './layout'
import { buildReportRegistry } from './registry'
import { statementPoints } from './statement'
import { resolveReportText, type ReportLayout } from './report-text'
import { TARIFF_SOURCE_UNTRACKED } from './types'
import type { PdfReportAnalysis, PdfReportInput } from './types'

/**
 * Das Kapitel „Unser Vorschlag".
 *
 * Gemessen wird die eine Eigenschaft, die es hat und die kein anderes Kapitel teilt: JEDER Punkt
 * steht einzeln unter Bedingung, und was entfällt, entfällt ersatzlos — ohne Lücke in der
 * Nummerierung. Die Beträge selbst sind anderswo gemessen (sie kommen aus `summaryWaysOf` und
 * `comparisonSelection` und werden hier nicht neu gerechnet).
 */

const MONTHS = (first: number): (number | null)[] => [first, ...Array<null>(11).fill(null)]

function comparisonWith(args: {
  current: number
  comparison: number
  spot: number
  battery: number
}): MonthlyTariffComparison {
  return {
    currentTariffEur: MONTHS(args.current),
    comparisonTariffEur: MONTHS(args.comparison),
    comparisonSupplier: 'ENSTROGA',
    spotWithoutControlEur: MONTHS(args.spot),
    spotWithBatteryEur: MONTHS(args.battery),
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
      coveredDays: 209,
    },
  }
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

function entryWith(netSavingOverHorizon: number): BatteryRoiEntry {
  return {
    battery: BATTERY,
    newBilledKw: 40,
    leistungspreisSavingPerYear: 0,
    selfConsumptionSavingPerYear: 300,
    loadShiftSavingPerYear: 100,
    selfConsumptionSavingOverCoveredPeriod: 300,
    loadShiftSavingOverCoveredPeriod: 100,
    annualizationFactor: 1,
    coveredDays: 209,
    totalSavingPerYear: 400,
    warnings: [],
    totalInvestment: 21000,
    subsidyAmount: 0,
    taxBenefit: 0,
    taxEffectsIncluded: false,
    netInvestment: 21000,
    amortizationYears: 52.5,
    netSavingOverHorizon,
    dispatchTrace: undefined as unknown as BatteryRoiEntry['dispatchTrace'],
  }
}

/** Ein Zusatzszenario, das sich NICHT rechnet — der „Nein"-Zweig der Gerätewahl. */
const ADDON_NEGATIVE: AddonBatteryScenario = {
  ...entryWith(-5388),
  combined: { ...BATTERY, id: 'combined', usableCapacityKwh: 79.2 },
}

const PV_VALUE: PvValueScenario = {
  coveredDays: 209,
  measured: { withPvEur: 1000, withoutPvEur: 1400, valueEur: 400 },
  annual: null,
  months: [
    { year: 2026, month: 2, selfConsumptionKwh: null, outage: true },
    { year: 2026, month: 3, selfConsumptionKwh: 240, outage: false },
  ],
  estimatedGenerationKwh: 240,
}

const LOAD_PROFILE: LoadProfile = {
  readings: [{ ts: '2026-02-03T07:15:00.000Z', gridPowerKw: 12 }],
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Vienna',
  source: 'import_only',
}

function analysisWith(args: {
  comparison?: MonthlyTariffComparison
  existing?: boolean
  pvValue?: PvValueScenario
}): PdfReportAnalysis {
  const entry = entryWith(4200)
  return {
    current: {
      annualPeakKw: 13.5,
      monthlyPeaksKw: Array<number>(12).fill(13.5),
      billedKw: 13.5,
      leistungspreisCostPerYear: 0,
    },
    perBattery: [entry, { ...entry, battery: { ...BATTERY, id: 'kat-2', name: 'Katalog 2' } }],
    recommendation: { batteryId: BATTERY.id, rationale: '' },
    assumptions: {
      roundTripEfficiency: 0.9,
      horizonYears: 10,
      energyPriceCtPerKwh: 13.08,
      einspeiseverguetungCtPerKwh: 4.56,
      billingModel: 'monthly_max_sum',
    },
    dataQuality: {
      coveredDays: 209,
      coveredMonths: 8,
      gapsInterpolated: 0,
      largestGapSlots: 0,
      warnings: [],
    },
    ...(args.comparison
      ? { tariffOptimization: { computable: true, monthlyComparison: args.comparison } }
      : {}),
    ...(args.existing
      ? { existingBatteryAnalysis: { entry, addonScenarios: [ADDON_NEGATIVE] } }
      : {}),
    ...(args.pvValue ? { pvValue: args.pvValue } : {}),
  }
}

function inputFor(analysis: PdfReportAnalysis, overrides?: Partial<PdfReportInput>): PdfReportInput {
  return {
    title: 'Prüffall',
    subtitle: 'Unser Vorschlag',
    period: '30.01.2026 – 26.08.2026',
    printedAt: '22.09.2026',
    analysis,
    loadProfile: LOAD_PROFILE,
    tariffSource: TARIFF_SOURCE_UNTRACKED,
    tariffVintage: null,
    ...overrides,
  }
}

/** Die echte Beschreibung des zusammengestellten Dokuments — dagegen lösen die Verweise auf. */
function layoutFor(input: PdfReportInput): ReportLayout {
  const context = buildReportContext(input)
  return buildReportLayout(input, context, buildReportRegistry(input, context))
}

/**
 * Die Punkte, wie das Dokument sie setzt: aufgelöst und um die leeren gekürzt.
 *
 * ⚠ Die Texte kommen als `Record` und nicht als Feld: ein Index wäre die Reihenfolge, und genau
 * die ändert sich in diesen Proben von Fall zu Fall (das ist ja der Gegenstand). Über den Titel
 * angesprochen schlägt ein fehlender Punkt als fehlender Schlüssel auf, nicht als verschobener
 * Vergleich, der zufällig noch passt.
 */
function textsOf(input: PdfReportInput): Record<string, string> {
  return Object.fromEntries(pointsOf(input).map((point) => [point.title, point.text]))
}

function pointsOf(input: PdfReportInput): { title: string; text: string }[] {
  const proposal = buildAdviceChapter(input).proposal
  if (!proposal) return []
  return statementPoints(proposal, layoutFor(input)).map((point) => ({
    title: point.title,
    text: point.segments.map((segment) => segment.text).join(''),
  }))
}

describe('Kapitel „Unser Vorschlag" — Abschnitt „Was wir vorschlagen"', () => {
  /*
   * Der Urbanz-Zuschnitt: der selbst gefundene Vergleichstarif ist TEURER, aWATTar ohne Steuerung
   * günstiger, die Ladesteuerung noch günstiger, ein Bestandsspeicher mit „Nein"-Verdikt, und der
   * PV-Beitrag ist rekonstruiert statt gemessen. Alle vier Punkte treffen zu.
   */
  it('nennt den günstigeren der beiden einfachen Wege und führt alle vier Punkte', () => {
    const input = inputFor(
      analysisWith({
        comparison: comparisonWith({ current: 1000, comparison: 1100, spot: 900, battery: 800 }),
        existing: true,
        pvValue: PV_VALUE,
      }),
    )
    const points = pointsOf(input)

    expect(points.map((p) => p.title)).toEqual([
      'Wollen Sie es einfach halten',
      'Wollen Sie das Maximum',
      'Zusätzlicher Speicher',
      'Für eine noch genauere Zahl',
    ])

    const texts = textsOf(input)

    /* Punkt 1 ist Weg 3 und nicht Weg 2: der Vergleichstarif kostet hier MEHR. */
    expect(texts['Wollen Sie es einfach halten']).toContain('aWATTar')
    expect(texts['Wollen Sie es einfach halten']).not.toContain('ENSTROGA')
    /* 1000 − 900, über die 209 gemessenen Tage — nicht als Jahreszahl. */
    expect(texts['Wollen Sie es einfach halten']).toContain('€ 100')
    expect(texts['Wollen Sie es einfach halten']).toContain('209 gemessenen Tage')

    /* Punkt 2 ist die Ladesteuerung und liegt über Punkt 1 (1000 − 800). */
    expect(texts['Wollen Sie das Maximum']).toContain('bis zu € 200')

    /* Punkt 3 zeigt auf das Kapitel, in dem die Antwort steht — kein zweites „Nein" mit Zahlen. */
    expect(texts['Zusätzlicher Speicher']).toBe(
      'Nicht nötig — das ist bereits geklärt: die Antwort samt Begründung steht im Kapitel ' +
        '„Speichergrösse und Gerätewahl".',
    )

    expect(texts['Für eine noch genauere Zahl']).toContain('Einspeisedaten')
  })

  /*
   * ⚠ DER WÄCHTER GEGEN DAS LEISTUNGSVERSPRECHEN. Das Zielbild sagt an Punkt 2 „Wir bieten diese
   * Steuerung als eigenes Service an und richten sie für Ihre Batterie ein" — eine Zusage, die
   * niemand bestätigt hat. Sie darf in keinem Punkt dieses Kapitels entstehen.
   */
  it('verspricht kein Steuerungs-Service', () => {
    const input = inputFor(
      analysisWith({
        comparison: comparisonWith({ current: 1000, comparison: 1100, spot: 900, battery: 800 }),
        existing: true,
        pvValue: PV_VALUE,
      }),
    )
    const text = pointsOf(input)
      .map((p) => p.text)
      .join(' ')

    expect(text).not.toMatch(/wir bieten/i)
    expect(text).not.toMatch(/richten .* ein/i)
    expect(text).toContain('Sprechen Sie uns an')
  })

  /*
   * Kein Tarifweg spart etwas, und die Ladesteuerung bleibt ebenfalls über den heutigen Kosten.
   * Punkt 1 UND 2 entfallen — die übrigen rücken auf und werden ab 1 gezählt (die Nummern entstehen
   * beim Rendern aus der Reihenfolge, s. `statementPoints`).
   */
  it('lässt Punkt 1 und 2 entfallen, wenn kein Weg etwas spart', () => {
    const input = inputFor(
      analysisWith({
        comparison: comparisonWith({ current: 900, comparison: 1000, spot: 1100, battery: 1000 }),
        existing: true,
        pvValue: PV_VALUE,
      }),
    )

    expect(pointsOf(input).map((p) => p.title)).toEqual([
      'Zusätzlicher Speicher',
      'Für eine noch genauere Zahl',
    ])
  })

  /*
   * Katalog-Fall: kein Bestandsspeicher, also stellt das Kapitel „Speichergrösse und Gerätewahl"
   * die Zusatzspeicher-Frage gar nicht (`variant === 'catalog'`) — und der Punkt entfällt, statt
   * die Katalog-Empfehlung ein zweites Mal zu behaupten. Ohne PV-Rekonstruktion entfällt auch
   * Punkt 4.
   */
  it('lässt Punkt 3 entfallen, wo es keinen Bestandsspeicher gibt', () => {
    const input = inputFor(
      analysisWith({
        comparison: comparisonWith({ current: 1000, comparison: 1100, spot: 900, battery: 800 }),
      }),
    )

    expect(pointsOf(input).map((p) => p.title)).toEqual([
      'Wollen Sie es einfach halten',
      'Wollen Sie das Maximum',
    ])
  })
})

describe('Kapitel „Unser Vorschlag" — Abschnitt „Woher diese Zahlen stammen"', () => {
  /* Jeder Satz nur, wenn die Angabe dahinter belegt ist — und kein Satz über PV ohne PV-Kapitel. */
  it('nennt nur die belegten Quellen', () => {
    const input = inputFor(
      analysisWith({
        comparison: comparisonWith({ current: 1000, comparison: 1100, spot: 900, battery: 800 }),
      }),
      {
        /* `null` ist die Aussage „aus eigener Eingabe", nicht die Abwesenheit einer Angabe. */
        tariffSource: null,
        netzbetreiber: 'wiener_netze',
        tariffProvenance: { gridTariffValidFrom: ['2026-01-01'], invoicePeriods: [] },
      },
    )
    const provenance = buildAdviceChapter(input).provenance
    const body = resolveReportText(provenance!.body, layoutFor(input), provenance!.id)

    expect(body).toContain('aus Ihren eigenen Angaben')
    expect(body).toContain('Wiener Netze')
    expect(body).toContain('gültig ab 01.01.2026')
    expect(body).toContain('EAG-Förderbeitrag')
    expect(body).toContain('historischen Stundenpreise')
    /* Ohne PV-Kapitel kein Satz über die Rekonstruktion. */
    expect(body).not.toContain('PVGIS')
  })

  /*
   * ⚠ DAS KAPITEL IST BEDINGT: ohne berechenbaren Tarifvergleich (keine Wege, keine Abgaben, keine
   * Börsenpreise), ohne nachverfolgte Tarifherkunft, ohne Bestandsspeicher und ohne PV bleibt
   * nichts zu sagen — dann entfällt es samt Agenda-Eintrag statt als leere Seite dazustehen.
   */
  it('entfällt ganz, wo es weder Vorschlag noch belegte Quelle gibt', () => {
    const input = inputFor(analysisWith({}))

    expect(buildAdviceChapter(input)).toEqual({ proposal: null, provenance: null })
    expect(hasAdviceChapter(input)).toBe(false)
  })
})
