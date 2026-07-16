import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { EMBEDDED_CALCULATOR_SRC } from '@/lib/config'
import { CALCULATOR_RUN_HREF } from '@/lib/nav'
import { robotsFor } from '@/lib/routes'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'CalculatorFrame' })
  return {
    title: `${t('title')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    /*
     * NOINDEX (Entscheidung, umkehrbar): Der crawlbare Inhalt dieser Seite ist
     * eine leere Hülle — der Rechner steckt im iframe und zählt für Google nicht
     * als Inhalt DIESER Seite. Indexiert würde hier also eine dünne Seite mit
     * derselben Suchintention konkurrieren wie die Produktseite
     * /peak-shaving/kalkulator, die den Content wirklich trägt (§6.2:
     * „Intent-getrennte Seiten kannibalisieren sich nicht").
     * `follow`, damit die Verlinkung weiter zählt.
     *
     * DIE ENTSCHEIDUNG STEHT SEIT 13b IN `lib/routes.ts` (`indexable: false`) und
     * wird hier nur noch abgeholt — sie hatte vorher zwei Fundorte: hier und,
     * implizit, in der sitemap. Genau daraus entsteht der Widerspruch, den §6.4
     * verbietet: eine Seite, die sich selbst auf `noindex` stellt, während die
     * sitemap sie zum Indexieren anbietet. Jetzt speist EINE Aussage beide.
     */
    robots: robotsFor(CALCULATOR_RUN_HREF),
    /*
     * KEIN `alternates` — als EINZIGE Seite (Prompt 13a), und das ist Absicht,
     * kein Vergessen: Canonical und hreflang sind Aussagen über eine Seite, die
     * in den Index soll („dies ist die maßgebliche Adresse", „das ist die
     * Fassung für diese Sprache"). Auf einer `noindex`-Seite widersprechen sie
     * der Zeile darüber. Google behandelt die Kombination ausdrücklich als
     * widersprüchliches Signal — die Seite bleibt deshalb nackt.
     */
  }
}

/**
 * Der Pro-Kalkulator INNERHALB der coolin.at-Hülle (Pflichtenheft §5.2b/§8.1).
 *
 * Bis Phase 1 sprang der CTA extern auf `apps/website` ab — der Nutzer verließ
 * coolin.at. Diese Route holt ihn zurück: Header und Footer sind die normalen,
 * dazwischen läuft der echte Rechner im iframe. Der Rechner selbst bleibt, wo
 * er ist (`apps/website`); hier wird NICHTS von ihm nachgebaut, importiert oder
 * portiert — die Konsolidierung ist Phase 2 (§8.1), kein Anbau in Phase 1.
 *
 * Quelle + `?embed=1`: `lib/config.ts`.
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'CalculatorFrame' })

  return (
    <>
      {/*
       * Die Seite braucht eine H1 (A11y-Dokumentstruktur, §9.4) — aber KEINE
       * sichtbare: sie würde den Rechner nach unten aus dem Bild schieben, und
       * der Fokus liegt hier auf dem Werkzeug, nicht auf einer Überschrift.
       * Der iframe trägt seinen eigenen `title` für die Screenreader-Ansage.
       */}
      <h1 className="sr-only">{t('title')}</h1>

      {/*
       * HÖHE: `100dvh` (nicht `100vh`) — auf Mobile wächst/schrumpft die
       * Browserleiste; `vh` rechnet mit der GRÖSSTEN Fläche und schöbe den
       * Rechner unter die Leiste. `- var(--header-h)`: der Header ist fixiert
       * und liegt über allem, seine Höhe ist also kein nutzbarer Platz.
       *
       * `min-h`: auf einem quergedrehten Handy bliebe sonst ein ~300px hoher
       * Schlitz übrig, in dem der Flow nicht bedienbar ist. Dann lieber die
       * Seite scrollen lassen als den Rechner quetschen.
       *
       * SCROLLEN: der iframe ist so hoch wie die freie Fläche, der Rechner
       * scrollt darin selbst. Ihn per postMessage auf die Inhaltshöhe zu
       * synchronisieren (und damit NUR die Seite scrollen zu lassen) ginge nur
       * mit einem Sender in `apps/website` — dort ist in diesem Schritt
       * ausschließlich der Embed-Parameter erlaubt. Bewusst nicht gebaut.
       *
       * VOLLFLÄCHIG: kein `Container`, kein Rand, kein Radius — der Rechner
       * bringt seinen eigenen Grund (bg-surface-alt) und seine eigene
       * Innenbreite mit. Ein Kasten um den Kasten wäre doppelter Rahmen.
       */}
      <iframe
        src={EMBEDDED_CALCULATOR_SRC}
        title={t('iframeTitle')}
        className="block w-full border-0"
        style={{ height: 'calc(100dvh - var(--header-h))', minHeight: '40rem' }}
      />
    </>
  )
}
