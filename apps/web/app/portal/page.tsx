import { PartnerPortalPage } from '@/components/partner-portal/partner-portal-page'
import { PortalGeneralPanel } from '@/components/portal/general-panel'
import { PortalShell } from '@/components/portal/shell'
import { ANMELDEN_HREF, NEXT_PARAM } from '@/lib/auth/config'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { PORTAL_HOST_ROOT } from '@/lib/portal-host'
import { readPortal } from '@/lib/partner-portal/read'
import { routing } from '@/i18n/routing'

/**
 * DER REITER „ALLGEMEIN" — die Wurzel des Portalbereichs (B18-3).
 *
 * ⚠ VON AUSSEN AUF KEINEM HOST ERREICHBAR. Adressiert wird sie als `/` auf `partner.coolin.at`;
 * die Middleware schreibt intern hierher um. Begründung: `PORTAL_RENDER_ROOT` in
 * `lib/portal-host.ts`.
 *
 * ── WARUM „ALLGEMEIN" AUF DER WURZEL LIEGT UND NICHT „MARKETING" ────────────────────────────────
 * Es ist der erste Reiter, und ein erster Punkt, der nicht die Startseite des Bereichs ist, wäre
 * eine eigene Merkwürdigkeit (dieselbe Ordnung wie „Übersicht" im Admin-Bereich). Fachlich ist es
 * ausserdem der Reiter, der immer etwas zu zeigen hat: Er sagt, mit welchem Konto und für welchen
 * Betrieb man gerade angemeldet ist — die Frage, die vor jeder anderen kommt.
 *
 * ── DIE DREI ZUSTÄNDE SIND UNVERÄNDERT (B16-4b) ────────────────────────────────────────────────
 * Nicht angemeldet → `/anmelden?next=/` (das Rücksprungziel ist die Adresse AUF DIESEM HOST, nie
 * der Render-Pfad). Angemeldet ohne aktive Partnerzeile → Erklärzustand, ausdrücklich KEINE
 * Umleitung: Das ist der Normalfall jedes Monitor- und Kalkulator-Kontos, und wer angemeldet ist
 * und trotzdem weggeschickt würde, liefe im Kreis. Angemeldet mit Partnerzeile → das Portal.
 *
 * Die beiden Nicht-Partner-Zustände rendern DIESELBE Fassung wie `/partner-portal`
 * (`PartnerPortalPage`) — bewusst ohne Reiter: Es gibt nichts zu navigieren. Die Kopfzeile bleibt,
 * damit man sich abmelden kann.
 */
export const dynamic = 'force-dynamic'

export default async function Page() {
  const portal = await readPortal()

  // Serverseitig, BEVOR irgendetwas gerendert oder ausgeliefert wird (Invariante J6).
  if (!portal) {
    redirectToLocalized(ANMELDEN_HREF, routing.defaultLocale, { [NEXT_PARAM]: PORTAL_HOST_ROOT })
  }

  if (portal.state.state !== 'partner') {
    return (
      <PortalShell active={null}>
        <PartnerPortalPage state={portal.state} referralUrl={portal.referralUrl} />
      </PortalShell>
    )
  }

  return (
    <PortalShell active={PORTAL_HOST_ROOT}>
      <PortalGeneralPanel partner={portal.state.partner} email={portal.email} />
    </PortalShell>
  )
}
