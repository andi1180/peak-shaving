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
import { statementTexts } from './statement'
import { TARIFF_SOURCE_UNTRACKED } from './types'
import type { PdfReportAnalysis, PdfReportInput } from './types'

/**
 * Stufe D — die ZWEITE Render-Fixture: ein Report mit Bestandsanlage.
 *
 * ── ⚠ WARUM ES SIE BRAUCHT ────────────────────────────────────────────────────────────────────
 * `optional-sections.test.ts` rendert einen KATALOG-Fall (keine Bestandsanlage). Was dieser Fall
 * zusätzlich erreicht, sind die Zweige, die eine Bestandsanlage voraussetzen: die Bestandsrahmung
 * der Empfehlung samt Zusatzspeicher-Zeiger, der Monatsvergleich im Detail-Kapitel und die
 * Zusatzgeräte-Tabelle. Was in `report-text.test.ts` gegen von Hand hingeschriebene
 * Zusammenstellungen belegt ist, lässt sich dort NICHT messen: ob der Fall im echten Dokument
 * überhaupt entsteht — ein Verweis, dessen Zweig kein Report je betritt, ist grün und trotzdem tot.
 *
 * ── DIE FALLGESTALT ───────────────────────────────────────────────────────────────────────────
 * Rekonstruiert aus dem Drei-Fälle-Harness der Optik-Bestandsaufnahme
 * (`Report_Baukasten_Optik_Bestandsaufnahme.md` §1.2): Fall A (Urbanz — Bestandsspeicher
 * 19,2 kWh / 10,6 kW, PV vorhanden, 209 abgedeckte Tage / 8 Monate, Tarifvergleich rechenbar) mit
 * dem sich rechnenden Zusatzgerät aus Fall C.
 *
 * ⚠ EINE BENANNTE ABWEICHUNG VON FALL A: der Leistungspreis ist hier > 0. Der Urbanz-Anschluss
 * hängt auf Netzebene 7 ohne Leistungsmessung und hat den Posten gar nicht. Die Fallgestalt ist
 * übernommen, nicht die Netzebene.
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
 * ergeben den Monatsvergleich im Detail-Kapitel. Und `addonScenarios` trägt genau EIN Gerät über
 * der Schwelle `netSavingOverHorizon > 0`: das ist der positive `addon`-Zweig samt
 * Zusatzgeräte-Tabelle.
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
  ways: null,
  waysError: null,
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
    ways: null,
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
      /* B3-3: Körper UND Listenpunkte — ein Baustein in Listenform hat keinen Körper mehr. */
      if (built) {
        for (const text of statementTexts(built))
          parts.push(resolveReportText(text, layout, entry.id))
      }
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
    expect(text).toContain('Ein zusätzlicher Batteriespeicher rechnet sich für Sie')
  }, 60_000)

  /**
   * ⚠ VON DEN ACHT VERWEISEN, DIE NUR DER BESTANDSFALL ERREICHTE, SIND ZWEI ÜBRIG. Die sechs
   * übrigen zeigten auf `savings`/`load_shift` — beide Bausteine sind mit der Zusammenfassung
   * entfallen (Ein-Spanne-Regel D8). Gemessen wird deshalb BEIDES: dass die zwei überlebenden
   * auflösen, und dass von den sechs kein Rest im Dokument stehengeblieben ist.
   */
  it('löst die zwei verbliebenen Querverweise auf, die der Katalog-Fall nicht erreicht', () => {
    const text = reportText(BESTANDSFALL)

    /* 10 — `recommendation` → `addon`, über den Verweisnamen von Kapitel 1. */
    expect(text).toContain(
      'Ob sich ein ZUSÄTZLICHES Gerät neben Ihrer Anlage lohnt, steht auf der Zusammenfassung',
    )
    /* 20 — `addon_table` → Spalte „Ersparnis/Jahr" der Kandidatentabelle. */
    expect(text).toContain('die Spalten „Ersparnis/Jahr" und „Netto" sind also Differenzen')

    /* Und kein Satz nennt mehr eine Zeile oder eine Seite, die es nicht gibt. */
    expect(text).not.toContain('Kernergebnis')
    expect(text).not.toContain('Wert der Ladesteuerung" in der Aufschlüsselung')
    expect(text).not.toContain('Dieser Betrag steckt NICHT in der Zahl')
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
    /* Der positive Zweig des Kapitel-1-Zeigers darf hier nicht mitkommen. */
    expect(text).not.toContain('Ein zusätzlicher Batteriespeicher rechnet sich für Sie')

    /* Und er geht durchs Dokument — der Zweig war bis B3-2a nie gerendert worden. */
    const pdf = await pdfFor(KLARSATZ_FALL)
    expect(Number(pdf.toString('latin1').match(/\/Count (\d+)/)?.[1])).toBeGreaterThan(5)
  }, 60_000)

  /**
   * B3-2b — die Kapitel-1-Fassung von `addon` ist ein ZEIGER, in beiden Fällen.
   *
   * ⚠ Gemessen wird der AUFGELÖSTE Satz und nicht das Template: die Ortsangabe entsteht erst
   * gegen die Leseordnung (`layout.ts`), und genau sie ist der Unterschied zur alten Fassung, die
   * ihren Nachbarn wortgleich wiederholte statt auf ihn zu zeigen.
   */
  it('zeigt aus Kapitel 1 auf Kapitel 6 — mit Gerät wie ohne', () => {
    const positiv = reportText(BESTANDSFALL)
    expect(positiv).toContain(
      'Ein zusätzlicher Batteriespeicher rechnet sich für Sie: das bestgereihte Gerät bringt ' +
        '€\u00a01.499 im Jahr zusätzlich, und im Kapitel „Speichergrösse und Gerätewahl" steht, ' +
        'welches Gerät das ist und was es kostet.',
    )
    /* Die drei Sätze der alten Fassung standen wortgleich auch in Kapitel 6 — genau das nicht. */
    expect(positiv).not.toContain('Gerechnet als EIN gemeinsamer Speicher aus Ihrer Anlage')

    expect(reportText(KLARSATZ_FALL)).toContain(
      'Ein zusätzlicher Batteriespeicher lohnt sich für Sie derzeit nicht — woran das liegt, ' +
        'steht im Kapitel „Speichergrösse und Gerätewahl".',
    )
  })

  /**
   * B3-2c — die Zahl des positiven Zeigers hängt an der Kandidatentabelle.
   *
   * ⚠ IHR EINZIGER BELEG STEHT DORT: welches Gerät, was es kostet, was netto bleibt. Ohne die
   * Tabelle bliebe sonst ein Betrag stehen, den das Dokument nirgends aufschlüsselt — und gemessen
   * wird das am tatsächlichen Dastehen der Tabelle, nicht an einer zweiten Bedingung daneben.
   */
  it('`table_candidates` abgewählt: der positive Zeiger verliert Zahl und Verweis', () => {
    const ohneTabelle: PdfReportInput = {
      ...BESTANDSFALL,
      optionalSections: ['addon', 'hour_flow', 'charge_price', 'data_quality'],
    }
    const text = reportText(ohneTabelle)

    expect(text).toContain('Ein zusätzlicher Batteriespeicher rechnet sich für Sie.')
    expect(text).not.toContain('das bestgereihte Gerät bringt')
    expect(text).not.toContain('€\u00a01.499')

    /* Gegenprobe im Klarsatz-Fall: dessen Zeiger zeigt auf das Verdikt und bleibt unberührt. */
    expect(
      reportText({ ...KLARSATZ_FALL, optionalSections: ohneTabelle.optionalSections }),
    ).toContain('lohnt sich für Sie derzeit nicht — woran das liegt, steht im Kapitel')
  })

  /**
   * B3-2b, Kante E — `addon` ist jetzt abwählbar, und der Satz im Empfehlungs-Kapitel zeigt auf
   * ihn („steht auf der Kernergebnis-Seite"). Er fällt auf seine leere Ersatzfassung; was
   * zurückbliebe, wäre sonst ein Verweis auf eine Seite ohne das Genannte — und dem Blatt sieht
   * man das nicht an, es fehlt nichts, wo etwas fehlen würde.
   */
  it('`addon` abgewählt: der Zeiger fällt, und mit ihm der Satz aus Kapitel 2', () => {
    const ohneAddon: PdfReportInput = {
      ...BESTANDSFALL,
      optionalSections: ['hour_flow', 'charge_price', 'table_candidates', 'data_quality'],
    }
    const text = reportText(ohneAddon)

    expect(text).not.toContain('Ein zusätzlicher Batteriespeicher')
    expect(text).not.toContain('steht auf der Kernergebnis-Seite')
    /* Der erste Punkt bleibt — der Verweis umfasst genau den zweiten (B3-3). */
    expect(text).toContain('wenn ich Ihre Anlage durch ein neues Gerät ersetzte?".')
    /* Und das Vergleichs-Kapitel, auf das er zeigte, steht unverändert. */
    expect(text).toContain('Gerechnet ist je Zeile EIN gemeinsamer Speicher')
  })

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
