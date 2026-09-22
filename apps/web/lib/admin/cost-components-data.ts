import 'server-only'

/**
 * Der LESEWEG der Kostenbausteine (K1b) — getrennt von den Server Actions, damit die Seiten ihn
 * importieren können (eine `'use server'`-Datei exportiert ausschliesslich Actions).
 *
 * ⚠ Wie beim Katalog gilt: `.from('battery_cost_components')` zeigte dem Admin die halbe Arbeit
 * nicht. Die RLS-Policy gibt nur BEPREISTE Zeilen frei — und ein Baustein ohne Preis ist genau
 * der, den jemand bearbeiten will.
 */
import { createClient } from '@/lib/supabase/server'
import type { CostComponentRow } from './cost-components'

export type CostComponentList = {
  rows: CostComponentRow[]
  /** „konnte nicht geladen werden" ist nicht dasselbe wie „es gibt keine Bausteine". */
  failed: boolean
}

export async function listCostComponents(art?: string | null): Promise<CostComponentList> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_list_cost_components', {
    p_art: art ?? undefined,
  })

  if (error) {
    console.error('[admin/cost-components] admin_list_cost_components:', error)
    return { rows: [], failed: true }
  }

  return { rows: (data ?? []) as CostComponentRow[], failed: false }
}

export async function getCostComponent(id: string): Promise<CostComponentRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_get_cost_component', { p_id: id })

  if (error) {
    console.error('[admin/cost-components] admin_get_cost_component:', error)
    return null
  }

  const payload = (data ?? {}) as Partial<CostComponentRow> & { status?: string }
  return payload.status === 'not_found' || !payload.id ? null : (payload as CostComponentRow)
}
