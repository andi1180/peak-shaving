import { getTranslations } from 'next-intl/server'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Link as TextLink } from '@/components/ui/link'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { articleHref, articlesFor, WISSEN_HREF, type Article } from '@/lib/wissen'

/**
 * Wissen-Teaser (§4.4 Nr. 5) — der Anriss auf der Startseite.
 *
 * WAR: drei hartkodierte Karten mit „in Vorbereitung"-Marke, alle drei auf
 * `/wissen` zeigend, weil es noch keinen Artikel gab.
 * IST: datengetrieben aus `lib/wissen.ts` — dieselbe Quelle wie die Übersicht.
 *
 * ROOT CAUSE DER STUBS, statt sie zu kaschieren: Die drei Karten waren
 * Platzhalter für Artikel, die es nicht gab; der Kommentar in der alten Fassung
 * sagte das auch offen („dorthin zu verlinken hieße, wissentlich in einen 404 zu
 * führen"). Mit diesem Schritt gibt es den Flaggschiff-Artikel — die Karte zeigt
 * jetzt auf ihn.
 *
 * DIE ZWEI ANDEREN STUBS SIND ERSATZLOS ENTFERNT, und das ist eine inhaltliche
 * Entscheidung, keine Aufräumaktion: Sie hießen „Arbeitspreis und Leistungspreis
 * — der entscheidende Unterschied" und „RLM-Messung: ab wann Ihr Lastgang
 * viertelstündlich erfasst wird". Beides sind inzwischen H2-ABSCHNITTE INNERHALB
 * des 2027-Artikels (§6.5). Sie als eigene Artikel anzukündigen hieße, denselben
 * Info-Intent ein zweites Mal zu bedienen — genau die Keyword-Dopplung, die §6.2
 * verbietet. Zwei Karten, die einen Artikel versprechen, der als Kapitel bereits
 * existiert, sind kein Teaser, sondern eine Ankündigung ins Leere.
 *
 * Die Sektion trägt damit, was da ist. Kommt ein zweiter Artikel dazu, erscheint
 * er ohne Code-Änderung als schmale Karte daneben.
 */

/** Wie viele Anreißer neben dem Flaggschiff Platz haben (§4.4: „2–3 Artikel"). */
const MAX_SECONDARY = 2

function FeaturedCard({ article, wide }: { article: Article; wide: boolean }) {
  return (
    <Link
      href={articleHref(article.slug)}
      className={`group flex flex-col rounded-lg border border-accent-border bg-accent-subtle p-6 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        wide ? 'lg:col-span-2' : 'lg:col-span-3'
      }`}
    >
      <span className="text-label uppercase text-accent">{article.tag}</span>
      <h3 className="mt-3 max-w-prose text-h3 text-ink">{article.title}</h3>
      {/* Der `teaser` aus dem Frontmatter — derselbe Text wie auf der
          Übersichtskarte. Ein zweiter, abweichender Anreißer für denselben
          Artikel wäre nur eine weitere Stelle, an der die Seite von sich selbst
          abweichen kann (gleiche Logik wie bei den Branchen-Kacheln). */}
      <p className="mt-3 max-w-prose text-body text-text">{article.teaser}</p>
      <div className="mt-auto pt-6">
        <ArrowRight
          className="h-4 w-4 text-accent transition-transform group-hover:translate-x-0.5"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </div>
    </Link>
  )
}

function SecondaryCard({ article }: { article: Article }) {
  return (
    <Link
      href={articleHref(article.slug)}
      className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="text-label uppercase text-text-muted">{article.tag}</span>
      <h3 className="mt-2 text-h4 text-ink">{article.title}</h3>
      <p className="mt-2 text-small text-text-muted">{article.teaser}</p>
    </Link>
  )
}

export async function WissenTeaser({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'Home.Wissen' })
  const articles = articlesFor(locale)

  // Ohne Artikel keine Sektion. Eine Überschrift „Was Sie wissen müssen" über
  // einer leeren Fläche wäre schlechter als gar nichts.
  if (articles.length === 0) return null

  /*
   * Der hervorgehobene Artikel (§6.1) ist der mit `featured: true` — steht
   * keiner so markiert da, tritt der neueste an seine Stelle. Kein Slug im Code:
   * `featuredArticle()` würde `undefined` liefern, wenn jemand die Markierung
   * entfernt, und die Sektion hätte still kein Flaggschiff mehr.
   */
  const featured = articles.find((article) => article.featured) ?? (articles[0] as Article)
  const secondary = articles
    .filter((article) => article.slug !== featured.slug)
    .slice(0, MAX_SECONDARY)

  return (
    <Section tone="alt">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>{t('eyebrow')}</Eyebrow>
            <h2 className="mt-3 text-h2 text-ink">{t('title')}</h2>
            <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>
          </div>
          <TextLink href={WISSEN_HREF} variant="standalone" className="text-small">
            {t('more')}
          </TextLink>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {/*
           * `wide` nur, wenn es Anreißer gibt: Die Flaggschiff-Karte belegte
           * fest zwei von drei Spalten. Ohne Nachbarn stünde daneben ein Drittel
           * leere Fläche — die Karte nimmt dann die volle Breite. Phase 1 hat
           * genau einen Artikel; das ist der reale Fall, nicht der Randfall.
           */}
          <FeaturedCard article={featured} wide={secondary.length > 0} />

          {secondary.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              {secondary.map((article) => (
                <SecondaryCard key={article.slug} article={article} />
              ))}
            </div>
          ) : null}
        </div>
      </Container>
    </Section>
  )
}
