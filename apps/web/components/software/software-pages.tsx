import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { Link } from '@/i18n/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { kontaktHrefFor } from '@/lib/kontakt/themen'
import { pageAlternates } from '@/lib/seo'
import {
  SOFTWARE_HREF,
  SOFTWARE_KONTAKT_THEMA,
  SOFTWARE_MODULES,
  findSoftwareModule,
  metaDescriptionFromLead,
  softwareModuleHref,
  softwareModuleImage,
  softwareNavKey,
  type SoftwareModule,
} from '@/lib/software'

type Item = { label: string; text: string }

const BRAND_SUFFIX = 'COOLiN ENERGY'

/** Volle Spaltenbreite: Container 1152 px minus 2 × 24 px Rand, darunter Viewport minus Rand. */
const MODULE_IMAGE_SIZES =
  '(min-width: 1152px) 1104px, (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)'
const CARD_IMAGE_SIZES =
  '(min-width: 1152px) 352px, (min-width: 1024px) 31vw, (min-width: 768px) 46vw, calc(100vw - 32px)'

export async function softwareOverviewMetadata(locale: string): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'Software' })
  return {
    title: `${t('Overview.title')} – ${t('eyebrow')} — ${BRAND_SUFFIX}`,
    description: metaDescriptionFromLead(t('Overview.lead')),
    alternates: pageAlternates(locale, SOFTWARE_HREF),
  }
}

export async function softwareModuleMetadata(locale: string, key: string): Promise<Metadata> {
  const mod = findSoftwareModule(key)
  const t = await getTranslations({ locale, namespace: 'Software' })
  return {
    title: `${t(`Modules.${key}.title`)} – ${t('eyebrow')} — ${BRAND_SUFFIX}`,
    description: metaDescriptionFromLead(t(`Modules.${key}.lead`)),
    alternates: pageAlternates(locale, softwareModuleHref(mod)),
  }
}

function StatusBadge() {
  const t = useTranslations('Software')
  return (
    <Badge variant="navy" className="whitespace-normal">
      {t('status')}
    </Badge>
  )
}

/** Abschluss mit dem einen CTA der Seite — gleiche Navy-Fläche wie auf Leistungs-/Branchenseiten. */
function Closing() {
  const t = useTranslations('Software.Closing')
  return (
    <section className="bg-navy text-navy-foreground">
      <Container className="py-16 sm:py-24">
        <div className="max-w-prose">
          <h2 className="text-h2 text-navy-foreground">{t('title')}</h2>
          <p className="mt-5 text-body text-white/80">{t('text')}</p>
          <Button asChild variant="secondary" size="lg" className="mt-8">
            <Link href={kontaktHrefFor(SOFTWARE_KONTAKT_THEMA)}>{t('button')}</Link>
          </Button>
        </div>
      </Container>
    </section>
  )
}

/** Karte mit Bild, Titel, Kurztext und Status; der Titel-Link deckt die ganze Karte ab. */
function ModuleCard({ mod }: { mod: SoftwareModule }) {
  const t = useTranslations(`Software.Modules.${mod.key}`)
  return (
    <li className="relative flex flex-col overflow-hidden rounded-md border border-line bg-surface transition-colors focus-within:border-line-strong hover:border-line-strong">
      <Image
        src={softwareModuleImage(mod)}
        alt=""
        width={1200}
        height={760}
        sizes={CARD_IMAGE_SIZES}
        className="h-auto w-full border-b border-line"
      />
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-h3 text-ink">
          <Link
            href={softwareModuleHref(mod)}
            className="outline-none after:absolute after:inset-0 focus-visible:underline"
          >
            {t('title')}
          </Link>
        </h3>
        <p className="mt-2 flex-1 text-body text-text-muted">{t('card')}</p>
        <div className="mt-4">
          <StatusBadge />
        </div>
      </div>
    </li>
  )
}

