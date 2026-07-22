/**
 * Vokabular und Antwort-Leser des Admin-Abschnitts „Partner" (B16-2).
 *
 * REIN: kein `server-only`, kein `next/*` — die Server-Seite liest die Typen, das Client-Formular
 * die Beschriftungen. Gleiche Aufteilung wie `lib/admin/leads.ts` (B1-3) und `lib/admin/analyses.ts`
 * (B14-2).
 *
 * Der Zeilen-Typ ist eine BEHAUPTUNG über die Migration, kein Beweis (`admin_list_partners` gibt
 * `jsonb` zurück). Deshalb liest `readPartnerList` defensiv: Ist der Status nicht `ok`, kommt `null`
 * zurück statt eines Laufzeitfehlers mitten im Rendern — und die Seite kann „konnte nicht geladen
 * werden" von „es gibt noch keine Fachbetriebe" unterscheiden. Der Unterschied ist hier nicht
 * theoretisch: Eine leere Partnerliste ist der NORMALZUSTAND am ersten Tag.
 */

/** Basispfad des Partner-Abschnitts — ohne Locale-Präfix, wie der ganze Admin-Bereich. */
export const PARTNERS_HREF = '/admin/partner'

/**
 * Eine Zeile aus `public.admin_list_partners` (B16-1).
 *
 * `lead_count` und `customer_count` zählen VERSCHIEDENE Dinge und verhalten sich NICHT wie „davon
 * … davon": „gebracht" und „geworden" sind zwei Zahlen, und die zweite ist die, über die später
 * abgerechnet oder verhandelt wird. `lead_count` zählt anonymisierte Leads ausdrücklich MIT — genau
 * dafür hält B16-1 `partner_slug` aus `guard_anonymized_lead` heraus; eine Zahl, die nach 24 Monaten
 * schrumpft, nähme einem Fachbetrieb rückwirkend den Nachweis über die von ihm gebrachten Kontakte.
 */
export type PartnerRow = {
  slug: string
  display_name: string
  contact_first_name: string | null
  contact_last_name: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  lead_count: number
  customer_count: number
}

function asObject(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
}

/** `null` = der Wrapper hat NICHT `ok` gemeldet (nicht: „es gibt keine Fachbetriebe"). */
export function readPartnerList(data: unknown): PartnerRow[] | null {
  const obj = asObject(data)
  if (!obj || obj.status !== 'ok') return null
  return Array.isArray(obj.partners) ? (obj.partners as PartnerRow[]) : []
}

/**
 * Die Ansprechperson als EIN Satz — oder `null`.
 *
 * Zusammengeführt NUR für die Anzeige. `platform.partners` führt Vor- und Nachname bewusst getrennt
 * (B16-1: genau diese Zusammenlegung hat `platform.leads` einen brechenden Spaltenwechsel gekostet,
 * weil sich ein zusammengesetzter Name bei Doppelnamen und Titeln nicht zuverlässig zerlegen lässt).
 * Die Zusammenführung hier ändert nichts an den gespeicherten Werten — und sie geht nur in EINE
 * Richtung.
 */
export function contactPersonLabel(partner: PartnerRow): string | null {
  const parts = [partner.contact_first_name, partner.contact_last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' ') : null
}
