import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// Die echten Server-Actions ziehen `server-only`; die Darstellung braucht sie nicht.
vi.mock('@/lib/admin/data-entry-actions-rechnung-choices', () => ({
  getInvoiceFieldConflictsAction: vi.fn(),
  chooseInvoiceFieldValueAction: vi.fn(),
  clearInvoiceFieldChoiceAction: vi.fn(),
}))

import { InvoiceFieldChoicesView } from './invoice-field-choices'
import { CHOSEN_DOCUMENT, OPEN_NO_WEIGHTED, OPEN_WEIGHTED } from './invoice-field-choices.fixtures'

const TARIFF_HREF = '/admin/kalkulator-projekte/p1/dateneingabe?station=zp1-tarif'
const noop = async () => null

function render(conflicts: Parameters<typeof InvoiceFieldChoicesView>[0]['conflicts']) {
  return renderToStaticMarkup(
    <InvoiceFieldChoicesView
      conflicts={conflicts}
      tariffHref={TARIFF_HREF}
      onApply={noop}
      onLift={noop}
    />,
  )
}

function checkedValues(html: string): string[] {
  return [...html.matchAll(/<input[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /\schecked=""/.test(tag))
    .map((tag) => /value="([^"]*)"/.exec(tag)?.[1] ?? '')
}

describe('Auswahlblock für widersprüchliche Rechnungswerte', () => {
  it('ohne Konfliktfeld kein Block', () => {
    expect(render([])).toBe('')
  })

  it('offen: Mittelwert zuoberst und vorausgewählt, Rechnungen darunter, Link zum Tarif-Schritt', () => {
    const html = render([OPEN_WEIGHTED])
    expect(html).toContain('Widersprüchliche Werte – bitte wählen')
    expect(html).toContain('Das Feld bleibt leer, bis Sie einen Wert wählen oder eintragen.')
    const weighted = html.indexOf('Gewichteter Mittelwert: 13,20 ct/kWh (Gewichtung: Lastgang-kWh)')
    const firstDocument = html.indexOf('12,35 ct/kWh – 01.01.2025–30.06.2025 – rechnung-2025.pdf')
    expect(weighted).toBeGreaterThan(-1)
    expect(firstDocument).toBeGreaterThan(weighted)
    expect(html).toContain('(Zeitraum geschätzt)')
    expect(html).toContain('Zusammensetzung')
    expect(checkedValues(html)).toEqual(['weighted'])
    expect(html).toContain('Übernehmen')
    expect(html).toContain(`href="${TARIFF_HREF.replace('&', '&amp;')}"`)
    expect(html).toContain('Eigenen Wert im Tarif-Schritt eintragen')
  })

  it('ohne Mittelwert steht der Grund an seiner Stelle, Vorauswahl ist die Rechnung', () => {
    const html = render([OPEN_NO_WEIGHTED])
    expect(html).toContain('Für dieses Feld gibt es keinen gewichteten Mittelwert.')
    expect(html).not.toContain('Gewichteter Mittelwert:')
    expect(html).toContain('54 € / kW und Jahr – Zeitraum unbekannt – rechnung-2026.pdf')
    expect(checkedValues(html)).toEqual(['document:doc-b'])
  })

  it('gewählt: Wert mit Beschreibung und „Wahl aufheben", keine Optionen', () => {
    const html = render([CHOSEN_DOCUMENT])
    expect(html).toContain('Gewählt: 12,35 ct/kWh')
    expect(html).toContain('Rechnung rechnung-2025.pdf, 01.01.2025–30.06.2025')
    expect(html).toContain('Wahl aufheben')
    expect(html).not.toContain('type="radio"')
    expect(html).not.toContain('Übernehmen')
  })
})

describe('Hinweis bei Leistungspreis mit Benutzungsdauer-Stufen', () => {
  const info = {
    tiers: [
      {
        validFrom: '2026-01-01',
        thresholdHours: 2500,
        belowEurPerKwYear: 22.75,
        aboveEurPerKwYear: 131.8,
      },
    ],
    invoiceValues: [
      {
        documentId: 'jan',
        filename: 'jan.pdf',
        periodFrom: '2026-01-01',
        periodTo: '2026-01-31',
        value: 22.75,
      },
    ],
  }

  it('zeigt Stände und Rechnungswerte ohne Auswahlelemente, auch ohne weitere Konfliktfelder', () => {
    const html = renderToStaticMarkup(
      <InvoiceFieldChoicesView
        conflicts={[]}
        tieredDemandInfo={info}
        tariffHref={TARIFF_HREF}
        onApply={noop}
        onLift={noop}
      />,
    )
    expect(html).toContain('Leistungspreis mit Benutzungsdauer-Stufen')
    // de-AT gruppiert Tausender mit einem schmalen Leerzeichen.
    expect(html).toMatch(
      /gültig ab 01\.01\.2026: bis 2\s500 h 22,75 €\/kW·a, darüber 131,80 €\/kW·a/,
    )
    expect(html).toContain('Die Rechnungswerte dienen nur zur Kontrolle:')
    expect(html).toContain('22,75 €/kW·a – 01.01.2026–31.01.2026 – jan.pdf')
    expect(html).not.toMatch(/<input|<button|Übernehmen|Tarif-Schritt|Widersprüchliche/)
  })
})
