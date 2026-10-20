import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import messages from '@/messages/de.json'

const pathname = { current: '/' }
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => pathname.current,
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const { HeaderActions, QuickAccessBar } = await import('./quick-access')

function render(path: string) {
  pathname.current = path
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Vienna">
      <HeaderActions />
      <QuickAccessBar />
    </NextIntlClientProvider>,
  )
}

describe('Header-Buttons und Leiste (Leadgen 6)', () => {
  it('Marketing-Seiten: Profi-Report im Header und in der Leiste', () => {
    for (const path of ['/', '/peak-shaving', '/wissen/leistungspreis', '/partner/muster']) {
      const html = render(path)
      expect(html.match(/href="\/profi-report"[^>]*>Profi-Report</g)).toHaveLength(2)
      expect(html).toContain('<nav aria-label="Schnellzugriff"')
      expect(html.match(/>Ersparnis berechnen</g)).toHaveLength(2)
    }
  })

  it('/profi-report: Jetzt anfragen → #anfrage, kein Profi-Report-Button', () => {
    const html = render('/profi-report')
    expect(html.match(/href="#anfrage"[^>]*>Jetzt anfragen</g)).toHaveLength(2)
    expect(html).not.toContain('>Profi-Report<')
  })

  it('Abmelden/Konto: keine Leiste, Ersparnis berechnen bleibt im Header', () => {
    for (const path of ['/abmelden', '/konto']) {
      const html = render(path)
      expect(html).not.toContain('Schnellzugriff')
      expect(html).not.toContain('Profi-Report')
      expect(html).toContain('>Ersparnis berechnen<')
    }
  })
})
