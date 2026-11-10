import { readFileSync } from 'node:fs'
import path from 'node:path'

import { EXISTING_BATTERY_ID } from 'shared'

import {
  buildReportInputFromRenderRequest,
  readRenderRequest,
} from '@/lib/pdf-report/build-report-input'
import { reportInputForDisplay } from '@/lib/pdf-report/price-display'
import type { PdfReportInput } from '@/lib/pdf-report/types'

/**
 * Prüffälle der Vorderseite „Auf einen Blick": die anonymisierte Render-Anfrage der Report-Snapshots
 * (Gewerbe, Leistungspreis, 157 Tage, ohne PV) und daraus konstruierte Varianten.
 */
const FIXTURES = path.join(import.meta.dirname, 'report-snapshots/fixtures')

export function muster(withAnnualScenario: boolean): PdfReportInput {
  const row = JSON.parse(
    readFileSync(
      path.join(FIXTURES, 'gewerbe-leistungspreis-teiljahr-wien/render-request.json'),
      'utf8',
    ),
  )
  if (withAnnualScenario) {
    row.analysis_result.annualScenario = JSON.parse(
      readFileSync(
        path.join(FIXTURES, 'gewerbe-leistungspreis-teiljahr-jahr-wien/annual-scenario.json'),
        'utf8',
      ),
    )
  }
  const readout = readRenderRequest({ data: row, error: null })
  if (readout.status !== 'ok') throw new Error('Render-Anfrage nicht lesbar')
  return buildReportInputFromRenderRequest(readout.request, new Date('2026-09-30T18:37:04.946Z'))
}

/** Eine Variante aus dem Jahr-Fall: tiefe Kopie, dann `edit` auf das Ergebnis. */
export function variant(edit: (input: PdfReportInput) => void): PdfReportInput {
  const input = structuredClone(muster(true))
  edit(input)
  return input
}

type Entry = PdfReportInput['analysis']['perBattery'][number]

/** Ändert das empfohlene Gerät in `perBattery`. */
export function editRecommended(input: PdfReportInput, edit: (entry: Entry) => void): void {
  const a = input.analysis
  edit(a.perBattery.find((e) => e.battery.id === a.recommendation!.batteryId)!)
}

/** Liefertarif unbekannt über ein ganzes Jahr: die Zeitraumsummen des Teiljahrs als Jahr ausgegeben. */
export function unknownTariffYear(
  edit: (input: PdfReportInput) => void = () => {},
): PdfReportInput {
  const input = structuredClone(muster(false))
  input.analysis.dataQuality.coveredDays = 365
  const optimization = input.analysis.tariffOptimization
  if (optimization?.computable !== true) throw new Error('Fixture ohne Tarifvergleich')
  optimization.monthlyComparison!.currentTariffEur = null
  edit(input)
  return input
}

/**
 * Privat, synthetisch: ein ganzes Jahr mit Bestands-PV und Einspeisung im Lastgang (mittags
 * negativ), Leistungspreis und empfohlenem Speicher mit Kappung — in Brutto-Anzeige wie im Render-Pfad.
 */
export function privatYear(): PdfReportInput {
  const input = structuredClone(muster(false))
  input.analysis.dataQuality.coveredDays = 365
  input.hasPv = true
  input.pvStage = 'existing'
  input.loadProfile.source = 'net_signed'
  input.loadProfile.readings = input.loadProfile.readings.map((r) => {
    const hour = new Date(r.ts).getUTCHours()
    return hour >= 10 && hour < 13 ? { ...r, gridPowerKw: -Math.abs(r.gridPowerKw) / 4 } : r
  })
  input.priceDisplay = 'gross'
  return reportInputForDisplay(input)
}

/** Nur „Ihr Tarif heute" (Konditionen des dynamischen Tarifs fehlen), kein Speicher im Katalog. */
export function ownTariffOnly(): PdfReportInput {
  const input = structuredClone(muster(false))
  const a = input.analysis
  if (a.tariffOptimization?.computable !== true) throw new Error('Fixture ohne Tarifvergleich')
  a.tariffOptimization = {
    computable: false,
    side: 'dynamic_tariff',
    kind: 'unavailable',
    ranges: [],
    monthlyComparison: a.tariffOptimization.monthlyComparison,
  } as never
  a.recommendation = null
  a.perBattery = []
  a.noRecommendationReason = 'no_candidates'
  return input
}

/** Bestandsspeicher im Jahr-Fall: der Jahreslauf rechnet mit dem eigenen Gerät. */
export function existingBattery(): PdfReportInput {
  return variant(({ analysis }) => {
    const primary = analysis.perBattery[0]!
    analysis.existingBatteryAnalysis = {
      entry: { ...primary, battery: { ...primary.battery, id: EXISTING_BATTERY_ID } },
      addonScenarios: [],
    } as never
    analysis.annualScenario!.device = { batteryId: EXISTING_BATTERY_ID, name: 'Bestand' }
  })
}

