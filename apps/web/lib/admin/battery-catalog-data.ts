import 'server-only'

/**
 * Der LESEWEG des Abschnitts „Batteriespeicher" (K1) — getrennt von den Server Actions, damit die
 * Seiten ihn importieren können (eine `'use server'`-Datei exportiert ausschliesslich Actions).
 *
 * ── ⚠ WARUM DIE ADMIN-SEITE NICHT EINFACH `.from('battery_catalog')` LIEST ────────────────────
 * Weil sie dann die halbe Arbeit nicht sähe. Die RLS-Policy auf `public.battery_catalog` gibt dem
 * angemeldeten Client nur die AKTIVEN Zeilen frei — genau das ist ihr Zweck (ein halbfertiges Gerät
 * darf der öffentliche Rechner nicht ranken). Ein Entwurf, der noch bearbeitet werden muss, wäre
 * über den gewöhnlichen Weg unsichtbar.
 *
 * `public.admin_list_battery_catalog` ist deshalb SECURITY DEFINER mit `platform.is_admin()` im
 * Rumpf und liefert ALLE Zeilen — samt Einkaufspreis aus `platform.battery_purchase_prices`, an den
 * es sonst überhaupt keinen Weg gibt.
 */
import { createClient } from '@/lib/supabase/server'
import type { BatteryCatalogRow } from './battery-catalog'

export type BatteryCatalogFilter = {
  kategorie?: string | null
  active?: boolean | null
}

export type BatteryCatalogList = {
  rows: BatteryCatalogRow[]
  /**
   * ⚠ „konnte nicht geladen werden" ist NICHT dasselbe wie „es gibt keine Geräte". Ein leerer
   * Katalog ist ein gültiger Zustand; ein Fehler darf sich nicht als solcher lesen lassen.
   */
  failed: boolean
}

export async function listBatteries(
  filter: BatteryCatalogFilter = {},
): Promise<BatteryCatalogList> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_list_battery_catalog', {
    p_kategorie: filter.kategorie ?? undefined,
    p_active: filter.active ?? undefined,
  })

  if (error) {
    console.error('[admin/battery-catalog] admin_list_battery_catalog:', error)
    return { rows: [], failed: true }
  }

  return { rows: (data ?? []) as BatteryCatalogRow[], failed: false }
}

export async function getBattery(id: string): Promise<BatteryCatalogRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_get_battery', { p_id: id })

  if (error) {
    console.error('[admin/battery-catalog] admin_get_battery:', error)
    return null
  }

  const payload = (data ?? {}) as { status?: string; battery?: BatteryCatalogRow }
  return payload.status === 'ok' && payload.battery ? payload.battery : null
}
