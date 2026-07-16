import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import { compileMDX } from 'next-mdx-remote/rsc'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { FaqSection } from '@/components/faq-section'
import { mdxComponents } from '@/components/wissen/mdx-components'
import { WISSEN_HREF, type Article } from '@/lib/wissen'
import { KONTAKT_HREF } from '@/lib/nav'

/**
 * DAS Template aller Wissen-Artikel (§6.5, §10.1).
 *
 * Gleiche Rolle wie `components/branche/branche-page.tsx` und
 * `components/leistung/leistung-page.tsx`: EINE Layout-Datei, die Route
 * (`app/(site)/[locale]/wissen/[slug]/page.tsx`) reicht nur den Artikel herein.
 *
 * WARUM `[slug]` HIER RICHTIG IST, obwohl Leistungen/Branchen statische Ordner
 * haben: Jene sind eine feste, kuratierte IA (§4.1 — sie stehen im Menü, ihre
 * Zahl ist eine Entscheidung). Wissen ist eine COLLECTION, die wächst; ein
 * Ordner je Artikel wäre eine Code-Änderung pro Redaktionsentscheidung — genau
 * das, was §10.1 mit dem Autoren-UI abschaffen will.
 *
 * Aufbau (§6.5): Header (Meta + H1 + Lead) → MDX-Körper → FAQ → Quellen → CTA.
 *
 * FAQ UND QUELLEN STEHEN AUSSERHALB DES MDX — mit Absicht:
 *   – Die FAQ kommt aus dem Frontmatter (`{ q, a }`), damit ein späterer
 *     `FAQPage`-JSON-LD (§6.4) sie STRUKTURIERT lesen kann. Stünde sie als
 *     Fließtext im MDX, müsste man sie aus HTML zurückparsen.
 *   – Die Quellen ebenso: §9.5 verlangt Quellen, und ein Autor soll sie nicht
 *     jedes Mal als Liste neu formatieren.
 * Beide erscheinen dadurch garantiert am Ende und in derselben Form — auch beim
 * zwanzigsten Artikel.
 *
 * KEIN SIGNATURE-MOTIV: kanonischer Ort ist der Footer (DESIGN.md), der hier
 * bereits läuft. Ein Auftritt hier wäre der zweite.
 */

/** Der Titel-/Description-Bau ist für ALLE Artikel identisch — also einmal. */
export function articleMetadata(article: Article): Metadata {
  return {
    title: `${article.title} — COOLiN ENERGY`,
    description: article.description,
  }
}

/**
 * Datum in „16. Juli 2026". `Intl` mit der Locale des Artikels, kein
 * handgepflegtes Monatsnamen-Array — und `timeZone: 'UTC'`, weil das Frontmatter
 * ein reines Kalenderdatum trägt: Ohne die Angabe würde `2026-07-16` auf einem
 * Server westlich von Greenwich als 15. Juli gerendert.
 */
