import 'server-only'

import { readDailyConsumption } from 'extractors'
import { COUNTRY_DISPLAY, type GridTariffRowInput } from 'shared'
import { readProjectDocument } from '@/lib/project-documents/documents'
import type { createClient } from '@/lib/supabase/server'
import { gridTariffReadOfPoint, readGridTariffRowsForAnalysis } from './analysis-tariff-inputs'
import { invoiceChoicesNeedConsumption, type ConsumptionByDay } from './invoice-field-choices'
import { readAdminProject } from './projects'

type AdminClient = Awaited<ReturnType<typeof createClient>>

/**
 * Netzbezug je Ortstag aus der Lastgang-Datei des Zählpunkts. Ohne Lastgang oder bei einem
 * Lesefehler `null` — dann wird nach Tagen gewichtet, nicht abgebrochen.
 */
export async function readConsumptionByDay(
  supabase: AdminClient,
  projectId: string,
  sourceDocumentId: string | null,
): Promise<ConsumptionByDay | null> {
  if (sourceDocumentId === null) return null
  try {
    const document = await readProjectDocument(sourceDocumentId)
    if (!document.ok) {
      console.warn('[admin/rechnungswahl] Lastgang nicht lesbar:', document.reason)
      return null
    }
    const projectRes = await supabase.rpc('admin_get_project', { p_id: projectId })
    const project = readAdminProject(projectRes.data)
    const timezone =
      project !== null && project !== 'not_found'
        ? COUNTRY_DISPLAY[project.country].timeZone
        : undefined
    const outcome = readDailyConsumption(document.bytes, document.filename, { timezone })
    if (!outcome.ok) {
      console.warn('[admin/rechnungswahl] Lastgang nicht auswertbar:', outcome.reason)
      return null
    }
    return { days: outcome.days, intervalMinutes: outcome.intervalMinutes }
  } catch (cause) {
    console.warn('[admin/rechnungswahl] Lastgang-Lesen fehlgeschlagen:', cause)
    return null
  }
}

/** Der Lastgang nur, wenn eine gespeicherte Mittelwert-Wahl ihn für die Zusammenführung braucht. */
export async function consumptionForInvoiceMerge(
  supabase: AdminClient,
  projectId: string,
  point: { draft: Record<string, unknown>; sourceDocumentId: string | null },
): Promise<ConsumptionByDay | null> {
  return invoiceChoicesNeedConsumption(point.draft)
    ? readConsumptionByDay(supabase, projectId, point.sourceDocumentId)
    : null
}

/**
 * Die Netzentgelt-Zeilen des Zählpunkts über seinen Lastgang-Zeitraum — dieselbe Auswahl wie der
 * Analyse-Lauf. `null`, wenn nicht bestimmbar oder nicht lesbar (dann gilt „keine Stufen").
 */
export async function readGridTariffRowsOfPoint(
  supabase: AdminClient,
  projectId: string,
  point: { draft: Record<string, unknown>; coveredFrom: string | null; coveredTo: string | null },
): Promise<GridTariffRowInput[] | null> {
  const read = gridTariffReadOfPoint(point)
  if (read === null) return null
  try {
    const projectRes = await supabase.rpc('admin_get_project', { p_id: projectId })
    const project = readAdminProject(projectRes.data)
    if (project === null || project === 'not_found') return null
    return await readGridTariffRowsForAnalysis(supabase, { ...read, country: project.country })
  } catch (cause) {
    console.warn('[admin/rechnungswahl] Netzentgelt-Zeilen nicht lesbar:', cause)
    return null
  }
}
