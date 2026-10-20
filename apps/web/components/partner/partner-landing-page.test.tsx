import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import messages from '@/messages/de.json'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/schnellreport/actions', () => ({
  loadSchnellreportTextsAction: vi.fn(),
  requestSchnellreportCallbackAction: vi.fn(),
}))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const { PartnerLandingPage } = await import('./partner-landing-page')

describe('Partner-Landingpage (3b-3)', () => {
  it('trägt den Schnellcheck neben dem Partnertext', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Vienna">
        <PartnerLandingPage
          partnerName="Raymann Elektrotechnik GmbH"
          partnerSlug="raymann"
          marketingConsentText={null}
          partnerDisclosureConsentText={null}
        />
      </NextIntlClientProvider>,
    )

    // Positivkontrolle: der Partnertext der Seite.
    expect(html).toContain('Raymann Elektrotechnik GmbH empfiehlt Ihnen')
    expect(html).toContain(messages.Schnellcheck.title)
    expect(html).toContain(messages.Schnellcheck.ctaReport)
  })
})
