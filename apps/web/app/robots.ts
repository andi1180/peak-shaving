import type { MetadataRoute } from 'next'
import { absoluteUrl, IS_PRODUCTION_SITE } from '@/lib/site'

/**
 * /robots.txt (Pflichtenheft §6.4).
 *
 * DIE SEITE VERBIETET SICH SELBST, SOLANGE SIE NICHT AUF coolin.at LIEGT.
 * Das ist der Kern dieser Datei: Bis zum DNS-Umzug (§12) läuft der Neubau auf
 * `peak-shaving-web.vercel.app`. Eine indexierte vercel.app-Adresse würde nach
 * dem Umzug gegen die echte coolin.at antreten — mit identischem Inhalt, also
 * als Duplikat, das man anschließend mühsam wieder aus dem Index bekommt. Die
 * Preview ist zum Ansehen da, nicht zum Ranken.
 *
 * Die Weiche hängt an `SITE_URL` (`lib/site.ts`), nicht an `VERCEL_ENV` — die
 * Begründung steht bei `IS_PRODUCTION_SITE`. Damit bleibt der Cutover EIN
 * Handgriff: `NEXT_PUBLIC_SITE_URL=https://coolin.at` in Vercel setzen schaltet
 * Canonicals, hreflang, OG-Bild und robots gemeinsam scharf.
 *
 * WARUM HIER KEINE `disallow`-EINTRÄGE FÜR DIE noindex-SEITEN STEHEN (die
 * rechner-Hülle, `/styleguide`) — das ist die Falle, die §6.4 mit „robots darf
 * noindex nicht widersprechen" meint, und sie wirkt genau andersherum, als man
 * denkt: `Disallow` verbietet das CRAWLEN, nicht das Indexieren. Eine gesperrte
 * Seite darf Google nicht abrufen — und sieht damit ihr eigenes `noindex` NIE.
 * Die URL kann dann trotzdem im Index landen (ohne Inhalt, allein über Links).
 * Ein `noindex` wirkt nur, wenn der Crawler die Seite lesen darf. Also: lesen
 * lassen. Die beiden Seiten schließen sich selbst aus, sauberer geht es nicht.
 */
export default function robots(): MetadataRoute.Robots {
  if (!IS_PRODUCTION_SITE) {
    return {
      rules: [{ userAgent: '*', disallow: '/' }],
      /*
       * BEWUSST OHNE `sitemap`: Eine sitemap ist eine Einladung zum Crawlen —
       * neben einem „Disallow: /" wäre sie ein Widerspruch in derselben Datei.
       * Die sitemap selbst bleibt erreichbar und korrekt, sie wird hier nur nicht
       * beworben.
       */
    }
  }

  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: absoluteUrl('/sitemap.xml'),
  }
}
