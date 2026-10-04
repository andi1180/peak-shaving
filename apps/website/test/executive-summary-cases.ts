import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  buildReportInputFromRenderRequest,
  readRenderRequest,
} from '@/lib/pdf-report/build-report-input'
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

/** Alle Fälle, für die es eine Vorderseite gibt. */
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
}
