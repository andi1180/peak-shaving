import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Container } from '@/components/ui/layout'
import { JsonLd } from '@/components/json-ld'
import { faqPageLd } from '@/lib/json-ld'
import { COMPANY } from '@/lib/nav'

/*
 * „Gut zu wissen" vor dem Kontakt-CTA (Leadgen 7) nach `docs/prototypes/startseite-profi-teaser-faq.html`.
 * Aufklappbar über `<details>`, damit geschlossene Antworten im ausgelieferten HTML bleiben (Grund wie
 * bei `FaqSection`, die hier wegen Layout, Aufklappen und Link nicht passt). Das `FAQPage`-Markup
 * trägt genau den sichtbaren Antworttext, ein Link zählt mit seiner Beschriftung.
 */

type HomeFaqItem = { q: string; a: string; link?: { label: string; href: string } }

/** Sichtbarer Text einer Antwort — dieselbe Zeichenkette geht ins Strukturdaten-Markup. */
export function homeFaqAnswerText(item: HomeFaqItem): string {
  return item.link ? `${item.a} ${item.link.label}` : item.a
}

export function HomeFaq() {
  const t = useTranslations('Home.Faq')
  const items = t.raw('items') as HomeFaqItem[]

  return (
    <section aria-labelledby="faq-title" className="bg-surface-alt py-[72px] max-[900px]:py-14">
      <JsonLd
        schema={faqPageLd(items.map((item) => ({ q: item.q, a: homeFaqAnswerText(item) })))}
      />
      <Container className="grid items-start gap-12 min-[901px]:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] max-[900px]:gap-5">
        <div>
          <p className="m-0 mb-2.5 text-[12px] font-semibold uppercase tracking-[.08em] text-accent">
            {t('eyebrow')}
          </p>
          <h2
            id="faq-title"
            className="m-0 mb-3 text-balance text-[clamp(26px,3vw,36px)] font-bold leading-[1.12] tracking-[-0.02em] text-ink"
          >
            {t('title')}
          </h2>
          <p className="m-0 text-text-muted">
            {t.rich('hint', {
              address: COMPANY.email,
              email: (chunks) => (
                <a
                  href={`mailto:${COMPANY.email}`}
                  className="font-semibold text-accent hover:text-accent-hover"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>

        <div className="border-t border-line">
          {items.map((item, index) => (
            <details key={item.q} open={index === 0} className="group border-b border-line">
              <summary className="flex cursor-pointer list-none justify-between gap-4 py-[18px] text-[17px] font-semibold text-ink after:flex-none after:text-[22px] after:font-normal after:leading-none after:text-accent after:content-['+'] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy group-open:after:content-['–'] [&::-webkit-details-marker]:hidden">
                {item.q}
              </summary>
              <p className="m-0 mb-[18px] max-w-[62ch] text-text">
                {item.a}
                {item.link && (
                  <>
                    {' '}
                    <Link href={item.link.href} className="text-accent hover:text-accent-hover">
                      {item.link.label}
                    </Link>
                  </>
                )}
              </p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  )
}
