/**
 * Zeilen-Typen der drei `admin_list_*`-Wrapper (T4-4).
 *
 * Die Wrapper geben `jsonb` zurück; der Supabase-Typgenerator kennt davon nur `Json`. Diese Typen
 * beschreiben die tatsächliche Form — sie sind eine BEHAUPTUNG über die Migration, kein Beweis.
 * Deshalb liest `readList` unten defensiv: fehlt der erwartete Schlüssel oder ist der Status nicht
 * `ok`, kommt eine leere Liste zurück statt eines Laufzeitfehlers mitten im Rendern.
 *
 * Rein: kein `server-only`, kein `next/*` — Server- wie Client-Komponenten lesen von hier.
 */

/** Statuscache des Scrapers (monitor.scrape_targets, CHECK auf diese drei Werte). */
export type ScrapeStatus = 'ok' | 'failed' | 'never'

export type ScrapeTargetRow = {
  id: string
  provider_name: string
  provider_slug: string
  tariff_page_url: string
  is_active: boolean
  network_area: string | null
  sort_priority: number
  notes: string | null
  extraction_config: unknown
  last_scrape_status: ScrapeStatus | null
  last_scrape_at: string | null
  last_scrape_error: string | null
  updated_at: string
}

export type EntitlementRow = {
  product: string
  /** stripe = vom Sync-Trigger abgeleitet, manual = händisch/per Gutscheincode. */
  source: 'stripe' | 'manual'
  is_active: boolean
  valid_until: string | null
  /** is_active UND nicht abgelaufen — dieselbe Regel wie platform.has_entitlement (I1/T11). */
  currently_active: boolean
}

export type UserRow = {
  user_id: string
  email: string | null
  created_at: string
  display_name: string | null
  roles: string[]
  entitlements: EntitlementRow[]
}

export type CodeRow = {
  id: string
  code: string
  product_key: string
  max_redemptions: number | null
  redemption_count: number
  expires_at: string | null
  is_active: boolean
  note: string | null
  created_at: string
}

/**
 * Liest die Liste aus einer Wrapper-Antwort. Gibt `null` zurück, wenn der Wrapper NICHT `ok`
 * gemeldet hat — der Aufrufer unterscheidet damit „nichts angelegt" (leere Liste) von „konnte nicht
 * gelesen werden" (null) und kann Letzteres anzeigen, statt eine leere Tabelle zu behaupten.
 */
export function readList<T>(data: unknown, key: string): T[] | null {
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  if (obj.status !== 'ok') return null
  const list = obj[key]
  return Array.isArray(list) ? (list as T[]) : []
}

/** Ob die Nutzerliste abgeschnitten wurde (der Wrapper deckelt bei 500 und sagt es mit). */
export function readTruncation(data: unknown): { total: number; truncated: boolean } {
  if (typeof data !== 'object' || data === null) return { total: 0, truncated: false }
  const obj = data as Record<string, unknown>
  return {
    total: typeof obj.total === 'number' ? obj.total : 0,
    truncated: obj.truncated === true,
  }
}
