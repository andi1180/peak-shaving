import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PartnerPortalRoute } from '@/components/partner-portal/partner-portal-route'
import { PARTNER_PORTAL_HREF } from '@/lib/partner-portal/config'
import { robotsFor } from '@/lib/routes'

/**
 * `/partner-portal` — der eingeloggte Bereich eines Fachbetriebs (B16-4b).
 *
 * ── DER PFAD LIEGT AUSDRÜCKLICH NICHT UNTER `/partner/` ─────────────────────────────────────────
 * Dieselbe harte Auflage wie bei `/partner-werden` (B16-3): Dort sitzt seit B16-2 das dynamische
 * Segment `[slug]`. Ein statisches Kindsegment machte den Kurz-Key dieses Namens für immer
 * unerreichbar — und zwar still: Der betroffene Betrieb bekäme einen Empfehlungslink, der auf eine
 * ganz andere Seite führt, und der Fehler fiele erst auf, wenn seine Serienmail draussen ist. Die
 * Begründung steht ausführlich in `lib/partner-portal/config.ts`, wo der Pfad definiert ist.
 *
 * ── DREI ZUSTÄNDE, UND NUR EINER IST EINE UMLEITUNG ─────────────────────────────────────────────
 * Nicht angemeldet → `/anmelden?next=/partner-portal`. Das Rücksprungziel benutzt den bestehenden
 * Mechanismus aus B10-2/B10-5 (`NEXT_PARAM` + `sanitizeNext` in `signInAction`), es wird hier
 * NICHTS nachgebaut: Die Anmeldeseite reicht den Wert als verstecktes Feld weiter, und die Action
 * prüft ihn ein zweites Mal serverseitig — was der Browser schickt, entscheidet nichts.
 *
 * Angemeldet, aber keine Partnerzeile → ein eigener ERKLÄRZUSTAND, ausdrücklich KEINE Umleitung.
 * Dieselbe Überlegung wie beim Kalkulator-Zugang (B10-2): Wer angemeldet ist und trotzdem
 * weggeschickt würde, liefe im Kreis. Und es ist der Normalfall — jedes Monitor- und
 * Kalkulator-Konto hat keine Partnerzeile; ein Kunde, der die Adresse zufällig aufruft, darf nicht
 * auf einer Fehlerseite landen.
 *
 * Angemeldet mit aktiver Partnerzeile → das Portal.
 *
 * ── EIN STILLGELEGTER BETRIEB BEKOMMT KEINEN ZUGANG, UND DIE ROUTE ENTSCHEIDET DAS NICHT ────────
 * `public.get_my_partner` gibt einen inaktiven Partner gar nicht heraus (`and p.is_active`). Die
 * Seite kann den dritten Zustand deshalb nicht erfinden — sie sieht dasselbe wie bei einem Konto
 * ohne Partnerzeile. Das ist die gewollte Entsprechung zu seiner Landingpage, die ab der
 * Stilllegung 404 antwortet: Die Deaktivierung IST die Ansage, und ein Portal, das danach weiterhin
 * einen Empfehlungslink zum Kopieren anböte, verwiese auf eine Seite, die nachweislich ins Leere
 * führt.
 *
 * ── KEIN ISR, KEIN INDEX ────────────────────────────────────────────────────────────────────────
 * `dynamic = 'force-dynamic'`: Die Seite liest die Sitzung und zeigt den Namen sowie den
 * persönlichen Link EINES Betriebs. Eine zwischengespeicherte Fassung zeigte dem nächsten Besucher
 * den Link des vorigen — der teuerste denkbare Cache-Fehler dieser Seite, weil eine daraus
 * entstehende Aussendung Anfragen dem falschen Betrieb zuordnete. `robotsFor` liest die
 * `noindex`-Entscheidung aus `lib/routes.ts`, dem einen Fundort, an dem auch die sitemap sie liest
 * (die Route steht dort als NICHT indexierbar und erscheint deshalb in keiner sitemap).
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
    robots: robotsFor(PARTNER_PORTAL_HREF),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  /*
   * Der Ablauf selbst liegt in `PartnerPortalRoute` — geteilt mit der Wurzel des Portal-Hosts
   * (B18-1a-Nachbesserung). Diese Route bleibt unverändert erreichbar und behält ihr eigenes
   * Rücksprungziel: Wer sich von HIER aus anmeldet, will hierher zurück.
   */
  return <PartnerPortalRoute locale={locale} signInNext={PARTNER_PORTAL_HREF} />
}
