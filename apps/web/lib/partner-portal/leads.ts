/**
 * Der Leser der Partner-Lead-Sicht (B18-6) — die Anwendungsseite von `public.get_my_partner_leads`.
 *
 * REIN: kein `server-only`, kein `next/*`, keine Datenbank. Genau derselbe Aufbau wie
 * `portal.ts`/`read.ts`: hier die Auslegung der Antwort, dort der Aufruf. Der Test kommt damit ohne
 * Stack aus, und die Anzeige-Komponente kann die Typen lesen, ohne eine Server-Abhängigkeit zu
 * ziehen.
 *
 * ── DIE ZWEI ZAHLEN SIND DER GANZE INHALT DIESES REITERS ────────────────────────────────────────
 * Der Wrapper liefert `leads` (die FREIGEGEBENEN, mit Feldern) und `total` (ALLE zugeordneten,
 * nicht anonymisierten Anfragen — unabhängig von der Einwilligung). Die Differenz ist die
 * namenlose Restmenge: Anfragen, die dieser Betrieb gebracht hat, deren Kontaktdaten er aber nicht
 * sehen darf, weil die Person die Weitergabe nicht freigegeben hat.
 *
 * Sie wird HIER berechnet und nicht in der Komponente: Es ist eine Aussage über die Daten, keine
 * Darstellungsfrage — und sie ist die einzige Stelle, an der aus zwei richtigen Zahlen eine falsche
 * werden kann. Deshalb `Math.max(0, …)`: Ein `total`, das kleiner wäre als die gelieferte Liste,
 * kann es fachlich nicht geben, aber eine negative Zahl in einem Satz wie „ausserdem −1 Anfragen"
 * ist die schlechteste denkbare Art, davon zu erfahren.
 *
 * ── DREI ZUSTÄNDE, UND DER MITTLERE IST HIER EIN GRENZFALL ──────────────────────────────────────
 *   `ok`      Es gibt eine aktive Partnerzeile → Liste und Zahlen.
 *   `none`    Der Wrapper hat keine aktive Partnerzeile gefunden. ⚠ Auf DIESEM Reiter ist das ein
 *             Widerspruch und kein Normalfall: Die Seite ruft ihn ausschliesslich auf, nachdem
 *             `readPortal` bereits einen Partner gemeldet hat. Er entsteht real nur, wenn der
 *             Betrieb ZWISCHEN den beiden Aufrufen stillgelegt wurde. Er bleibt trotzdem ein
 *             eigener Zustand statt stillschweigend `error` zu werden — damit das Log die Ursache
 *             benennen kann; angezeigt wird beides gleich (s. `PortalLeadsPanel`).
 *   `error`   Die Antwort war nicht lesbar, oder der Aufruf ist gescheitert. ⚠ AUSDRÜCKLICH NICHT
 *             als „0 Anfragen" dargestellt: Eine leere Liste ist eine AUSSAGE („noch nichts
 *             gekommen"), ein Fehler ist das Fehlen einer Aussage. Wer beides gleich anzeigt, sagt
 *             einem Fachbetrieb, seine Aussendung sei wirkungslos geblieben, obwohl niemand
 *             nachgesehen hat.
 */

/**
 * Eine freigegebene Anfrage — GENAU die Felder, die `public.get_my_partner_leads` herausgibt.
 *
 * Der Massstab dort ist der RÜCKRUF, nicht der Aktenauszug: Der interne Lead-Status, die
 * Aufbewahrungsfelder und die Segmentierungsmerkmale fahren bewusst nicht mit (B18-6-Schema). Diese
 * Beschränkung steht in der DATENBANK; der Typ hier ist eine BEHAUPTUNG über die Migration, kein
 * Beweis — deshalb wird unten defensiv gelesen.
 *
 * Alle Felder ausser `id` sind nullable: In `platform.leads` sind `company`, `first_name`,
 * `last_name` und `phone` optional (erhoben wird, was der jeweilige Einstiegspunkt fragt). `null`
 * heisst „nicht angegeben" und wird als solches durchgereicht, NICHT zu `''` geglättet — eine
 * Oberfläche, die eine Zeile weglassen will, muss den Fall erkennen können.
 */
