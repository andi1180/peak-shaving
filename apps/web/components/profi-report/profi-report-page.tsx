import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/layout'
import { cn } from '@/lib/utils'
import { PROFI_REPORT_ANFRAGE_ID, PROFI_REPORT_BEISPIEL_ID } from '@/lib/profi-report/links'
import {
  SCHNELLREPORT_SETTINGS,
  priceOffer,
  type SchnellreportSettings,
} from '@/lib/schnellreport/settings'
import { ProfiReportForm } from './profi-report-form'
import {
  PAGE_SIZE,
  pageImage,
  type PagerPage,
  type PagerTocEntry,
} from '@/lib/profi-report/beispiel'
import { ReportPager } from './report-pager'

/*
 * /profi-report (Leadgen 4b) nach `docs/prototypes/profi-report-prototyp.html`: Hero mit Preisbox und
 * Seitenstapel, „Was Sie bekommen", Blätterleiste (#beispiel), Ablauf, Unterlagen + Fragen,
 * Anfrage (#anfrage). Preis und Kontakt aus `lib/schnellreport/settings.ts` — dieselbe Quelle wie
 * das Schnellreport-PDF. Radius/Schatten von Preisbox, Seitenbildern und Formular sind die
 * Prototyp-Ausnahme aus DESIGN.md.
 */

const EYEBROW = 'm-0 mb-2.5 text-[12px] font-semibold uppercase tracking-[.08em] text-accent'
const H2 =
  'm-0 mb-2.5 text-balance text-[clamp(24px,2.8vw,32px)] font-bold leading-[1.15] tracking-[-0.02em] text-navy'
const LEAD = 'm-0 max-w-[34em] text-[18px] text-text-muted max-[520px]:text-[16.5px]'
const SECTION = 'py-16 max-[520px]:py-11'
const BTN =
  'inline-flex items-center justify-center gap-2 rounded-[9px] bg-accent px-5 py-[14px] text-[15px] font-semibold leading-none text-accent-foreground no-underline hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy'
const PAGE_SHADOW = 'shadow-[0_2px_4px_rgba(15,23,42,.08),0_22px_44px_-20px_rgba(15,23,42,.45)]'

/** Seiten des Hero-Stapels (1, 2, 7) samt Lage, wie im Prototyp. */
const STACK = [
  { page: 1, className: 'left-0 top-[30px] -rotate-[4deg]' },
  { page: 7, className: 'right-0 top-[46px] rotate-[5deg]' },
  { page: 2, className: 'left-[22%] top-[10px] z-[2] rotate-[1.5deg]' },
] as const

