import 'server-only'
import { partnerHref } from '@/lib/leads/partner'
import { readMyPartner, type PortalState } from '@/lib/partner-portal/portal'
import { absoluteUrl } from '@/lib/site'
import { createClient } from '@/lib/supabase/server'

/**
 * DER EINE LESEWEG DES PORTALBEREICHS (B18-3, herausgezogen aus `partner-portal-route.tsx`).
 *
 * ── WARUM ES IHN GIBT ───────────────────────────────────────────────────────────────────────────
 * Seit B18-3 gibt es DREI Routen, die denselben Zustand brauchen: `/partner-portal` auf coolin.at
 * (unverändert) sowie die zwei Reiter des Portalbereichs auf `partner.coolin.at`. Der Ablauf ist in
 * allen dreien identisch — Sitzung lesen, `get_my_partner` aufrufen, den Empfehlungslink bilden —
 * und er ist keine Darstellungsfrage: An ihm hängt, ob ein Fachbetrieb sein Portal sieht, den
 * Erklärzustand oder eine Fehlermeldung. Drei Kopien liefen auseinander, und zwar an der teuersten
 * Stelle, die dieses Produkt hat.
 *
 * REIN AUF DEN ZUSTAND BESCHRÄNKT: Diese Datei leitet NICHT um und rendert nichts. Wohin ein nicht
 * angemeldeter Besucher geschickt wird, ist je Route verschieden (das Rücksprungziel ist die
 * Adresse AUF DEM JEWEILIGEN HOST) — das entscheidet der Aufrufer, und deshalb ist „keine Sitzung"
 * hier ein Rückgabewert (`null`) und keine Weiterleitung.
 */
export type PortalRead = {
  /**
   * Die Adresse des angemeldeten Kontos.
   *
   * Sie kommt aus der SITZUNG und ausdrücklich NICHT aus `get_my_partner` — der Wrapper liefert
   * keine E-Mail, und das ist Absicht (B18-3-Schema: was eine Server Component liest, kann im
   * ausgelieferten HTML landen). Die Sitzung hat sie ohnehin, es ist die Adresse des Lesenden
   * selbst, und sie beantwortet die einzige Frage, die ein Fachbetrieb hier wirklich stellt:
   * „mit welchem Konto bin ich gerade angemeldet".
   */
  email: string | null
  state: PortalState
  /** Der VOLLSTÄNDIGE Empfehlungslink — `null`, sobald es keine aktive Partnerzeile gibt. */
  referralUrl: string | null
}

/** Liest den Portalzustand des angemeldeten Kontos. `null` = keine Sitzung. */
export async function readPortal(): Promise<PortalRead | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Serverseitig, BEVOR irgendetwas gerendert oder ausgeliefert wird (Invariante J6).
  if (!user) return null

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

  return { email: user.email ?? null, state, referralUrl }
}