export type PortalLead = {
  id: string
  company: string | null
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  /** ISO-Zeitstempel aus `platform.leads.created_at` — wann die Anfrage eingegangen ist. */
  createdAt: string | null
}

export type PortalLeadsState =
  | {
      state: 'ok'
      /** Die freigegebenen Anfragen, neueste zuerst (die Reihenfolge kommt aus dem Wrapper). */
      leads: PortalLead[]
      /** ALLE zugeordneten, nicht anonymisierten Anfragen — mit und ohne Freigabe. */
      total: number
      /** `total − leads.length`: die Anfragen, die mitzählen, aber keinen Namen tragen dürfen. */
      withoutConsent: number
    }
  | { state: 'none' }
  | { state: 'error' }

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** `null` bei allem, was keine nichtleere Zeichenkette ist — s. Typ-Kommentar oben. */
function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Liest die Antwort von `public.get_my_partner_leads`.
 *
 * ── EINE ZEILE OHNE `id` WIRD VERWORFEN, NICHT GERETTET ─────────────────────────────────────────
 * Sie ist das einzige Pflichtfeld: Ohne sie hat die Liste keinen stabilen Schlüssel, und die
 * Oberfläche müsste einen aus der E-Mail-Adresse bilden — Personenbezug in DOM-Attributen, genau
 * der Grund, aus dem der Wrapper die Kennung überhaupt mitliefert. Verworfen wird die EINZELNE
 * Zeile; der Rest der Liste bleibt. Die Alternative wäre, wegen einer unlesbaren Zeile die ganze
 * Sicht auf `error` zu setzen — dann verschwänden echte, freigegebene Anfragen aus dem Blick eines
 * Fachbetriebs, weil eine andere Zeile kaputt ist.
 *
 * ⚠ `total` bleibt dabei UNANGETASTET. Es ist die Zahl der Datenbank, nicht die Länge der Liste;
 * eine verworfene Zeile wandert dadurch automatisch in die namenlose Restmenge, statt spurlos zu
 * verschwinden. Das ist die richtige Fehlerrichtung: lieber „eine Anfrage, die ich nicht sehe" als
 * „eine Anfrage, die es nie gab".
 */
export function readMyPartnerLeads(data: unknown, error?: unknown): PortalLeadsState {
  if (error) return { state: 'error' }

  const obj = asObject(data)
  if (!obj) return { state: 'error' }
  if (obj.status === 'none') return { state: 'none' }
  if (obj.status !== 'ok') return { state: 'error' }

  /*
   * `total` MUSS eine Zahl sein — ohne sie liesse sich die namenlose Restmenge nicht bilden, und
   * die wegzulassen hiesse, dem Fachbetrieb eine unvollständige Liste als vollständige zu zeigen.
   * `Number.isInteger` statt `typeof === 'number'`: `NaN` und `Infinity` sind beides Zahlen und
   * beides keine Anzahl.
   */
  if (!Number.isInteger(obj.total) || (obj.total as number) < 0) return { state: 'error' }
  const total = obj.total as number

  if (!Array.isArray(obj.leads)) return { state: 'error' }

  const leads: PortalLead[] = []
  for (const entry of obj.leads) {
    const row = asObject(entry)
    if (!row) continue
    const id = optionalText(row.id)
    if (!id) continue
    leads.push({
      id,
      company: optionalText(row.company),
      firstName: optionalText(row.first_name),
      lastName: optionalText(row.last_name),
      email: optionalText(row.email),
      phone: optionalText(row.phone),
      createdAt: optionalText(row.created_at),
    })
  }

  return { state: 'ok', leads, total, withoutConsent: Math.max(0, total - leads.length) }
}
