import { analysisForDisplay, vatFactor } from 'shared'
import type { PdfReportInput } from './types'

/**
 * H3 — der Report-Eingang in seiner Anzeigebasis: Ergebnis und Katalog-Listenpreise × (1 + USt)
 * für Privatkunden, sonst unverändert. Genau EINMAL am Eingang von `renderReportPdf`, damit
 * Kapitel, Tabellen und Diagramme dieselben Zahlen sehen.
 */
export function reportInputForDisplay(input: PdfReportInput): PdfReportInput {
  const basis = input.priceDisplay ?? 'net'
  if (basis === 'net') return input
  const factor = vatFactor(basis)
  return {
    ...input,
    analysis: analysisForDisplay(input.analysis, basis),
    batteryCatalogMeta:
      input.batteryCatalogMeta &&
      Object.fromEntries(
        Object.entries(input.batteryCatalogMeta).map(([id, meta]) => [
          id,
          { ...meta, listPriceNet: meta.listPriceNet * factor },
        ]),
      ),
  }
}
