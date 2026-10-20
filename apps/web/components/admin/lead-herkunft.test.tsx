import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readLeadAttribution, readProfiReportRequests } from '@/lib/admin/lead-attribution'
import { LeadHerkunft, LeadProfiReport, LeadUtmCell } from './lead-herkunft'

// Rückgabe von `admin_get_lead_attribution`.
const DATA = {
  first_touch: {
    created_at: '2026-10-20T08:30:00Z',
    utm_source: 'linkedin',
    utm_medium: 'social',
    utm_campaign: 'test',
    landing_path: '/',
    referrer_host: 'www.linkedin.com',
  },
  touches: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      channel: 'profi_report',
      created_at: '2026-10-21T09:00:00Z',
      landing_path: '/profi-report',
    },
    {
      id: '11111111-1111-4111-8111-111111111111',
      channel: 'schnellreport',
      created_at: '2026-10-20T08:30:00Z',
      utm_source: 'linkedin',
      utm_medium: 'social',
      utm_campaign: 'test',
      landing_path: '/',
    },
  ],
}

describe('Admin: Herkunft', () => {
  it('Lead-Detail zeigt first touch und je Absendung die eigene Herkunft', () => {
    const html = renderToStaticMarkup(<LeadHerkunft attribution={readLeadAttribution(DATA)} />)
    expect(html).toContain('First touch')
    expect(html).toContain('linkedin / social / test')
    expect(html).toContain('www.linkedin.com')
    expect(html).toContain('Profi-Report-Anfrage')
    expect(html).toContain('/profi-report')
    expect(html).toMatch(/Quelle \/ Medium \/ Kampagne<\/dt><dd[^>]*>direkt/)
  })

  it('ohne erfasste Herkunft ein Hinweis statt leerer Felder', () => {
    const html = renderToStaticMarkup(<LeadHerkunft attribution={readLeadAttribution(null)} />)
    expect(html).toContain('Noch keine Herkunft erfasst')
  })

  it('Profi-Report-Teil mit Lastgang-Angabe; Listenzelle mit Quelle und Kampagne', () => {
    const rows = readProfiReportRequests([
      { id: 'a', created_at: '2026-10-21T09:00:00Z', has_load_profile: 'unsicher' },
      { id: 'b', created_at: '2026-10-21T09:00:00Z', has_load_profile: 'vielleicht' },
    ])
    const html = renderToStaticMarkup(<LeadProfiReport rows={rows} />)
    expect(html).toMatch(/Lastgang vorhanden<\/dt><dd[^>]*>weiß nicht/)
    expect(html.match(/Lastgang vorhanden/g)).toHaveLength(1)
    expect(renderToStaticMarkup(<LeadProfiReport rows={[]} />)).toBe('')

    const cell = renderToStaticMarkup(<LeadUtmCell source="linkedin" campaign="test" />)
    expect(cell).toContain('linkedin')
    expect(cell).toContain('test')
  })
})
