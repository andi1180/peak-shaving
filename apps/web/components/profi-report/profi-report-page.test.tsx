import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import messages from '@/messages/de.json'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/profi-report/actions', () => ({ submitProfiReportAction: vi.fn() }))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('next/image', () => ({
  default: ({ src, alt, loading }: { src: string; alt: string; loading?: 'eager' | 'lazy' }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading={loading} />
  ),
}))

const { ProfiReportPage } = await import('./profi-report-page')
const { SCHNELLREPORT_SETTINGS } = await import('@/lib/schnellreport/settings')

function render() {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Vienna">
      <ProfiReportPage />
    </NextIntlClientProvider>,
  )
}

describe('/profi-report (4b)', () => {
  it('trägt Hero, Preis aus den Einstellungen, Anker, Blätterleiste, PDF-Link, Formular und Kontakt', () => {
    const html = render()

    expect(html).toMatch(/<h1[^>]*>Die genaue Antwort für Ihren Betrieb<\/h1>/)
    expect(html).toContain(SCHNELLREPORT_SETTINGS.price)
    expect(html).toContain('id="beispiel"')
    expect(html).toContain('id="anfrage"')

    const thumbs = html.match(/seite-\d\d-vorschau\.webp/g) ?? []
    expect(thumbs).toHaveLength(11)
    expect(html).toContain('href="/beispiel-report/beispiel-profi-report.pdf"')
    expect(html).toContain('target="_blank"')

    for (const name of [
      'firma',
      'vorname',
      'nachname',
      'email',
      'telefon',
      'lastgang',
      'nachricht',
    ]) {
      expect(html).toContain(`name="${name}"`)
    }
    expect(html).toContain(`${SCHNELLREPORT_SETTINGS.contactName}, ${SCHNELLREPORT_SETTINGS.phone}`)
  })
})
