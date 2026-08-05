/**
 * B19-Nachbesserung — Vokabular und Antwort-Leser der formlos erfassten Firmen.
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client — dieselbe Aufteilung wie
 * `lib/admin/partners.ts` (B16-2). Die Server-Seite liest die Typen, das Client-Formular die
 * Beschriftungen.
 *
 * ── ⚠ DAS IST NICHT DIE PARTNERLISTE, UND DAS IST DER GANZE PUNKT ───────────────────────────────
 * Eine Zeile hier ist eine NOTIZ: ein Betrieb, den ein Anrufer als Empfehlungsgeber genannt hat.
 * Sie hat kein `is_active`, keinen Slug, kein Konto und keinen Zugang. Sie landet in
 * `platform.leads.mentioned_business_id` und ausdrücklich NIE in `partner_slug` — jene Spalte ist
 * seit B18-6 ein Zugriffsrecht (`public.get_my_partner_leads` zeigt einem angemeldeten Fachbetrieb
 * darüber SEINE Anfragen mit Namen). Wer die beiden Listen zusammenlegt, verschenkt genau dieses
 * Recht an einen Namen, den jemand am Telefon gehört hat.
 *
 * Der Zeilen-Typ ist eine BEHAUPTUNG über die Migration, kein Beweis (`admin_list_mentioned_businesses`
 * gibt `jsonb` zurück). Deshalb liest `readMentionedBusinessList` defensiv: Ist der Status nicht
 * `ok`, kommt `null` zurück statt eines Laufzeitfehlers mitten im Rendern — und die Seite kann
 * „konnte nicht geladen werden" von „es gibt noch keine Firmen" unterscheiden. Der Unterschied ist
 * nicht theoretisch: Eine leere Liste ist der NORMALZUSTAND am ersten Tag.
 */

/** Eine Zeile aus `public.admin_list_mentioned_businesses`. */
export type MentionedBusinessRow = {
  id: string
  name: string
  created_at: string
  /**
   * Wie viele Leads diese Firma bisher genannt haben — die einzige Zahl, die aus dieser Ablage
   * überhaupt etwas macht. Zählt anonymisierte Leads MIT (die Zuordnung überlebt die
   * Anonymisierung, wie `partner_slug`).
   */
  lead_count: number
}

function asObject(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
}

/** `null` = der Wrapper hat NICHT `ok` gemeldet (nicht: „es gibt keine Firmen"). */
export function readMentionedBusinessList(data: unknown): MentionedBusinessRow[] | null {
  const obj = asObject(data)
  if (!obj || obj.status !== 'ok') return null
  return Array.isArray(obj.businesses) ? (obj.businesses as MentionedBusinessRow[]) : []
}

/**
 * Der Status aus `public.admin_attach_mentioned_business`.
 *
 * `anonymized` und `not_found` sind fachliche Zustände und keine Fehler — der Wrapper wirft dafür
 * nicht. Sie sind auf dem Aufnahmeweg praktisch unerreichbar (der Lead entsteht Sekunden vorher),
 * werden aber gelesen statt geraten: was nicht `ok` ist, gilt als nicht zugeordnet.
 */
export type AttachMentionOutcome = {
  status: 'ok' | 'not_found' | 'anonymized'
  business_id?: string | null
  name?: string | null
  created?: boolean
}

/** `null` = unlesbare Antwort. Der Aufrufer behandelt das wie einen Fehlschlag. */
export function readAttachOutcome(data: unknown): AttachMentionOutcome | null {
  const obj = asObject(data)
  if (!obj || typeof obj.status !== 'string') return null
  return obj as AttachMentionOutcome
}
