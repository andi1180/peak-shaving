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

import { publicEnv } from './env.public'

/*
 * Beide Werte kommen aus der zentralen, validierten `env.public.ts` (T4-2, Aufgabe 1) — dort
 * stehen die literalen `process.env.NEXT_PUBLIC_*`-Referenzen, die Next zur Build-Zeit textuell
 * ersetzt. Hier keine rohen process.env-Zugriffe mehr; die Origin-Prüfung unten bleibt unverändert.
 */
const CONFIGURED_URL = publicEnv.NEXT_PUBLIC_SITE_URL
/** Von Vercel automatisch gesetzt (die URL DIESES Deployments). */
const VERCEL_URL = publicEnv.NEXT_PUBLIC_VERCEL_URL

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
 * Die Produktivdomain — das ZIEL des Cutovers (§12), nicht eine zweite Quelle
 * der Basis-URL.
 *
 * DER UNTERSCHIED IST WICHTIG, weil der Kopf dieser Datei eine hart eingetragene
 * Produktivdomain ausdrücklich ablehnt: Diese Konstante wird NIE gerendert. Kein
 * Canonical, kein hreflang, keine Bild-URL entsteht aus ihr — dafür bleibt
 * `SITE_URL` die einzige Quelle. Sie beantwortet eine andere Frage: „läuft dieser
 * Build unter der echten Domain?" Und die lässt sich nicht beantworten, ohne
 * irgendwo zu sagen, welche Domain die echte ist. Sie steht hier und nicht in
 * `app/robots.ts`, damit alles, was eine Domain kennt, in DIESER Datei bleibt.
 */
export const PRODUCTION_ORIGIN = 'https://coolin.at'

/**
 * Läuft dieser Build unter der Produktivdomain? Steuert `app/robots.ts`: Nur auf
 * coolin.at ist Indexierung erlaubt, überall sonst gilt `Disallow: /`.
 *
 * WARUM NICHT `VERCEL_ENV === 'production'`, was näher läge: Das Vercel-Projekt
 * `peak-shaving-web` hat JETZT SCHON ein Production-Deployment — es liegt nur
 * noch auf `peak-shaving-web.vercel.app`, weil die Domain noch nicht umgezogen
 * ist (§12). `VERCEL_ENV` stünde dort auf „production" und gäbe die Preview zur
 * Indexierung frei, wo sie der späteren coolin.at Konkurrenz machen würde. Die
 * Frage ist nicht „ist das ein Production-Deployment?", sondern „liegt es unter
 * der richtigen Adresse?".
 *
 * FAIL-CLOSED: Ein unbekannter Origin (Preview, Staging, localhost, ein
 * Tippfehler) ist NICHT die Produktivdomain und wird damit nicht indexiert. Der
 * teure Fehler ist eine indexierte Zweit-Domain, nicht eine nicht-indexierte
 * Preview — die zweite merkt man beim Testen, die erste erst am Ranking.
 *
 * DER CUTOVER BLEIBT EIN EINZIGER HANDGRIFF: `NEXT_PUBLIC_SITE_URL` auf
 * `https://coolin.at` setzen schaltet Canonicals, hreflang, OG-Bild UND robots
 * gemeinsam um. Ein zweiter Schalter (etwa `NEXT_PUBLIC_ALLOW_INDEXING`) könnte
 * halb umgelegt werden — robots gäbe die Seite frei, während die Canonicals noch
 * auf die vercel.app zeigen. Genau diese Hälfte darf es nicht geben.
 */
export const IS_PRODUCTION_SITE = SITE_URL === PRODUCTION_ORIGIN

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