/** Teiljahr, Liefertarif unbekannt. */
function unknownTariffPartial(): PdfReportInput {
  const input = structuredClone(muster(false))
  const optimization = input.analysis.tariffOptimization
  if (optimization?.computable !== true) throw new Error('Fixture ohne Tarifvergleich')
  optimization.monthlyComparison!.currentTariffEur = null
  return input
}

/**
 * Die einfacheren Fassungen, je eine je Grund (`SimpleVariant`). Getrennt geführt, damit die Prüfungen
 * der vollen Seite unverändert über `EXECUTIVE_SUMMARY_CASES` laufen.
 */
export const SIMPLE_SUMMARY_CASES: Record<string, PdfReportInput> = {
  messzeitraum: muster(false),
  'messzeitraum-anderes-geraet': variant(({ analysis }) => {
    analysis.annualScenario!.device = { batteryId: 'anderes-geraet', name: 'Anderes Gerät' }
  }),
  'tarif-unbekannt-messzeitraum': unknownTariffPartial(),
  bestandsspeicher: existingBattery(),
  'nur-kosten': ownTariffOnly(),
  'tarif-unbekannt-ohne-speicher': unknownTariffYear((input) =>
    editRecommended(input, (e) => {
      e.totalInvestment = 50_000
      e.netInvestment = 50_000
      // Die lineare Kopfzahl liest den Netto-Betrag des Geräts direkt.
      e.netSavingOverHorizon = 25_000 - 50_000
    }),
  ),
}

/** Alle Prüffälle der Vorderseite; die einfacheren Fassungen stehen am Ende. */
export const EXECUTIVE_SUMMARY_CASES: Record<string, PdfReportInput> = {
  'jahr (Müldür)': muster(true),
  'nur-tarif (Katalog leer)': variant(({ analysis }) => {
    analysis.recommendation = null
    analysis.perBattery = []
  }),
  'speicher-lohnt-nicht': variant((input) =>
    editRecommended(input, (e) => {
      e.totalInvestment = 50_000
      e.netInvestment = 50_000
    }),
  ),
  'mit Förderung': variant((input) =>
    editRecommended(input, (e) => {
      e.subsidyAmount = 2_000
      e.netInvestment = e.totalInvestment - 2_000
    }),
  ),
  'ohne Spitzenersparnis': variant(({ analysis }) => {
    analysis.annualScenario!.ways.peakShavingSavingEur = 0
  }),
  // Konstruiert: die Zeitraumsummen des Teiljahrs als ganzes Jahr ausgegeben — prüft nur den Weg.
  'volles Jahr (konstruiert)': (() => {
    const input = structuredClone(muster(false))
    input.analysis.dataQuality.coveredDays = 365
    return input
  })(),
  // Längste Texte: Namen, Förderzeile, alle Bestandteile der Investition, Vergleichstarif.
  'Worst Case': variant((input) => {
    input.customer = {
      company:
        'Muster Gastro- und Hotelbetriebs-Gesellschaft mit beschränkter Haftung & Co KG, Niederlassung Wien-Donaustadt',
    }
    input.analysis.annualScenario!.ways.comparisonTariffEur = 30_000
    input.analysis.annualScenario!.ways.comparisonSupplier =
      'Wien Energie Optima Business Float Garantie'
    editRecommended(input, (e) => {
      e.battery = {
        ...e.battery,
        name: 'Kostal & Dyness Retrofit S Hochvolt-Gewerbespeicher mit integriertem Hybrid-Wechselrichter',
        requiresFoundation: true,
        foundationCost: 1_000,
        inverterIncluded: false,
        extraInverterCost: 1_500,
      }
      // Hohe Investition: allein durch günstiges Laden jenseits des Horizonts — die längste Zeile.
      e.totalInvestment = 17_000
      e.subsidyAmount = 2_000
      e.netInvestment = e.totalInvestment - 2_000
    })
  }),
  'privat (brutto, Bestands-PV)': privatYear(),
  'tarif-unbekannt (konstruiert)': unknownTariffYear(),
  // Längste Texte der Variante: Namen und Förderung.
  'tarif-unbekannt Worst Case': unknownTariffYear((input) => {
    input.customer = {
      company:
        'Muster Gastro- und Hotelbetriebs-Gesellschaft mit beschränkter Haftung & Co KG, Niederlassung Wien-Donaustadt',
    }
    editRecommended(input, (e) => {
      e.battery = {
        ...e.battery,
        name: 'Kostal & Dyness Retrofit S Hochvolt-Gewerbespeicher mit integriertem Hybrid-Wechselrichter',
        requiresFoundation: true,
        foundationCost: 1_000,
        inverterIncluded: false,
        extraInverterCost: 1_500,
      }
      // Ohne Jahresszenario liest die Seite die Rückzahlzeit aus dem Gerät — mitziehen.
      e.totalInvestment = 17_000
      e.subsidyAmount = 2_000
      e.netInvestment = e.totalInvestment - 2_000
      e.amortizationYears = e.netInvestment / e.totalSavingPerYear
      e.netSavingOverHorizon =
        e.totalSavingPerYear * input.analysis.assumptions.horizonYears - e.netInvestment
    })
  }),
  ...SIMPLE_SUMMARY_CASES,
}
