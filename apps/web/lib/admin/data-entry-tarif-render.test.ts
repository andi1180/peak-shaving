import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { MeteringPointSummary } from './metering-points'

/**
 * Der Block „Dynamischer Tarif (Spotvertrag)" erscheint nur bei Projektland DE; bei AT bleibt das
 * DOM der Station ohne ihn. Die Actions sind ersetzt — gerendert wird nur die Komponente.
 */
vi.mock('@/lib/admin/data-entry-actions', () => ({
  deleteMeteringPointDynamicTariffAction: async () => ({}),
  deleteMeteringPointTariffComparisonAction: async () => ({}),
  saveMeteringPointDynamicTariffAction: async () => ({}),
  saveMeteringPointTariffComparisonAction: async () => ({}),
  saveMeteringPointAnalysisAssumptionsAction: async () => ({}),
}))

// Der Test-Transformer nutzt die klassische JSX-Laufzeit: `React` muss vor dem Import global stehen.
;(globalThis as { React?: typeof React }).React = React

const { DataEntryTarif } = await import('@/components/admin/data-entry-tarif')

const point = (draft: Record<string, unknown> = {}) =>
  ({ id: '66666666-7777-4888-8999-aaaaaaaaaaaa', draft }) as unknown as MeteringPointSummary

function render(country: 'AT' | 'DE', draft: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(DataEntryTarif, {
      projectId: '11111111-2222-4333-8444-555555555555',
      meteringPoint: point(draft),
      meteringPointNumber: 1,
      nextHref: null,
      segment: 'betrieb',
      hasKnownTariff: false,
      awattarAverageCtPerKwh: null,
      country,
    }),
  )
}

describe('Tarif-Station — Block „Dynamischer Tarif"', () => {
  it('bei AT kein Block, bei DE mit Block', () => {
    expect(render('AT')).not.toContain('Dynamischer Tarif')
    expect(render('AT')).not.toContain('markupCtPerKwh')

    const de = render('DE')
    expect(de).toContain('Dynamischer Tarif (Spotvertrag)')
    expect(de).toContain('name="markupCtPerKwh"')
    expect(de).toContain(
      'Werte netto. Ohne Angabe wird der Vergleich mit dem dynamischen Tarif nicht gerechnet.',
    )
  })

  it('zeigt gespeicherte Werte nach dem Neuladen und statt des Formulars den Löschknopf', () => {
    const de = render('DE', {
      dynamicSupplierName: 'Beispiel Spot',
      dynamicMarkupCtPerKwh: 1.5,
      dynamicBaseFeeEurPerMonth: 4.9,
    })
    expect(de).toContain('Beispiel Spot')
    expect(de).toContain('Löschen')
    expect(de).not.toContain('name="markupCtPerKwh"')
  })
})
