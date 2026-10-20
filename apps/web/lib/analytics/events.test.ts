import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { kwhBand, registerAnalyticsClient, track } from './events'

// PostHog gemockt: ein Client, der nur mitschreibt.
const capture = vi.fn()

beforeEach(() => {
  vi.stubGlobal('window', { location: { pathname: '/partner/muster-elektro', search: '' } })
  registerAnalyticsClient({ capture })
})

afterEach(() => {
  registerAnalyticsClient(null)
  capture.mockReset()
  vi.unstubAllGlobals()
})

/** Jedes Ereignis einmal, mit den Eigenschaften aus dem Auftrag. */
function fireAll() {
  track('cta_ersparnis_click', { position: 'hero' })
  track('cta_ersparnis_click', { position: 'bottombar' })
  track('cta_profi_report_click', { position: 'header', variant: 'profi_report' })
  track('cta_profi_report_click', { position: 'bottombar', variant: 'jetzt_anfragen' })
  track('cta_profi_report_click', { position: 'home_teaser', variant: 'beispiel_ansehen' })
  track('schnellcheck_started', { country: 'AT' })
  track('schnellcheck_result_shown', {
    country: 'DE',
    kwh_band: kwhBand(320_000),
    has_kw: true,
    has_bill: false,
  })
  track('schnellreport_form_opened')
  track('schnellreport_submitted', { country: 'AT', tips_optin: true })
  track('callback_requested')
  track('profi_report_beispiel_page', { page: 7 })
  track('profi_report_pdf_opened')
  track('profi_report_request_submitted', { lastgang: 'unsicher' })
}

describe('Funnel-Ereignisse', () => {
  it('jedes Ereignis trägt seine Eigenschaften plus path und partner', () => {
    fireAll()
    const common = { path: '/partner/muster-elektro', partner: true }
    expect(capture.mock.calls).toEqual([
      ['cta_ersparnis_click', { ...common, position: 'hero' }],
      ['cta_ersparnis_click', { ...common, position: 'bottombar' }],
      ['cta_profi_report_click', { ...common, position: 'header', variant: 'profi_report' }],
      ['cta_profi_report_click', { ...common, position: 'bottombar', variant: 'jetzt_anfragen' }],
      [
        'cta_profi_report_click',
        { ...common, position: 'home_teaser', variant: 'beispiel_ansehen' },
      ],
      ['schnellcheck_started', { ...common, country: 'AT' }],
      [
        'schnellcheck_result_shown',
        { ...common, country: 'DE', kwh_band: '250-500k', has_kw: true, has_bill: false },
      ],
      ['schnellreport_form_opened', common],
      ['schnellreport_submitted', { ...common, country: 'AT', tips_optin: true }],
      ['callback_requested', common],
      ['profi_report_beispiel_page', { ...common, page: 7 }],
      ['profi_report_pdf_opened', common],
      ['profi_report_request_submitted', { ...common, lastgang: 'unsicher' }],
    ])
  })

  it('keine Eigenschaft trägt E-Mail, Name, Firma oder Telefon', () => {
    vi.stubGlobal('window', { location: { pathname: '/', search: '?partner=x&utm_source=y' } })
    fireAll()
    const forbiddenKeys = /mail|name|firma|company|telefon|phone|vorname|nachname/i
    for (const [, properties] of capture.mock.calls as Array<[string, object]>) {
      for (const [key, value] of Object.entries(properties)) {
        expect(key).not.toMatch(forbiddenKeys)
        expect(['string', 'number', 'boolean']).toContain(typeof value)
        expect(String(value)).not.toMatch(/@|\d{6,}/)
      }
    }
  })

  it('kwh_band in Stufen, Ereignisse vor dem Init werden nachgereicht', () => {
    expect([99_999, 100_000, 250_000, 500_000, 1_000_000, 1_000_001].map(kwhBand)).toEqual([
      '<100k',
      '100-250k',
      '250-500k',
      '500k-1M',
      '500k-1M',
      '>1M',
    ])
    registerAnalyticsClient(null)
    track('profi_report_pdf_opened')
    expect(capture).not.toHaveBeenCalled()
    registerAnalyticsClient({ capture })
    expect(capture).toHaveBeenCalledWith('profi_report_pdf_opened', {
      path: '/partner/muster-elektro',
      partner: true,
    })
  })
})
