import path from 'node:path'
import { createElement as h } from 'react'
import { describe, expect, it } from 'vitest'
import { Font, renderToBuffer } from '@react-pdf/renderer'
import type { PvOutageMonth } from 'engine'
import type {
  AddonBatteryScenario,
  BatteryCandidate,
  BatteryRoiEntry,
  DispatchTrace,
  LoadProfile,
  MonthlyTariffComparison,
} from 'shared'

import type { ReportChartRasters } from './charts'
import { buildReportContext } from './context'
import { ReportDocument } from './document'
import { buildReportLayout, reportBlockSelected } from './layout'
import { createPageNumberSink } from './page-numbers'
import { buildReportRegistry } from './registry'
import { resolveReportText } from './report-text'
import { TARIFF_SOURCE_UNTRACKED } from './types'
import type { PdfReportAnalysis, PdfReportInput } from './types'

/**
 * Stufe D — die ZWEITE Render-Fixture: ein Report mit Bestandsanlage.
 *
 * ── ⚠ WARUM ES SIE BRAUCHT ────────────────────────────────────────────────────────────────────
 * `optional-sections.test.ts` rendert einen KATALOG-Fall (keine Bestandsanlage). Von den 17
 * Fundstellen, die #279–#281 auf `ReportRef` umgestellt haben, löst er neun auf; die übrigen acht
 * liegen in Zweigen, die dieser Fall nie betritt — die Kassen-Fassung von `savings`
 * (`SavingsPlacement === 'cash'`, sie setzt eine Bestandsanlage voraus), die Bestandsrahmung der
 * Empfehlung, der Monatsvergleich im Detail-Kapitel und die Zusatzgeräte-Tabelle. Sie waren bis hierher allein über `report-text.test.ts` gegen von Hand
 * hingeschriebene Zusammenstellungen belegt. Was dort NICHT gemessen werden kann, ist, ob der Fall
 * im echten Dokument überhaupt entsteht: ein Verweis, dessen Zweig kein Report je betritt, ist
 * grün und trotzdem tot.
 *
 * ── DIE FALLGESTALT ───────────────────────────────────────────────────────────────────────────
 * Rekonstruiert aus dem Drei-Fälle-Harness der Optik-Bestandsaufnahme
 * (`Report_Baukasten_Optik_Bestandsaufnahme.md` §1.2): Fall A (Urbanz — Bestandsspeicher
 * 19,2 kWh / 10,6 kW, PV vorhanden, 209 abgedeckte Tage / 8 Monate, Tarifvergleich rechenbar) mit
 * dem sich rechnenden Zusatzgerät aus Fall C.
 *
 * ⚠ EINE BENANNTE ABWEICHUNG VON FALL A: der Leistungspreis ist hier > 0. Der Urbanz-Anschluss
 * hängt auf Netzebene 7 ohne Leistungsmessung und hat den Posten gar nicht — dann entfällt
 * `peak_shaving` vollständig (`summary.ts`), und mit ihm der erste der acht Verweise. Die
 * Fallgestalt ist übernommen, nicht die Netzebene.
 *
 * ⚠ DIE SCHRIFT WIRD AUS DEM DATEISYSTEM REGISTRIERT — s. `optional-sections.test.ts`.
 */
const FONT_DIR = path.resolve(import.meta.dirname, '../../public/report-fonts')
Font.register({
  family: 'Inter',
  fonts: [
    { src: `${FONT_DIR}/Inter-Regular.woff`, fontWeight: 400 },
    { src: `${FONT_DIR}/Inter-SemiBold.woff`, fontWeight: 600 },
    { src: `${FONT_DIR}/Inter-Bold.woff`, fontWeight: 700 },
  ],
})
Font.registerHyphenationCallback((word) => [word])

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Die Fixture
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const KAT1: BatteryCandidate = {
  id: 'kat-1',
  name: 'Katalog 1',
  manufacturer: 'Fixture',
  class: 'commercial',
  usableCapacityKwh: 60,
  maxPowerKw: 20,
  roundTripEfficiency: 0.9,
  pricePerKwh: 350,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic',
}

