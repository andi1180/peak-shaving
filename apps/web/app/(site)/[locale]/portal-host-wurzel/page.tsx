import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PartnerPortalRoute } from '@/components/partner-portal/partner-portal-route'
import { PARTNER_PORTAL_HREF } from '@/lib/partner-portal/config'
import { PORTAL_HOST_ROOT } from '@/lib/portal-host'
import { robotsFor } from '@/lib/routes'

/**
 * WAS AUF DEM PORTAL-HOST UNTER `/` GERENDERT WIRD (B18-1a-Nachbesserung).
 *
 * ⚠ DIESE ROUTE IST VON AUSSEN AUF KEINEM HOST ERREICHBAR. Sie ist ausschliesslich das Ziel des
 * internen Rewrites in `middleware.ts`; jeder direkte Aufruf ihres Pfades — auf `coolin.at` wie auf
 * `partner.coolin.at`, mit und ohne Locale-Präfix — wird dort mit 404 beantwortet, BEVOR
 * irgendetwas anderes greift. Ihr Pfad steht in keiner Adresszeile, keinem Location-Header, keinem
 * `next`-Parameter und keiner sitemap. Die vollständige Begründung samt der drei Stellen, die das
 * durchsetzen, steht bei `PORTAL_ROOT_RENDER_PATH` in `lib/portal-host.ts`.
 *
 * ── WARUM ES SIE GIBT UND NICHT EINE HOST-WEICHE IN DER STARTSEITE ──────────────────────────────
 * `app/(site)/[locale]/page.tsx` ist die Marketing-Startseite und wird statisch vorgerendert. Sie
 * den Host lesen zu lassen, nähme ihr genau das — auf BEIDEN Hosts. Die wichtigste Seite der
 * Website würde bei jedem Aufruf serverseitig gebaut, damit eine Subdomain ihren Eingang bekommt.
 * Der Rewrite hält die Kosten dort, wo der Sonderfall ist: `/` auf coolin.at bleibt statisch,
 * allein diese Route ist dynamisch.
 *
 * ── INHALTLICH IST SIE DER PORTALBEREICH, NICHT EINE ZWEITE FASSUNG DAVON ───────────────────────
 * Sie rendert `PartnerPortalRoute` — dieselbe Komponente wie `/partner-portal`, mit dem EINEN
 * Unterschied, der den Host ausmacht: dem Rücksprungziel der Anmeldung. Die drei Zustände, ihre
 * Begründungen und `force-dynamic` gelten unverändert weiter (s. `/partner-portal`).
 *
 * `force-dynamic` aus demselben Grund wie dort: Die Seite liest die Sitzung und zeigt den Namen
 * sowie den persönlichen Link EINES Betriebs. Eine zwischengespeicherte Fassung zeigte dem nächsten
 * Besucher den Link des vorigen — der teuerste denkbare Cache-Fehler dieser Seite, weil eine daraus
 * entstehende Aussendung Anfragen dem falschen Betrieb zuordnete.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'PartnerPortal' })
  return {
    title: `${t('metaTitle')} — COOLiN ENERGY`,
    /*
     * Die `noindex`-Entscheidung wird NICHT zweitgetroffen: sie kommt aus `robotsFor` und gehört
     * dem Portalbereich, nicht dieser Adresse. Dass der Portal-Host ohnehin vollständig auf
     * `Disallow: /` steht (`app/robots.ts`), ist die zweite Schicht — keine Verdopplung, sondern
     * eine andere Reichweite: Die eine wirkt je Seite, die andere je Host.
     */
    robots: robotsFor(PARTNER_PORTAL_HREF),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  /*
   * Das Rücksprungziel ist `/` auf DEMSELBEN Host — nicht `/partner-portal` und nicht `/konto`.
   * Ein Partner darf unmittelbar nach dem Einloggen nirgends einen Portal-Pfad in der Adresszeile
   * sehen; die Domain trägt die Bedeutung bereits. `sanitizeNext` (`lib/auth/config.ts`) lässt
   * seiten-interne Pfade zu, `/` erfüllt seine Bedingung bereits — es ist nichts nachzubauen.
   */
  return <PartnerPortalRoute locale={locale} signInNext={PORTAL_HOST_ROOT} />
}
