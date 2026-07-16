/**
 * Die EINE Basis-URL dieser Seite (Pflichtenheft §6.3/§6.4).
 *
 * WARUM ÜBER EINE ENV-VARIABLE UND NICHT ALS KONSTANTE „https://coolin.at":
 * Die Produktivdomain liegt noch auf Netlify; gebaut und angeschaut wird auf
 * einer Vercel-Preview-URL (§8.4/§12). Eine hart eingetragene Produktivdomain
 * würde JETZT schon Canonicals und OG-Bild-URLs auf eine Adresse zeigen lassen,
 * unter der diese Seite nicht liegt — also auf fremde Inhalte. Über die Variable
 * ist der spätere DNS-Umzug ein Variablenwechsel in Vercel, kein Code-Deploy.
 *
 * ALLES leitet sich hiervon ab: `metadataBase` (Root-Layout), die Canonicals und
 * hreflang-Einträge (`lib/seo.ts`) und die absolute OG-Bild-URL. Es gibt bewusst
 * keinen zweiten Ort, an dem eine Domain steht.
 *
 * Konfiguration: `NEXT_PUBLIC_SITE_URL` — dokumentiert in `.env.example`.
 */

/*
 * Beide Variablen werden LITERAL gelesen (kein `process.env[name]`): Next ersetzt
 * `process.env.NEXT_PUBLIC_*` zur Build-Zeit durch den Wert — ein dynamischer
 * Zugriff würde nicht ersetzt und wäre im Browser-Bundle schlicht `undefined`.
 */
const CONFIGURED_URL = process.env.NEXT_PUBLIC_SITE_URL
/** Von Vercel automatisch gesetzt (die URL DIESES Deployments). */
const VERCEL_URL = process.env.NEXT_PUBLIC_VERCEL_URL

/** Letzter Ausweg: `next dev`/`next start` ohne jede Konfiguration. */
const LOCAL_FALLBACK = 'http://localhost:3000'

/**
 * Prüft eine konfigurierte Basis-URL und gibt ihren Origin zurück (ohne
 * abschließenden „/").
 *
 * Wirft LAUT statt still auf den Fallback zurückzufallen — dieselbe Haltung wie
 * die Frontmatter-Prüfung in `lib/wissen.ts`: Ein Tippfehler in der Variable
 * („coolin.at" ohne Schema) würde sonst eine ganze Seite mit localhost-Canonicals
 * ausliefern, und das fällt niemandem auf, bis das Ranking fehlt.
 */
function toOrigin(raw: string, source: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(
      `${source}="${raw}" ist keine gültige absolute URL. Erwartet wird ein Origin mit Schema, z. B. "https://coolin.at".`,
    )
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${source}="${raw}" muss http:// oder https:// verwenden.`)
  }
  // Ein Pfad/Query/Hash in der Basis-URL würde `new URL(pfad, basis)` still
  // verfälschen (der Pfad ersetzt ihn, statt anzuhängen). Lieber jetzt brechen.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(
      `${source}="${raw}" darf nur der Origin sein — ohne Pfad, Query oder Anker (z. B. "https://coolin.at").`,
    )
  }
  return url.origin
}

function resolveSiteUrl(): string {
  if (CONFIGURED_URL) return toOrigin(CONFIGURED_URL, 'NEXT_PUBLIC_SITE_URL')
  /*
   * Preview ohne gesetzte Variable: die Seite kanonisiert auf SICH SELBST.
   * Das ist der ehrliche Zustand — eine Preview, die auf coolin.at kanonisiert,
   * behauptet, Inhalte einer Domain zu sein, die sie nicht ausliefert.
   */
  if (VERCEL_URL) return toOrigin(`https://${VERCEL_URL}`, 'NEXT_PUBLIC_VERCEL_URL')
  return LOCAL_FALLBACK
}

/** Origin dieser Seite, garantiert ohne abschließenden „/" (z. B. „https://coolin.at"). */
export const SITE_URL = resolveSiteUrl()

/**
 * Macht aus einem seiten-internen Pfad eine absolute URL.
 *
 * `new URL(pfad, basis)` statt String-Verkettung — aus demselben Grund wie in
 * `lib/config.ts`: die URL-Klasse normalisiert und kann keinen doppelten Slash
 * erzeugen.
 */
export function absoluteUrl(pathname: string): string {
  return new URL(pathname, SITE_URL).toString()
}
