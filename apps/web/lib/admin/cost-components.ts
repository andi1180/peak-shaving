/**
 * Kostenbausteine (K1b) — Fundament und Installation als eigene, EINMAL bepreisbare Zeilen.
 *
 * ── WARUM NICHT ZWEI BETRÄGE AM GERÄT ────────────────────────────────────────────────────────
 * Weil ein Fundament keine Eigenschaft des Geräts ist, sondern eine Leistung je Grössenklasse:
 * dieselbe Bodenplatte trägt einen 107-kWh-Schrank von SMA wie einen von SolarEdge. Als Betrag am
 * Gerät stünde derselbe Preis neun Mal da — neun Stellen, an denen er auseinanderlaufen kann.
 */

export const COST_COMPONENTS_HREF = '/admin/kostenbausteine'

export const COST_COMPONENT_ARTEN = ['fundament', 'installation'] as const
export type CostComponentArt = (typeof COST_COMPONENT_ARTEN)[number]

export const COST_COMPONENT_ART_LABELS: Record<CostComponentArt, string> = {
  fundament: 'Fundament',
  installation: 'Installation',
}

/**
 * Eine Zeile, wie `public.admin_list_cost_components` / `admin_get_cost_component` sie liefern.
 *
 * ⚠ `used_by_count` und `used_by_active_count` fahren aus dem Wrapper mit, nicht aus einem zweiten
 * Aufruf: die Liste muss zeigen, ob ein Löschen abgewiesen würde, und zwei Abfragen könnten
 * dazwischen auseinanderlaufen.
 */
export type CostComponentRow = {
  id: string
  art: string
  bezeichnung: string
  beschreibung: string | null
  price_net: number | null
  price_as_of: string | null
  notes: string | null
  created_at: string
  updated_at: string
  used_by_count: number
  used_by_active_count: number
}

export function costComponentArtLabel(value: string): string {
  return COST_COMPONENT_ART_LABELS[value as CostComponentArt] ?? value
}

/** Netto-Euro, wie im Katalog: deutsche Schreibweise, zwei Nachkommastellen. */
export function costComponentPriceText(row: Pick<CostComponentRow, 'price_net'>): string {
  if (row.price_net === null) return 'noch nicht bepreist'
  return `${row.price_net.toLocaleString('de-AT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`
}

/**
 * Die Beschriftung im Auswahlfeld des Geräteformulars. Der Preis steht MIT dabei, und wo er fehlt,
 * steht das ausdrücklich — sonst wählt jemand einen Baustein aus und versteht die anschliessend
 * abgelehnte Freigabe nicht.
 */
export function costComponentOptionLabel(row: Pick<CostComponentRow, 'bezeichnung' | 'price_net'>): string {
  return `${row.bezeichnung} — ${costComponentPriceText(row)}`
}

/**
 * Darf dieser Baustein gelöscht werden? Die ANTWORT gibt die Datenbank (Fremdschlüssel mit
 * `on delete restrict`); das hier ist die Anzeige davor, damit niemand vergeblich klickt.
 */
export function costComponentInUse(row: CostComponentRow): boolean {
  return row.used_by_count > 0
}

export function costComponentDeleteConfirmText(row: CostComponentRow): string {
  return `„${row.bezeichnung}" wirklich löschen? Das lässt sich nicht rückgängig machen.`
}

/**
 * Warum der Preis nicht entfallen darf. Nur aussagekräftig, solange AKTIVE Geräte den Baustein
 * nutzen — ein Entwurf darf seinen Baustein jederzeit unbepreist sehen.
 */
export function costComponentPriceLocked(row: CostComponentRow): boolean {
  return row.price_net !== null && row.used_by_active_count > 0
}
