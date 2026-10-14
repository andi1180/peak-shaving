import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_DYNAMIC_TARIFF_BY_COUNTRY, dynamicTariffDraftFields } from 'shared'

import type { MeteringPointSummary } from './metering-points'

/**
 * Der Block „Dynamischer Tarif (Spotvertrag)" erscheint für jedes Projektland — die Station bekommt
 * gar kein Land mehr. Die Actions sind ersetzt — gerendert wird nur die Komponente.
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

function render(draft: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(DataEntryTarif, {
      projectId: '11111111-2222-4333-8444-555555555555',
      meteringPoint: point(draft),
      meteringPointNumber: 1,
      nextHref: null,
      segment: 'betrieb',
      hasKnownTariff: false,
      awattarAverageCtPerKwh: null,
    }),
  )
}

describe('Tarif-Station — Block „Dynamischer Tarif"', () => {
  it('Block ohne Länderbezug: leer mit Formular, mit AT-Vorbelegung die vermerkten Werte', () => {
    const empty = render()
    expect(empty).toContain('Dynamischer Tarif (Spotvertrag)')
    expect(empty).toContain('name="markupCtPerKwh"')
    expect(empty).toContain('Werte netto. Leer = kein Vergleich mit dem dynamischen Tarif; 0 = bewusst null.')

    const prefilled = render(
      Object.fromEntries(
        dynamicTariffDraftFields(DEFAULT_DYNAMIC_TARIFF_BY_COUNTRY.AT!).map((f) => [f.field, f.value]),
      ),
    )
    expect(prefilled).toContain('Dynamischer Tarif (Spotvertrag)')
    expect(prefilled).toContain('aWATTar HOURLY')
  })

  it('zeigt gespeicherte Werte nach dem Neuladen und statt des Formulars den Löschknopf', () => {
    const de = render({
      dynamicSupplierName: 'Beispiel Spot',
      dynamicMarkupCtPerKwh: 1.5,
      dynamicBaseFeeEurPerMonth: 4.9,
    })
    expect(de).toContain('Beispiel Spot')
    expect(de).toContain('Löschen')
    expect(de).not.toContain('name="markupCtPerKwh"')
  })
})
