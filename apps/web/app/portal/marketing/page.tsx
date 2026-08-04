import { PartnerMarketingContent } from '@/components/partner-portal/partner-marketing-content'
import { PartnerPortalPage } from '@/components/partner-portal/partner-portal-page'
import { PortalShell } from '@/components/portal/shell'
import { Container } from '@/components/ui/layout'
import { ANMELDEN_HREF, NEXT_PARAM } from '@/lib/auth/config'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { PORTAL_MARKETING_PATH } from '@/lib/portal-host'
import { readPortal } from '@/lib/partner-portal/read'
import { routing } from '@/i18n/routing'

/**
 * DER REITER „MARKETING" (B18-3) — Empfehlungslink und Textvorlagen.
 *
 * ⚠ VON AUSSEN AUF KEINEM HOST ERREICHBAR. Adressiert wird er als `/marketing` auf
 * `partner.coolin.at`; die Middleware schreibt intern hierher um. Begründung: `PORTAL_RENDER_ROOT`
 * in `lib/portal-host.ts`.
 *
 * ── DER INHALT IST VERSCHOBEN, NICHT KOPIERT ───────────────────────────────────────────────────
 * `PartnerMarketingContent` ist dieselbe Fassung, die `/partner-portal` auf coolin.at zeigt (dort
 * im öffentlichen Website-Rahmen). Geändert hat sich allein der Rahmen darum: Kopfzeile und Reiter
 * statt Mega-Menü. Eine zweite Fassung liefe auseinander — und diese Texte gehen unter dem NAMEN
 * DES PARTNERS an dessen Bestandskunden.
 *
 * Die drei Zustände und das Rücksprungziel folgen derselben Regel wie in der Wurzel des Bereichs
 * (`app/portal/page.tsx`), nur zeigt `next` hier auf `/marketing`: Wer sich von diesem Reiter aus
 * anmeldet, will zu diesem Reiter zurück.
 */
export const dynamic = 'force-dynamic'

export default async function Page() {
  const portal = await readPortal()

  // Serverseitig, BEVOR irgendetwas gerendert oder ausgeliefert wird (Invariante J6).
  if (!portal) {
    redirectToLocalized(ANMELDEN_HREF, routing.defaultLocale, {
      [NEXT_PARAM]: PORTAL_MARKETING_PATH,
    })
  }

  if (portal.state.state !== 'partner') {
    return (
      <PortalShell active={null}>
        <PartnerPortalPage state={portal.state} referralUrl={portal.referralUrl} />
      </PortalShell>
    )
  }

  return (
    <PortalShell active={PORTAL_MARKETING_PATH}>
      <Container className="py-16 sm:py-24">
        <div className="mx-auto w-full max-w-2xl">
          {/*
           * Kein `Eyebrow` „Partner-Portal" wie auf `/partner-portal`: Dort ordnet er die Seite
           * innerhalb der Website ein, hier sagt die Kopfzeile es bereits — und zweimal derselbe
           * Satz übereinander liest sich wie ein Fehler.
           */}
          <PartnerMarketingContent
            companyName={portal.state.partner.displayName}
            referralUrl={portal.referralUrl}
          />
        </div>
      </Container>
    </PortalShell>
  )
}
