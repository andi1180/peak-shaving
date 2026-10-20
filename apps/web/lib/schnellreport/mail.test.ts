import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env.server', () => ({ serverEnv: {} }))

const { buildReportMail } = await import('./mail')
const { SCHNELLREPORT_VALUES } = await import('@/lib/test-support/schnellreport')

describe('Schnellreport-Mail (4b)', () => {
  it('verlinkt Beispiel und Anfrage auf /profi-report mit UTM, nicht mehr das Kontaktformular', () => {
    const { text, html } = buildReportMail(SCHNELLREPORT_VALUES)
    const query = 'utm_source=schnellreport&amp;utm_medium=email&amp;utm_campaign=profi-report'
    expect(html).toContain(`/profi-report?${query}#beispiel`)
    expect(html).toContain(`/profi-report?${query}#anfrage`)
    expect(html).toContain('So sieht ein Profi-Report aus')
    expect(text).toContain('/profi-report?utm_source=schnellreport&utm_medium=email')
    expect(`${text}${html}`).not.toContain('/kontakt?thema=')
  })
})
