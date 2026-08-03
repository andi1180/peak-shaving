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

/**
 * Die EINZIGEN Felder, die `public.get_my_partner` herausgibt (die Beschränkung steht in der DB).
 *
 * ── SLUG UND ANZEIGENAME SIND PFLICHT, DIE ÜBRIGEN DREI NICHT ───────────────────────────────────
 * `slug`/`displayName` tragen den Empfehlungslink; fehlt eines von beiden, ist die Antwort für
 * diesen Zweck unbrauchbar und `readMyPartner` liefert `error` (s. unten). Die drei mit B18-3
 * ergänzten Felder sind OPTIONAL, und zwar aus zwei verschiedenen Gründen gleichzeitig:
 *
 *   `contactFirstName`/`contactLastName` sind in `platform.partners` nullable — ein von Hand
 *   aufgenommener Betrieb ohne hinterlegte Ansprechperson ist der reale Normalfall. `null` heisst
 *   hier „nichts hinterlegt" und wird als solches durchgereicht, NICHT zu `''` geglättet: Eine
 *   Oberfläche, die „keine Ansprechperson hinterlegt" schreiben will, muss den Fall erkennen können.
 *
 *   `partnerSince` fehlt, wenn die Antwort das Feld nicht (oder unlesbar) trägt — etwa aus einer
 *   Datenbank, auf der diese Migration noch nicht liegt. Das ist kein Fehler, der ein Portal
 *   sperren dürfte: Der Empfehlungslink funktioniert auch ohne Beitrittsdatum.
 *
 * Defensiv gelesen wie die bestehenden Felder — der Typ hier ist eine BEHAUPTUNG über die
 * Migration, kein Beweis.
 */
export type PortalPartner = {
  slug: string
  displayName: string
  /** Vorname der Ansprechperson; `null` = nicht hinterlegt, `undefined` = nicht mitgeliefert. */
  contactFirstName?: string | null
  /** Nachname der Ansprechperson; `null` = nicht hinterlegt, `undefined` = nicht mitgeliefert. */
  contactLastName?: string | null
  /** ISO-Zeitstempel aus `platform.partners.created_at` — seit wann der Betrieb Partner ist. */
  partnerSince?: string
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

  return {
    state: 'partner',
    partner: {
      slug,
      displayName,
      contactFirstName: optionalName(obj.contact_first_name),
      contactLastName: optionalName(obj.contact_last_name),
      partnerSince: typeof obj.created_at === 'string' ? obj.created_at : undefined,
    },
  }
}

/**
 * Ein optionales Namensfeld der Ansprechperson (B18-3).
 *
 * Dieselbe defensive Haltung wie oben — mit einem bewussten Unterschied zu `slug`/`displayName`:
 * Dort ist ein leerer Wert ein FEHLER (ohne sie gäbe es keinen Empfehlungslink), hier ist er eine
 * ANGABE, nämlich „nicht hinterlegt". Ein Leerstring oder reine Leerzeichen werden deshalb zu
 * `null` normalisiert statt durchgereicht: Beides sähe in einer Oberfläche wie ein hinterlegter,
 * aber unsichtbarer Name aus, und die Anrede daraus wäre eine Lücke mitten im Satz. Alles, was
 * keine Zeichenkette ist, gilt als „nicht mitgeliefert" (`undefined`).
 */
function optionalName(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
