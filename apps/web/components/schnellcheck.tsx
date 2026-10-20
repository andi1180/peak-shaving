'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { SchnellreportForm } from '@/components/schnellreport-form'
import { kontaktHrefFor } from '@/lib/kontakt/themen'
import { PARTNER_QUERY_PARAM } from '@/lib/leads/partner'
import { cn } from '@/lib/utils'
import {
  KW_SLIDER,
  computeSchnellcheck,
  formatGrouped,
  formatTyped,
  parseGroupedNumber,
  type Country,
} from '@/lib/schnellcheck'

/*
 * Schnellcheck (Leadgen-Umbau Schritt 3a) nach dem freigegebenen Prototyp
 * `docs/prototypes/schnellcheck-prototyp.html`. Die Rechnung ist rein (`lib/schnellcheck.ts`).
 *
 * Abweichungen vom Prototyp: keine vorbelegten Beispielwerte in den Feldern (sie sähen aus wie
 * Angaben des Besuchers), und der Feldrand ist `line-input` (AA 3:1). Österreich und Deutschland
 * teilen sich seit Schritt 3a-2 dieselbe Ergebnisansicht; nur Leistungspreis und Quellenzeile
 * unterscheiden sich.
 * Karte mit Radius/Schatten: Ausnahme in DESIGN.md. Der Schnellreport öffnet seit Schritt 3b-2
 * sein Formular direkt unter dem Report-Block; Profi-Report und Erstgespräch führen bis Schritt 4
 * ins Kontaktformular mit vorbelegtem Thema.
 */

const LABEL = 'text-[13.5px] font-semibold text-ink'
const SMALL = 'm-0 text-[12.5px] text-text-faint'
const BTN =
  'inline-flex items-center gap-2 rounded-[9px] px-5 py-[14px] text-[15px] font-semibold leading-none no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy max-[480px]:w-full max-[480px]:justify-center'
const BAR_TRANSITION =
  '[transition:width_.6s_cubic-bezier(.2,.7,.2,1)] motion-reduce:[transition:none]'

type FieldKey = 'kwh' | 'kw' | 'bill'

const FIELDS: { key: FieldKey; unit: 'unitKwh' | 'unitKw' | 'unitEur'; optional: boolean }[] = [
  { key: 'kwh', unit: 'unitKwh', optional: false },
  { key: 'kw', unit: 'unitKw', optional: true },
  { key: 'bill', unit: 'unitEur', optional: true },
]

