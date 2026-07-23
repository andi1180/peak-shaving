/**
 * Der Leser des Partner-Portals (B16-4b) — die Anwendungsseite von `public.get_my_partner`.
 *
 * REIN: kein `server-only`, kein `next/*`, keine Datenbank. Die Route liest die Typen, das
 * Client-Kopierfeld die Werte, der Test beides.
 *
 * ── DREI ZUSTÄNDE, UND DER MITTLERE IST DER WICHTIGE ────────────────────────────────────────────
 * Der Wrapper gibt `jsonb` zurück; der Typ hier ist eine BEHAUPTUNG über die Migration, kein Beweis.
 * Deshalb wird defensiv gelesen, und zwar mit einer Unterscheidung, die es an keiner anderen
 * Leser-Stelle gibt (`readPartnerList`, B16-2, kennt nur „geht/geht nicht"):
 *
 *   `partner`  Es gibt eine aktive Partnerzeile zu diesem Konto → Portal.
 *   `none`     Es gibt keine → Erklärzustand mit Verweis auf `/partner-werden`. KEIN Fehler und
 *              KEINE Umleitung ins Leere: Das ist der Normalfall für jedes Konto dieser Plattform,
 *              und ein Kunde, der die Adresse zufällig aufruft, darf nicht auf einer Fehlerseite
 *              landen. Ein STILLGELEGTER Betrieb landet ebenfalls hier — der Wrapper gibt ihn nicht
 *              heraus, die Anwendung kann den dritten Zustand also gar nicht erst erfinden (dieselbe
 *              Konstruktion wie bei der Landingpage, die ab der Stilllegung 404 antwortet).
 *   `error`    Die Antwort war nicht lesbar. Ausdrücklich NICHT dasselbe wie `none` — sonst
 *              schickte ein Datenbankausfall einen echten Fachbetrieb auf das Bewerbungsformular
 *              und legte ihm nahe, sich ein zweites Mal zu bewerben.
 */

/** Die EINZIGEN Felder, die `public.get_my_partner` herausgibt (die Beschränkung steht in der DB). */
export type PortalPartner = {
  slug: string
  displayName: string
}

export type PortalState =
  | { state: 'partner'; partner: PortalPartner }
  | { state: 'none' }
  | { state: 'error' }

function asObject(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
}

/**
 * Liest die Antwort von `public.get_my_partner`.
 *
 * `error` ist der Rückfall für alles Unerwartete — auch für ein `ok` ohne Slug oder Anzeigename.
 * Ein Portal, das einen leeren Empfehlungslink zum Kopieren anböte, wäre schlimmer als eines, das
 * sagt, dass es gerade nicht geht: Der Link ginge an Bestandskunden und liesse sich nicht
 * zurückholen.
 */
export function readMyPartner(data: unknown, error?: unknown): PortalState {
  if (error) return { state: 'error' }

  const obj = asObject(data)
  if (!obj) return { state: 'error' }
  if (obj.status === 'none') return { state: 'none' }
  if (obj.status !== 'ok') return { state: 'error' }

  const slug = typeof obj.slug === 'string' ? obj.slug.trim() : ''
  const displayName = typeof obj.display_name === 'string' ? obj.display_name.trim() : ''
  if (slug === '' || displayName === '') return { state: 'error' }

  return { state: 'partner', partner: { slug, displayName } }
}
