'use server'

import { revalidatePath } from 'next/cache'
import { INVOICE_MERGE_FIELD_KEYS, type InvoiceMergeFieldKey } from 'shared'
import { dropInapplicableBillingModel } from '@/lib/project-chat/draft'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/db-types'
import { readKnownOperatorIdsForProject } from './grid-operators'
import { readStoredInvoiceExtractions } from './invoice-extractions'
import {
  WEIGHTABLE_INVOICE_FIELDS,
  invoiceChoicesNeedConsumption,
  invoiceFieldChoiceOffered,
  invoiceFieldConflictOptions,
  mergeInvoiceDraft,
  readInvoiceFieldChoices,
  withInvoiceFieldChoices,
  type InvoiceFieldChoice,
  type InvoiceFieldChoiceResult,
  type InvoiceFieldConflictsResult,
} from './invoice-field-choices'
import { readConsumptionByDay } from './invoice-field-choices-server'
import { readMeteringPointList, type MeteringPointSummary } from './metering-points'
import { projectDataEntryHref } from './projects'
import { FORBIDDEN, GENERIC, UUID, isForbidden, statusOf } from './data-entry-actions-shared'

type Client = Awaited<ReturnType<typeof createClient>>

const NOT_CONFLICTING =
  'Dieses Feld ist nicht (mehr) widersprüchlich. Bitte laden Sie die Seite neu.'

async function loadPoint(
  projectId: string,
  meteringPointId: string,
): Promise<{ supabase: Client; point: MeteringPointSummary } | { error: string }> {
  if (!UUID.test(projectId) || !UUID.test(meteringPointId)) return { error: GENERIC }
  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { error: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (Rechnungswahl):', listRes.error)
    return { error: GENERIC }
  }
  const point = readMeteringPointList(listRes.data)?.find((p) => p.id === meteringPointId)
  if (!point)
    return { error: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }
  return { supabase, point }
}

function isFieldKey(value: unknown): value is InvoiceMergeFieldKey {
  return (INVOICE_MERGE_FIELD_KEYS as readonly unknown[]).includes(value)
}

/** Nur die bekannten Felder einer Wahl — was der Aufruf sonst mitschickt, wird nicht gespeichert. */
function normalizeChoice(value: unknown): InvoiceFieldChoice | null {
  const raw = value as { kind?: unknown; documentId?: unknown } | null
  if (raw?.kind === 'weighted') return { kind: 'weighted' }
  if (raw?.kind === 'document' && typeof raw.documentId === 'string' && raw.documentId !== '') {
    return { kind: 'document', documentId: raw.documentId }
  }
  return null
}

/** Schreibt den Entwurf über den gemeinsamen Rechnungs-Pfad — EIN Schreibvorgang. */
async function writeMerged(
  supabase: Client,
  projectId: string,
  point: MeteringPointSummary,
  draft: Record<string, unknown>,
): Promise<InvoiceFieldChoiceResult> {
  const { draft: next } = mergeInvoiceDraft({
    draft,
    entries: readStoredInvoiceExtractions(point.draft),
    knownOperatorIds: await readKnownOperatorIdsForProject(supabase, projectId),
    now: new Date(),
    legacyInvoiceDraft: true,
    consumption: invoiceChoicesNeedConsumption(draft)
      ? await readConsumptionByDay(supabase, projectId, point.sourceDocumentId)
      : null,
  })
  const res = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: point.id,
    p_draft: dropInapplicableBillingModel(next) as Json,
  })
  if (res.error) {
    if (isForbidden(res.error)) return { ok: false, error: FORBIDDEN }
    console.error('[admin/dateneingabe] update_metering_point_draft (Rechnungswahl):', res.error)
    return { ok: false, error: GENERIC }
  }
  if (statusOf(res.data) !== 'ok') return { ok: false, error: GENERIC }
  revalidatePath(projectDataEntryHref(projectId))
  return { ok: true }
}

/** Die widersprüchlichen Rechnungsfelder eines Zählpunkts mit ihren Wahlmöglichkeiten. */
export async function getInvoiceFieldConflictsAction(
  projectId: string,
  meteringPointId: string,
): Promise<InvoiceFieldConflictsResult> {
  const loaded = await loadPoint(projectId, meteringPointId)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  const { supabase, point } = loaded
  const known = await readKnownOperatorIdsForProject(supabase, projectId)

  let conflicts = invoiceFieldConflictOptions(point.draft, null, known)
  // Den Lastgang nur lesen, wenn ein Mittelwert überhaupt angeboten wird.
  if (conflicts.some((c) => c.options.some((o) => o.kind === 'weighted'))) {
    const consumption = await readConsumptionByDay(supabase, projectId, point.sourceDocumentId)
    if (consumption !== null)
      conflicts = invoiceFieldConflictOptions(point.draft, consumption, known)
  }
  return { ok: true, conflicts }
}

/** Speichert die Wahl für ein widersprüchliches Feld und wendet sie sofort an. */
export async function chooseInvoiceFieldValueAction(
  projectId: string,
  meteringPointId: string,
  field: InvoiceMergeFieldKey,
  choice: InvoiceFieldChoice,
): Promise<InvoiceFieldChoiceResult> {
  const normalized = normalizeChoice(choice)
  if (!isFieldKey(field) || normalized === null) return { ok: false, error: GENERIC }
  if (
    normalized.kind === 'weighted' &&
    !(WEIGHTABLE_INVOICE_FIELDS as readonly string[]).includes(field)
  ) {
    return { ok: false, error: 'Für dieses Feld gibt es keinen gewichteten Mittelwert.' }
  }

  const loaded = await loadPoint(projectId, meteringPointId)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  const { supabase, point } = loaded

  const conflict = invoiceFieldConflictOptions(
    point.draft,
    null,
    await readKnownOperatorIdsForProject(supabase, projectId),
  ).find((c) => c.field === field)
  if (!conflict) return { ok: false, error: NOT_CONFLICTING }
  if (!invoiceFieldChoiceOffered(conflict, normalized)) {
    return { ok: false, error: 'Diese Wahl steht für dieses Feld nicht zur Verfügung.' }
  }

  const draft = withInvoiceFieldChoices(point.draft, {
    ...readInvoiceFieldChoices(point.draft),
    [field]: { ...normalized, chosenAt: new Date().toISOString() },
  })
  return writeMerged(supabase, projectId, point, draft)
}

/** Entfernt die Wahl; das Feld ist danach wieder leer. */
export async function clearInvoiceFieldChoiceAction(
  projectId: string,
  meteringPointId: string,
  field: InvoiceMergeFieldKey,
): Promise<InvoiceFieldChoiceResult> {
  if (!isFieldKey(field)) return { ok: false, error: GENERIC }
  const loaded = await loadPoint(projectId, meteringPointId)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  const { supabase, point } = loaded

  const stored = readInvoiceFieldChoices(point.draft)
  if (!stored[field]) return { ok: true }
  const rest = { ...stored }
  delete rest[field]
  return writeMerged(supabase, projectId, point, withInvoiceFieldChoices(point.draft, rest))
}
