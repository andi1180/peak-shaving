'use client'

import * as React from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import {
  PAGE_SIZE,
  THUMB_SIZE,
  chapterOf,
  pageImage,
  pageThumb,
  type PagerPage,
  type PagerTocEntry,
} from '@/lib/profi-report/beispiel'
import { BEISPIEL_REPORT_PDF_HREF } from '@/lib/profi-report/links'

/*
 * Blätterleiste des Beispiel-Reports (Leadgen 4b): grosses Bild, Vorschaubilder darunter,
 * Erklärung und Inhaltsverzeichnis rechts. Bilder aus `public/beispiel-report/` (Schritt 4a).
 * Tastatur: die Vorschaubilder sind Knöpfe; Pfeil links/rechts blättert und nimmt den Fokus mit.
 */

export function ReportPager({
  pages,
  toc,
  initialIndex = 1,
}: {
  pages: PagerPage[]
  toc: PagerTocEntry[]
  initialIndex?: number
}) {
  const t = useTranslations('ProfiReport.beispiel')
  const [index, setIndex] = React.useState(initialIndex)
  const thumbsRef = React.useRef<HTMLDivElement>(null)
  const current = pages[index]!
  const chapter = chapterOf(toc, current.page)

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = (index + step + pages.length) % pages.length
    setIndex(next)
    thumbsRef.current?.querySelectorAll('button')[next]?.focus()
  }

  return (
    <div className="mt-7 grid items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <div className="grid justify-items-center gap-[14px] rounded-[14px] bg-surface-sunken p-[22px] max-[520px]:p-3">
        <Image
          key={current.page}
          src={pageImage(current.page)}
          width={PAGE_SIZE.width}
          height={PAGE_SIZE.height}
          sizes="(min-width: 1024px) 480px, 92vw"
          quality={90}
          alt={t('imageAlt', { page: current.page, title: current.title })}
          className="h-auto w-full max-w-[480px] rounded-[3px] bg-surface shadow-[0_2px_4px_rgba(15,23,42,.08),0_16px_32px_-18px_rgba(15,23,42,.4)]"
        />
        <div
          ref={thumbsRef}
          role="group"
          aria-label={t('thumbsLabel')}
          onKeyDown={onKeyDown}
          className="flex flex-wrap justify-center gap-2"
        >
          {pages.map((p, i) => (
            <button
              key={p.page}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={i === index ? 'true' : undefined}
              aria-label={t('thumb', { page: p.page, title: p.title })}
              className={cn(
                'w-14 cursor-pointer rounded-[4px] border-2 border-transparent bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy',
                i === index && 'border-accent',
              )}
            >
              <Image
                src={pageThumb(p.page)}
                width={THUMB_SIZE.width}
                height={THUMB_SIZE.height}
                sizes="56px"
                loading="lazy"
                unoptimized
                alt=""
                className="block h-auto w-full rounded-[2px]"
              />
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-[14px]">
        <span className="text-[12.5px] tabular-nums text-text-faint" aria-live="polite">
          {t('pageOf', { page: current.page })}
        </span>
        <h3 className="m-0 text-[20px] font-semibold text-navy">{current.title}</h3>
        <p className="m-0 text-text">{current.text}</p>
        <div className="mt-2.5 border-t border-line" aria-label={t('tocLabel')} role="list">
          {toc.map((entry) => (
            <div
              key={entry.page}
              role="listitem"
              aria-current={entry.page === chapter ? 'true' : undefined}
              className={cn(
                'flex justify-between gap-3 border-b border-line py-[9px] text-[14.5px]',
                entry.page === chapter && 'font-semibold text-accent',
              )}
            >
              <span>{entry.title}</span>
              <span
                className={cn(
                  'tabular-nums',
                  entry.page === chapter ? 'text-accent' : 'text-text-faint',
                )}
              >
                {entry.page}
              </span>
            </div>
          ))}
        </div>
        <a
          href={BEISPIEL_REPORT_PDF_HREF}
          target="_blank"
          rel="noopener"
          className="mt-1 font-semibold text-accent underline underline-offset-4 hover:text-accent-hover"
        >
          {t('pdf')}
        </a>
      </div>
    </div>
  )
}
