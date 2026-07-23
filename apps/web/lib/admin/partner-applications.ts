/**
 * Vokabular und Antwort-Leser des Admin-Abschnitts „Partner-Anträge" (B16-3).
 *
 * REIN: kein `server-only`, kein `next/*` — die Seiten lesen die Typen, die interne
 * Benachrichtigungsmail den Detail-Pfad, das Client-Formular die Beschriftungen. Gleiche Aufteilung
 * wie `lib/admin/leads.ts` (B1-3), `lib/admin/analyses.ts` (B14-2) und `lib/admin/partners.ts`
 * (B16-2).
 *
 * ── WARUM EIN GESCHWISTERPFAD UND KEIN UNTERPFAD VON `/admin/partner` ───────────────────────────
 * `components/admin/nav.tsx` markiert einen Punkt als aktiv, wenn der Pfad mit ihm beginnt. Läge der
 * Eingang unter `/admin/partner/antraege`, wären BEIDE Punkte gleichzeitig markiert — genau der
 * Zustand, vor dem der Kommentar dort warnt („der Nutzer sähe zwei aktive Punkte und wüsste nicht,
 * wo er ist"). `/admin/partner-antraege` ist ein eigener Zweig und markiert genau sich selbst.
 *
 * Der Zeilen-Typ ist eine BEHAUPTUNG über die Migration, kein Beweis (die Wrapper geben `jsonb`
 * zurück). Deshalb wird defensiv gelesen: Ist der Status nicht `ok`, kommt `null` zurück statt eines
 * Laufzeitfehlers mitten im Rendern — und die Seite kann „konnte nicht geladen werden" von „es gibt
 * keine Anträge" unterscheiden. Der Unterschied ist hier nicht theoretisch: Ein leerer Eingang ist
 * der NORMALZUSTAND am ersten Tag.
 */

/** Basispfad des Abschnitts — ohne Locale-Präfix, wie der ganze Admin-Bereich. */
export const PARTNER_APPLICATIONS_HREF = '/admin/partner-antraege'

/** Der Pfad einer einzelnen Bewerbung. Auch die interne Benachrichtigungsmail verlinkt darauf. */
export function PARTNER_APPLICATION_DETAIL_HREF(id: string): string {
  return `${PARTNER_APPLICATIONS_HREF}/${id}`
}

export type PartnerApplicationStatus = 'pending' | 'approved' | 'rejected'

/** Die Statuswerte in der Reihenfolge, in der sie als Filter angeboten werden. */
export const PARTNER_APPLICATION_STATUSES: readonly PartnerApplicationStatus[] = [
  'pending',
  'approved',
  'rejected',
] as const

export function isPartnerApplicationStatus(value: unknown): value is PartnerApplicationStatus {
  return (
    typeof value === 'string' && (PARTNER_APPLICATION_STATUSES as readonly string[]).includes(value)
  )
}

/**
 * Beschriftungen des Status. Deutsch im Code, nicht in `messages/de.json` — der Admin-Bereich liegt
 * ausserhalb der next-intl-Struktur (begründet in `lib/admin/schema.ts`, T4-4).
 */
export const PARTNER_APPLICATION_STATUS_LABEL: Record<PartnerApplicationStatus, string> = {
  pending: 'Offen',
  approved: 'Genehmigt',
  rejected: 'Abgelehnt',
}

/** Eine Zeile aus `public.admin_list_partner_applications`. */
export type PartnerApplicationRow = {
  id: string
  company: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  website: string | null
  message: string
  status: PartnerApplicationStatus
  created_at: string
  reviewed_at: string | null
  /**
   * Hängt ein Auth-Konto am Antrag? Bewusst nur ein BOOLEAN in der Liste: die Kontoadresse ist für
   * die Übersicht ohne Belang, und ein Feld, das dort nicht gebraucht wird, hat in einer Liste über
   * fremde Personen nichts verloren. Die Detailansicht liefert sie.
   */
  has_account: boolean
}

