import { PartnerPortalPage } from '@/components/partner-portal/partner-portal-page'
import { ANMELDEN_HREF, NEXT_PARAM } from '@/lib/auth/config'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { partnerHref } from '@/lib/leads/partner'
import { readMyPartner } from '@/lib/partner-portal/portal'
import { absoluteUrl } from '@/lib/site'
import { createClient } from '@/lib/supabase/server'

/**
 * DER PORTALBEREICH — EINE Fassung, zwei Adressen (B18-1a-Nachbesserung).
 *
 * Bis hierher stand dieser Ablauf im Rumpf von `app/(site)/[locale]/partner-portal/page.tsx`. Seit
 * `partner.coolin.at/` denselben Bereich bedient, gibt es dafür zwei Routen — und genau deshalb
 * steht er hier: Eine zweite, kopierte Fassung liefe auseinander, und zwar an der teuersten Stelle,
 * die dieses Produkt hat. Die drei Zustände (nicht angemeldet → Anmeldung, angemeldet ohne
 * Partnerzeile → Erklärzustand, angemeldet mit aktiver Partnerzeile → Portal) sind eine fachliche
 * Entscheidung, keine Darstellungsfrage; sie ausgerechnet je Host getrennt zu pflegen hiesse, dass
 * ein Fachbetrieb je nach Adresse etwas anderes zu sehen bekommt.
 *
 * Verschoben, NICHT umgeschrieben: Die Begründungen zu den drei Zuständen, zu `force-dynamic` und
 * zur Nicht-Umleitung des Erklärzustands stehen unverändert im Kopf der Route
 * `/partner-portal`; die Ableitung selbst liegt weiterhin in `lib/partner-portal/portal.ts`, die
 * Darstellung in `partner-portal-page.tsx`.
 *
 * ── DER EINZIGE UNTERSCHIED ZWISCHEN DEN BEIDEN ADRESSEN IST DAS RÜCKSPRUNGZIEL ─────────────────
 * `signInNext` sagt, wohin die Anmeldung zurückführt — und das ist AUF DEMSELBEN HOST zu lesen:
 * auf coolin.at `/partner-portal`, auf dem Portal-Host `/`. Der Wert läuft unverändert durch den
 * bestehenden Mechanismus (`NEXT_PARAM` + `sanitizeNext` in `signInAction`); hier wird NICHTS
 * nachgebaut und ausdrücklich keine Host-Allowlist eingeführt: `sanitizeNext` lässt seiten-INTERNE
 * Pfade zu, und ein interner Pfad bleibt beim Umleiten von sich aus auf dem Host, von dem er kam.
 * Genau deshalb genügt `/` — es gibt keine Adresse, die einen anderen Host tragen müsste.
 */
export async function PartnerPortalRoute({
  locale,
  /** Rücksprungziel nach der Anmeldung — ein seiten-interner Pfad auf DEMSELBEN Host. */
  signInNext,
}: {
  locale: string
  signInNext: string
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Serverseitig, BEVOR irgendetwas gerendert oder ausgeliefert wird (Invariante J6).
  if (!user) {
    redirectToLocalized(ANMELDEN_HREF, locale, { [NEXT_PARAM]: signInNext })
  }

  const { data, error } = await supabase.rpc('get_my_partner')
  if (error) console.error('[partner-portal] get_my_partner:', error)

  const state = readMyPartner(data, error)

  /*
   * Der vollständige Link entsteht SERVERSEITIG aus `absoluteUrl` — es gibt in dieser App genau
   * eine Basis-URL (`lib/site.ts`). Im Browser aus `window.location.origin` zusammengesetzt trüge
   * er auf einer Preview-Domain eine Adresse, die ein Fachbetrieb an hunderte Bestandskunden
   * verschickt und die in Wochen ins Leere zeigt. Dieselbe Begründung wie im Admin-Bereich (B16-2).
   *
   * ⚠ AUF DEM PORTAL-HOST GILT DASSELBE, und das ist Absicht: Der Empfehlungslink zeigt auf die
   * Landingpage `/partner/<slug>` — die liegt auf der HAUPTDOMAIN und wird auf dem Portal-Host per
   * 308 weggeleitet. Ein relativ gebildeter Link trüge hier also die falsche Adresse.
   */
  const referralUrl =
    state.state === 'partner' ? absoluteUrl(partnerHref(state.partner.slug)) : null

  return <PartnerPortalPage state={state} referralUrl={referralUrl} />
}