export function ProfiReportPage({
  settings = SCHNELLREPORT_SETTINGS,
}: {
  settings?: SchnellreportSettings
}) {
  const t = useTranslations('ProfiReport')
  const price = settings.price.trim()
  const priceNote = settings.priceNote.trim()

  const gets = t.raw('gets.items') as { title: string; text: string }[]
  const pages = t.raw('beispiel.pages') as PagerPage[]
  const toc = t.raw('beispiel.toc') as PagerTocEntry[]
  const steps = t.raw('ablauf.steps') as { title: string; text: string }[]
  const unterlagen = t.raw('unterlagen.items') as string[]
  const faq = [
    ...(price ? [{ q: t('faq.price.q'), a: t('faq.price.a', { offer: priceOffer(settings) }) }] : []),
    ...(t.raw('faq.items') as { q: string; a: string }[]),
  ]
  const contact = [settings.contactName, settings.phone].filter(Boolean).join(', ')

  return (
    <>
      <Container className="grid items-center gap-14 pb-16 pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <div>
          <p className={EYEBROW}>{t('hero.eyebrow')}</p>
          <h1 className="m-0 mb-[18px] text-balance text-[clamp(34px,4.2vw,50px)] font-bold leading-[1.06] tracking-[-0.025em] text-navy">
            {t('hero.title')}
          </h1>
          <p className={cn(LEAD, 'mb-[26px]')}>{t('hero.lead')}</p>
          <div className="grid max-w-[460px] gap-[14px] rounded-[14px] border border-line bg-surface px-[22px] py-5 shadow-[0_1px_2px_rgba(15,23,42,.04),0_14px_32px_-22px_rgba(15,23,42,.25)]">
            {price && (
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-[40px] font-bold leading-none tracking-[-0.02em] text-navy tabular-nums">
                  {price}
                </span>
                {priceNote && (
                  <span className="text-[14px] text-text-muted">
                    {/* Wie im Prototyp zweizeilig: „Einführungspreis bis …" / „zzgl. USt." */}
                    {priceNote.split(', ').map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )}
            <a className={BTN} href={`#${PROFI_REPORT_ANFRAGE_ID}`}>
              {t('hero.cta')}
            </a>
            <p className="m-0 text-[13px] text-text-faint">{t('hero.note')}</p>
          </div>
        </div>
        <div
          className="relative h-[470px] max-lg:h-[380px] max-[520px]:h-[300px]"
          aria-hidden="true"
        >
          {STACK.map(({ page, className }) => (
            <Image
              key={page}
              src={pageImage(page)}
              width={PAGE_SIZE.width}
              height={PAGE_SIZE.height}
              sizes="(min-width: 1024px) 300px, 58vw"
              priority
              alt=""
              className={cn(
                'absolute h-auto w-[300px] max-w-[70%] rounded-[4px] max-[520px]:w-[58%]',
                PAGE_SHADOW,
                className,
              )}
            />
          ))}
          <span className="absolute bottom-1.5 left-0 z-[3] rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-text-muted">
            {t('hero.tag')}
          </span>
        </div>
      </Container>

      <section className={cn(SECTION, 'bg-surface-alt')}>
        <Container>
          <p className={EYEBROW}>{t('gets.eyebrow')}</p>
          <h2 className={H2}>{t('gets.title')}</h2>
          <div className="mt-7 grid gap-[18px] lg:grid-cols-3">
            {gets.map((item, i) => (
              <div
                key={item.title}
                className="grid content-start gap-1.5 rounded-xl border border-line bg-surface px-5 py-[18px]"
              >
                <span className="text-[12px] font-bold tracking-[.06em] text-accent">{i + 1}</span>
                <b className="text-[16px] text-ink">{item.title}</b>
                <p className="m-0 text-[14.5px] text-text-muted">{item.text}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section id={PROFI_REPORT_BEISPIEL_ID} className={cn(SECTION, 'scroll-mt-[var(--header-h)]')}>
        <Container>
          <p className={EYEBROW}>{t('beispiel.eyebrow')}</p>
          <h2 className={H2}>{t('beispiel.title')}</h2>
          <p className={LEAD}>{t('beispiel.lead')}</p>
          <ReportPager pages={pages} toc={toc} />
        </Container>
      </section>

      <section className={cn(SECTION, 'bg-surface-alt')}>
        <Container>
          <p className={EYEBROW}>{t('ablauf.eyebrow')}</p>
          <h2 className={H2}>{t('ablauf.title')}</h2>
          <ol className="m-0 mt-7 grid list-none gap-[18px] p-0 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <li key={step.title} className="grid content-start gap-1.5">
                <span
                  className="grid h-[30px] w-[30px] place-items-center rounded-full border-[1.5px] border-accent bg-accent-subtle text-[14px] font-bold text-accent"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <b className="text-ink">{step.title}</b>
                <p className="m-0 text-[14.5px] text-text-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className={SECTION}>
        <Container className="grid gap-12 lg:grid-cols-2">
          <div>
            <p className={EYEBROW}>{t('unterlagen.eyebrow')}</p>
            <h2 className={H2}>{t('unterlagen.title')}</h2>
            <ul className="m-0 mt-4 grid list-none gap-2.5 p-0">
              {unterlagen.map((item) => (
                <li key={item} className="grid grid-cols-[18px_1fr] gap-2.5 text-[15px]">
                  <span
                    className="mt-1 h-3.5 w-3.5 rounded-[3px] border-[1.5px] border-text-muted"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
            <p className="m-0 mt-[14px] text-[13px] text-text-faint">{t('unterlagen.note')}</p>
          </div>
          <div>
            <p className={EYEBROW}>{t('faq.eyebrow')}</p>
            <h2 className={H2}>{t('faq.title')}</h2>
            <div className="mt-4 border-t border-line">
              {faq.map((item) => (
                <details key={item.q} className="group border-b border-line py-[14px]">
                  <summary className="flex cursor-pointer list-none justify-between gap-3 font-semibold text-ink [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span className="font-bold text-accent" aria-hidden="true">
                      <span className="group-open:hidden">+</span>
                      <span className="hidden group-open:inline">–</span>
                    </span>
                  </summary>
                  <p className="m-0 mt-2 text-[15px] text-text-muted">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <section
        id={PROFI_REPORT_ANFRAGE_ID}
        className={cn(SECTION, 'scroll-mt-[var(--header-h)] bg-surface-alt')}
      >
        <Container className="grid items-start gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <p className={EYEBROW}>{t('anfrage.eyebrow')}</p>
            <h2 className={H2}>{t('anfrage.title')}</h2>
            <p className={LEAD}>{t('anfrage.lead')}</p>
            {(contact || settings.email) && (
              <div className="mt-5 grid gap-1 text-[15px]">
                <span>{t('anfrage.contactIntro')}</span>
                {contact && (
                  <b className="text-ink">
                    {settings.phone ? (
                      <a href={`tel:${settings.phone.replace(/\s+/g, '')}`} className="text-ink">
                        {contact}
                      </a>
                    ) : (
                      contact
                    )}
                  </b>
                )}
                {settings.email && (
                  <a href={`mailto:${settings.email}`} className="text-text">
                    {settings.email}
                  </a>
                )}
              </div>
            )}
          </div>
          <ProfiReportForm fallbackEmail={settings.email} />
        </Container>
      </section>
    </>
  )
}