export function Schnellcheck({
  showHeading = false,
  partnerSlug,
}: {
  showHeading?: boolean
  /** Partner aus dem Pfad (`/partner/<slug>`); sonst gilt `?partner=` der Adresse. */
  partnerSlug?: string
}) {
  const t = useTranslations('Schnellcheck')
  const uid = React.useId()
  const [country, setCountry] = React.useState<Country>('AT')
  const [raw, setRaw] = React.useState<Record<FieldKey, string>>({ kwh: '', kw: '', bill: '' })
  const [sliderKw, setSliderKw] = React.useState<number>(KW_SLIDER.initial)
  const [reportOpen, setReportOpen] = React.useState(false)
  const [partnerFromQuery, setPartnerFromQuery] = React.useState<string | undefined>(undefined)

  // `?partner=<slug>` wie im Kontaktformular: nur aus der Adresse gelesen, nichts gespeichert;
  // ob der Slug gilt, entscheidet der Server.
  React.useEffect(() => {
    const partner = new URLSearchParams(window.location.search).get(PARTNER_QUERY_PARAM)
    if (partner) setPartnerFromQuery(partner)
  }, [])
  const reportFormRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (reportOpen) reportFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [reportOpen])

  const kwh = parseGroupedNumber(raw.kwh)
  const kw = parseGroupedNumber(raw.kw)
  const bill = parseGroupedNumber(raw.bill)
  const result = computeSchnellcheck({ country, kwh, kw, bill, sliderKw })

  // Die eingegebenen Werte reisen als vorbelegte Nachricht ins Kontaktformular.
  const prefill = [
    t('prefillIntro'),
    t('prefillCountry', { country: country === 'AT' ? t('countryAT') : t('countryDE') }),
    kwh !== null && t('prefillKwh', { kwh: formatGrouped(kwh) }),
    kw !== null && t('prefillKw', { kw: formatGrouped(kw) }),
    bill !== null && t('prefillBill', { bill: formatGrouped(bill) }),
  ]
    .filter(Boolean)
    .join('\n')
  const hrefFor = (thema: string) => kontaktHrefFor(thema, kwh === null ? undefined : prefill)

  const countryButton = (value: Country, label: string) => (
    <button
      type="button"
      aria-pressed={country === value}
      onClick={() => setCountry(value)}
      className={cn(
        'cursor-pointer rounded-[7px] px-[14px] py-2 text-[13px] font-semibold leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy',
        country === value ? 'bg-navy text-navy-foreground' : 'bg-transparent text-text-muted',
      )}
    >
      {label}
    </button>
  )

  return (
    <div>
      {showHeading && (
        <>
          <p className="mb-[10px] text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">
            {t('eyebrow')}
          </p>
          <h2 className="mb-2 text-balance text-[clamp(28px,3.4vw,38px)] font-bold leading-[1.1] tracking-[-0.02em] text-navy">
            {t('title')}
          </h2>
          <p className="mb-7 max-w-[38em] text-[17px] text-text-muted">{t('intro')}</p>
        </>
      )}

      <section
        aria-label={t('ariaLabel')}
        className="overflow-hidden rounded-[16px] border border-line bg-surface shadow-[0_1px_2px_rgba(23,23,23,0.04),0_18px_40px_-24px_rgba(23,23,23,0.22)]"
      >
        <div className="grid gap-5 px-[26px] py-6 max-[480px]:px-4 max-[480px]:py-[18px]">
          <div
            role="group"
            aria-label={t('countryLabel')}
            className="inline-flex gap-[3px] justify-self-start rounded-[10px] border border-line p-[3px]"
          >
            {countryButton('AT', t('countryAT'))}
            {countryButton('DE', t('countryDE'))}
          </div>

          <div className="grid grid-cols-1 gap-[18px] min-[721px]:grid-cols-3">
            {FIELDS.map((field) => {
              const id = `${uid}-${field.key}`
              return (
                <div key={field.key} className="grid min-w-0 content-start gap-[6px]">
                  <label htmlFor={id} className={LABEL}>
                    {t(`${field.key}Label`)}{' '}
                    {field.optional && (
                      <span className="font-medium text-text-faint">{t('optional')}</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      id={id}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder={t(`${field.key}Placeholder`)}
                      value={raw[field.key]}
                      onChange={(e) =>
                        setRaw((prev) => ({ ...prev, [field.key]: formatTyped(e.target.value) }))
                      }
                      className="w-full rounded-[10px] border border-line-input bg-surface py-[13px] pl-[14px] pr-[52px] text-[17px] font-medium leading-none tabular-nums text-ink focus:border-transparent focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-accent"
                    />
                    <span className="pointer-events-none absolute right-[14px] top-1/2 -translate-y-1/2 text-[13px] font-semibold text-text-faint">
                      {t(field.unit)}
                    </span>
                  </div>
                  <span className="text-[12.5px] text-text-faint">{t(`${field.key}Hint`)}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div
          aria-live="polite"
          className="grid gap-[22px] border-t border-line bg-surface-alt px-[26px] pb-[26px] pt-6 max-[480px]:px-4 max-[480px]:py-[18px]"
        >
          {!result && <p className="m-0 text-[15px] text-text-muted">{t('empty')}</p>}

          <div hidden={!result}>
            {result?.smallConsumption && (
              <div className="mb-[18px] rounded-[10px] border border-line bg-surface px-[14px] py-3 text-[14px] text-text-muted">
                {t('small')}
              </div>
            )}

            {result && (
              <div>
                <div className="grid gap-1">
                  <span className="text-[clamp(34px,5vw,46px)] font-bold leading-[1.05] tracking-[-0.02em] tabular-nums text-negative">
                    {t('big', { amount: formatGrouped(result.peakCostEur) })}
                  </span>
                  <span className="text-[16px] font-semibold text-ink">
                    {result.kwFromInput
                      ? t('bigSubKnown')
                      : t('bigSubExample', { kw: formatGrouped(result.kw) })}
                  </span>
                </div>

                {!result.kwFromInput && (
                  <div className="mt-[18px] grid gap-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={LABEL}>{t('sliderLabel')}</span>
                      <b className="whitespace-nowrap text-[15px] tabular-nums text-ink">
                        {t('kwValue', { kw: formatGrouped(sliderKw) })}
                      </b>
                    </div>
                    <input
                      type="range"
                      min={KW_SLIDER.min}
                      max={KW_SLIDER.max}
                      step={KW_SLIDER.step}
                      value={sliderKw}
                      aria-label={t('sliderAria')}
                      onChange={(e) => setSliderKw(Number(e.target.value))}
                      className="w-full accent-accent"
                    />
                    <div className="flex justify-between text-[11.5px] tabular-nums text-text-faint">
                      {[KW_SLIDER.min, 500, KW_SLIDER.max].map((value) => (
                        <span key={value}>{t('kwValue', { kw: formatGrouped(value) })}</span>
                      ))}
                    </div>
                  </div>
                )}

                {result.bill && (
                  <div className="mt-5 grid gap-[10px]">
                    <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-faint">
                      {t('vizTitle')}
                    </span>
                    <div
                      role="img"
                      aria-label={t('billAria', {
                        bill: formatGrouped(result.bill.billEur),
                        peak: formatGrouped(result.bill.peakEur),
                      })}
                      className="flex h-11 overflow-hidden rounded-[10px] border border-line bg-surface"
                    >
                      <div
                        className={cn('h-full bg-line-strong', BAR_TRANSITION)}
                        style={{ width: `${(100 - result.bill.share).toFixed(1)}%` }}
                      />
                      <div
                        className={cn('h-full bg-negative', BAR_TRANSITION)}
                        style={{ width: `${result.bill.share.toFixed(1)}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap justify-between gap-3 text-[13px] text-text-muted">
                      <span>
                        <Swatch className="bg-line-strong" />
                        {t('legendRest')}{' '}
                        <b className="tabular-nums text-ink">
                          {t('eur', { amount: formatGrouped(result.bill.restEur) })}
                        </b>
                      </span>
                      <span>
                        <Swatch className="bg-negative" />
                        {t('legendPeak')}{' '}
                        <b className="tabular-nums text-negative">
                          {t('eur', { amount: formatGrouped(result.bill.peakEur) })}
                        </b>{' '}
                        ·{' '}
                        <b className="tabular-nums text-negative">
                          {t('percent', { pct: result.bill.percent })}
                        </b>
                      </span>
                    </div>
                  </div>
                )}

                <div className="mt-5 flex items-center gap-[14px] rounded-[12px] border border-line bg-surface px-4 py-[14px]">
                  <span className="whitespace-nowrap text-[22px] font-bold tabular-nums text-accent">
                    {t('savingValue', { amount: formatGrouped(result.savingEur) })}
                  </span>
                  <p className="m-0 text-[14px] text-text">{t('savingText')}</p>
                </div>
                <p className={cn(SMALL, 'mt-[10px]')}>
                  {result.usageHours === null
                    ? t('noteAT', { price: result.demandPrice })
                    : t('noteDE', {
                        price: result.demandPrice,
                        hours: formatGrouped(result.usageHours),
                      })}
                </p>
              </div>
            )}

            <div className="mt-6 grid grid-cols-[170px_minmax(0,1fr)] items-center gap-[26px] rounded-[14px] border border-line bg-surface p-[22px] max-[620px]:grid-cols-1 max-[620px]:justify-items-center">
              <PdfPreview
                peakCostEur={result?.peakCostEur ?? null}
                share={result?.bill?.share ?? 0}
                title={t('pdfTitle')}
                forLabel={t('pdfFor')}
                caption={t('pdfCaption')}
                amount={result ? t('eur', { amount: formatGrouped(result.peakCostEur) }) : ''}
              />
              <div className="grid min-w-0 justify-items-start gap-[14px] max-[620px]:justify-items-stretch">
                <h3 className="m-0 text-[18px] font-semibold tracking-[-0.01em] text-navy">
                  {t('offerTitle')}
                </h3>
                <ul className="m-0 grid list-none gap-2 p-0">
                  {(['check1', 'check2', 'check3', 'check4', 'check5'] as const).map((key) => (
                    <li
                      key={key}
                      className="relative pl-[26px] text-[14.5px] leading-[1.45] text-text"
                    >
                      <CheckIcon />
                      {t.rich(key, {
                        b: (chunks) => <b className="font-semibold text-ink">{chunks}</b>,
                      })}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  aria-expanded={reportOpen}
                  aria-controls={`${uid}-report-form`}
                  onClick={() => setReportOpen(true)}
                  className={cn(
                    BTN,
                    'cursor-pointer bg-accent text-accent-foreground hover:bg-accent-hover max-[620px]:justify-center',
                  )}
                >
                  {t('ctaReport')}
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
                    <path
                      d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <p className={SMALL}>{t('reportNote')}</p>
              </div>
            </div>

            {reportOpen && (
              <div id={`${uid}-report-form`} ref={reportFormRef} className="mt-4 scroll-mt-6">
                <SchnellreportForm
                  check={{ country, kwh, kw, bill, sliderKw }}
                  partnerSlug={partnerSlug ?? partnerFromQuery}
                />
              </div>
            )}

            <div className="mt-[22px] grid gap-3">
              <p className="m-0 text-balance text-[15.5px] font-semibold text-ink">{t('teaser')}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={hrefFor('profiReport')}
                  className={cn(BTN, 'border border-line bg-surface text-navy hover:border-navy')}
                >
                  {t('ctaProfi')}
                </Link>
                <span className={SMALL}>
                  {t.rich('erstgespraech', {
                    link: (chunks) => (
                      <Link href={hrefFor('erstgespraech')} className="text-navy underline">
                        {chunks}
                      </Link>
                    ),
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function Swatch({ className }: { className: string }) {
  return (
    <i
      className={cn(
        'mr-[6px] inline-block h-[10px] w-[10px] rounded-[3px] align-[-1px]',
        className,
      )}
    />
  )
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      className="absolute left-0 top-[3px]"
    >
      <circle
        cx="8"
        cy="8"
        r="7.25"
        fill="var(--color-accent-subtle)"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
      />
      <path
        d="M5 8.2 7 10l4-4"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Gestapelte PDF-Seiten mit der eigenen Zahl und dem Anteilsbalken — rein dekorativ. */
function PdfPreview({
  peakCostEur,
  share,
  title,
  forLabel,
  caption,
  amount,
}: {
  peakCostEur: number | null
  share: number
  title: string
  forLabel: string
  caption: string
  amount: string
}) {
  const page =
    'absolute h-[200px] w-[150px] rounded-[6px] border border-line bg-surface shadow-[0_8px_20px_-12px_rgba(23,23,23,0.35)]'
  return (
    <div aria-hidden="true" className="relative h-[220px] w-[170px]">
      <div className={cn(page, 'left-[18px] top-4 rotate-[5deg]')} />
      <div className={cn(page, 'left-[10px] top-2 rotate-[2deg]')} />
      <div className={cn(page, 'left-0 top-0 grid content-start gap-1 px-3 py-[14px]')}>
        <div className="text-[7px] font-bold tracking-[0.06em] text-navy">
          COOL<span className="text-accent">i</span>N ENERGY
        </div>
        <div className="mt-2 text-[13px] font-bold text-navy">{title}</div>
        <div className="text-[7.5px] text-text-faint">{forLabel}</div>
        {peakCostEur !== null && (
          <>
            <div className="mt-[10px] text-[17px] font-bold tabular-nums text-negative">
              {amount}
            </div>
            <div className="text-[7px] text-text-muted">{caption}</div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-[3px] bg-line-strong">
              <i className="flex-1 bg-line-strong" />
              <i
                className={cn('bg-negative', BAR_TRANSITION)}
                style={{ width: `${share.toFixed(1)}%` }}
              />
            </div>
          </>
        )}
        <div className="mt-3 grid gap-1">
          <i className="block h-1 w-full rounded-[2px] bg-line" />
          <i className="block h-1 w-full rounded-[2px] bg-line" />
          <i className="block h-1 w-[60%] rounded-[2px] bg-line" />
        </div>
      </div>
    </div>
  )
}
