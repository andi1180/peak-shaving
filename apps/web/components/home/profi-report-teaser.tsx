import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/layout'
import { CtaProfiReportLink } from '@/components/analytics/cta-profi-report-link'
import { PAGE_SIZE, pageImage } from '@/lib/profi-report/beispiel'
import {
  PROFI_REPORT_ANFRAGE_ID,
  PROFI_REPORT_BEISPIEL_ID,
  PROFI_REPORT_HREF,
} from '@/lib/profi-report/links'
import { SCHNELLREPORT_SETTINGS, type SchnellreportSettings } from '@/lib/schnellreport/settings'
import { cn } from '@/lib/utils'

/*
 * Profi-Report-Teaser der Startseite (Leadgen 7) nach `docs/prototypes/startseite-profi-teaser-faq.html`:
 * Navy-Vollfläche direkt nach dem Schnellcheck. Preis aus `lib/schnellreport/settings.ts` (eine Quelle
 * mit /profi-report und dem PDF). Farben auf Navy, Radius und Schatten der Seitenbilder sind die
 * Prototyp-Ausnahme aus DESIGN.md.
 */

const BTN =
  'inline-flex items-center justify-center rounded-[9px] px-[22px] py-[15px] text-[15px] font-semibold leading-none no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-navy-accent max-[480px]:w-full'

/*
 * Lage der drei Seiten in Prozent der Stapelhöhe, damit der Stapel unter 900 px mit der Breite
 * skaliert (Seitenverhältnis des Kastens) und keine Seite unten aus der Fläche ragt.
 */
const STACK = [
  { page: 1, className: 'left-[3%] top-[8%] -rotate-[5deg] outline outline-1 outline-navy-line' },
  { page: 11, className: 'right-[3%] top-[11.5%] rotate-[5deg]' },
  { page: 2, className: 'left-[21%] top-[1.2%] z-[2] rotate-[1deg]' },
] as const

export function ProfiReportTeaser({
  settings = SCHNELLREPORT_SETTINGS,
}: {
  settings?: SchnellreportSettings
}) {
  const t = useTranslations('Home.ProfiTeaser')
  const questions = t.raw('questions') as { title: string; text: string }[]
  const price = settings.price.trim()
  const priceNote = settings.priceNote.trim()

  return (
    <section
      id="profi-report"
      aria-labelledby="profi-teaser-title"
      className="overflow-hidden bg-navy py-20 text-navy-foreground max-[900px]:py-14"
    >
      <Container className="grid items-center gap-14 min-[901px]:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] max-[900px]:gap-9">
        <div>
          <p className="m-0 mb-2.5 text-[12px] font-semibold uppercase tracking-[.08em] text-navy-accent">
            {t('eyebrow')}
          </p>
          <h2
            id="profi-teaser-title"
            className="m-0 mb-3 text-balance text-[clamp(30px,3.6vw,44px)] font-bold leading-[1.12] tracking-[-0.02em] text-navy-foreground"
          >
            {t('title')}
          </h2>
          <p className="m-0 max-w-[36em] text-[18px] text-navy-foreground-muted">{t('lead')}</p>

          <ol className="m-0 mt-7 list-none border-t border-navy-line p-0">
            {questions.map((question, index) => (
              <li
                key={question.title}
                className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-b border-navy-line py-3.5"
              >
                <span className="pt-0.5 text-[13px] font-bold tabular-nums text-navy-accent">
                  {index + 1}
                </span>
                <div>
                  <p className="m-0 text-[16.5px] font-semibold text-navy-foreground">
                    {question.title}
                  </p>
                  <p className="m-0 text-[14.5px] text-navy-foreground-muted">{question.text}</p>
                </div>
              </li>
            ))}
          </ol>

          {price && (
            <p className="m-0 mt-7 flex flex-wrap items-baseline gap-3">
              <span className="text-[40px] font-bold leading-none tracking-[-0.02em] tabular-nums">
                {price}
              </span>
              {priceNote && (
                <span className="text-[14px] text-navy-foreground-muted">{priceNote}</span>
              )}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <CtaProfiReportLink
              href={`${PROFI_REPORT_HREF}#${PROFI_REPORT_BEISPIEL_ID}`}
              position="home_teaser"
              variant="beispiel_ansehen"
              className={cn(BTN, 'bg-navy-foreground text-navy hover:bg-navy-subtle')}
            >
              {t('ctaBeispiel')}
            </CtaProfiReportLink>
            <CtaProfiReportLink
              href={`${PROFI_REPORT_HREF}#${PROFI_REPORT_ANFRAGE_ID}`}
              position="home_teaser"
              variant="anfragen"
              className={cn(
                BTN,
                'border-[1.5px] border-navy-line text-navy-foreground hover:border-navy-foreground',
              )}
            >
              {t('ctaAnfragen')}
            </CtaProfiReportLink>
          </div>
          <p className="m-0 mt-3 text-[13px] text-navy-foreground-muted">{t('beispielSource')}</p>
        </div>

        <div
          className="relative h-[480px] max-[900px]:aspect-[100/103] max-[900px]:h-auto max-[900px]:w-full max-[900px]:max-w-[460px]"
          aria-hidden="true"
        >
          {STACK.map(({ page, className }) => (
            <Image
              key={page}
              src={pageImage(page)}
              width={PAGE_SIZE.width}
              height={PAGE_SIZE.height}
              sizes="(min-width: 901px) 290px, 64vw"
              loading="lazy"
              alt=""
              className={cn(
                'absolute h-auto w-[290px] max-w-[64%] rounded-[3px] shadow-[0_2px_6px_rgba(0,0,0,.18),0_28px_50px_-22px_rgba(0,0,0,.6)]',
                className,
              )}
            />
          ))}
          <span className="absolute bottom-0 left-0 z-[3] rounded-full border border-navy-line bg-navy-hover px-3 py-1.5 text-[12.5px] text-navy-foreground">
            {t('stackTag')}
          </span>
        </div>
      </Container>
    </section>
  )
}