const KAT2: BatteryCandidate = { ...KAT1, id: 'kat-2', name: 'Katalog 2', usableCapacityKwh: 90 }

/** Die Anlage des Kunden — ihre EXAKTEN Werte, kein Katalog-Ersatz (`ExistingBatteryAnalysis`). */
const BESTAND: BatteryCandidate = {
  ...KAT1,
  id: 'bestand',
  name: 'Ihre Anlage',
  usableCapacityKwh: 19.2,
  maxPowerKw: 10.6,
}

const TRACE: DispatchTrace = {
  capKwByPeriod: [40],
  caughtPeaks: [{ ts: '2025-02-03T07:15:00.000Z', originalKw: 48, residualKw: 40, caught: true }],
  representativeDays: [],
  batteryFlowByHourMonth: Array.from({ length: 24 }, (_, hour) =>
    Array.from({ length: 12 }, (_, month) => (hour === 3 ? 4 + month : null)),
  ),
  monthlyChargePrice: {
    chargeCtPerKwh: [8, ...Array<null>(11).fill(null)],
    dischargeCtPerKwh: [22, ...Array<null>(11).fill(null)],
    averageCtPerKwh: [14, ...Array<null>(11).fill(null)],
    chargedKwh: [500, ...Array<null>(11).fill(null)],
    dischargedKwh: [420, ...Array<null>(11).fill(null)],
  },
}

/**
 * ⚠ `annualizationFactor > 1` ist Teil der Fallgestalt und nicht Beiwerk: 209 von 365 Tagen sind
 * die gemessene Abdeckung des Urbanz-Lastgangs, und an ihr hängt der Hochrechnungssatz von
 * `load_control` — einer der acht Verweise, die der Katalog-Fall nicht erreicht.
 */
function roiEntry(battery: BatteryCandidate, over: Partial<BatteryRoiEntry> = {}): BatteryRoiEntry {
  return {
    battery,
    newBilledKw: 40,
    leistungspreisSavingPerYear: 800,
    selfConsumptionSavingPerYear: 524,
    loadShiftSavingPerYear: 175,
    selfConsumptionSavingOverCoveredPeriod: 300,
    loadShiftSavingOverCoveredPeriod: 100,
    annualizationFactor: 365 / 209,
    coveredDays: 209,
    totalSavingPerYear: 1499,
    warnings: [],
    totalInvestment: 21000,
    subsidyAmount: 0,
    taxBenefit: 0,
    taxEffectsIncluded: false,
    netInvestment: 21000,
    amortizationYears: 14,
    netSavingOverHorizon: -6010,
    dispatchTrace: TRACE,
    ...over,
  }
}

function addonScenario(
  battery: BatteryCandidate,
  netSavingOverHorizon: number,
): AddonBatteryScenario {
  return {
    ...roiEntry(battery, { netSavingOverHorizon }),
    combined: {
      ...BESTAND,
      usableCapacityKwh: BESTAND.usableCapacityKwh + battery.usableCapacityKwh,
      maxPowerKw: BESTAND.maxPowerKw + battery.maxPowerKw,
    },
  }
}

const COMPARISON: MonthlyTariffComparison = {
  currentTariffEur: [1200, ...Array<null>(11).fill(null)],
  spotWithoutControlEur: [1100, ...Array<null>(11).fill(null)],
  spotWithBatteryEur: [950, ...Array<null>(11).fill(null)],
  coveredMonths: 8,
  fixedCosts: {
    networkBaseFeeEur: 0,
    supplierBaseFeeEur: 0,
    awattarBaseFeeEur: 4.79,
    supplierFeeEurPerMonth: 0,
    awattarFeeEurPerMonth: 4.79,
    coveredDays: 209,
  },
}

const LOAD_PROFILE: LoadProfile = {
  readings: [{ ts: '2025-02-03T07:15:00.000Z', gridPowerKw: 48 }],
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Vienna',
  source: 'net_signed',
}