function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`))
}

export async function ArticlePage({ article, locale }: { article: Article; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'Wissen.Article' })

  /*
   * MDX wird zur BUILD-Zeit kompiliert: Die Route hat `generateStaticParams`,
   * die Seite ist also vorgerendert (kein Compiler im Request-Pfad, kein
   * MDX-Compiler im Client-Bundle).
   *
   * `parseFrontmatter: false` — das Frontmatter ist an dieser Stelle bereits
   * abgetrennt (`lib/wissen.ts` liefert `body` ohne den Block). Es hier ein
   * zweites Mal zu parsen wäre eine zweite Auslegung derselben Datei.
   */
  const { content } = await compileMDX({
    source: article.body,
    components: mdxComponents,
    options: { parseFrontmatter: false },
  })

  return (
    <>
      <Container className="py-12 sm:py-16">
        {/* Zurück zur Übersicht — bei einer Collection der erwartete Ausgang.
            Leistungen/Branchen haben ihn nicht: dort trägt das Menü die IA. */}
        <p>
          <Link
            href={WISSEN_HREF}
            className="group inline-flex items-center gap-2 rounded-sm text-small text-text-muted underline decoration-line-strong underline-offset-[3px] transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ArrowLeft
              className="h-4 w-4 shrink-0 transition-transform group-hover:-translate-x-0.5"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            {t('backToOverview')}
          </Link>
        </p>

        <div className="mt-8">
          <Eyebrow>{article.tag}</Eyebrow>
          <h1 className="mt-3 max-w-prose text-h1 text-ink">{article.title}</h1>
          {/*
           * Die Description ist der Lead. Bewusst KEIN zweiter, abweichender
           * Anreißer im Frontmatter für dieselbe Stelle: Was in der Suche steht,
           * soll das sein, was der Leser oben liest — sonst ist eines von beidem
           * eine Werbeversion.
           */}
          <p className="mt-5 max-w-prose text-lead text-text">{article.description}</p>

          {/*
           * Meta-Zeile. `<time dateTime>` mit dem ISO-Wert: maschinenlesbar für
           * einen späteren `Article`-JSON-LD (§6.4) und für Suchmaschinen —
           * „16. Juli 2026" allein ist nur Text.
           */}
          <dl className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-line pt-4 text-caption text-text-muted">
            <div className="flex gap-1.5">
              <dt>{t('publishedLabel')}</dt>
              <dd>
                <time dateTime={article.date}>{formatDate(article.date, locale)}</time>
              </dd>
            </div>
            {article.updated ? (
              <div className="flex gap-1.5">
                <dt>{t('updatedLabel')}</dt>
                <dd>
                  <time dateTime={article.updated}>{formatDate(article.updated, locale)}</time>
                </dd>
              </div>
            ) : null}
            <div className="flex gap-1.5">
              <dt>{t('authorLabel')}</dt>
              <dd>{article.author}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="sr-only">{t('readingLabel')}</dt>
              <dd>{t('readingMinutes', { minutes: article.readingMinutes })}</dd>
            </div>
          </dl>
        </div>
      </Container>

      {/*
       * DER ARTIKEL. `<article>`, nicht `<div>`: Das ist der in sich
       * abgeschlossene Inhalt der Seite — für Screenreader-Landmarks und für
       * einen späteren `Article`-JSON-LD die richtige Klammer.
       *
       * Die Breitenbegrenzung sitzt an den Textelementen (mdx-components.tsx),
       * nicht hier — sonst könnte kein Chart je breiter stehen (§7.5).
       */}
      <Container className="pb-16 sm:pb-24">
        <article>{content}</article>
      </Container>

      <FaqSection title={t('faqTitle')} items={article.faq} tone="alt" />

      {/*
       * QUELLEN (§9.5). Bei einem Artikel über einen LAUFENDEN
       * Verordnungsprozess ist das keine Fußnoten-Kür: Der Stand ändert sich,
       * und der Leser muss ihn selbst nachprüfen können. Deshalb stehen die
       * Quellen sichtbar am Seitenende — nicht in einem Accordion.
       */}
      {article.sources.length > 0 ? (
        <Section>
          <Container>
            <h2 className="max-w-prose text-h3 text-ink">{t('sourcesTitle')}</h2>
            <p className="mt-3 max-w-prose text-small text-text-muted">{t('sourcesNote')}</p>
            <ul className="mt-5 max-w-prose space-y-2">
              {article.sources.map((source) => (
                <li key={source.url} className="text-small">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-sm text-accent underline decoration-accent underline-offset-[3px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
          </Container>
        </Section>
      ) : null}

      {/*
       * Abschluss: das Gespräch (§3.1 Beratungs-Achse) — wie bei Leistungen und
       * Branchen. Der Kalkulator-CTA steht bereits im Artikel (im
       * Schnellrechner); hier wäre er der zweite und würde mit dem Kontakt
       * konkurrieren.
       *
       * `secondary` auf Navy: Teal 700 trennt sich dort kaum vom Grund (2,05:1
       * Flächenkontrast), die weiße Fläche liegt bei 12,06:1 und IST hier der
       * Primary. Der Eyebrow trägt aus demselben Grund den hellen Knoten-Ton.
       * (Identisch zu den anderen Templates — s. DESIGN.md.)
       */}
      <section className="bg-navy text-navy-foreground">
        <Container className="py-16 sm:py-24">
          <div className="max-w-prose">
            <Eyebrow className="text-node">{t('cta.eyebrow')}</Eyebrow>
            <h2 className="mt-3 text-h2 text-navy-foreground">{t('cta.title')}</h2>
            <p className="mt-5 text-body text-white/80">{t('cta.lead')}</p>
            <Button asChild variant="secondary" size="lg" className="mt-8">
              <Link href={KONTAKT_HREF}>{t('cta.button')}</Link>
            </Button>
          </div>
        </Container>
      </section>
    </>
  )
}
