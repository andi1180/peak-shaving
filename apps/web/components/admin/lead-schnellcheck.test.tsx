import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readSchnellreportRequests } from '@/lib/admin/schnellreport-requests'
import { LeadSchnellcheck } from './lead-schnellcheck'

// Rückgabe von `admin_list_schnellreport_requests` (numeric kommt als Zahl oder Zeichenkette).
const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  created_at: '2026-10-20T08:30:00Z',
  country: 'AT',
  branche: 'handel',
  annual_kwh: 250000,
  peak_kw: '150',
  peak_kw_entered: false,
  bill_eur: 65000,
  demand_price_eur_per_kw: '67',
  peak_cost_eur: 10100,
  tips_requested: true,
  tips_confirmed: false,
  callback_requested: true,
}

describe('Admin-Lead-Detail: Abschnitt „Schnellcheck"', () => {
  it('erscheint bei einem Lead mit Werten', () => {
    const html = renderToStaticMarkup(<LeadSchnellcheck rows={readSchnellreportRequests([ROW])} />)

    expect(html).toContain('Schnellcheck')
    expect(html).toContain('Handel &amp; Filialen')
    expect(html).toContain('150 kW')
    expect(html).toContain('(Reglerwert)')
    expect(html).toContain('10.100 € pro Jahr')
    expect(html).toContain('67 €/kW·a')
    expect(html).toContain('angefordert, noch nicht bestätigt')
    expect(html).toMatch(/Rückruf gewünscht<\/dt><dd[^>]*>ja/)
  })

  it('fehlt bei einem Lead ohne Werte', () => {
    expect(renderToStaticMarkup(<LeadSchnellcheck rows={readSchnellreportRequests([])} />)).toBe('')
  })
})