const PV_OUTAGE_MONTHS: PvOutageMonth[] = [
  { year: 2026, month: 2, daysWithDayWindowData: 28, minDayWindowKw: 9.4 },
  { year: 2026, month: 3, daysWithDayWindowData: 31, minDayWindowKw: 8.1 },
]

/**
 * ⚠ `existingBatteryAnalysis` UND ein rechenbarer `tariffOptimization` — erst beide zusammen
 * ergeben die Kassen-Fassung von `savings` (`isRealSavingsComparison`), an der fünf der acht
 * Verweise hängen. Und `addonScenarios` trägt genau EIN Gerät über der Schwelle
 * `netSavingOverHorizon > 0`: das ist der positive `addon`-Zweig samt Zusatzgeräte-Tabelle.
 */
const ANALYSIS: PdfReportAnalysis = {
  current: {
    annualPeakKw: 48,
    monthlyPeaksKw: Array<number>(12).fill(48),
    billedKw: 48,
    leistungspreisCostPerYear: 3980.16,
  },
  perBattery: [roiEntry(KAT1), roiEntry(KAT2)],
  recommendation: { batteryId: KAT1.id, rationale: '' },
  assumptions: {
    roundTripEfficiency: 0.9,
    horizonYears: 10,
    energyPriceCtPerKwh: 24.5,
    einspeiseverguetungCtPerKwh: 7.2,
    billingModel: 'monthly_max_sum',
  },
  tariffOptimization: { computable: true, monthlyComparison: COMPARISON },
  existingBatteryAnalysis: {
    entry: roiEntry(BESTAND),
    addonScenarios: [addonScenario(KAT1, 4200), addonScenario(KAT2, -3100)],
  },
  dataQuality: {
    coveredDays: 209,
    coveredMonths: 8,
    gapsInterpolated: 1200,
    largestGapSlots: 0,
    warnings: ['209 von 365 Tagen abgedeckt'],
  },
}

const BESTANDSFALL: PdfReportInput = {
  title: 'Prüffall Bestand',
  subtitle: 'Stufe D — Bestandsfall',
  period: '01.01.2026 – 28.07.2026',
  printedAt: '18.09.2026',
  analysis: ANALYSIS,
  loadProfile: LOAD_PROFILE,
  tariffSource: TARIFF_SOURCE_UNTRACKED,
  tariffVintage: null,
  hasPv: true,
  pvOutageMonths: PV_OUTAGE_MONTHS,
}

/**
 * Dieselbe Fixture OHNE die Bestandsanlage — als Gegenprobe und sonst nichts.
 *
 * ⚠ Sie ist keine zweite Fallgestalt: alle Zahlen bleiben, es fällt genau ein Feld weg. Damit ist
 * jeder Unterschied im erzeugten Text auf `existingBatteryAnalysis` zurückzuführen und nicht auf
 * eine nebenher geänderte Grösse.
 */
const OHNE_BESTAND: PdfReportInput = {
  ...BESTANDSFALL,
  analysis: { ...ANALYSIS, existingBatteryAnalysis: undefined },
}

/**
 * Dieselbe Fixture mit BEIDEN Zusatzgeräten unter der Schwelle — der Klarsatz-Fall (B3-2a).
 *
 * ⚠ ER HAT BIS HIERHER GEFEHLT: `registry.test.ts` belegt den Zweig auf `not.toBeNull()`, aber
 * kein Prüflauf hat ihn je DURCHS DOKUMENT geführt. Das Verdikt wäre damit gebaut und nie
 * gerendert — und es ist der einzige Baustein mit eigener Überschriftsgrösse, eigenem Kopfwort
 * und einer Auszeichnung im Fliesstext.
 *
 * ⚠ Die Reihung ist absteigend (§3.8) und die Fixture hält sie ein: −5.388 vor −12.000. Das
 * bestgereihte Gerät ist damit das erste, und sein Fehlbetrag ist die Zahl im Satz.
 */
const KLARSATZ_FALL: PdfReportInput = {
  ...BESTANDSFALL,
  analysis: {
    ...ANALYSIS,
    existingBatteryAnalysis: {
      entry: roiEntry(BESTAND),
      addonScenarios: [addonScenario(KAT1, -5388), addonScenario(KAT2, -12000)],
    },
  },
}