export function SoftwareOverviewPage() {
  const t = useTranslations('Software')

  return (
    <>
      <Container className="py-16 sm:py-24">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('Overview.title')}</h1>
        <p className="mt-5 max-w-prose text-lead text-text">{t('Overview.lead')}</p>
      </Container>

      <Section tone="alt">
        <Container>
          <h2 className="max-w-prose text-h2 text-ink">{t('Overview.why.title')}</h2>
          <p className="mt-4 max-w-prose text-body text-text">{t('Overview.why.text')}</p>
        </Container>
      </Section>

      <Section>
        <Container>
          <h2 className="max-w-prose text-h2 text-ink">{t('Overview.modules.title')}</h2>
          <p className="mt-4 max-w-prose text-body text-text-muted">{t('Overview.modules.text')}</p>
          <ul className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {SOFTWARE_MODULES.map((mod) => (
              <ModuleCard key={mod.key} mod={mod} />
            ))}
          </ul>
        </Container>
      </Section>

      <Closing />
    </>
  )
}

export function SoftwareModulePage({ moduleKey }: { moduleKey: string }) {
  const mod = findSoftwareModule(moduleKey)
  const tSoftware = useTranslations('Software')
  const t = useTranslations(`Software.Modules.${mod.key}`)
  const tNav = useTranslations('Nav')
  const features = t.raw('features.items') as Item[]
  const steps = t.raw('steps.items') as Item[]
  const image = softwareModuleImage(mod)
  const others = SOFTWARE_MODULES.filter((m) => m.key !== mod.key)

  return (
    <>
      <Container className="py-16 sm:py-24">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Eyebrow>
            <Link href={SOFTWARE_HREF} className="hover:underline focus-visible:underline">
              {tSoftware('eyebrow')}
            </Link>
          </Eyebrow>
          <StatusBadge />
        </div>
        <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('title')}</h1>
        <p className="mt-5 max-w-prose text-lead text-text">{t('lead')}</p>

        <figure className="mt-10">
          {/* Link auf die PNG selbst, damit sie sich am Handy gross öffnen lässt. */}
          <a
            href={image}
            className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Image
              src={image}
              alt={t('title')}
              width={1200}
              height={760}
              sizes={MODULE_IMAGE_SIZES}
              priority
              className="h-auto w-full rounded-md border border-line"
            />
          </a>
          <figcaption className="mt-3 text-small text-text-muted">
            {tSoftware('caption')}
          </figcaption>
        </figure>
      </Container>

      <Section tone="alt">
        <Container>
          <h2 className="max-w-prose text-h2 text-ink">{t('features.title')}</h2>
          <ul className="mt-8 grid max-w-prose gap-4">
            {features.map((item) => (
              <li
                key={item.label}
                className="border-l-2 border-line-strong pl-4 text-body text-text"
              >
                <strong className="font-semibold text-ink">{item.label}:</strong> {item.text}
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section>
        <Container>
          <h2 className="max-w-prose text-h2 text-ink">{t('steps.title')}</h2>
          <ol className="mt-10 space-y-8 sm:space-y-10">
            {steps.map((item, i) => (
              <li key={item.label} className="grid gap-x-5 gap-y-2 sm:grid-cols-[3rem_1fr]">
                <span aria-hidden="true" className="text-h4 tabular-nums text-text-muted">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="max-w-prose border-t border-line-strong pt-3 sm:border-t-0 sm:pt-0">
                  <h3 className="text-h3 text-ink">{item.label}</h3>
                  <p className="mt-2 text-body text-text-muted">{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      <Section tone="alt">
        <Container>
          <h2 className="max-w-prose text-h2 text-ink">{t('note.title')}</h2>
          <p className="mt-4 max-w-prose text-body text-text">{t('note.text')}</p>
        </Container>
      </Section>

      <Closing />

      <Section>
        <Container>
          <nav aria-label={tSoftware('otherModules')}>
            <p className="text-label uppercase text-text-muted">{tSoftware('otherModules')}</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {others.map((m) => (
                <li key={m.key}>
                  <Link
                    href={softwareModuleHref(m)}
                    className="block rounded-md border border-line px-4 py-3 text-body font-medium text-ink hover:border-line-strong focus-visible:border-line-strong"
                  >
                    {tNav(softwareNavKey(m))}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Container>
      </Section>
    </>
  )
}
