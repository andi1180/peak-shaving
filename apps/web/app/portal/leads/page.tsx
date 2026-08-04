import { PartnerPortalPage } from '@/components/partner-portal/partner-portal-page'
import { PortalLeadsPanel } from '@/components/portal/leads-panel'
import { PortalShell } from '@/components/portal/shell'
import { ANMELDEN_HREF, NEXT_PARAM } from '@/lib/auth/config'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { PORTAL_LEADS_PATH } from '@/lib/portal-host'
import { readPortal } from '@/lib/partner-portal/read'
import { readPartnerLeads } from '@/lib/partner-portal/read-leads'
import { routing } from '@/i18n/routing'

/**
 * DER REITER „LEADS" (B18-6) — die Anfragen, die über den Empfehlungslink dieses Betriebs kamen.
 *
 * ⚠ VON AUSSEN AUF KEINEM HOST ERREICHBAR. Adressiert wird er als `/leads` auf
 * `partner.coolin.at`; die Middleware schreibt intern hierher um. Begründung: `PORTAL_RENDER_ROOT`
 * in `lib/portal-host.ts`.
 *
 * ── ⚠ DIE ZUGANGSPRÜFUNG STEHT HIER, NICHT IM LAYOUT ────────────────────────────────────────────
 * Dieselbe Lehre wie im Admin-Bereich und in den zwei bestehenden Reitern: Dass ein Layout
 * `children` nicht rendert, verhindert nicht, dass Next die Seite rendert und ins Flight-Payload
 * schreibt. Eine Seite dieses Bereichs ohne `readPortal` wäre ein Portalbereich ohne Anmeldung —
 * und sie funktionierte tadellos. Ein Test in `lib/portal-host.test.ts` misst das für JEDE Seite
 * unter dem Render-Baum, diese eingeschlossen.
 *
 * ── ZWEI AUFRUFE, IN DIESER REIHENFOLGE, UND DER ZWEITE NUR IM PARTNER-FALL ─────────────────────
 * `readPortal` beantwortet die Frage, die jeder Reiter stellt (angemeldet? aktive Partnerzeile?).
 * Erst wenn sie mit „Partner" beantwortet ist, wird `readPartnerLeads` aufgerufen — sonst führte
 * jeder Aufruf dieser Adresse durch einen Nicht-Partner zu einer Abfrage, deren Ergebnis niemand
 * ansieht. Die Leads sind bewusst NICHT Teil von `readPortal`: Sie werden von genau einer Seite
 * gebraucht, `readPortal` läuft auf vieren.
 *
 * ── DIE DREI ZUSTÄNDE SIND UNVERÄNDERT DIE DER BESTEHENDEN REITER ──────────────────────────────
 * Nicht angemeldet → `/anmelden?next=/leads` (das Rücksprungziel ist die Adresse AUF DIESEM HOST,
 * nie der Render-Pfad; wer sich von diesem Reiter aus anmeldet, will hierher zurück). Angemeldet
 * ohne aktive Partnerzeile → dieselbe Fassung wie `/partner-portal`, ausdrücklich OHNE Reiter (es
 * gibt nichts zu navigieren) und ohne Umleitung. Angemeldet mit Partnerzeile → dieser Reiter.
 *
 * Ein Fehlschlag des Lead-Aufrufs ist KEIN vierter Zustand dieser Seite: Er wird zu einem
 * Anzeigezustand INNERHALB des Reiters (`PortalLeadsPanel`), damit Rahmen und Navigation stehen
 * bleiben. Ein Fachbetrieb, den ein Datenbankfehler aus seinem Portal wirft, kann nicht einmal mehr
 * auf einen anderen Reiter wechseln.
 */
export const dynamic = 'force-dynamic'

export default async function Page() {
  const portal = await readPortal()

  // Serverseitig, BEVOR irgendetwas gerendert oder ausgeliefert wird (Invariante J6).
  if (!portal) {
    redirectToLocalized(ANMELDEN_HREF, routing.defaultLocale, { [NEXT_PARAM]: PORTAL_LEADS_PATH })
  }

  if (portal.state.state !== 'partner') {
    return (
      <PortalShell active={null}>
        <PartnerPortalPage state={portal.state} referralUrl={portal.referralUrl} />
      </PortalShell>
    )
  }

  const leads = await readPartnerLeads()

  return (
    <PortalShell active={PORTAL_LEADS_PATH}>
      <PortalLeadsPanel leads={leads} />
    </PortalShell>
  )
}
