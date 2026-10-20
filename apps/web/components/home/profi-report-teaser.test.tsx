import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import messages from '@/messages/de.json'

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))
vi.mock('next/image', () => ({
  default: ({ src, alt, loading, width, height }: React.ComponentProps<'img'>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading={loading} width={width} height={height} />
  ),
}))

const { ProfiReportTeaser } = await import('./profi-report-teaser')
const { HomeFaq } = await import('./home-faq')
const { SCHNELLREPORT_SETTINGS } = await import('@/lib/schnellreport/settings')

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Vienna">
      {node}
    </NextIntlClientProvider>,
  )
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")

describe('Profi-Report-Teaser (Leadgen 7)', () => {
  it('Buttons, Preis aus der Einstellung, Seiten 1/2/11 mit festen Massen und Lazy Loading', () => {
    const html = render(<ProfiReportTeaser />)
    expect(html).toContain('href="/profi-report#beispiel"')
    expect(html).toContain('href="/profi-report#anfrage"')
    expect(html).toContain(SCHNELLREPORT_SETTINGS.price)
    expect(html).toContain(SCHNELLREPORT_SETTINGS.priceNote)
    const images = html.match(/<img [^>]+>/g) ?? []
    expect(images.map((img) => img.match(/seite-(\d\d)\.webp/)?.[1])).toEqual(['01', '11', '02'])
    for (const img of images) expect(img).toMatch(/loading="lazy".*width="1241".*height="1754"/)
  })

  it('zeigt einen geänderten Preis aus der Einstellung', () => {
    const html = render(
      <ProfiReportTeaser
        settings={{ ...SCHNELLREPORT_SETTINGS, price: '612 €', priceNote: 'Aktion bis 31.03.2027' }}
      />,
    )
    expect(html).toContain('612 €')
    expect(html).toContain('Aktion bis 31.03.2027')
    expect(html).not.toContain(SCHNELLREPORT_SETTINGS.price)
  })
})

describe('FAQ der Startseite (Leadgen 7)', () => {
  it('sechs Fragen, erste offen, Strukturdaten wortgleich mit dem sichtbaren Text', () => {
    const html = render(<HomeFaq />)
    const details = html.match(/<details[^>]*>.*?<\/details>/g) ?? []
    expect(details).toHaveLength(6)
    expect(details.map((d) => /^<details[^>]* open=""/.test(d))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ])
    expect(details[3]).toContain('href="/wissen/leistungstarif-2027"')

    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]!)
    expect(ld['@type']).toBe('FAQPage')
    const visible = details.map((d) => ({
      q: text(d.match(/<summary[^>]*>(.*?)<\/summary>/)![1]!),
      a: text(d.match(/<p[^>]*>(.*?)<\/p>/)![1]!),
    }))
    expect(
      ld.mainEntity.map((e: { name: string; acceptedAnswer: { text: string } }) => ({
        q: e.name,
        a: e.acceptedAnswer.text,
      })),
    ).toEqual(visible)
  })
})
