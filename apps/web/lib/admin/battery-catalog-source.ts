import 'server-only'

import {
  BATTERY_CATALOG_SELECT,
  loadBatteryCatalog,
  toBatteryCatalogRows,
  type BatteryCatalogCategory,
  type BatteryCatalogResult,
} from 'shared'

import type { createClient } from '@/lib/supabase/server'

type CatalogClient = Awaited<ReturnType<typeof createClient>>

/** Dieselbe Frist wie im öffentlichen Rechner (`apps/website/lib/battery-catalog/source.ts`). */
export const BATTERY_CATALOG_TIMEOUT_MS = 3_000

/**
 * K3c — die Katalog-Kategorie des Wizard-Laufs, DIREKT aus dem B24-Segment des Projekts.
 *
 * Bewusst nicht `batteryCategoryFor` des öffentlichen Rechners: jene Funktion rät aus dem Einstieg,
 * hier liegt eine ausdrückliche Angabe vor. `null` (Segment nie gewählt) wird nicht geraten.
 */
export function batteryCategoryForSegment(
  segment: string | null,
): BatteryCatalogCategory | null {
  if (segment === 'privat') return 'heim'
  if (segment === 'betrieb') return 'gewerbe'
  return null
}

/**
 * Der Speicherkatalog für einen Wizard-Lauf, über den K3a-Loader.
 *
 * ⚠ HARTE REGEL (K3c): Der Katalog wird NUR mit einer Rolle gelesen, für die RLS gilt — hier der
 * angemeldete Admin (`authenticated`) aus `createClient()`. NIE mit `service_role` und NIE über die
 * SECURITY-DEFINER-Pflegewrapper (`admin_list_battery_catalog`): beide sehen inaktive Entwürfe, und
 * ein Entwurf mit ungeprüften Kenndaten stünde dann als Empfehlung im Kundenreport.
 */
export async function fetchBatteryCatalogForAnalysis(
  supabase: CatalogClient,
  category: BatteryCatalogCategory,
): Promise<BatteryCatalogResult> {
  return loadBatteryCatalog(category, async (requested) => {
    try {
      const response = await supabase
        .from('battery_catalog')
        .select(BATTERY_CATALOG_SELECT)
        .eq('kategorie', requested)
        .eq('active', true)
        .order('usable_capacity_kwh', { ascending: true })
        // postgrest-js wiederholt GETs sonst still mit 1/2/4 s Backoff, und ein Hänger liefe unbegrenzt.
        .retry(false)
        .abortSignal(AbortSignal.timeout(BATTERY_CATALOG_TIMEOUT_MS))
      if (response.error) {
        return {
          ok: false,
          reason: 'request_failed',
          message: `Der Speicherkatalog liess sich nicht abrufen (${response.error.message}).`,
        }
      }
      return { ok: true, rows: toBatteryCatalogRows(response.data) }
    } catch (cause) {
      // Ein Netzfehler wirft statt `{ error }` zu liefern (K3b, im Browser gemessen).
      return {
        ok: false,
        reason: 'request_failed',
        message: `Der Speicherkatalog liess sich nicht abrufen (${
          cause instanceof Error ? cause.message : String(cause)
        }).`,
      }
    }
  })
}