/** Der vollständige Antrag aus `public.admin_get_partner_application`. */
export type PartnerApplicationDetail = Omit<PartnerApplicationRow, 'has_account'> & {
  user_id: string | null
  /** Die Adresse des VERKNÜPFTEN KONTOS — nicht zwingend die Adresse im Antrag (s. u.). */
  account_email: string | null
  reviewed_by_email: string | null
  /**
   * Der Fachbetrieb, der AUS DIESEM ANTRAG entstanden ist (B16-4a) — `null`, solange er nicht
   * genehmigt ist. Ohne dieses Feld endete ein genehmigter Antrag in einer Sackgasse: die
   * Gegenrichtung des Fremdschlüssels wird sonst nirgends gelesen.
   */
  partner_slug: string | null
  /**
   * Der Fachbetrieb, an dem das KONTO dieses Antrags bereits hängt (B16-4a). Steht VOR der
   * Genehmigung als Warnung zur Verfügung — sonst erführe man erst durch die Ablehnung
   * `account_taken`, dass das Konto vergeben ist, nachdem man bereits einen Kurz-Key bestätigt hat.
   * Nach der Genehmigung ist er identisch mit `partner_slug`.
   */
  account_partner_slug: string | null
  /**
   * OB und WANN der entstandene Fachbetrieb über seinen Portalzugang benachrichtigt wurde (B16-4b) —
   * `null` heisst „noch nie".
   *
   * ⚠ Der Grund, warum dieses Feld hier steht und nicht nur in der Partnerliste: Die Erfolgsmeldung
   * der Genehmigung bleibt NICHT stehen (das Genehmigungsformular wird nur gerendert, solange der
   * Antrag `pending` ist — mit dem Erfolg verschwindet es samt seiner Meldung; im Bau gemessen).
   * Ohne dieses Feld wäre ausgerechnet der Fall „Mailversand gescheitert" auf dieser Seite unsichtbar
   * und der Admin hielte den Vorgang für abgeschlossen.
   */
  partner_notified_at: string | null
}

export type PartnerApplicationList = {
  total: number
  limit: number
  offset: number
  applications: PartnerApplicationRow[]
}

function asObject(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
}

/**
 * `null` = der Wrapper hat NICHT `ok` gemeldet (nicht: „es gibt keine Anträge").
 * `'invalid_filter'` = der Statusfilter wurde abgewiesen; die Seite sagt das, statt eine
 * ungefilterte Liste als gefilterte auszugeben.
 */
export function readPartnerApplicationList(
  data: unknown,
): PartnerApplicationList | 'invalid_filter' | null {
  const obj = asObject(data)
  if (!obj) return null
  if (obj.status === 'invalid_filter') return 'invalid_filter'
  if (obj.status !== 'ok') return null

  return {
    total: typeof obj.total === 'number' ? obj.total : 0,
    limit: typeof obj.limit === 'number' ? obj.limit : 50,
    offset: typeof obj.offset === 'number' ? obj.offset : 0,
    applications: Array.isArray(obj.applications)
      ? (obj.applications as PartnerApplicationRow[])
      : [],
  }
}

/** `null` = nicht gelesen; `'not_found'` = es gibt ihn nicht. Zwei verschiedene Aussagen. */
export function readPartnerApplicationDetail(
  data: unknown,
): PartnerApplicationDetail | 'not_found' | null {
  const obj = asObject(data)
  if (!obj) return null
  if (obj.status === 'not_found') return 'not_found'
  if (obj.status !== 'ok') return null
  const application = asObject(obj.application)
  return application ? (application as PartnerApplicationDetail) : null
}

/**
 * Vor- und Nachname als EIN Satz — nur für die Anzeige.
 *
 * Die Datenbank führt beide getrennt (dieselbe Begründung wie bei `platform.partners` und
 * `platform.leads`: die Zerlegung eines zusammengesetzten Namens scheitert bei Doppelnamen und
 * Titeln, und der Fehler landet in einer Anrede). Die Zusammenführung geht nur in EINE Richtung und
 * ändert nichts an den gespeicherten Werten.
 */
export function applicantName(row: {
  first_name: string | null
  last_name: string | null
}): string {
  return [row.first_name, row.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ')
}
