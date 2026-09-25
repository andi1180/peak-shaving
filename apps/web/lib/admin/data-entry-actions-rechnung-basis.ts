'use server'

import { revalidatePath } from 'next/cache'
import { dropInapplicableBillingModel, setDraftField } from '@/lib/project-chat/draft'
import { createClient } from '@/lib/supabase/server'
import {
  foldStoredInvoices,
  readPriceBasisField,
  readStoredInvoiceExtractions,
  withInvoicePriceBasis,
  withStoredInvoiceExtractions,
} from './invoice-extractions'
import { readMeteringPointList } from './metering-points'
import { projectDataEntryHref } from './projects'
import type { AdminState } from './schema'
import type { Json } from '@/db-types'
import {
  FORBIDDEN,
  GENERIC,
  UNKNOWN_PROJECT,
  UUID,
  isForbidden,
  readProjectId,
  statusOf,
} from './data-entry-actions-shared'

/**
 * H3 — die Preisbasis einer gelesenen Rechnung festlegen, deren Scan sie als unklar gemeldet hat.
 *
 * Bis dahin gehen ihre Lieferantenpreise nicht in den Entwurf (kein stiller Default). Nach der Wahl
 * werden alle Rechnungen neu gefaltet — dieselbe Regel wie beim Upload und beim Entfernen.
 */
export async function setInvoicePriceBasisAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  const documentId = String(formData.get('documentId') ?? '').trim()
  const basis = readPriceBasisField(formData.get('basis'))
  if (!UUID.test(meteringPointId) || documentId === '' || basis === null) {
    return { formError: GENERIC }
  }

  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (Preisbasis):', listRes.error)
    return { formError: GENERIC }
  }
  const point = readMeteringPointList(listRes.data)?.find((p) => p.id === meteringPointId)
  if (!point)
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }

  const stored = readStoredInvoiceExtractions(point.draft)
  if (!stored.some((entry) => entry.documentId === documentId)) {
    revalidatePath(projectDataEntryHref(projectId))
    return { formError: 'Diese Rechnung liegt nicht (mehr) an diesem Zählpunkt.' }
  }
  const next = stored.map((entry) =>
    entry.documentId === documentId ? { ...entry, supplierPriceBasisChosen: basis } : entry,
  )

  const fold = foldStoredInvoices(next)
  let nextDraft = withInvoicePriceBasis(withStoredInvoiceExtractions(point.draft, next), fold)
  const now = new Date()
  for (const { field, value } of fold.values) {
    nextDraft = setDraftField(nextDraft, field, value, 'measured', undefined, now)
  }

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    p_draft: dropInapplicableBillingModel(nextDraft) as Json,
  })
  if (draftRes.error) {
    if (isForbidden(draftRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] update_metering_point_draft (Preisbasis):', draftRes.error)
    return { formError: GENERIC }
  }
  if (statusOf(draftRes.data) !== 'ok') return { formError: GENERIC }

  revalidatePath(projectDataEntryHref(projectId))
  return {
    success:
      basis === 'gross'
        ? 'Preisbasis „inkl. USt" übernommen — die Lieferantenpreise sind netto umgerechnet.'
        : 'Preisbasis „netto" übernommen.',
  }
}
