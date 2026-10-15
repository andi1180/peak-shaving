/**
 * Die Netzbetreiber-Auswahl eines Projektlandes: Code-Katalog ∪ Betreiber aus `grid_tariffs` mit
 * diesem Land (`gridOperatorOptionsFor`, `shared`).
 *
 * Gelesen mit dem angemeldeten Client — `grid_tariffs` ist für `authenticated` lesbar.
 */
import 'server-only'

import {
  DEFAULT_COUNTRY,
  GRID_OPERATOR_CATALOG,
  gridOperatorOptionsFor,
  type Country,
  type GridOperatorOption,
} from 'shared'
import type { createClient } from '@/lib/supabase/server'
import type { KnownOperatorIds } from './invoice-extractions'
import { readAdminProject } from './projects'

type AdminClient = Awaited<ReturnType<typeof createClient>>

/** Ein Lesefehler fällt auf den Katalog des Landes zurück: die Liste ist eine Eingabehilfe. */
export async function readGridOperatorOptions(
  supabase: AdminClient,
  country: Country,
): Promise<GridOperatorOption[]> {
  const { data, error } = await supabase
    .from('grid_tariffs')
    .select('operator_id, operator_name')
    .eq('country', country)
    .order('valid_from', { ascending: false })

  if (error) {
    console.error('[admin/grid-operators] grid_tariffs:', error)
    return [...GRID_OPERATOR_CATALOG[country]]
  }
  return gridOperatorOptionsFor(country, data ?? [])
}

/** Die als bekannt geltenden Betreiber-Kennungen für das Land eines Projekts. */
export async function readKnownOperatorIdsForProject(
  supabase: AdminClient,
  projectId: string,
): Promise<KnownOperatorIds> {
  const projectRes = await supabase.rpc('admin_get_project', { p_id: projectId })
  const project = readAdminProject(projectRes.data)
  if (projectRes.error || project === null || project === 'not_found') {
    // Ohne lesbares Land gilt die Vorgabe vor der DE-Erweiterung: Österreich.
    console.error('[admin/grid-operators] Projektland nicht lesbar:', projectRes.error ?? project)
  }
  const country = project !== null && project !== 'not_found' ? project.country : DEFAULT_COUNTRY
  return (await readGridOperatorOptions(supabase, country)).map((option) => option.id)
}

/**
 * Anzeigename einer Kennung aus ihrer jüngsten Netzentgelt-Zeile im Land — für den Report, wenn der
 * Betreiber nicht im Code-Katalog steht. `null` bei Lesefehler oder ohne Zeile.
 */
export async function readOperatorDisplayName(
  supabase: AdminClient,
  operatorId: string,
  country: Country,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('grid_tariffs')
    .select('operator_name')
    .eq('operator_id', operatorId)
    .eq('country', country)
    .order('valid_from', { ascending: false })
    .limit(1)
  if (error) {
    console.error('[admin/grid-operators] operator_name:', error)
    return null
  }
  const name = data?.[0]?.operator_name?.trim()
  return name ? name : null
}
