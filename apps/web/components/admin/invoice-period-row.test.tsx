import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// Die echten Server-Actions ziehen `server-only`; die Darstellung braucht sie nicht.
vi.mock('@/lib/admin/data-entry-actions-rechnung-period', () => ({
  setInvoicePeriodOverrideAction: vi.fn(),
  clearInvoicePeriodOverrideAction: vi.fn(),
}))

import { InvoicePeriodView, type InvoicePeriodRowData } from './invoice-period-row'

const noop = () => {}

function render(data: InvoicePeriodRowData, editing = false) {
  return renderToStaticMarkup(
    <InvoicePeriodView
      data={data}
      editing={editing}
      pending={false}
      error={null}
      onEdit={noop}
      onCancel={noop}
      onSave={noop}
      onClear={noop}
    />,
  )
}

const BASE: InvoicePeriodRowData = {
  documentId: 'd1',
  filename: 'jahresrechnung.pdf',
  read: { from: '2024-10-20', to: '2025-10-19' },
  effective: { from: '2024-10-20', to: '2025-10-19' },
  overridden: false,
  flags: [],
}

describe('Zeitraum je gelesener Rechnung', () => {
  it('mit Hinweisen: Zeitraum, Bernstein-Markierungen, Korrigieren-Knopf, kein Entfernen', () => {
    const html = render({
      ...BASE,
      flags: [
        { kind: 'assumed' },
        { kind: 'overlap', documentId: 'd2', filename: 'nachverrechnung.pdf' },
      ],
    })
    expect(html).toContain('Zeitraum: 20.10.2024–19.10.2025')
    expect(html).toContain('Zeitraum geschätzt')
    expect(html).toContain('überlappt mit nachverrechnung.pdf')
    expect(html.match(/bg-warning-subtle/g)).toHaveLength(2)
    expect(html).toContain('Zeitraum korrigieren')
    expect(html).not.toContain('Korrektur entfernen')
    expect(html).not.toContain('korrigiert (gelesen')
  })

  it('mit Korrektur: wirksamer Zeitraum, Original und Entfernen-Knopf', () => {
    const html = render({
      ...BASE,
      effective: { from: '2025-01-01', to: '2025-12-31' },
      overridden: true,
    })
    expect(html).toContain('Zeitraum: 01.01.2025–31.12.2025')
    expect(html).toContain('korrigiert (gelesen: 20.10.2024–19.10.2025)')
    expect(html).toContain('Korrektur entfernen')
    expect(html).not.toContain('bg-warning-subtle')
  })

  it('beim Korrigieren: zwei Datumsfelder mit dem wirksamen Zeitraum vorbelegt', () => {
    const html = render(BASE, true)
    expect(html.match(/type="date"/g)).toHaveLength(2)
    expect(html).toContain('value="2024-10-20"')
    expect(html).toContain('value="2025-10-19"')
    expect(html).toContain('Speichern')
  })
})
