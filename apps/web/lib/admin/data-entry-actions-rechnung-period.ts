'use server'

import { revalidatePath } from 'next/cache'
import { dropInapplicableBillingModel } from '@/lib/project-chat/draft'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/db-types'
import { readKnownOperatorIdsForProject } from './grid-operators'
import { readStoredInvoiceExtractions, type StoredInvoiceExtraction } from './invoice-extractions'
import { mergeInvoiceDraft, type InvoiceFieldChoiceResult } from './invoice-field-choices'
import { consumptionForInvoiceMerge } from './invoice-field-choices-server'
import { invoicePeriodOverrideError, localDateIso } from './invoice-period-flags'
import { readMeteringPointList } from './metering-points'
import { projectDataEntryHref } from './projects'
import {
  AUSTRIA_TIME_ZONE,
  FORBIDDEN,
  GENERIC,
  UUID,
  isForbidden,
  statusOf,
} from './data-entry-actions-shared'

const NOT_HERE = 'Diese Rechnung liegt nicht (mehr) an diesem Zählpunkt.'

/**
 * Ersetzt den Eintrag einer Rechnung und führt alle Rechnungen über den gemeinsamen Pfad neu
 * zusammen — Widersprüche, Wahl, Gewichtung und Verlaufsregel rechnen danach mit dem neuen Zeitraum.
 */
async function rewriteEntry(
  projectId: string,
  meteringPointId: string,
  documentId: string,
  update: (entry: StoredInvoiceExtraction) => StoredInvoiceExtraction,
): Promise<InvoiceFieldChoiceResult> {
  if (!UUID.test(projectId) || !UUID.test(meteringPointId) || typeof documentId !== 'string') {
    return { ok: false, error: GENERIC }
  }
  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { ok: false, error: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (Rechnungszeitraum):', listRes.error)
    return { ok: false, error: GENERIC }
  }
  const point = readMeteringPointList(listRes.data)?.find((p) => p.id === meteringPointId)
  if (!point) {
    return {
      ok: false,
      error: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.',
    }
  }

  const stored = readStoredInvoiceExtractions(point.draft)
  if (!stored.some((entry) => entry.documentId === documentId))
    return { ok: false, error: NOT_HERE }
  const entries = stored.map((entry) => (entry.documentId === documentId ? update(entry) : entry))

  const { draft: next } = mergeInvoiceDraft({
    draft: point.draft,
    entries,
    knownOperatorIds: await readKnownOperatorIdsForProject(supabase, projectId),
    now: new Date(),
    legacyInvoiceDraft: true,
    consumption: await consumptionForInvoiceMerge(supabase, projectId, point),
  })
  const res = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: point.id,
    p_draft: dropInapplicableBillingModel(next) as Json,
  })
  if (res.error) {
    if (isForbidden(res.error)) return { ok: false, error: FORBIDDEN }
    console.error(
      '[admin/dateneingabe] update_metering_point_draft (Rechnungszeitraum):',
      res.error,
    )
    return { ok: false, error: GENERIC }
  }
  if (statusOf(res.data) !== 'ok') return { ok: false, error: GENERIC }
  revalidatePath(projectDataEntryHref(projectId))
  return { ok: true }
}

/** Korrigiert den Abrechnungszeitraum einer gelesenen Rechnung (die Extraktion bleibt unverändert). */
export async function setInvoicePeriodOverrideAction(
  projectId: string,
  meteringPointId: string,
  documentId: string,
  from: string,
  to: string,
): Promise<InvoiceFieldChoiceResult> {
  const now = new Date()
  const error = invoicePeriodOverrideError(
    String(from),
    String(to),
    localDateIso(now, AUSTRIA_TIME_ZONE),
  )
  if (error !== null) return { ok: false, error }
  return rewriteEntry(projectId, meteringPointId, documentId, (entry) => ({
    ...entry,
    billingPeriodOverride: { from, to, at: now.toISOString() },
  }))
}

/** Entfernt die Korrektur; danach gilt wieder der gelesene Zeitraum. */
export async function clearInvoicePeriodOverrideAction(
  projectId: string,
  meteringPointId: string,
  documentId: string,
): Promise<InvoiceFieldChoiceResult> {
  return rewriteEntry(projectId, meteringPointId, documentId, (entry) => {
    const rest = { ...entry }
    delete rest.billingPeriodOverride
    return rest
  })
}
