import { getTranslations } from 'next-intl/server'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { Link as TextLink } from '@/components/ui/link'
import { articleHref, articlesFor, type Article } from '@/lib/wissen'
import { KONTAKT_HREF } from '@/lib/nav'

/**
 * Übersicht `/wissen` (Pflichtenheft §6.2 Info-Intent, §10.1).
 *
 * Spiegelt `components/branche/branchen-overview.tsx`: gleicher Aufbau
 * (Hero → Karten → Flaggschiff-Verweis → Kontakt-CTA), gleiche Kachel-Optik.
 *
 * DER UNTERSCHIED IST DIE DATENQUELLE, und er ist der ganze Punkt dieses
 * Schritts: Branchen kommen aus einer Liste im Code (`lib/branchen.ts` →
 * `lib/nav.ts`), Artikel aus dem VERZEICHNIS (`lib/wissen.ts` liest
 * `content/wissen/`). Ein neuer Artikel ist eine neue Datei — diese Datei ändert
 * sich dabei nicht.
 *
 * PHASE 1 HAT GENAU EINEN ARTIKEL, und die Seite ist trotzdem als Liste gebaut.
 * Das ist keine Spekulation auf Vorrat (§4-Prinzip „kein Over-Engineering"),
 * sondern die billigere Variante: Eine hartkodierte Einzelseite müsste beim
 * zweiten Artikel wieder aufgemacht werden. `.map()` über ein Array der Länge 1
 * kostet nichts.
 *
 * KEIN LEERZUSTAND-DESIGN: Gäbe es null Artikel, wäre der Bereich nicht
 * fertiggebaut — dafür gab es den `PagePlaceholder`, den dieser Schritt ersetzt.
 * Die Liste kann per Konstruktion nicht leer sein, solange eine `.mdx`-Datei
 * existiert; wäre sie es, fällt es sofort auf, statt einen erfundenen
 * „Demnächst"-Zustand zu zeigen.
 */

/**
 * Eine Artikel-Karte.
 *
 * `featured` bekommt die Akzent-Fläche und die volle Breite — der 2027-Artikel
 * ist der strategische Hebel (§6.1) und soll sich vom Rest unterscheiden. Die
 * Hervorhebung kommt aus dem Frontmatter, nicht aus einer Position in dieser
 * Datei: Welcher Artikel der wichtigste ist, ist eine Redaktions- und keine
 * Code-Entscheidung.
 */
function ArticleCard({ article, featured }: { article: Article; featured?: boolean }) {
  return (
    <li className={featured ? 'sm:col-span-2' : undefined}>
      <Link
        href={articleHref(article.slug)}
        // `h-full` + `mt-auto` am Pfeil: alle Karten stehen auf einer Baseline,
        // der Pfeil sitzt immer am unteren Rand — dieselbe Mechanik wie in
        // `branchen-overview.tsx` und `portfolio.tsx`.
        className={
          featured
            ? 'group flex h-full flex-col rounded-lg border border-accent-border bg-accent-subtle p-6 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
            : 'group flex h-full flex-col rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        }
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={
              featured ? 'text-label uppercase text-accent' : 'text-label uppercase text-text-muted'
            }
          >
            {article.tag}
          </span>
          {/* `<time dateTime>`: maschinenlesbar, s. `article-page.tsx`. */}
          <time dateTime={article.date} className="text-caption tabular-nums text-text-muted">
            {article.date.split('-').reverse().join('.')}
          </time>
        </div>

        <h2 className={featured ? 'mt-3 text-h3 text-ink' : 'mt-2 text-h4 text-ink'}>
          {article.title}
        </h2>
        {/* Der `teaser`, NICHT die `description`: Die Description ist der
            Suchmaschinen-Anriss (§6.3) und steht auf der Artikelseite als Lead.
            Zwei verschiedene Rollen, zwei Felder — s. `lib/wissen.ts`. */}
        <p
          className={
            featured ? 'mt-3 max-w-prose text-body text-text' : 'mt-2 text-small text-text-muted'
          }
        >
          {article.teaser}
        </p>

        <div className="mt-auto pt-5">
          <ArrowRight
            className={
              featured
                ? 'h-4 w-4 text-accent transition-transform group-hover:translate-x-0.5'
                : 'h-4 w-4 text-text-muted transition-colors group-hover:text-accent'
            }
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </div>
      </Link>
    </li>
  )
}

export async function WissenOverview({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'Wissen.Overview' })
  const tNav = await getTranslations({ locale, namespace: 'Nav' })
  const articles = articlesFor(locale)

  return (
    <>
      <Container className="py-16 sm:py-24">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('title')}</h1>
        <p className="mt-5 max-w-prose text-lead text-text">{t('lead')}</p>
        <p className="mt-5 max-w-prose text-body text-text-muted">{t('intro')}</p>
      </Container>

      <Section tone="alt">
        <Container>
          <ul className="grid gap-4 sm:grid-cols-2">
            {articles.map((article) => (
              <ArticleCard key={article.slug} article={article} featured={article.featured} />
            ))}
          </ul>
        </Container>
      </Section>

      {/* Verweis aufs Flaggschiff (§4.2/§6.4) — jeder Hub zeigt auf die
          „Money-Page". Gleiche Fläche und gleiche Rolle wie in der Branchen- und
          der Leistungs-Übersicht. */}
      <Section>
        <Container>
          <div className="max-w-prose rounded-lg border border-accent-border bg-accent-subtle p-6">
            <h2 className="text-h3 text-ink">{t('flagship.title')}</h2>
            <p className="mt-3 text-body text-text">{t('flagship.text')}</p>
            <p className="mt-4">
              <TextLink
                variant="standalone"
                href="/peak-shaving"
                className="group inline-flex items-center gap-2 text-small"
              >
                {tNav('peakShavingWhat')}
                <ArrowRight
                  className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </TextLink>
            </p>
          </div>
        </Container>
      </Section>

      {/* Primäre Aktion der Beratungs-Achse: das Gespräch (§3.1). */}
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