/** Kein Bild — das Dokument setzt an ihre Stelle den `missing`-Satz und rendert weiter. */
const CHARTS: ReportChartRasters = {
  load: null,
  loadError: null,
  loadVertices: null,
  cost: null,
  costError: null,
  costKind: null,
  monthly: null,
  monthlyError: null,
  flow: null,
  flowError: null,
  flowDay: null,
  hourFlow: null,
  hourFlowError: null,
  chargePrice: null,
  chargePriceError: null,
  comparison: null,
  comparisonError: null,
  comparisonVariant: null,
  captureMs: 0,
  figureMs: {
    load: null,
    cost: null,
    monthly: null,
    flow: null,
    hourFlow: null,
    chargePrice: null,
    comparison: null,
  },
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Der Text dieses Reports
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Der AUFGELÖSTE Text aller Bausteine, die das Dokument zeigt.
 *
 * ⚠ Er wird über dieselbe `ReportLayout` gebildet, die `render.tsx` an `ReportDocument` reicht,
 * und je Baustein mit derselben Ursprungskennung, mit der `document.tsx` auflöst
 * (`resolveReportText(statement.body, layout, statement.id)`). Was hier steht, ist deshalb keine
 * Nachbildung der Auflösung, sondern ihr Ergebnis — aus dem PDF selbst ist es nicht lesbar:
 * `@react-pdf/renderer` bettet die Schrift als Subset ein, die Textoperanden sind Glyph-Nummern.
 *
 * ⚠ Die zwei Filter sind die aus `buildReportLayout` — ohne sie stünde hier Text von Bausteinen,
 * die das Dokument weglässt.
 */
function reportText(input: PdfReportInput): string {
  const context = buildReportContext(input)
  const registry = buildReportRegistry(input, context)
  const layout = buildReportLayout(input, context, registry)

  const parts: string[] = []
  for (const entry of registry.entries) {
    if (!reportBlockSelected(input, entry.id)) continue
    if ((entry.id === 'hour_flow' || entry.id === 'charge_price') && !context.hasInsight) continue

    if (entry.form === 'statement') {
      const built = entry.build()
      if (built) parts.push(resolveReportText(built.body, layout, entry.id))
    } else if (entry.form === 'table') {
      const built = entry.build()
      if (built) {
        for (const row of built.rows) {
          for (const cell of row.cells) parts.push(resolveReportText(cell, layout, entry.id))
        }
      }
    }
  }
  return parts.join('\n')
}

async function pdfFor(input: PdfReportInput): Promise<Buffer> {
  const context = buildReportContext(input)
  const registry = buildReportRegistry(input, context)
  return renderToBuffer(
    h(ReportDocument, {
      input,
      charts: CHARTS,
      context,
      registry,
      layout: buildReportLayout(input, context, registry),
      agenda: null,
      sink: createPageNumberSink(),
    }) as never,
  )
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Die Proben
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

describe('Stufe D — der Bestandsfall als zweite Render-Fixture', () => {
  it('erzeugt ein vollständiges Dokument und betritt dabei den positiven addon-Zweig', async () => {
    const pdf = await pdfFor(BESTANDSFALL)

    /*
     * Eine Untergrenze und keine gepinnte Zahl: sie sagt, dass die Kapitel tatsächlich entstanden
     * sind und nicht bloss das Deckblatt. Fest gepinnt hinge sie am Umbruch und würde bei jeder
     * Textänderung rot, ohne dass etwas kaputt wäre (dieselbe Überlegung wie in
     * `optional-sections.test.ts`).
     */
    expect(Number(pdf.toString('latin1').match(/\/Count (\d+)/)?.[1])).toBeGreaterThan(5)

    const text = reportText(BESTANDSFALL)
    /* Der Klarsatz-Zweig („lohnt sich derzeit nicht") trüge diesen Satz NICHT. */
    expect(text).toContain('Gerechnet als EIN gemeinsamer Speicher aus Ihrer Anlage und diesem')
  }, 60_000)

  it('löst die acht Querverweise auf, die der Katalog-Fall nicht erreicht', () => {
    const text = reportText(BESTANDSFALL)

    /* 1 — `peak_shaving` → Kopfzahl von `savings`, Kassen-Zweig. */
    expect(text).toContain('Dieser Betrag steckt NICHT in der Zahl oben')
    /* 3 — `load_shift`, Abgleich mit der Kassen-Zeile. */
    expect(text).toContain('Die Zeile „Wert der Ladesteuerung" in der Aufschlüsselung oben')
    /* 4 — `load_shift`, Eigenverbrauch im Kassen-Zweig. */
    expect(text).toContain(
      'steckt in der Zeile „Wert der Ladesteuerung" in der Aufschlüsselung oben mit drin',
    )
    /* 10 — `recommendation` → `addon`, über den Verweisnamen von Kapitel 1. */
    expect(text).toContain(
      'Ob sich ein ZUSÄTZLICHES Gerät neben Ihrer Anlage lohnt, steht auf der Kernergebnis-Seite',
    )
    /* 11 — `load_control` → `load_shift`, Hochrechnungssatz (209 von 365 Tagen). */
    expect(text).toContain('die Zahl auf der Kernergebnis-Seite ist')
    /* 12 — `load_control` → Kassen-Zeile von `savings`. */
    expect(text).toContain(
      'Er steckt in der Zeile „Wert der Ladesteuerung" in der Aufschlüsselung der ' +
        'Kernergebnis-Seite bereits mit drin',
    )
    /* 15 — `monthly_comparison` (Bestandsfassung, Kapitel 3) → `savings`. */
    expect(text).toContain(
      'Die Kernergebnis-Seite zeigt die DIFFERENZEN zwischen diesen drei Summen',
    )
    /* 20 — `addon_table` → Spalte „Ersparnis/Jahr" der Kandidatentabelle. */
    expect(text).toContain('die Spalten „Ersparnis/Jahr" und „Netto" sind also Differenzen')
  })

  it('rendert den Klarsatz-Fall als Verdikt, mit Anzahl und Fehlbetrag', async () => {
    const text = reportText(KLARSATZ_FALL)

    /* Beide Zahlen des Verdikts — die Anzahl geprüfter Geräte und der Fehlbetrag des besten. */
    expect(text).toContain(
      'Keines der 2 geprüften Batteriegeräte würde sich neben Ihrer bestehenden Anlage ' +
        'innerhalb von 10 Jahren finanziell rechnen.',
    )
    /* `\u00a0` ist das schmale Leerzeichen aus `formatEur` (Intl, de-AT) — ausgeschrieben, weil es
       im Quelltext von einem gewöhnlichen Leerzeichen nicht zu unterscheiden wäre. */
    expect(text).toContain(
      'Das am besten abschneidende Gerät bliebe über 10 Jahre gerechnet €\u00a05.388 im Minus.',
    )
    /* Die Tabellen-Einleitung des positiven Zweigs darf hier nicht mitkommen. */
    expect(text).not.toContain('Gerechnet als EIN gemeinsamer Speicher')

    /* Und er geht durchs Dokument — der Zweig war bis B3-2a nie gerendert worden. */
    const pdf = await pdfFor(KLARSATZ_FALL)
    expect(Number(pdf.toString('latin1').match(/\/Count (\d+)/)?.[1])).toBeGreaterThan(5)
  }, 60_000)

  it('den Verweis aus Nr. 10 gibt es nur mit Bestandsanlage', () => {
    /*
     * ⚠ Die Gegenprobe ist der Punkt: im Katalog-Fall nimmt `framing` gar keinen Verweis, sondern
     * einen festen Satz („Aus dem Katalog schneidet dieses Gerät … am besten ab"). Ohne sie bliebe
     * offen, ob der Satz oben am Bestandszweig hängt oder ohnehin überall steht.
     */
    expect(reportText(OHNE_BESTAND)).not.toContain('steht auf der Kernergebnis-Seite')
    expect(reportText(OHNE_BESTAND)).toContain('Aus dem Katalog schneidet dieses Gerät')
  })
})
